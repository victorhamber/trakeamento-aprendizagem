import { pool } from '../db/pool';
import { CapiService } from './capi';

interface EnrichedData {
  fbp?: string;
  fbc?: string;
  externalId?: string;
  clientIp?: string;
  clientUa?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export class EnrichmentService {
  static async findVisitorData(siteKey: string, email?: string, phone?: string, externalId?: string): Promise<EnrichedData | null> {
    if (!email && !phone && !externalId) return null;

    const emailHash = email ? CapiService.hash(email) : null;
    const phoneHash = phone ? CapiService.hash(phone) : null;

    if (!emailHash && !phoneHash && !externalId) return null;

    // 1. Tentar buscar em site_visitors (Perfil consolidado)
    // Busca por email_hash OU phone_hash OU external_id
    const visitorQuery = `
      SELECT fbp, fbc, external_id, last_traffic_source, last_ip, last_user_agent
      FROM site_visitors
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND email_hash = $2::text) OR
          ($3::text IS NOT NULL AND phone_hash = $3::text) OR
          ($4::text IS NOT NULL AND external_id = $4::text)
        )
      ORDER BY last_seen_at DESC
      LIMIT 1
    `;

    try {
      const visitorRes = await pool.query(visitorQuery, [siteKey, emailHash, phoneHash, externalId || null]);
      
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

      // Buscar metadados (IP/UA) mais recentes em web_events APENAS se não tiver no visitorData
      // Isso permite limpar web_events antigo sem perder dados do perfil
      let metadata: any = null;
      if (!visitorData.clientIp || !visitorData.clientUa) {
         metadata = await this.findLatestMetadata(siteKey, visitorData.fbp, visitorData.externalId, emailHash, phoneHash);
      }

      if (Object.keys(visitorData).length > 0 || metadata) {
        return {
          ...visitorData,
          clientIp: visitorData.clientIp || metadata?.ip,
          clientUa: visitorData.clientUa || metadata?.ua
        };
      }

      // 2. Se não achou em visitors, tentar match direto em web_events (menos provável se visitors estiver populado corretamente)
      // Mas web_events tem o user_data.em / user_data.ph / user_data.external_id
      const eventQuery = `
        SELECT user_data, custom_data, user_data->>'client_ip_address' as ip, user_data->>'client_user_agent' as ua
        FROM web_events
        WHERE site_key = $1
          AND (
            ($2::text IS NOT NULL AND user_data->>'em' = $2::text) OR
            ($3::text IS NOT NULL AND user_data->>'ph' = $3::text) OR
            ($4::text IS NOT NULL AND user_data->>'external_id' = $4::text)
          )
        ORDER BY event_time DESC
        LIMIT 1
      `;

      const eventRes = await pool.query(eventQuery, [siteKey, emailHash, phoneHash, externalId || null]);
      
      if (eventRes.rowCount && eventRes.rowCount > 0) {
        const row = eventRes.rows[0];
        const ud = row.user_data || {};
        const cd = row.custom_data || {};
        
        return {
          fbp: ud.fbp,
          fbc: ud.fbc,
          externalId: ud.external_id, // pode ser array ou string
          clientIp: row.ip,
          clientUa: row.ua,
          utmSource: cd.utm_source,
          utmMedium: cd.utm_medium,
          utmCampaign: cd.utm_campaign,
          utmContent: cd.utm_content,
          utmTerm: cd.utm_term
        };
      }

    } catch (err) {
      console.error('[Enrichment] Error searching for visitor data:', err);
    }

    return null;
  }

  private static async findLatestMetadata(siteKey: string, fbp?: string, externalId?: string, emailHash?: string | null, phoneHash?: string | null) {
    // Busca IP/UA baseado em qualquer identificador disponível
    const query = `
      SELECT user_data->>'client_ip_address' as ip, user_data->>'client_user_agent' as ua
      FROM web_events
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND user_data->>'fbp' = $2::text) OR
          ($3::text IS NOT NULL AND user_data->>'external_id' = $3::text) OR
          ($4::text IS NOT NULL AND user_data->>'em' = $4::text) OR
          ($5::text IS NOT NULL AND user_data->>'ph' = $5::text)
        )
      ORDER BY event_time DESC
      LIMIT 1
    `;

    try {
      const res = await pool.query(query, [siteKey, fbp || null, externalId || null, emailHash || null, phoneHash || null]);
      if (res.rowCount && res.rowCount > 0) return res.rows[0];
    } catch (e) { /* ignore */ }
    return null;
  }

  private static parseUtmString(source?: string) {
    if (!source) return {};
    // Ex: "utm_source=google&utm_medium=cpc..."
    try {
      const urlParams = new URLSearchParams(source);
      return {
        utmSource: urlParams.get('utm_source') || undefined,
        utmMedium: urlParams.get('utm_medium') || undefined,
        utmCampaign: urlParams.get('utm_campaign') || undefined,
        utmContent: urlParams.get('utm_content') || undefined,
        utmTerm: urlParams.get('utm_term') || undefined,
      };
    } catch (e) {
      return {};
    }
  }
}
