import axios from 'axios';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

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
  custom_data?: any;
}

export class CapiService {
  // Função auxiliar para hash SHA256
  public static hash(input: string): string {
    return crypto.createHash('sha256').update(input.toLowerCase().trim()).digest('hex');
  }

  private async getSiteMetaConfig(siteKey: string) {
    const result = await pool.query(
      `SELECT m.pixel_id, m.capi_token_enc, m.enabled
       FROM sites s
       LEFT JOIN integrations_meta m ON m.site_id = s.id
       WHERE s.site_key = $1`,
      [siteKey]
    );
    if (!(result.rowCount || 0)) return null;
    const row = result.rows[0];
    if (row.enabled === false) return null;
    if (!row.pixel_id || !row.capi_token_enc) return null;
    try {
      return { pixelId: row.pixel_id as string, capiToken: decryptString(row.capi_token_enc as string) };
    } catch (e: any) {
      console.error(`Failed to decrypt CAPI token for siteKey=${siteKey}: ${e.message}. Key mismatch or data corruption.`);
      return null;
    }
  }

  public async sendEvent(siteKey: string, event: CapiEvent) {
    const cfg = await this.getSiteMetaConfig(siteKey);
    if (!cfg) {
      console.warn(`CAPI not configured for siteKey=${siteKey}`);
      return;
    }

    const payload = {
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
    } as any;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${cfg.pixelId}/events`,
        payload
      );
      console.log(`CAPI Event Sent: ${event.event_name} - ID: ${event.event_id}`, response.data);
      return response.data;
    } catch (error: any) {
      console.error('CAPI Error:', error.response?.data || error.message);
      // Aqui entraria lógica de DLQ/Retry
    }
  }
}

export const capiService = new CapiService();
