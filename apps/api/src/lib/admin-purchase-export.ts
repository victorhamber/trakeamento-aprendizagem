/** Monta CSV de compras de uma conta (admin) para Excel / lookalike Meta. */

export type PurchaseExportRow = {
  site_name?: string | null;
  site_domain?: string | null;
  order_id?: string | null;
  platform?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  status?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  external_id?: string | null;
  platform_date?: Date | string | null;
  created_at?: Date | string | null;
  custom_data?: unknown;
  user_data?: unknown;
  raw_payload?: unknown;
  landing_page?: string | null;
};

const SECRET_KEY =
  /^(access_token|capi_token|webhook_secret|hottok|password|authorization|api_secret|api_key|apikey)$/i;

export const PURCHASE_CSV_HEADERS = [
  'email',
  'phone',
  'fn',
  'ln',
  'ct',
  'st',
  'zip',
  'country',
  'dob',
  'gen',
  'value',
  'currency',
  'site',
  'site_domain',
  'order_id',
  'platform',
  'status',
  'purchase_date',
  'product',
  'offer_code',
  'offer_name',
  'payment_type',
  'installments',
  'recurrence',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'landing_page',
  'referrer',
  'fbp',
  'fbc',
  'external_id',
  'ip',
  'webhook_json',
] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
}

export function splitPersonName(full: string): { fn: string; ln: string } {
  const t = (full || '').trim().replace(/\s+/g, ' ');
  if (!t) return { fn: '', ln: '' };
  const i = t.indexOf(' ');
  if (i < 0) return { fn: t, ln: '' };
  return { fn: t.slice(0, i), ln: t.slice(i + 1) };
}

export function csvCell(v: string): string {
  const s = v.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stripSecrets(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const rec = asRecord(obj);
  if (!rec) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = stripSecrets(val);
  }
  return out;
}

function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function nest(raw: unknown, ...keys: string[]): unknown {
  let cur: unknown = raw;
  for (const k of keys) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[k];
  }
  return cur;
}

export function flattenPurchaseForCsv(row: PurchaseExportRow): Record<(typeof PURCHASE_CSV_HEADERS)[number], string> {
  const custom = asRecord(row.custom_data);
  const user = asRecord(row.user_data);
  const raw = asRecord(row.raw_payload);
  const capi = asRecord(raw?._capi_debug);
  const capiCd = asRecord(capi?.custom_data);
  const capiUd = asRecord(capi?.user_data);
  const data = asRecord(raw?.data) || raw;
  const buyer = asRecord(data?.buyer) || asRecord(data?.customer) || asRecord(data?.client);
  const purchase = asRecord(data?.purchase) || asRecord(data?.order);
  const product = asRecord(data?.product) || asRecord(purchase?.product);
  const offer = asRecord(purchase?.offer) || asRecord(data?.offer);
  const address = asRecord(buyer?.address) || asRecord(data?.address);
  const checkout = asRecord(data?.checkout) || asRecord(purchase?.checkout);

  const fullName = pick(
    row.customer_name,
    buyer?.name,
    [str(buyer?.first_name), str(buyer?.last_name)].filter(Boolean).join(' '),
    nest(data, 'buyer', 'name')
  );
  const { fn, ln } = splitPersonName(fullName);

  const email = pick(
    row.customer_email,
    buyer?.email,
    data?.email,
    raw?.email
  );
  const phone = pick(
    row.customer_phone,
    buyer?.checkout_phone,
    buyer?.phone,
    buyer?.cellphone,
    data?.phone,
    raw?.phone
  );

  const landing = pick(
    row.landing_page,
    custom?.event_source_url,
    custom?.event_url,
    custom?.page_location,
    capi?.event_source_url,
    capiCd?.event_source_url,
    capiCd?.event_url
  );
  const referrer = pick(
    capi?.referrer_url,
    custom?.referrer,
    capiCd?.referrer
  );

  let webhookJson = '';
  try {
    const cleaned = stripSecrets(raw);
    webhookJson = JSON.stringify(cleaned || {});
    if (webhookJson.length > 8000) webhookJson = webhookJson.slice(0, 8000) + '…';
  } catch {
    webhookJson = '';
  }

  return {
    email,
    phone,
    fn: pick(fn, buyer?.first_name),
    ln: pick(ln, buyer?.last_name),
    ct: pick(address?.city, buyer?.city, custom?.content_city),
    st: pick(address?.state, buyer?.state, address?.uf),
    zip: pick(address?.zip_code, address?.zip, address?.postal_code, buyer?.zip),
    country: pick(address?.country, buyer?.country),
    dob: pick(buyer?.birth, buyer?.birthday, buyer?.date_of_birth),
    gen: pick(buyer?.gender, buyer?.sex),
    value: pick(row.amount, nest(purchase, 'price', 'value'), nest(purchase, 'full_price', 'value')),
    currency: pick(row.currency, nest(purchase, 'price', 'currency_value'), nest(purchase, 'price', 'currency_code')),
    site: str(row.site_name),
    site_domain: str(row.site_domain),
    order_id: str(row.order_id),
    platform: str(row.platform),
    status: str(row.status),
    purchase_date: fmtDate(row.platform_date || row.created_at),
    product: pick(
      custom?.content_name,
      capiCd?.content_name,
      product?.name,
      nest(purchase, 'offer', 'name')
    ),
    offer_code: pick(offer?.code, custom?.offer_code, capiCd?.offer_code),
    offer_name: pick(offer?.name, custom?.offer_name, capiCd?.offer_name),
    payment_type: pick(purchase?.payment_type, checkout?.payment_method, nest(purchase, 'payment', 'type')),
    installments: pick(nest(purchase, 'payment', 'installments_number'), purchase?.installments_number),
    recurrence: pick(nest(purchase, 'recurrence_number'), nest(data, 'subscription', 'recurrence_number')),
    utm_source: pick(row.utm_source, custom?.utm_source, capiCd?.utm_source),
    utm_medium: pick(row.utm_medium, custom?.utm_medium, capiCd?.utm_medium),
    utm_campaign: pick(row.utm_campaign, custom?.utm_campaign, capiCd?.utm_campaign),
    utm_content: pick(custom?.utm_content, capiCd?.utm_content),
    utm_term: pick(custom?.utm_term, capiCd?.utm_term),
    landing_page: landing,
    referrer,
    fbp: pick(row.fbp, capiUd?.fbp, user?.fbp),
    fbc: pick(row.fbc, capiUd?.fbc, user?.fbc),
    external_id: pick(row.external_id, capiUd?.external_id, user?.external_id),
    ip: pick(capiUd?.client_ip_address, user?.client_ip_address),
    webhook_json: webhookJson,
  };
}

export function purchasesToCsv(rows: PurchaseExportRow[]): string {
  const lines = [PURCHASE_CSV_HEADERS.join(';')];
  for (const row of rows) {
    const flat = flattenPurchaseForCsv(row);
    lines.push(PURCHASE_CSV_HEADERS.map((h) => csvCell(flat[h])).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function csvFilenameForAccount(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name || email || 'conta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const day = new Date().toISOString().slice(0, 10);
  return `compras-${base || 'conta'}-${day}.csv`;
}
