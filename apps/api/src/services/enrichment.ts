import geoip from 'geoip-lite';
import { pool } from '../db/pool';
import { CapiService } from './capi';
import { DDI_LIST } from '../lib/ddi';
import { parseStoredTrafficSource, resolveSaleOriginFromHistory } from '../lib/visitorTrafficSource';

interface EnrichedData {
  fbp?: string;
  fbc?: string;
  externalId?: string;
  clientIp?: string;
  clientUa?: string;
  city?: string;
  state?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickId?: string;
  landingUrl?: string;
}

export class EnrichmentService {
  private static canonicalEid(val: unknown): string | null {
    if (val == null) return null;
    const s = String(val).trim();
    if (!s) return null;
    return s.startsWith('eid_') ? s : null;
  }

  static async findVisitorData(siteKey: string, email?: string, phone?: string, externalId?: string, options?: { ip?: string, country?: string }): Promise<EnrichedData | null> {
    if (!email && !phone && !externalId && !options?.ip) return null;

    const emailHash = email ? CapiService.hash(email) : null;
    
    // Normalização inteligente de telefone antes de gerar o hash para a busca
    let phoneHash: string | null = null;
    if (phone) {
      let p = phone.replace(/[^0-9]/g, '');
      if (p.length >= 10 && p.length <= 11) {
        let iso = (options?.country || '').toUpperCase().trim();
        if (!iso && options?.ip) {
          const geo = geoip.lookup(options.ip);
          if (geo?.country) iso = geo.country;
        }
        const targetCountry = iso || 'BR';
        const ddi = DDI_LIST.find(d => d.country === targetCountry)?.code;
        if (ddi && !p.startsWith(ddi)) {
          p = ddi + p;
        } else if (targetCountry === 'BR' && !p.startsWith('55')) {
          p = '55' + p;
        }
      }
      phoneHash = CapiService.hash(p);
    }

    if (!emailHash && !phoneHash && !externalId && !options?.ip) return null;

    // 1. Tentar buscar em site_visitors (Perfil consolidado)
    // Prioridade: IDs diretos > IP (Se habilitado)
    const visitorQuery = `
      SELECT fbp, fbc, external_id, last_traffic_source, first_traffic_source, last_ip, last_user_agent
      FROM site_visitors
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND email_hash = $2::text) OR
          ($3::text IS NOT NULL AND phone_hash = $3::text) OR
          ($4::text IS NOT NULL AND external_id = $4::text) OR
          ($5::text IS NOT NULL AND last_ip = $5::text)
        )
      ORDER BY 
        CASE WHEN external_id LIKE 'eid\\_%' THEN 0 ELSE 1 END ASC,
        CASE 
          WHEN email_hash = $2::text THEN 1
          WHEN phone_hash = $3::text THEN 2
          WHEN external_id = $4::text THEN 3
          WHEN last_ip = $5::text THEN 4
          ELSE 5
        END ASC,
        last_seen_at DESC
      LIMIT 1
    `;

    // Cross-site fallback: busca nos outros sites da mesma conta que compartilham o MESMO pixel
    const crossSiteQuery = `
      SELECT sv.fbp, sv.fbc, sv.external_id, sv.last_traffic_source, sv.first_traffic_source, sv.last_ip, sv.last_user_agent
      FROM site_visitors sv
      JOIN sites s ON s.site_key = sv.site_key
      JOIN integrations_meta m ON m.site_id = s.id
      WHERE s.account_id = (SELECT account_id FROM sites WHERE site_key = $1)
        AND sv.site_key != $1
        AND m.pixel_id IN (
          SELECT m2.pixel_id FROM sites s2
          JOIN integrations_meta m2 ON m2.site_id = s2.id
          WHERE s2.site_key = $1
          LIMIT 1
        )
        AND (
          ($2::text IS NOT NULL AND sv.email_hash = $2::text) OR
          ($3::text IS NOT NULL AND sv.phone_hash = $3::text) OR
          ($4::text IS NOT NULL AND sv.external_id = $4::text) OR
          ($5::text IS NOT NULL AND sv.last_ip = $5::text)
        )
      ORDER BY 
        CASE WHEN sv.external_id LIKE 'eid\\_%' THEN 0 ELSE 1 END ASC,
        CASE 
          WHEN sv.email_hash = $2::text THEN 1
          WHEN sv.phone_hash = $3::text THEN 2
          WHEN sv.external_id = $4::text THEN 3
          WHEN sv.last_ip = $5::text THEN 4
          ELSE 5
        END ASC,
        sv.last_seen_at DESC
      LIMIT 1
    `;

    try {
      const queryParams = [
        siteKey, 
        emailHash, 
        phoneHash, 
        externalId || null,
        options?.ip || null
      ];

      let visitorRes = await pool.query(visitorQuery, queryParams);
      
      // Cross-site fallback: se não achou no site atual, busca nos irmãos da mesma conta
      if (!visitorRes.rowCount || visitorRes.rowCount === 0) {
        console.log(`[Enrichment] No visitor found in site ${siteKey}, trying cross-site fallback...`);
        try {
          visitorRes = await pool.query(crossSiteQuery, queryParams);
          if (visitorRes.rowCount && visitorRes.rowCount > 0) {
            console.log(`[Enrichment] Cross-site match found! Recovered visitor data from sibling site.`);
          } else {
            console.log(`[Enrichment] Cross-site fallback: no match found for email=${!!emailHash} phone=${!!phoneHash} extId=${!!externalId} ip=${!!options?.ip}`);
          }
        } catch (csErr) {
          console.error(`[Enrichment] Cross-site query FAILED for site ${siteKey}:`, csErr);
        }
      }

      let visitorData: any = {};
      
      if (visitorRes.rowCount && visitorRes.rowCount > 0) {
        const row = visitorRes.rows[0];
        const utmsLast = this.parseUtmString(row.last_traffic_source);
        const utmsFirst = this.parseUtmString(row.first_traffic_source);
        visitorData = {
          fbp: row.fbp,
          fbc: row.fbc,
          externalId: this.canonicalEid(row.external_id) || undefined,
          clientIp: row.last_ip,
          clientUa: row.last_user_agent,
          ...utmsFirst,
          ...Object.fromEntries(Object.entries(utmsLast).filter(([, v]) => v)),
        };
      }

      // Buscar metadados (IP/UA) mais recentes em web_events caso falte no visitorData
      // ou se o match foi por IP e queremos dados de UA/Geolocalização mais completos
      const metadata = await this.findLatestMetadata(
        siteKey, 
        visitorData.fbp, 
        visitorData.externalId || externalId, 
        emailHash, 
        phoneHash
      );

      if (Object.keys(visitorData).length > 0 || metadata) {
        return {
          ...visitorData,
          clientIp: visitorData.clientIp || metadata?.ip || options?.ip,
          clientUa: visitorData.clientUa || metadata?.ua,
          city: visitorData.city || metadata?.city,
          state: visitorData.state || metadata?.state,
          utmSource: visitorData.utmSource || metadata?.utm_source,
          utmMedium: visitorData.utmMedium || metadata?.utm_medium,
          utmCampaign: visitorData.utmCampaign || metadata?.utm_campaign,
          utmContent: visitorData.utmContent || metadata?.utm_content,
          utmTerm: visitorData.utmTerm || metadata?.utm_term
        };
      }

      // 2. Se não achou de jeito nenhum, retornar null para que o webhook use o que tem no payload
      return null;
    } catch (err) {
      console.error(`[Enrichment] Error searching for visitor data (site=${siteKey}):`, err);
      return null;
    }
  }

