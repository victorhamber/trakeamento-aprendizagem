/**
 * fbc / fbp na Conversions API devem refletir o clique com fidelidade (fbclid sem toLowerCase ou truncar).
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
export function preserveMetaClickIds(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val !== 'string') return undefined;
  const t = val.trim();
  return t || undefined;
}

function parseMetaCookieTimestampMs(raw: string): number | undefined {
  const parts = raw.split('.');
  if (parts.length < 4) return undefined;
  const tsRaw = Number(parts[2]);
  if (!Number.isFinite(tsRaw) || tsRaw <= 0) return undefined;
  // Alguns integradores enviam segundos; normalizamos para ms.
  return tsRaw < 10_000_000_000 ? tsRaw * 1000 : tsRaw;
}

/**
 * fbc deve representar clique recente (janela de 90 dias).
 * Quando expirado, é melhor omitir do payload para evitar alerta de qualidade.
 */
export function preserveFreshMetaFbc(val: unknown, maxAgeDays = 90): string | undefined {
  const t = preserveMetaClickIds(val);
  if (!t) return undefined;
  if (!t.toLowerCase().startsWith('fb.')) return undefined;

  const tsMs = parseMetaCookieTimestampMs(t);
  if (!tsMs) return undefined;

  const now = Date.now();
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
  if (tsMs > now + 24 * 60 * 60 * 1000) return undefined;
  if (now - tsMs > maxAgeMs) return undefined;
  return t;
}

/**
 * Cookie/formato `fbc` enviado ao CAPI: `fb.<subdomain>.<creation_time>.<fbclid>`.
 * Usado no painel para preencher Click ID quando a URL/custom_data não trazem fbclid.
 */
export function fbclidFromFbcCookie(fbc: string | null | undefined): string | undefined {
  const t = typeof fbc === 'string' ? fbc.trim() : '';
  if (!t.toLowerCase().startsWith('fb.')) return undefined;
  const parts = t.split('.');
  if (parts.length < 4) return undefined;
  const fbclid = parts.slice(3).join('.');
  return fbclid || undefined;
}
