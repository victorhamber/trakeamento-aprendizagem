/**
 * Qualificação CRM (estilo Meta) — envio aditivo via Conversions API.
 *
 * Quando uma regra em `site_url_rules` é marcada com `parameters._crm_qualify = true`,
 * o ingest envia, EM PARALELO ao evento normal (website), um segundo evento CAPI no
 * formato CRM:
 *   - event_name: `parameters._crm_event_name` ou estágio padrão (ex.: "Qualificado")
 *   - action_source: "system_generated"
 *   - custom_data.event_source: "crm"
 *   - custom_data.lead_event_source: `parameters._crm_tool`, ou `_crm_label`, ou `Trajettu`
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

/** Estágio inicial enviado automaticamente em todo evento site `Lead` (sem regra CRM no mesmo disparo). */
export const CRM_AUTO_FUNNEL_LEAD_STAGE = 'Lead inicial';

/** Estágio padrão para qualificação por regra (URL/botão) quando `_crm_event_name` não foi personalizado. */
export const CRM_RULE_DEFAULT_PIPELINE_STAGE = 'Qualificado';

// Mesmo padrão usado em ingest.ts/quota.ts — robusto entre v6 e v7 do lru-cache.
const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

export type CrmQualifyConfig = {
  enabled: boolean;
  /** Legado: texto para lead_event_source quando `_crm_tool` não está definido. */
  label: string;
  /** Nome da ferramenta CRM em lead_event_source (doc Meta). Opcional. */
  tool?: string;
  /** Estágio do funil → event_name do payload CRM (doc Meta). Opcional; padrão Qualificado. */
  eventName?: string;
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
  const toolRaw = typeof p._crm_tool === 'string' ? p._crm_tool.trim() : '';
  const stageRaw = typeof p._crm_event_name === 'string' ? p._crm_event_name.trim() : '';
  return {
    enabled: true,
    label: labelRaw,
    ...(toolRaw ? { tool: toolRaw } : {}),
    ...(stageRaw ? { eventName: stageRaw } : {}),
  };
}

/** lead_event_source: ferramenta CRM (prioridade tool → label → Trajettu). */
export function resolveCrmLeadEventSource(qual: CrmQualifyConfig): string {
  const t = (qual.tool || '').trim();
  if (t) return t.slice(0, 120);
  const l = (qual.label || '').trim();
  if (l) return l.slice(0, 120);
  return 'Trajettu';
}

/** event_name do payload CRM para regras (meio do funil); padrão alinhado à doc Meta. */
export function resolveCrmPipelineEventName(qual: CrmQualifyConfig): string {
  const e = (qual.eventName || '').trim();
  if (e) return e.slice(0, 100);
  return CRM_RULE_DEFAULT_PIPELINE_STAGE;
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

/** Cache: toggle `crm_auto_funnel_lead` (envio automático do estágio inicial no Lead). */
const autoFunnelLeadCache: { get: (k: string) => boolean | undefined; set: (k: string, v: boolean) => void; delete: (k: string) => void } =
  new LRUCache({
    max: 5000,
    ttl: 60 * 1000,
  });

/**
 * Lead inicial no funil CRM: **ligado por padrão** para todo site com integração.
 * Só fica desligado se `crm_auto_funnel_lead` for explicitamente FALSE (opt-out raro / futuro).
 */
export async function shouldAutoFunnelLeadForSite(siteKey: string): Promise<boolean> {
  if (!siteKey) return false;
  const cached = autoFunnelLeadCache.get(siteKey);
  if (cached !== undefined) return cached;
  try {
    const { rows } = await pool.query<{ crm_auto_funnel_lead: boolean | null }>(
      `SELECT i.crm_auto_funnel_lead
       FROM integrations_meta i
       JOIN sites s ON s.id = i.site_id
       WHERE s.site_key = $1
       LIMIT 1`,
      [siteKey]
    );
    const v = rows[0]?.crm_auto_funnel_lead;
    const enabled = v !== false;
    autoFunnelLeadCache.set(siteKey, enabled);
    return enabled;
  } catch {
    autoFunnelLeadCache.set(siteKey, true);
    return true;
  }
}

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
  autoFunnelLeadCache.delete(siteKey);
}

type UserDataLike = NonNullable<CapiEvent['user_data']> & { lead_id?: unknown };

/**
 * Constrói o payload CAPI estilo CRM (system_generated) a partir do evento original
 * (que continua sendo enviado normalmente pelo CAPI website). Reusa user_data já hasheado.
 *
 * @param originalCapiEvent o payload website que está prestes a ser enviado
 * @param leadEventSource custom_data.lead_event_source (nome da ferramenta CRM — doc Meta)
 * @param crmEventName event_name do evento CRM (estágio do funil); padrão Lead
 * @param opts.includeValueAndCurrency força value/currency (usado para qualificação por compra)
 */
export function buildCrmQualificationCapiPayload(args: {
  originalCapiEvent: CapiEvent;
  leadEventSource: string;
  crmEventName?: string;
  includeValueAndCurrency?: { value: number; currency: string };
  /** Sufixo do event_id para dedup (padrão `_crm`; automático Lead inicial: `_crm_auto_lead`). */
  crmEventIdSuffix?: string;
}): CapiEvent {
  const { originalCapiEvent, leadEventSource, crmEventName, includeValueAndCurrency, crmEventIdSuffix } = args;

  const safeLeadSrc = (leadEventSource || '').trim().slice(0, 120) || 'Trajettu';
  const trimmedEv = (crmEventName || '').trim().slice(0, 100);
  const safeEventName = trimmedEv || 'Lead';

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
    lead_event_source: safeLeadSrc,
  };
  if (includeValueAndCurrency) {
    if (Number.isFinite(includeValueAndCurrency.value)) {
      customData.value = includeValueAndCurrency.value;
    }
    if (includeValueAndCurrency.currency) {
      customData.currency = includeValueAndCurrency.currency;
    }
  }

  const rawSuffix = (crmEventIdSuffix ?? '_crm').trim();
  const safeSuffix =
    rawSuffix && /^[a-zA-Z0-9_-]+$/.test(rawSuffix) ? rawSuffix : '_crm';

  return {
    event_name: safeEventName,
    event_time: originalCapiEvent.event_time,
    event_id: `${originalCapiEvent.event_id}${safeSuffix}`,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: customData,
  };
}
