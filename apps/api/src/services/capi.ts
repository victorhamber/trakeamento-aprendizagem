import axios from 'axios';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';
import { preserveMetaClickIds } from '../lib/meta-attribution';
import { META_GRAPH_API_VERSION } from '../lib/meta-graph-version';
import { createLogger } from '../lib/logger';

const log = createLogger('CAPI');

export type CapiCustomData = Record<string, unknown>;

/**
 * Data Processing Options para compliance LGPD/GDPR
 * @see https://developers.facebook.com/docs/marketing-apis/data-processing-options
 */
export interface DataProcessingOptions {
  data_processing_options: string[];
  data_processing_options_country: number;
  data_processing_options_state: number;
}
/**
 * Payload de um evento server-side para Graph `/{pixel-id}/events`.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 */
export interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  /** Preferência http(s) válida; se ausente/inválida, buildPayload usa CAPI_FALLBACK_EVENT_SOURCE_URL ou omite (website). */
  event_source_url?: string;
  /** Parâmetro de evento web no corpo `data[]` (não confundir com `referrer` só em custom_data). */
  referrer_url?: string;
  user_data: {
    client_ip_address?: string;
    client_user_agent?: string;
    em?: string[]; // hash SHA-256
    ph?: string[]; // hash SHA-256
    fn?: string[]; // hash SHA-256
    ln?: string[]; // hash SHA-256
    ct?: string[]; // hash SHA-256
    st?: string[]; // hash SHA-256
    zp?: string[]; // hash SHA-256
    db?: string[]; // hash SHA-256 (YYYYMMDD)
    country?: string[]; // hash SHA-256 (ISO 2-letter lowercase)
    fbp?: string;
    fbc?: string;
    external_id?: string; // hash SHA-256
  };
  custom_data?: CapiCustomData;
  action_source?: 'email' | 'website' | 'app' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'other';
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

  /**
   * Meta CAPI: external_id como SHA-256 do ID de primeiro partido.
   * Se já for hex de 64 caracteres (ex.: hash de email no webhook), não re-hasheia.
   */
  public static externalIdForCapiPayload(raw: string | undefined | null): string | undefined {
    if (raw == null) return undefined;
    const s = String(raw).trim();
    if (!s) return undefined;
    if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
    return CapiService.hash(s);
  }

  public static isValidHttpEventSourceUrl(s: string | undefined | null): boolean {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();
    if (!t.startsWith('http://') && !t.startsWith('https://')) return false;
    try {
      return Boolean(new URL(t).hostname);
    } catch {
      return false;
    }
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
    if (!cfg) return null;
    if (!cfg.enabled) return null;
    if (!cfg.pixel_id || !cfg.capi_token_enc) return null;

    try {
      const token = decryptString(cfg.capi_token_enc);
      if (!token) {
        await pool.query(
          `UPDATE integrations_meta i SET last_capi_status = 'error', last_capi_error = 'Falha ao descriptografar token CAPI. Re-salve o token no painel.', last_capi_attempt_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
          [siteKey]
        );
        return null;
      }
      // Remove any whitespace from the token
      return { pixelId: cfg.pixel_id, capiToken: token.replace(/\s+/g, ''), testEventCode: cfg.capi_test_event_code as string | null };
    } catch (e) {
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

  /**
   * Graph API exige vários campos de user_data como array de strings.
   * fbc/fbp/client_ip/client_user_agent ficam como string simples.
   * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
   */
  private static normalizeUserDataForGraphApi(
    ud: Record<string, unknown>
  ): Record<string, unknown> {
    const asArrayKeys = new Set([
      'em',
      'ph',
      'fn',
      'ln',
      'ct',
      'st',
      'zp',
      'db',
      'country',
      'external_id',
      'ge',
      'lead_id',
      'madid',
      'anon_id',
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ud)) {
      if (v === undefined || v === null || v === '') continue;
      if (asArrayKeys.has(k)) {
        out[k] = Array.isArray(v) ? v : [v];
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Retorna as opções de processamento de dados (LDU) para compliance LGPD/GDPR.
   * Por padrão, não aplica restrições (array vazio). Pode ser sobrescrito por env var.
   */
  private static getDataProcessingOptions(): DataProcessingOptions {
    const lduEnabled = process.env.CAPI_LDU_ENABLED === '1' || process.env.CAPI_LDU_ENABLED === 'true';
    if (lduEnabled) {
      return {
        data_processing_options: ['LDU'],
        data_processing_options_country: parseInt(process.env.CAPI_LDU_COUNTRY || '0', 10),
        data_processing_options_state: parseInt(process.env.CAPI_LDU_STATE || '0', 10),
      };
    }
    return {
      data_processing_options: [],
      data_processing_options_country: 0,
      data_processing_options_state: 0,
    };
  }

  private buildEventData(event: CapiEvent): Record<string, unknown> {
    const userDataIn = event.user_data ? ({ ...event.user_data } as Record<string, unknown>) : {};
    const fbcSafe = preserveMetaClickIds(userDataIn.fbc);
    const fbpSafe = preserveMetaClickIds(userDataIn.fbp);
    if (fbcSafe) userDataIn.fbc = fbcSafe;
    else delete userDataIn.fbc;
    if (fbpSafe) userDataIn.fbp = fbpSafe;
    else delete userDataIn.fbp;
    const ext = userDataIn.external_id;
    if (ext != null && String(ext).trim() !== '') {
      const hashed = CapiService.externalIdForCapiPayload(String(ext));
      if (hashed) userDataIn.external_id = hashed;
      else delete userDataIn.external_id;
    }

    const cleanedUserData = CapiService.normalizeUserDataForGraphApi(
      CapiService.cleanObject(userDataIn) as Record<string, unknown>
    );
    const cleanedCustomData = event.custom_data ? CapiService.cleanObject(event.custom_data) : undefined;

    const actionSource = event.action_source || 'website';
    let eventSourceUrl = (event.event_source_url || '').trim();
    if (!CapiService.isValidHttpEventSourceUrl(eventSourceUrl)) {
      const envUrl = (process.env.CAPI_FALLBACK_EVENT_SOURCE_URL || '').trim();
      if (CapiService.isValidHttpEventSourceUrl(envUrl)) eventSourceUrl = envUrl;
    }
    if (!CapiService.isValidHttpEventSourceUrl(eventSourceUrl) && actionSource === 'website') {
      log.warn('event_source_url inválido ou vazio para evento website', {
        event_name: event.event_name,
        event_id: event.event_id,
      });
    }

    const refUrl = (event.referrer_url || '').trim();
    const includeReferrer = CapiService.isValidHttpEventSourceUrl(refUrl);
    const dpo = CapiService.getDataProcessingOptions();

    return {
      event_name: event.event_name,
      event_time: event.event_time,
      event_id: event.event_id,
      ...(CapiService.isValidHttpEventSourceUrl(eventSourceUrl) ? { event_source_url: eventSourceUrl } : {}),
      ...(includeReferrer ? { referrer_url: refUrl } : {}),
      action_source: actionSource,
      user_data: cleanedUserData,
      ...(cleanedCustomData && Object.keys(cleanedCustomData).length > 0
        ? { custom_data: cleanedCustomData }
        : {}),
      ...dpo,
    };
  }

  private buildPayload(cfg: { pixelId: string; capiToken: string; testEventCode?: string | null }, event: CapiEvent) {
    return {
      data: [this.buildEventData(event)],
      access_token: cfg.capiToken,
      ...(cfg.testEventCode || process.env.META_TEST_EVENT_CODE
        ? { test_event_code: (cfg.testEventCode || process.env.META_TEST_EVENT_CODE) as string }
        : {}),
    };
  }

  private buildBatchPayload(
    cfg: { pixelId: string; capiToken: string; testEventCode?: string | null },
    events: CapiEvent[]
  ) {
    return {
      data: events.map((e) => this.buildEventData(e)),
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

  public async saveToOutbox(siteKey: string, event: CapiEvent, errorStr: string) {
    try {
      await pool.query(
        `INSERT INTO capi_outbox (site_key, payload, last_error, next_attempt_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
        [siteKey, JSON.stringify(event), errorStr]
      );
    } catch (e) {
      log.error('Failed to save to capi_outbox', { error: String(e) });
    }
  }

  /**
   * Move evento para dead letter table em vez de deletar permanentemente.
   * Permite análise posterior de eventos que falharam persistentemente.
   */
  private async moveToDeadLetter(row: { id: number; site_key: string; payload: unknown; last_error: string; attempts: number }) {
    try {
      await pool.query(
        `INSERT INTO capi_outbox_dead_letter (site_key, payload, last_error, attempts, original_created_at)
         SELECT site_key, payload, last_error, attempts, created_at FROM capi_outbox WHERE id = $1`,
        [row.id]
      );
      await pool.query('DELETE FROM capi_outbox WHERE id = $1', [row.id]);
      log.info('Moved failed event to dead letter', { site_key: row.site_key, attempts: row.attempts });
    } catch (e) {
      await pool.query('DELETE FROM capi_outbox WHERE id = $1', [row.id]);
      log.warn('Failed to move to dead letter, deleted instead', { error: String(e) });
    }
  }

  public async processOutbox() {
    try {
      // 1. Move registros que já excederam o limite de tentativas para dead letter
      const { rows: expiredRows } = await pool.query(
        `SELECT id, site_key, payload, last_error, attempts FROM capi_outbox 
         WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'`
      );
      for (const row of expiredRows) {
        await this.moveToDeadLetter(row);
      }

      // 2. Busca próximos eventos para re-tentar (agrupa por site_key para batching)
      const { rows } = await pool.query(
        `SELECT id, site_key, payload, last_error, attempts FROM capi_outbox 
         WHERE next_attempt_at <= NOW() AND attempts < 5 
         ORDER BY site_key, id ASC LIMIT 100`
      );

      // Agrupa por site_key para envio em batch
      const bySite = new Map<string, typeof rows>();
      for (const row of rows) {
        const arr = bySite.get(row.site_key) || [];
        arr.push(row);
        bySite.set(row.site_key, arr);
      }

      for (const [siteKey, siteRows] of bySite) {
        // Filtra eventos com token inválido (não adianta re-enviar)
        const validRows = siteRows.filter((r) => {
          if (r.last_error && r.last_error.includes('Token inválido')) {
            this.moveToDeadLetter(r);
            return false;
          }
          return true;
        });

        if (validRows.length === 0) continue;

        // Tenta envio em batch se tiver múltiplos eventos
        if (validRows.length > 1) {
          const events = validRows.map((r) => r.payload as CapiEvent);
          const result = await this.sendEventsBatch(siteKey, events);
          if (result.ok) {
            for (const r of validRows) {
              await pool.query('DELETE FROM capi_outbox WHERE id = $1', [r.id]);
            }
            log.info('Batch send success from outbox', { site_key: siteKey, count: validRows.length });
          } else {
            // Falha no batch — tenta individual
            for (const r of validRows) {
              const event = r.payload as CapiEvent;
              const res = await this.sendEventDetailed(siteKey, event);
              if (res.ok) {
                await pool.query('DELETE FROM capi_outbox WHERE id = $1', [r.id]);
              } else if (res.error?.includes('Token inválido')) {
                await this.moveToDeadLetter(r);
              } else {
                await pool.query(
                  `UPDATE capi_outbox 
                   SET attempts = attempts + 1, last_error = $1, next_attempt_at = NOW() + (INTERVAL '1 minutes' * POWER(2, attempts))
                   WHERE id = $2`,
                  [res.error, r.id]
                );
              }
            }
          }
        } else {
          // Envio individual
          const r = validRows[0];
          const event = r.payload as CapiEvent;
          const result = await this.sendEventDetailed(siteKey, event);
          if (result.ok) {
            await pool.query('DELETE FROM capi_outbox WHERE id = $1', [r.id]);
          } else if (result.error?.includes('Token inválido')) {
            await this.moveToDeadLetter(r);
          } else {
            await pool.query(
              `UPDATE capi_outbox 
               SET attempts = attempts + 1, last_error = $1, next_attempt_at = NOW() + (INTERVAL '1 minutes' * POWER(2, attempts))
               WHERE id = $2`,
              [result.error, r.id]
            );
          }
        }
      }
    } catch (e) {
      log.error('Error processing CAPI outbox', { error: String(e) });
    }
  }

  /**
   * Verifica se o CAPI está saudável para um site (último status ok e não desabilitado)
   */
  public async isCapiHealthy(siteKey: string): Promise<boolean> {
    const until = CapiService.disabledUntil.get(siteKey);
    if (until && until > Date.now()) return false;

    try {
      const { rows } = await pool.query(
        `SELECT last_capi_status, last_capi_attempt_at
         FROM integrations_meta i
         JOIN sites s ON s.id = i.site_id
         WHERE s.site_key = $1`,
        [siteKey]
      );
      if (!rows[0]) return false;
      const status = rows[0].last_capi_status;
      const lastAttempt = rows[0].last_capi_attempt_at;
      
      // Considera saudável se último status foi ok ou se nunca tentou
      if (status === 'ok') return true;
      if (!lastAttempt) return true;
      
      // Se erro persistente por mais de 1h, considera não saudável
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (status === 'error' && new Date(lastAttempt) < hourAgo) {
        return false;
      }
      
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Envia múltiplos eventos em um único request (batch).
   * Graph API suporta até 1000 eventos por request.
   * Recomendado para outbox e processamento em massa.
   */
  public async sendEventsBatch(siteKey: string, events: CapiEvent[]): Promise<CapiSendResult> {
    if (events.length === 0) {
      return { ok: true, data: { events_received: 0 } };
    }

    const until = CapiService.disabledUntil.get(siteKey);
    if (until && until > Date.now()) {
      return { ok: false, error: 'CAPI desativado temporariamente (token inválido)' };
    }
    if (until && until <= Date.now()) CapiService.disabledUntil.delete(siteKey);

    const cfg = await this.getSiteMetaConfig(siteKey);
    if (!cfg) {
      return { ok: false, error: 'CAPI não configurado para este site' };
    }
    if (!this.isProbablyValidToken(cfg.capiToken)) {
      return { ok: false, error: 'Token CAPI inválido (formato)' };
    }

    // Limita a 1000 eventos por request (limite da API)
    const chunk = events.slice(0, 1000);
    const payload = this.buildBatchPayload(cfg, chunk);

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.pixelId}/events`,
        payload
      );
      log.info('Batch send success', {
        site_key: siteKey,
        count: chunk.length,
        fbtrace_id: response.data?.fbtrace_id,
      });
      await this.updateLastStatus(siteKey, { ok: true, data: response.data });
      return { ok: true, data: response.data };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const code = (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code;
        const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        if (code === 190) {
          CapiService.disabledUntil.set(siteKey, Date.now() + 60 * 60 * 1000);
          log.error('Batch send failed - token invalid', { site_key: siteKey });
          await this.updateLastStatus(siteKey, { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim(), details: error.response?.data });
          return { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim(), details: error.response?.data };
        }
        log.error('Batch send failed', { site_key: siteKey, error: message });
        await this.updateLastStatus(siteKey, { ok: false, error: message || 'Erro ao enviar para o Meta', details: error.response?.data });
        return { ok: false, error: message || 'Erro ao enviar para o Meta', details: error.response?.data };
      }
      const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('Batch send failed', { site_key: siteKey, error: errMsg });
      await this.updateLastStatus(siteKey, { ok: false, error: errMsg });
      return { ok: false, error: errMsg };
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
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.pixelId}/events`,
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
        return result;
      }
      const result = { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' } as const;
      await this.updateLastStatus(siteKey, result);
      return result;
    }
  }

  public async sendEvent(siteKey: string, event: CapiEvent): Promise<any> {
    const until = CapiService.disabledUntil.get(siteKey);
    if (until && until > Date.now()) {
      return { ok: false, error: 'CAPI desativado temporariamente (token inválido)' };
    }
    if (until && until <= Date.now()) CapiService.disabledUntil.delete(siteKey);

    const cfg = await this.getSiteMetaConfig(siteKey);
    if (!cfg) {
      return { ok: false, error: 'CAPI não configurado para este site' };
    }
    if (!this.isProbablyValidToken(cfg.capiToken)) {
      await this.updateLastStatus(siteKey, { ok: false, error: 'Token CAPI inválido (formato)' });
      log.error('Invalid token format', { site_key: siteKey });
      return { ok: false, error: 'Token CAPI inválido (formato)' };
    }

    const payload = this.buildPayload(cfg, event);

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.pixelId}/events`,
        payload
      );
      log.info(`Success ${event.event_name}`, {
        event_id: event.event_id,
        fbtrace_id: response.data?.fbtrace_id,
        messages: response.data?.messages || [],
      });

      await this.updateLastStatus(siteKey, { ok: true, data: response.data });
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const code = (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code;
        const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        if (code === 190) {
          CapiService.disabledUntil.set(siteKey, Date.now() + 60 * 60 * 1000);
          log.error('Token invalid, CAPI disabled temporarily', { site_key: siteKey, message });
          await this.updateLastStatus(siteKey, { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim(), details: error.response?.data });
          return { ok: false, error: `Token inválido no Meta. ${message || ''}`.trim() };
        }
        log.error('Send failed', { event_time: event.event_time, error: message });
        await this.updateLastStatus(siteKey, { ok: false, error: message || 'Erro ao enviar para o Meta', details: error.response?.data });
        return { ok: false, error: message || 'Erro ao enviar para o Meta' };
      } else {
        const errMsg = error instanceof Error ? error.message : 'unknown_error';
        log.error('Send failed', { error: errMsg });
        await this.updateLastStatus(siteKey, { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' });
        return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
      }
    }
  }
}

export const capiService = new CapiService();
