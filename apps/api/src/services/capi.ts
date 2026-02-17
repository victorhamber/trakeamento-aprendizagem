import axios from 'axios';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

type CapiCustomData = Record<string, unknown>;
interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url: string;
  user_data: {
    client_ip_address: string;
    client_user_agent: string;
    em?: string; // hash
    ph?: string; // hash
    fn?: string; // hash
    ln?: string; // hash
    ct?: string; // hash
    st?: string; // hash
    zp?: string; // hash
    db?: string; // hash
    fbp?: string;
    fbc?: string;
    external_id?: string; // hash
  };
  custom_data?: CapiCustomData;
}

export class CapiService {
  private static disabledUntil = new Map<string, number>();

  // Função auxiliar para hash SHA256
  public static hash(input: string): string {
    return crypto.createHash('sha256').update(input.toLowerCase().trim()).digest('hex');
  }

  private isProbablyValidToken(token: string): boolean {
    const t = token.trim();
    if (t.length < 20) return false;
    if (/\s/.test(t)) return false;
    if (!/^[A-Za-z0-9._|-]+$/.test(t)) return false;
    return true;
  }

  private async getSiteMetaConfig(siteKey: string) {
    const result = await pool.query(
      `SELECT m.pixel_id, m.capi_token_enc, m.enabled
       FROM sites s
       LEFT JOIN integrations_meta m ON m.site_id = s.id
       WHERE s.site_key = $1`,
      [siteKey]
    );
    
    // Fallback: tentar pegar do campo JSON meta_config na tabela sites (migração progressiva)
    if (!(result.rowCount || 0) || !result.rows[0].pixel_id) {
       const site = await pool.query('SELECT meta_config FROM sites WHERE site_key = $1', [siteKey]);
       if (site.rowCount && site.rows[0].meta_config) {
          const conf = site.rows[0].meta_config;
          if (conf.pixel_id && conf.capi_token) {
             return { pixelId: conf.pixel_id, capiToken: conf.capi_token };
          }
       }
       return null;
    }

    const row = result.rows[0];
    if (row.enabled === false) return null;
    if (!row.pixel_id || !row.capi_token_enc) return null;
    try {
      const capiToken = decryptString(row.capi_token_enc as string).trim().replace(/\s+/g, '');
      if (!this.isProbablyValidToken(capiToken)) {
        console.warn(`CAPI token inválido para siteKey=${siteKey}. Atualize o token no painel (use o token bruto, ex: EAA...).`);
        return null;
      }
      return { pixelId: row.pixel_id as string, capiToken };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown_error';
      console.error(`Failed to decrypt CAPI token for siteKey=${siteKey}: ${message}. Key mismatch or data corruption.`);
      return null;
    }
  }

  public async sendEvent(siteKey: string, event: CapiEvent) {
    const until = CapiService.disabledUntil.get(siteKey);
    if (until && until > Date.now()) return;
    if (until && until <= Date.now()) CapiService.disabledUntil.delete(siteKey);

    const cfg = await this.getSiteMetaConfig(siteKey);
    if (!cfg) {
      console.warn(`CAPI not configured for siteKey=${siteKey}`);
      return;
    }

    const payload: {
      data: Array<{
        event_name: string;
        event_time: number;
        event_id: string;
        event_source_url: string;
        action_source: 'website';
        user_data: CapiEvent['user_data'] & { fbc?: string; fbp?: string };
        custom_data?: CapiCustomData;
      }>;
      access_token: string;
      test_event_code?: string;
    } = {
      data: [
        {
          event_name: event.event_name,
          event_time: event.event_time,
          event_id: event.event_id,
          event_source_url: event.event_source_url,
          action_source: 'website',
          user_data: {
             ...event.user_data,
             fbc: event.user_data.fbc || undefined,
             fbp: event.user_data.fbp || undefined,
          },
          custom_data: event.custom_data,
        },
      ],
      access_token: cfg.capiToken,
      ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
    };

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${cfg.pixelId}/events`,
        payload
      );
      console.log(`CAPI Event Sent: ${event.event_name} - ID: ${event.event_id}`, response.data);
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const code = (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code;
        const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        if (code === 190) {
          CapiService.disabledUntil.set(siteKey, Date.now() + 60 * 60 * 1000);
          console.error(
            `CAPI desativado temporariamente para siteKey=${siteKey} (token inválido). Atualize o CAPI Token no painel. ${message || ''}`.trim()
          );
          return;
        }
        console.error('CAPI Error:', error.response?.data || error.message);
      } else {
        console.error('CAPI Error:', error instanceof Error ? error.message : 'unknown_error');
      }
      // Aqui entraria lógica de DLQ/Retry
    }
  }
}

export const capiService = new CapiService();
