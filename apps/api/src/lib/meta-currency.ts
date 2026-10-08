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
 * Converte valor digitado (pt-BR ou en) em número: "1.297" → 1297,
 * "1.297,50" → 1297.5, "97,50" → 97.5, "9.99" → 9.99, "R$ 597" → 597.
 * Ponto seguido de grupos de exatamente 3 dígitos é separador de milhar.
 */
export function normalizeMoneyString(raw: string): string {
  let s = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (!s) return '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    s = s.indexOf(',') !== lastComma ? s.split(',').join('') : s.replace(',', '.');
  } else if (lastDot >= 0 && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.split('.').join('');
  }
  return s;
}

/** Aceita número ou string ("97", "97,00", "1.297"); rejeita negativo/NaN. */
export function parseMetaEventValue(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  }
  const s = normalizeMoneyString(String(raw));
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

const MONEY_ALIAS_KEYS = ['value', 'amount', 'price', 'total', 'revenue', 'currency', 'currency_code', 'moeda'] as const;

/**
 * Mantém `value` só quando o evento já traz um número > 0 (compra real ou
 * valor digitado na regra). Não inventa ticket, não manda 0 e não manda
 * currency sozinha — campo ausente, não zero.
 */
export function ensureMetaRoasMoneyFields(
  _eventName: string,
  customData: Record<string, unknown>,
  fallbackCurrency = 'BRL'
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...customData };
  const rawValue = out.value ?? out.amount ?? out.price ?? out.total ?? out.revenue;
  const parsed = parseMetaEventValue(rawValue);
  const positive = parsed !== undefined && parsed > 0 ? parsed : undefined;

  for (const key of MONEY_ALIAS_KEYS) delete out[key];

  if (positive === undefined) return out;

  const rawCurrency = customData.currency ?? customData.currency_code ?? customData.moeda;
  out.value = positive;
  out.currency = normalizeMetaCurrencyCode(rawCurrency, fallbackCurrency);
  return out;
}

/**
 * Campos de comércio no Purchase CAPI.
 * Não envia `value: 0`. Também não envia `contents`, `content_ids` nem
 * `content_type: product`: o id do produto Hotmart é o mesmo em todas as
 * ofertas (24, 597, 1997) e a Meta trata isso como um único preço de catálogo.
 * O preço de cada venda vai só em `value` + `currency`.
 */
export function isMetaCatalogContentId(raw: unknown): boolean {
  if (raw == null) return false;
  return /^\d+$/.test(String(raw).trim());
}

export function buildMetaPurchaseCommerceFields(input: {
  value: unknown;
  currency?: unknown;
  /** Mantido na assinatura; não entra no payload da Meta. */
  contentId?: unknown;
  orderId?: unknown;
  numItems?: number;
}): Record<string, unknown> {
  const parsed = parseMetaEventValue(input.value);
  const positive =
    parsed !== undefined && parsed > 0 ? Math.round(parsed * 100) / 100 : undefined;
  const currency =
    positive !== undefined ? normalizeMetaCurrencyCode(input.currency) : undefined;
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
  if (orderId) out.order_id = orderId;
  return out;
}

function stripPurchaseCatalogFields(out: Record<string, unknown>): void {
  delete out.contents;
  delete out.content_ids;
  if (out.content_type === 'product' || out.content_type === 'product_group') {
    delete out.content_type;
  }
}

/** Remove payload de catálogo inválido antes do POST no Graph (inclui retry da outbox). */
export function sanitizeMetaCommerceCustomData(
  eventName: string,
  customData: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...customData };
  if (eventName === 'Purchase') {
    stripPurchaseCatalogFields(out);
    return out;
  }
  if (eventName !== 'InitiateCheckout' && eventName !== 'AddToCart') {
    delete out.contents;
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

  const rawContents = Array.isArray(out.contents) ? out.contents : [];
  const cleanedContents: Array<Record<string, unknown>> = [];
  for (const item of rawContents) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const price = parseMetaEventValue(rec.item_price ?? rec.price);
    if (price === undefined || price <= 0) continue;
    const rawId = rec.id != null ? String(rec.id).trim() : '';
    if (rawId && !isMetaCatalogContentId(rawId)) continue;
    const qty = parseMetaEventValue(rec.quantity);
    cleanedContents.push({
      quantity: qty && qty > 0 ? qty : 1,
      item_price: Math.round(price * 100) / 100,
      ...(rawId ? { id: rawId } : {}),
    });
  }
  if (cleanedContents.length > 0) out.contents = cleanedContents;
  else delete out.contents;
  return out;
}
