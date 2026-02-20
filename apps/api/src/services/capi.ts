import axios from 'axios';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

export type CapiCustomData = Record<string, unknown>;
export interface CapiEvent {
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
    const { rows } = await pool.query(
      `SELECT i.pixel_id, i.capi_token_enc, i.enabled, i.capi_test_event_code
       FROM sites s
       JOIN integrations_meta i ON i.site_id = s.id
       WHERE s.site_key = $1`,
      [siteKey]
    );

    const cfg = rows[0];
    if (!cfg) {
      console.log(`[CAPI] Config not found for siteKey=${siteKey}`);
      return null;
    }
    if (!cfg.enabled) {
      console.log(`[CAPI] Meta integration disabled for siteKey=${siteKey}`);
      return null;
    }
    if (!cfg.pixel_id || !cfg.capi_token_enc) {
      console.log(`[CAPI] Missing pixel_id or capi_token for siteKey=${siteKey}`);
      return null;
    }

    try {
      const token = decryptString(cfg.capi_token_enc);
      if (!token) {
         console.log(`[CAPI] Failed to decrypt token for siteKey=${siteKey}`);
         return null;
      }
      return { pixelId: cfg.pixel_id, capiToken: token, testEventCode: cfg.capi_test_event_code as string | null };
    } catch (e) {
      console.log(`[CAPI] Decrypt error for siteKey=${siteKey}`, e);
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
      ...(cfg.testEventCode || process.env.META_TEST_EVENT_CODE
        ? { test_event_code: (cfg.testEventCode || process.env.META_TEST_EVENT_CODE) as string }
        : {}),
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
