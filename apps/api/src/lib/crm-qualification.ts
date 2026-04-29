/**
 * Qualificação CRM (estilo Meta) — envio aditivo via Conversions API.
 *
 * Quando uma regra em `site_url_rules` é marcada com `parameters._crm_qualify = true`,
 * o ingest envia, EM PARALELO ao evento normal (website), um segundo evento CAPI no
 * formato CRM:
 *   - event_name: "Lead"
 *   - action_source: "system_generated"
 *   - custom_data.event_source: "crm"
 *   - custom_data.lead_event_source: rótulo configurado (`parameters._crm_label`)
 *
 * O `event_id` é derivado (`<original>_crm`) para deduplicar no Meta sem colidir
 * com o evento original.
 *
 * Compras vindas de webhook usam `buildCrmQualificationFromPurchase` para forçar
 * a qualificação máxima ("Compra realizada"), respeitando o toggle global
 * `integrations_meta.crm_qualify_purchases` (default TRUE).
 *
 * Aditivo: NÃO altera o token CAPI, Pixel ID, SDK injetado ou formulários.
 *
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 * @see https://www.facebook.com/business/help/2607361604974157 (CRM uploads / Lead Event Source)
 */

import type { CapiEvent } from '../services/capi';
import { pool } from '../db/pool';

// Mesmo padrão usado em ingest.ts/quota.ts — robusto entre v6 e v7 do lru-cache.
const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

export type CrmQualifyConfig = {
  enabled: boolean;
  /** Rótulo que aparece em `lead_event_source` (ex.: "Lead qualificado", "Compra realizada"). */
  label: string;
};

/**
 * Lê os 2 campos opcionais que adicionamos ao `parameters` JSONB livre de `site_url_rules`.
 * Não afeta regras antigas — chaves desconhecidas são simplesmente ignoradas.
 */
export function extractCrmQualifyFromRuleParameters(
  parameters: unknown
): CrmQualifyConfig | null {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  const p = parameters as Record<string, unknown>;
  if (p._crm_qualify !== true) return null;
  const labelRaw = typeof p._crm_label === 'string' ? p._crm_label.trim() : '';
  return { enabled: true, label: labelRaw };
}

/** Cache LRU dos parâmetros de regra (60s) para evitar hit no DB a cada evento ingerido. */
const ruleParamsCache: { get: (k: string) => CrmQualifyConfig | null | undefined; set: (k: string, v: CrmQualifyConfig | null) => void; delete: (k: string) => void } = new LRUCache({
  max: 5000,
  ttl: 60 * 1000,
});

/**
 * Busca a configuração CRM de uma regra (site_url_rules) por id, escopada ao site_key.
 * Cacheia o resultado (mesmo quando é null) para evitar pressão no DB sob alto tráfego.
 */
export async function getCrmQualifyForRule(
  siteKey: string,
  ruleId: number
): Promise<CrmQualifyConfig | null> {
  if (!siteKey || !Number.isFinite(ruleId)) return null;
  const cacheKey = `${siteKey}::${ruleId}`;
  const cached = ruleParamsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const { rows } = await pool.query<{ parameters: unknown }>(
      `SELECT r.parameters
       FROM site_url_rules r
       JOIN sites s ON s.id = r.site_id
       WHERE r.id = $1 AND s.site_key = $2
       LIMIT 1`,
      [ruleId, siteKey]
    );
    const cfg = rows[0] ? extractCrmQualifyFromRuleParameters(rows[0].parameters) : null;
    ruleParamsCache.set(cacheKey, cfg);
    return cfg;
  } catch {
    return null;
  }
}

/** Cache LRU do toggle global `crm_qualify_purchases` por site_key (60s). */
const purchaseToggleCache: { get: (k: string) => boolean | undefined; set: (k: string, v: boolean) => void; delete: (k: string) => void } = new LRUCache({
  max: 5000,
  ttl: 60 * 1000,
});

/** True por padrão (compras qualificam automaticamente). Cliente pode desligar na aba Meta. */
export async function shouldQualifyPurchasesForSite(siteKey: string): Promise<boolean> {
  if (!siteKey) return false;
  const cached = purchaseToggleCache.get(siteKey);
  if (cached !== undefined) return cached;

  try {
    const { rows } = await pool.query<{ crm_qualify_purchases: boolean | null }>(
      `SELECT i.crm_qualify_purchases
       FROM integrations_meta i
       JOIN sites s ON s.id = i.site_id
       WHERE s.site_key = $1
       LIMIT 1`,
      [siteKey]
    );
    const v = rows[0]?.crm_qualify_purchases;
    const enabled = v === null || v === undefined ? true : Boolean(v);
    purchaseToggleCache.set(siteKey, enabled);
    return enabled;
  } catch {
    return true;
  }
}

/** Permite invalidar caches manualmente após updates (rotas PUT). */
export function invalidateCrmCaches(siteKey: string, ruleId?: number): void {
  if (ruleId !== undefined) ruleParamsCache.delete(`${siteKey}::${ruleId}`);
  purchaseToggleCache.delete(siteKey);
}

type UserDataLike = NonNullable<CapiEvent['user_data']> & { lead_id?: unknown };

/**
 * Constrói o payload CAPI estilo CRM (Lead system_generated) a partir do evento original
 * (que continua sendo enviado normalmente pelo CAPI website). Reusa user_data já hasheado.
 *
 * @param originalCapiEvent o payload website que está prestes a ser enviado
 * @param label rótulo que aparece em custom_data.lead_event_source
 * @param opts.includeValueAndCurrency força value/currency (usado para qualificação por compra)
 */
export function buildCrmQualificationCapiPayload(args: {
  originalCapiEvent: CapiEvent;
  label: string;
  includeValueAndCurrency?: { value: number; currency: string };
}): CapiEvent {
  const { originalCapiEvent, label, includeValueAndCurrency } = args;

  const safeLabel =
    label && label.trim() ? label.trim().slice(0, 120) : originalCapiEvent.event_name;

  const userDataIn = (originalCapiEvent.user_data || {}) as UserDataLike;

  const userData: CapiEvent['user_data'] = {
    client_ip_address: userDataIn.client_ip_address,
    client_user_agent: userDataIn.client_user_agent,
    em: userDataIn.em,
    ph: userDataIn.ph,
    fn: userDataIn.fn,
    ln: userDataIn.ln,
    ct: userDataIn.ct,
    st: userDataIn.st,
    zp: userDataIn.zp,
    db: userDataIn.db,
    country: userDataIn.country,
    external_id: userDataIn.external_id,
  };

  // lead_id (Meta Lead Ads) é suportado pelo serializador; só anexamos se vier no original.
  if (userDataIn.lead_id !== undefined && userDataIn.lead_id !== null && userDataIn.lead_id !== '') {
    (userData as Record<string, unknown>).lead_id = userDataIn.lead_id;
  }

  const customData: Record<string, unknown> = {
    event_source: 'crm',
    lead_event_source: safeLabel,
  };
  if (includeValueAndCurrency) {
    if (Number.isFinite(includeValueAndCurrency.value)) {
      customData.value = includeValueAndCurrency.value;
    }
    if (includeValueAndCurrency.currency) {
      customData.currency = includeValueAndCurrency.currency;
    }
  }

  return {
    event_name: 'Lead',
    event_time: originalCapiEvent.event_time,
    event_id: `${originalCapiEvent.event_id}_crm`,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: customData,
  };
}
