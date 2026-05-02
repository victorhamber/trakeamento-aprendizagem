/**
 * Consolida fonte de tráfego para `site_visitors` (primeiro/último toque) e enriquecimento de relatórios.
 * Prioriza query string da URL (landing real); completa com custom_data do pixel.
 */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const;
export type UtmRecord = Record<(typeof UTM_KEYS)[number], string>;

function emptyUtmRecord(): UtmRecord {
  return {
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
    click_id: '',
  };
}

/** Parse de query string (?a=b ou a=b) para registro UTM. */
export function parseStoredTrafficSource(raw: string | null | undefined): UtmRecord | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const q = s.startsWith('?') ? s.slice(1) : s;
    const params = new URLSearchParams(q);
    const pick = (k: string) => (params.get(k) || '').trim();
    let utm_source = pick('utm_source');
    let utm_medium = pick('utm_medium');
    const utm_campaign = pick('utm_campaign');
    const utm_content = pick('utm_content');
    const utm_term = pick('utm_term');
    let click_id = pick('click_id');
    const fbclid = pick('fbclid');
    const gclid = pick('gclid');
    if (!click_id && fbclid) click_id = fbclid;
    if (!utm_source && fbclid) {
      utm_source = 'facebook';
      if (!utm_medium) utm_medium = 'cpc';
    } else if (!utm_source && gclid) {
      utm_source = 'google';
      if (!utm_medium) utm_medium = 'cpc';
    }
    const r = emptyUtmRecord();
    r.utm_source = utm_source;
    r.utm_medium = utm_medium;
    r.utm_campaign = utm_campaign;
    r.utm_content = utm_content;
    r.utm_term = utm_term;
    r.click_id = click_id;
    if (!r.utm_source && !r.utm_campaign && !r.utm_content && !r.click_id) return null;
    return r;
  } catch {
    return null;
  }
}

function recordFromLandingUrl(url: string): UtmRecord | null {
  try {
    const u = new URL(url);
    return parseStoredTrafficSource(u.search || '');
  } catch {
    const i = url.indexOf('?');
    if (i < 0) return null;
    return parseStoredTrafficSource(url.slice(i));
  }
}

function pickCd(cd: Record<string, unknown> | undefined, key: string): string {
  if (!cd) return '';
  const v = cd[key];
  if (typeof v !== 'string') return '';
  return v.trim();
}

function recordFromCustomData(cd: Record<string, unknown> | undefined): UtmRecord | null {
  if (!cd) return null;
  let utm_source = pickCd(cd, 'utm_source');
  let utm_medium = pickCd(cd, 'utm_medium');
  const utm_campaign = pickCd(cd, 'utm_campaign');
  const utm_content = pickCd(cd, 'utm_content');
  const utm_term = pickCd(cd, 'utm_term');
  let click_id = pickCd(cd, 'click_id');
  const fbclid = pickCd(cd, 'fbclid');
  const gclid = pickCd(cd, 'gclid');
  if (!click_id && fbclid) click_id = fbclid;
  if (!utm_source && fbclid) {
    utm_source = 'facebook';
    if (!utm_medium) utm_medium = 'cpc';
  } else if (!utm_source && gclid) {
    utm_source = 'google';
    if (!utm_medium) utm_medium = 'cpc';
  }
  const r = emptyUtmRecord();
  r.utm_source = utm_source;
  r.utm_medium = utm_medium;
  r.utm_campaign = utm_campaign;
  r.utm_content = utm_content;
  r.utm_term = utm_term;
  r.click_id = click_id;
  if (!r.utm_source && !r.utm_campaign && !r.utm_content && !r.click_id) return null;
  return r;
}

/** URL primeiro (utm da landing); custom_data completa o que faltar. */
function mergeUrlPrefer(urlRec: UtmRecord | null, cdRec: UtmRecord | null): UtmRecord | null {
  if (!urlRec && !cdRec) return null;
  const out = emptyUtmRecord();
  for (const k of UTM_KEYS) {
    const vu = (urlRec?.[k] || '').trim();
    const vc = (cdRec?.[k] || '').trim();
    out[k] = vu || vc || '';
  }
  if (!out.utm_source && !out.utm_campaign && !out.utm_content && !out.click_id) return null;
  return out;
}