  /**
   * UTMs + URL da última landing com origem, mesmo quando fbp/fbc já existem.
   * Usado no Purchase CAPI quando o checkout chega sem UTM.
   */
  static async findAttributionHistory(
    siteKey: string,
    opts: {
      externalId?: string | null;
      fbp?: string | null;
      fbc?: string | null;
      emailHash?: string | null;
    }
  ): Promise<EnrichedData | null> {
    const ext = (opts.externalId || '').trim();
    const fbp = (opts.fbp || '').trim();
    const fbc = (opts.fbc || '').trim();
    const emailHash = (opts.emailHash || '').trim();
    if (!ext && !fbp && !fbc && !emailHash) return null;

    try {
      const vis = await pool.query<{
        last_traffic_source: string | null;
        first_traffic_source: string | null;
        external_id: string | null;
      }>(
        `SELECT last_traffic_source, first_traffic_source, external_id
         FROM site_visitors
         WHERE site_key = $1
           AND (
             ($2::text <> '' AND external_id = $2)
             OR ($3::text <> '' AND fbp IS NOT NULL AND fbp = $3)
             OR ($4::text <> '' AND fbc IS NOT NULL AND fbc = $4)
             OR ($5::text <> '' AND email_hash IS NOT NULL AND email_hash = $5)
           )
         ORDER BY last_seen_at DESC NULLS LAST
         LIMIT 1`,
        [siteKey, ext, fbp, fbc, emailHash]
      );
      const row = vis.rows[0];
      const eid = this.canonicalEid(row?.external_id) || this.canonicalEid(ext);

      const history: Array<Record<string, string> | null> = [];
      let landingUrl: string | undefined;
      if (eid) {
        const ev = await pool.query<{ event_source_url: string | null; custom_data: unknown }>(
          `SELECT event_source_url, custom_data
           FROM web_events
           WHERE site_key = $1
             AND user_data->>'external_id' = $2
             AND event_name = 'PageView'
             AND event_time >= NOW() - INTERVAL '60 days'
           ORDER BY event_time DESC
           LIMIT 40`,
          [siteKey, eid]
        );
        for (const e of ev.rows) {
          const url = typeof e.event_source_url === 'string' ? e.event_source_url.trim() : '';
          const fromUrl = url ? parseStoredTrafficSource(url.includes('?') ? url.slice(url.indexOf('?')) : '') : null;
          const fromCd =
            e.custom_data && typeof e.custom_data === 'object'
              ? parseStoredTrafficSource(
                  Object.entries(e.custom_data as Record<string, unknown>)
                    .filter(([, v]) => typeof v === 'string' && String(v).trim())
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
                    .join('&')
                )
              : null;
          const merged: Record<string, string> = {
            utm_source: (fromUrl?.utm_source || fromCd?.utm_source || '').trim(),
            utm_medium: (fromUrl?.utm_medium || fromCd?.utm_medium || '').trim(),
            utm_campaign: (fromUrl?.utm_campaign || fromCd?.utm_campaign || '').trim(),
            utm_content: (fromUrl?.utm_content || fromCd?.utm_content || '').trim(),
            utm_term: (fromUrl?.utm_term || fromCd?.utm_term || '').trim(),
            click_id: (fromUrl?.click_id || fromCd?.click_id || '').trim(),
          };
          history.push(merged);
          if (!landingUrl && url.startsWith('http') && (merged.utm_source || merged.utm_campaign || merged.utm_content)) {
            landingUrl = url;
          }
        }
      }

      const fromLast = row?.last_traffic_source ? parseStoredTrafficSource(String(row.last_traffic_source)) : null;
      const fromFirst = row?.first_traffic_source ? parseStoredTrafficSource(String(row.first_traffic_source)) : null;
      const resolved = resolveSaleOriginFromHistory(fromLast, [...history, fromFirst]);
      if (!resolved && !landingUrl) return null;

      return {
        utmSource: resolved?.utm_source || undefined,
        utmMedium: resolved?.utm_medium || undefined,
        utmCampaign: resolved?.utm_campaign || undefined,
        utmContent: resolved?.utm_content || undefined,
        utmTerm: resolved?.utm_term || undefined,
        clickId: resolved?.click_id || undefined,
        landingUrl,
      };
    } catch (err) {
      console.error(`[Enrichment] findAttributionHistory failed (site=${siteKey}):`, err);
      return null;
    }
  }

