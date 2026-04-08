/** Query keys do modo seletor / teste no site (não fazem parte da URL “real” da página). */
export const TRAJETTU_AUX_QUERY_KEYS = ['ta_pick', 'ta_origin', 'ta_test', 'ta_rule'] as const;

/** Limpa o valor de "Se a URL contém" após o postMessage do seletor (defesa contra SDK antigo/cache). */
export function stripTrajettuAuxFromMatchPath(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  const hadLeadingSlash = s.startsWith('/');
  try {
    const u = new URL(s, 'https://trajettu-aux-path.invalid');
    for (const k of TRAJETTU_AUX_QUERY_KEYS) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    let out = u.pathname + (q ? `?${q}` : '');
    if (!hadLeadingSlash && out.startsWith('/')) out = out.slice(1);
    return out;
  } catch {
    return s;
  }
}
