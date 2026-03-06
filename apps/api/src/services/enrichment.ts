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
  /**
   * Tenta encontrar dados de rastreamento (FBP, FBC, UTMs) baseados no email ou telefone do comprador.
   * Busca primeiro na tabela consolidada site_visitors, depois em eventos recentes.
   */
  static async findVisitorData(siteKey: string, email?: string, phone?: string): Promise<EnrichedData | null> {
    if (!email && !phone) return null;

    const emailHash = email ? CapiService.hash(email) : null;
    const phoneHash = phone ? CapiService.hash(phone) : null;

    if (!emailHash && !phoneHash) return null;

    // 1. Tentar buscar em site_visitors (Perfil consolidado)
    // Busca por email_hash OU phone_hash
    const visitorQuery = `
      SELECT fbp, fbc, external_id, last_traffic_source
      FROM site_visitors
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND email_hash = $2::text) OR
          ($3::text IS NOT NULL AND phone_hash = $3::text)
        )
      ORDER BY last_seen_at DESC
      LIMIT 1
    `;

    try {
      const visitorRes = await pool.query(visitorQuery, [siteKey, emailHash, phoneHash]);
      
      if (visitorRes.rowCount && visitorRes.rowCount > 0) {
        const row = visitorRes.rows[0];
        const utms = this.parseUtmString(row.last_traffic_source);
        
        // Se achou visitor, tenta pegar IP/UA do último evento dele
        const metadata = await this.findLatestMetadata(siteKey, row.fbp, row.external_id);

        return {
          fbp: row.fbp || undefined,
          fbc: row.fbc || undefined,
          externalId: row.external_id || undefined,
          clientIp: metadata?.ip,
          clientUa: metadata?.ua,
          ...utms
        };
      }

      // 2. Se não achou em visitors, tentar match direto em web_events (menos provável se visitors estiver populado corretamente)
      // Mas web_events tem o user_data.em / user_data.ph
      const eventQuery = `
        SELECT user_data, custom_data, user_data->>'client_ip_address' as ip, user_data->>'client_user_agent' as ua
        FROM web_events
        WHERE site_key = $1
          AND (
            ($2::text IS NOT NULL AND user_data->>'em' = $2::text) OR
            ($3::text IS NOT NULL AND user_data->>'ph' = $3::text)
          )
        ORDER BY event_time DESC
        LIMIT 1
      `;

      const eventRes = await pool.query(eventQuery, [siteKey, emailHash, phoneHash]);
      
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

  private static async findLatestMetadata(siteKey: string, fbp?: string, externalId?: string) {
    if (!fbp && !externalId) return null;

    const query = `
      SELECT user_data->>'client_ip_address' as ip, user_data->>'client_user_agent' as ua
      FROM web_events
      WHERE site_key = $1
        AND (
          ($2::text IS NOT NULL AND user_data->>'fbp' = $2::text) OR
          ($3::text IS NOT NULL AND user_data->>'external_id' = $3::text)
        )
      ORDER BY event_time DESC
      LIMIT 1
    `;

    try {
      const res = await pool.query(query, [siteKey, fbp, externalId]);
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
