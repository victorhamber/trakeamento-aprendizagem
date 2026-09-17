/**
 * Normalização de PII no formato da Correspondência Avançada / CAPI da Meta.
 * @see https://developers.facebook.com/docs/meta-pixel/advanced/advanced-matching
 */

/** UF (2 letras) a partir de nome/sigla de estado brasileiro. */
const BR_STATE_BY_NAME: Record<string, string> = {
  acre: 'ac',
  alagoas: 'al',
  amapa: 'ap',
  amazonas: 'am',
  bahia: 'ba',
  ceara: 'ce',
  'distrito federal': 'df',
  'espirito santo': 'es',
  goias: 'go',
  maranhao: 'ma',
  'mato grosso': 'mt',
  'mato grosso do sul': 'ms',
  'minas gerais': 'mg',
  para: 'pa',
  paraiba: 'pb',
  parana: 'pr',
  pernambuco: 'pe',
  piaui: 'pi',
  'rio de janeiro': 'rj',
  'rio grande do norte': 'rn',
  'rio grande do sul': 'rs',
  rondonia: 'ro',
  roraima: 'rr',
  'santa catarina': 'sc',
  'sao paulo': 'sp',
  sergipe: 'se',
  tocantins: 'to',
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Nome/sobrenome: minúsculas, sem acento (padrão Meta AM). */
export function normalizeMetaPersonName(raw: string): string {
  return stripDiacritics(String(raw || ''))
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa nome completo em fn/ln.
 * Se só houver uma parte, vai para fn (Meta: first name).
 */
export function splitMetaPersonName(fullName: string): { fn: string; ln: string } {
  const t = normalizeMetaPersonName(fullName);
  if (!t) return { fn: '', ln: '' };
  const i = t.indexOf(' ');
  if (i < 0) return { fn: t, ln: '' };
  return { fn: t.slice(0, i), ln: t.slice(i + 1).trim() };
}

/** Cidade: minúsculas, sem espaços (ex.: menlopark). */
export function normalizeMetaCity(raw: string): string {
  return stripDiacritics(String(raw || ''))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Estado/província: código de 2 letras em minúsculas.
 * Aceita UF (`SP`) ou nome (`São Paulo` → `sp`).
 */
export function normalizeMetaState(raw: string): string {
  const t = stripDiacritics(String(raw || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return '';
  if (/^[a-z]{2}$/.test(t)) return t;
  return BR_STATE_BY_NAME[t] || t.replace(/[^a-z]/g, '').slice(0, 2);
}

/** País ISO-3166 alpha-2 em minúsculas. */
export function normalizeMetaCountry(raw: string): string {
  const s = stripDiacritics(String(raw || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!s) return '';
  if (/^[a-z]{2}$/.test(s)) return s;
  if (s === 'brasil' || s === 'brazil') return 'br';
  if (s === 'portugal') return 'pt';
  if (s === 'usa' || s === 'unitedstates' || s === 'estadosunidos') return 'us';
  const m = s.match(/^[a-z]{2}-([a-z]{2})$/);
  if (m) return m[1];
  const letters = s.replace(/[^a-z]/g, '');
  if (letters.length === 2) return letters;
  return '';
}
