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
