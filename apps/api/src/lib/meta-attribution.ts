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
