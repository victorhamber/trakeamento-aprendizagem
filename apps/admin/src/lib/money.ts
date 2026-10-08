/**
 * Valor digitado no formato brasileiro ou americano → número.
 * "1.297" → 1297, "1.297,50" → 1297.5, "97,50" → 97.5, "9.99" → 9.99, "R$ 597" → 597.
 * Ponto seguido de grupos de exatamente 3 dígitos é separador de milhar.
 */
export function parseMoneyInput(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
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
  return Number(s);
}