  private static async findLatestMetadata(siteKey: string, fbp?: string, externalId?: string, emailHash?: string | null, phoneHash?: string | null) {
    const baseQuery = (whereClause: string) => `
      SELECT 
        user_data->>'client_ip_address' as ip, 
        user_data->>'client_user_agent' as ua,
        user_data->>'ct' as city,
        user_data->>'st' as state,
        custom_data->>'utm_source' as utm_source,
        custom_data->>'utm_medium' as utm_medium,
        custom_data->>'utm_campaign' as utm_campaign,
        custom_data->>'utm_content' as utm_content,
        custom_data->>'utm_term' as utm_term
      FROM web_events
      ${whereClause}
        AND (
          ($2::text IS NOT NULL AND user_data->>'fbp' = $2::text) OR
          ($3::text IS NOT NULL AND (
            user_data->>'external_id' = $3::text OR
            (jsonb_typeof(user_data->'external_id') = 'array' AND user_data->'external_id'->>0 = $3::text)
          )) OR
          ($4::text IS NOT NULL AND (
            user_data->>'em' = $4::text OR
            (jsonb_typeof(user_data->'em') = 'array' AND user_data->'em'->>0 = $4::text)
          )) OR
          ($5::text IS NOT NULL AND (
            user_data->>'ph' = $5::text OR
            (jsonb_typeof(user_data->'ph') = 'array' AND user_data->'ph'->>0 = $5::text)
          ))
        )
      ORDER BY
        CASE
          WHEN custom_data->>'utm_source' IS NOT NULL AND BTRIM(custom_data->>'utm_source') <> '' THEN 0
          WHEN custom_data->>'utm_campaign' IS NOT NULL AND BTRIM(custom_data->>'utm_campaign') <> '' THEN 0
          ELSE 1
        END ASC,
        event_time DESC
      LIMIT 1
    `;

    const params = [siteKey, fbp || null, externalId || null, emailHash || null, phoneHash || null];

    try {
      // 1. Buscar no site atual
      let res = await pool.query(baseQuery('WHERE site_key = $1'), params);
      
      // 2. Cross-site fallback: buscar nos sites irmãos com o mesmo pixel
      if (!res.rowCount || res.rowCount === 0) {
        const crossSiteWhere = `
          WHERE site_key IN (
            SELECT s2.site_key FROM sites s1
            JOIN integrations_meta m1 ON m1.site_id = s1.id
            JOIN integrations_meta m2 ON m2.pixel_id = m1.pixel_id
            JOIN sites s2 ON s2.id = m2.site_id
            WHERE s1.site_key = $1 AND s2.site_key != $1
          )`;
        res = await pool.query(baseQuery(crossSiteWhere), params);
      }
      
      if (res.rowCount && res.rowCount > 0) return res.rows[0];
    } catch (e) { /* ignore */ }
    return null;
  }

  private static parseUtmString(source?: string) {
    if (!source) return {};
    try {
      // Extrair apenas a query string se for uma URL completa
      let queryString = source;
      if (source.includes('?')) {
        queryString = source.split('?')[1];
      }
      
      const urlParams = new URLSearchParams(queryString);
      const utms: any = {};
      
      const sourceVal = urlParams.get('utm_source');
      if (sourceVal && !sourceVal.startsWith('trk_')) utms.utmSource = sourceVal;
      
      const mediumVal = urlParams.get('utm_medium');
      if (mediumVal) utms.utmMedium = mediumVal;
      
      const campaignVal = urlParams.get('utm_campaign');
      if (campaignVal) utms.utmCampaign = campaignVal;
      
      const contentVal = urlParams.get('utm_content');
      if (contentVal) utms.utmContent = contentVal;
      
      const termVal = urlParams.get('utm_term');
      if (termVal) utms.utmTerm = termVal;
      
      return utms;
    } catch (e) {
      return {};
    }
  }
}
