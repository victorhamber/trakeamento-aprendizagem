/**
 * Meta Pixel / CAPI exigem `currency` como código ISO 4217 de 3 letras.
 * Valores como "R$", "MX$", números ou strings longas geram aviso de ROAS no Events Manager.
 */
export function normalizeMetaCurrencyCode(raw: unknown, fallback = 'BRL'): string {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim().toUpperCase();
  if (!s || s === '0') return fallback;
  if (/^[A-Z]{3}$/.test(s)) return s;
  return fallback;
}

/**
 * Eventos em que o Events Manager exige value + currency ISO para ROAS.
 * Lead é evento padrão Meta (`fbq('track')`). Download e Group são
 * personalizados do site (`fbq('trackCustom')`) — a Meta ainda alerta ROAS
 * neles. Purchase fica de fora para não inventar valor 0 numa conversão real.
 */
export const META_ROAS_MONEY_EVENTS = new Set([
  'ViewContent',
  'AddToCart',
  'AddToWishlist',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Lead',
  'CompleteRegistration',
  'Subscribe',
  'StartTrial',
  'Download',
  'Group',
  'Grupo',
  'Donate',
  'Schedule',
  'Contact',
  'SubmitApplication',
]);

/** Aceita número ou string ("97", "97,00"); rejeita negativo/NaN. */
export function parseMetaEventValue(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  }
  const s = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Garante `value` numérico + `currency` ISO 4217 nos eventos que o Meta
 * usa para ROAS. `value=0` é tratado como ausente (Events Manager marca inválido
 * e dispara “preços iguais”). Sem valor no evento, usa `fallbackValue` se > 0.
 */
export function ensureMetaRoasMoneyFields(
  eventName: string,
  customData: Record<string, unknown>,
  fallbackCurrency = 'BRL',
  fallbackValue?: number
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...customData };
  const rawValue = out.value ?? out.amount ?? out.price ?? out.total ?? out.revenue;
  const parsed = parseMetaEventValue(rawValue);
  const rawCurrency = out.currency ?? out.currency_code ?? out.moeda;
  const fallbackParsed = parseMetaEventValue(fallbackValue);
  const positive = parsed !== undefined && parsed > 0 ? parsed : undefined;
  const positiveFallback = fallbackParsed !== undefined && fallbackParsed > 0 ? fallbackParsed : undefined;

  if (META_ROAS_MONEY_EVENTS.has(eventName)) {
    out.value = positive ?? positiveFallback ?? 1;
    out.currency = normalizeMetaCurrencyCode(rawCurrency, fallbackCurrency);
    return out;
  }

  if (parsed !== undefined) {
    out.value = parsed;
    out.currency = normalizeMetaCurrencyCode(rawCurrency, fallbackCurrency);
  }
  return out;
}

/**
 * Campos de comércio no Purchase CAPI.
 * Não envia `value: 0`, nem `contents` (catálogo Meta). Offer Hotmart (`f7x5lf5w`)
 * no content_ids faz o Graph tratar o evento como DPA e descartar o Purchase
 * enquanto o evento CRM (sem contents) entra normal.
 */
export function isMetaCatalogContentId(raw: unknown): boolean {
  if (raw == null) return false;
  return /^\d+$/.test(String(raw).trim());
}

export function buildMetaPurchaseCommerceFields(input: {
  value: unknown;
  currency?: unknown;
  contentId?: unknown;
  orderId?: unknown;
  numItems?: number;
}): Record<string, unknown> {
  const parsed = parseMetaEventValue(input.value);
  const positive = parsed !== undefined && parsed > 0 ? parsed : undefined;
  const currency =
    positive !== undefined ? normalizeMetaCurrencyCode(input.currency) : undefined;
  const contentId =
    isMetaCatalogContentId(input.contentId) ? String(input.contentId).trim() : undefined;
  const orderId =
    input.orderId != null && String(input.orderId).trim() !== ''
      ? String(input.orderId).trim()
      : undefined;
  const numItems = input.numItems && input.numItems > 0 ? input.numItems : 1;
  const out: Record<string, unknown> = {
    num_items: numItems,
  };
  if (positive !== undefined && currency) {
    out.value = positive;
    out.currency = currency;
  }
  if (contentId) {
    out.content_ids = [contentId];
    out.content_type = 'product';
  }
  if (orderId) out.order_id = orderId;
  return out;
}

/** Remove payload de catálogo inválido antes do POST no Graph (inclui retry da outbox). */
export function sanitizeMetaCommerceCustomData(
  eventName: string,
  customData: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...customData };
  delete out.contents;
  if (eventName !== 'Purchase' && eventName !== 'InitiateCheckout' && eventName !== 'AddToCart') {
    return out;
  }
  const ids = Array.isArray(out.content_ids) ? out.content_ids : [];
  const numeric = ids.map((id) => String(id).trim()).filter((id) => isMetaCatalogContentId(id));
  if (numeric.length > 0) {
    out.content_ids = numeric;
    if (!out.content_type) out.content_type = 'product';
  } else {
    delete out.content_ids;
    if (out.content_type === 'product' || out.content_type === 'product_group') {
      delete out.content_type;
    }
  }
  return out;
}
