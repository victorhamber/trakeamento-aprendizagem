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
