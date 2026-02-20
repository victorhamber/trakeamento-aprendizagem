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
    em?: string; // hash SHA-256
    ph?: string; // hash SHA-256
    fn?: string; // hash SHA-256
    ln?: string; // hash SHA-256
    ct?: string; // hash SHA-256
    st?: string; // hash SHA-256
    zp?: string; // hash SHA-256
    db?: string; // hash SHA-256 (YYYYMMDD)
    country?: string; // hash SHA-256 (ISO 2-letter lowercase)
    fbp?: string;
    fbc?: string;
    external_id?: string; // hash SHA-256
  };
  custom_data?: CapiCustomData;
}

type CapiSendResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; details?: unknown };

export class CapiService {
  private static disabledUntil = new Map<string, number>();

  // Função auxiliar para hash SHA256
  public static hash(input: string): string {
    return crypto.createHash('sha256').update(input.toLowerCase().trim()).digest('hex');
  }

  private isProbablyValidToken(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const t = token.trim();
    if (t.length < 20) return false;
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
        // Atualiza status para o dashboard mostrar erro claro
        await pool.query(
          `UPDATE integrations_meta i SET last_capi_status = 'error', last_capi_error = 'Falha ao descriptografar token CAPI. Re-salve o token no painel.', last_capi_attempt_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
          [siteKey]
        );
        return null;
      }
      // Remove any whitespace from the token
      return { pixelId: cfg.pixel_id, capiToken: token.replace(/\s+/g, ''), testEventCode: cfg.capi_test_event_code as string | null };
    } catch (e) {
      console.log(`[CAPI] Decrypt error for siteKey=${siteKey}`, e);
      // Token foi criptografado com outra chave — instrução clara para o usuário
      await pool.query(
        `UPDATE integrations_meta i SET last_capi_status = 'error', last_capi_error = 'Token CAPI corrompido (chave de criptografia mudou). Cole o token novamente e clique Salvar.', last_capi_attempt_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
        [siteKey]
      );
      return null;
    }
  }

  /** Remove chaves com valor undefined, null ou string vazia do objeto */
  private static cleanObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && v !== '') cleaned[k] = v;
    }
    return cleaned as Partial<T>;
  }

  private buildPayload(cfg: { pixelId: string; capiToken: string; testEventCode?: string | null }, event: CapiEvent) {
    // Limpa user_data — o Meta penaliza campos vazios/nulos
    const cleanedUserData = CapiService.cleanObject(event.user_data);
    // Limpa custom_data também
    const cleanedCustomData = event.custom_data ? CapiService.cleanObject(event.custom_data) : undefined;

    return {
      data: [
        {
          event_name: event.event_name,
          event_time: event.event_time,
          event_id: event.event_id,
          event_source_url: event.event_source_url,
          action_source: 'website' as const,
          user_data: cleanedUserData,
          ...(cleanedCustomData && Object.keys(cleanedCustomData).length > 0
            ? { custom_data: cleanedCustomData }
            : {}),
        },
      ],
      access_token: cfg.capiToken,
      ...(cfg.testEventCode || process.env.META_TEST_EVENT_CODE
        ? { test_event_code: (cfg.testEventCode || process.env.META_TEST_EVENT_CODE) as string }
        : {}),
    };
  }

  private async updateLastStatus(siteKey: string, result: CapiSendResult) {
    const status = result.ok ? 'ok' : 'error';
    const error = result.ok ? null : result.error;
    const response = result.ok ? result.data : result.details || null;
    await pool.query(
      `UPDATE integrations_meta i
       SET last_capi_status = $1,
           last_capi_error = $2,
           last_capi_response = $3,
           last_capi_attempt_at = NOW()
       FROM sites s
       WHERE s.site_key = $4 AND i.site_id = s.id`,
      [status, error, response, siteKey]
    );
  }

  private async saveToOutbox(siteKey: string, event: CapiEvent, errorStr: string) {
    try {
      await pool.query(
        `INSERT INTO capi_outbox (site_key, payload, last_error, next_attempt_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
        [siteKey, JSON.stringify(event), errorStr]
      );
    } catch (e) {
      console.error('Failed to save to capi_outbox:', e);
    }
  }

  public async processOutbox() {
    try {
      const { rows } = await pool.query(
        `SELECT id, site_key, payload FROM capi_outbox 
         WHERE next_attempt_at <= NOW() AND attempts < 5 
         ORDER BY id ASC LIMIT 50`
      );

      for (const row of rows) {
        const event = row.payload as CapiEvent;
        const result = await this.sendEventDetailed(row.site_key, event);
        if (result.ok) {
          await pool.query('DELETE FROM capi_outbox WHERE id = $1', [row.id]);
        } else {
          await pool.query(
            `UPDATE capi_outbox 
             SET attempts = attempts + 1, last_error = $1, next_attempt_at = NOW() + (INTERVAL '1 minutes' * POWER(2, attempts))
             WHERE id = $2`,
            [result.error, row.id]
          );
        }
      }
    } catch (e) {
      console.error('Error processing CAPI outbox', e);
    }
  }

  public async sendEventDetailed(siteKey: string, event: CapiEvent): Promise<CapiSendResult> {
    const until = CapiService.disabledUntil.get(siteKey);
    if (until && until > Date.now()) {
      const result = { ok: false, error: 'CAPI desativado temporariamente (token inválido)' } as const;
      await this.updateLastStatus(siteKey, result);
      return result;
    }
    if (until && until <= Date.now()) CapiService.disabledUntil.delete(siteKey);

    const cfg = await this.getSiteMetaConfig(siteKey);
    if (!cfg) {
      const result = { ok: false, error: 'CAPI não configurado para este site' } as const;
      await this.updateLastStatus(siteKey, result);
      return result;
    }
    if (!this.isProbablyValidToken(cfg.capiToken)) {
      const result = { ok: false, error: 'Token CAPI inválido (formato)' } as const;
      await this.updateLastStatus(siteKey, result);
      return result;
    }

    const payload = this.buildPayload(cfg, event);

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${cfg.pixelId}/events`,
        payload
      );
      const result = { ok: true, data: response.data } as const;
      await this.updateLastStatus(siteKey, result);
      return result;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const code = (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code;
        const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        if (code === 190) {
          CapiService.disabledUntil.set(siteKey, Date.now() + 60 * 60 * 1000);
          const result = { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim(), details: error.response?.data } as const;
          await this.updateLastStatus(siteKey, result);
          return result;
        }
        const result = { ok: false, error: message || 'Erro ao enviar para o Meta', details: error.response?.data } as const;
        await this.updateLastStatus(siteKey, result);
        await this.saveToOutbox(siteKey, event, result.error);
        return result;
      }
      const result = { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' } as const;
      await this.updateLastStatus(siteKey, result);
      await this.saveToOutbox(siteKey, event, result.error);
      return result;
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
    if (!this.isProbablyValidToken(cfg.capiToken)) {
      await this.updateLastStatus(siteKey, { ok: false, error: 'Token CAPI inválido (formato)' });
      console.error(`CAPI invalid token format for siteKey=${siteKey}`);
      return;
    }

    const payload = this.buildPayload(cfg, event);

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${cfg.pixelId}/events`,
        payload
      );
      console.log(`CAPI Event Sent: ${event.event_name} - ID: ${event.event_id}`, response.data);
      await this.updateLastStatus(siteKey, { ok: true, data: response.data });
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
          await this.updateLastStatus(siteKey, { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim(), details: error.response?.data });
          return;
        }
        console.error('CAPI Error:', error.response?.data || error.message);
        await this.updateLastStatus(siteKey, { ok: false, error: message || 'Erro ao enviar para o Meta', details: error.response?.data });
        await this.saveToOutbox(siteKey, event, message || 'Erro ao enviar para o Meta');
      } else {
        console.error('CAPI Error:', error instanceof Error ? error.message : 'unknown_error');
        await this.updateLastStatus(siteKey, { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' });
        await this.saveToOutbox(siteKey, event, error instanceof Error ? error.message : 'Erro desconhecido');
      }
    }
  }
}

export const capiService = new CapiService();