function serializeUtmRecord(r: UtmRecord): string | undefined {
  const p = new URLSearchParams();
  if (r.utm_source) p.set('utm_source', r.utm_source);
  if (r.utm_medium) p.set('utm_medium', r.utm_medium);
  if (r.utm_campaign) p.set('utm_campaign', r.utm_campaign);
  if (r.utm_content) p.set('utm_content', r.utm_content);
  if (r.utm_term) p.set('utm_term', r.utm_term);
  if (r.click_id) p.set('click_id', r.click_id);
  const s = p.toString();
  return s || undefined;
}

/**
 * String estável para gravar em site_visitors.*_traffic_source (formato query utm_*).
 */
export function buildVisitorTrafficSourceString(
  customData: Record<string, unknown> | undefined,
  eventSourceUrl: string | null | undefined
): string | undefined {
  const url = typeof eventSourceUrl === 'string' ? eventSourceUrl.trim() : '';
  const urlRec = url ? recordFromLandingUrl(url) : null;
  const cdRec = recordFromCustomData(customData);
  const merged = mergeUrlPrefer(urlRec, cdRec);
  if (merged) {
    const ser = serializeUtmRecord(merged);
    if (ser) return ser;
  }
  const trafficSource =
    customData && typeof customData.traffic_source === 'string' ? customData.traffic_source.trim() : '';
  if (trafficSource && !trafficSource.toLowerCase().startsWith('trk_')) return trafficSource;
  const taTs = customData && typeof customData.ta_ts === 'string' ? customData.ta_ts.trim() : '';
  if (taTs && !taTs.toLowerCase().startsWith('trk_')) return taTs;
  return undefined;
}

/** Preenche campos vazios de `primary` com valores de `fallback` (ex.: perfil first_touch). */
export function mergeUtmFillGaps(
  primary: Record<string, string> | null | undefined,
  fallback: UtmRecord | Record<string, string> | null | undefined
): Record<string, string> | null {
  const fb = fallback as Record<string, string> | undefined;
  const fallbackHas = fb && UTM_KEYS.some((k) => (fb[k] || '').trim());
  if (!fallbackHas) {
    if (!primary) return null;
    const has = primary.utm_source || primary.utm_campaign || primary.utm_content || primary.click_id;
    return has ? { ...primary } : null;
  }
  if (!primary) {
    const o: Record<string, string> = {};
    for (const k of UTM_KEYS) o[k] = (fb![k] || '').trim();
    const has = o.utm_source || o.utm_campaign || o.utm_content || o.click_id;
    return has ? o : null;
  }
  const out: Record<string, string> = { ...primary };
  for (const k of UTM_KEYS) {
    if (!(out[k] || '').trim() && (fb![k] || '').trim()) {
      out[k] = (fb![k] || '').trim();
    }
  }
  const has = out.utm_source || out.utm_campaign || out.utm_content || out.click_id;
  return has ? out : null;
}

/**
 * UTMs persistidos na compra: colunas principais + `custom_data` do webhook (ex.: utm_content, utm_term, click_id/fbclid).
 * Usado só para **preencher lacunas** no último toque (ver mergeUtmFillGaps) — não sobrescreve o que já veio do PageView.
 */
export function utmRecordFromPurchaseRow(row: {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  custom_data?: unknown;
}): UtmRecord | null {
  const r = emptyUtmRecord();
  r.utm_source = (row.utm_source || '').trim();
  r.utm_medium = (row.utm_medium || '').trim();
  r.utm_campaign = (row.utm_campaign || '').trim();

  const cd =
    row.custom_data && typeof row.custom_data === 'object'
      ? recordFromCustomData(row.custom_data as Record<string, unknown>)
      : null;

  if (cd) {
    for (const k of UTM_KEYS) {
      if (!(r[k] || '').trim()) r[k] = (cd[k] || '').trim();
    }
  }

  if (!r.utm_source && !r.utm_medium && !r.utm_campaign && !r.utm_content && !r.utm_term && !r.click_id) return null;
  return r;
}
