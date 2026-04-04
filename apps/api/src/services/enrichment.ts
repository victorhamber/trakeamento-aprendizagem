import geoip from 'geoip-lite';
import { pool } from '../db/pool';
import { CapiService } from './capi';
import { DDI_LIST } from '../lib/ddi';

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
}

export class EnrichmentService {
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
      SELECT fbp, fbc, external_id, last_traffic_source, last_ip, last_user_agent
      FROM site_visitors
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND email_hash = $2::text) OR
          ($3::text IS NOT NULL AND phone_hash = $3::text) OR
          ($4::text IS NOT NULL AND external_id = $4::text) OR
          ($5::text IS NOT NULL AND last_ip = $5::text)
        )
      ORDER BY 
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
      SELECT sv.fbp, sv.fbc, sv.external_id, sv.last_traffic_source, sv.last_ip, sv.last_user_agent
      FROM site_visitors sv
      JOIN sites s ON s.site_key = sv.site_key
      JOIN integrations_meta m ON m.site_id = s.id
      WHERE s.account_id = (SELECT account_id FROM sites WHERE site_key = $1)
        AND sv.site_key != $1
        AND m.pixel_id = (
          SELECT m2.pixel_id FROM sites s2
          JOIN integrations_meta m2 ON m2.site_id = s2.id
          WHERE s2.site_key = $1
        )
        AND (
          ($2::text IS NOT NULL AND sv.email_hash = $2::text) OR
          ($3::text IS NOT NULL AND sv.phone_hash = $3::text) OR
          ($4::text IS NOT NULL AND sv.external_id = $4::text) OR
          ($5::text IS NOT NULL AND sv.last_ip = $5::text)
        )
      ORDER BY 
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
        visitorRes = await pool.query(crossSiteQuery, queryParams);
        if (visitorRes.rowCount && visitorRes.rowCount > 0) {
          console.log(`[Enrichment] Cross-site match found! Recovered visitor data from sibling site.`);
        }
      }

      let visitorData: any = {};
      
      if (visitorRes.rowCount && visitorRes.rowCount > 0) {
        const row = visitorRes.rows[0];
        const utms = this.parseUtmString(row.last_traffic_source);
        visitorData = {
          fbp: row.fbp,
          fbc: row.fbc,
          externalId: row.external_id,
          clientIp: row.last_ip,
          clientUa: row.last_user_agent,
          ...utms
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
      console.error('[Enrichment] Error searching for visitor data:', err);
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
      ORDER BY event_time DESC
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
