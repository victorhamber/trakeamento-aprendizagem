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
 * usa para ROAS. Sem valor real, envia 0 + BRL (par válido; Pixel e CAPI iguais).
 */
export function ensureMetaRoasMoneyFields(
  eventName: string,
  customData: Record<string, unknown>,
  fallbackCurrency = 'BRL'
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...customData };
  const rawValue = out.value ?? out.amount ?? out.price ?? out.total ?? out.revenue;
  const parsed = parseMetaEventValue(rawValue);
  const rawCurrency = out.currency ?? out.currency_code ?? out.moeda;

  if (META_ROAS_MONEY_EVENTS.has(eventName)) {
    out.value = parsed !== undefined ? parsed : 0;
    out.currency = normalizeMetaCurrencyCode(rawCurrency, fallbackCurrency);
    return out;
  }

  if (parsed !== undefined) {
    out.value = parsed;
    out.currency = normalizeMetaCurrencyCode(rawCurrency, fallbackCurrency);
  }
  return out;
}
