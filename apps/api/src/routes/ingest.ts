import { Router, Request } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool';
import { capiService, CapiService, CapiEvent } from '../services/capi';
import { Ga4Service } from '../services/ga4';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'; // Added import for express-rate-limit
import cors from 'cors'; // Added import for cors
import { DDI_LIST } from '../lib/ddi';
import { getClientIp } from '../lib/ip';
import { resolveServerGeoHint, geoFromGeoipLite } from '../lib/request-geo';
import { preserveMetaClickIds } from '../lib/meta-attribution';
import { mergeUserDataWithMetaParamBuilder } from '../lib/meta-param-builder-ingest';
import { normalizeMetaCurrencyCode } from '../lib/meta-currency';
import { buildVisitorTrafficSourceString } from '../lib/visitorTrafficSource';
import { checkEventQuota } from '../lib/quota';

const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

const ga4Service = new Ga4Service(pool);

function rateLimitKey(req: Request): string {
  const siteKeyRaw = (req.query['key'] as string | undefined) || (req.headers['x-site-key'] as string | undefined);
  const siteKey = typeof siteKeyRaw === 'string' ? siteKeyRaw.trim() : '';

  // Prefer Cloudflare real client IP. With CF + EasyPanel, req.ip can collapse to a proxy IP depending on hop count.
  const cfIp = (req.headers['cf-connecting-ip'] as string | undefined)?.trim();
  const ipRaw = cfIp || getClientIp(req) || req.ip || 'unknown';
  // Normalize IPv6 and prevent bypass using express-rate-limit helper.
  const ip = ipKeyGenerator({ ip: ipRaw } as any);

  // Separate budgets per site to avoid one hot site starving all others.
  return `${siteKey || 'no_site'}|${ip}`;
}

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1200, // limit each site+IP to 1200 requests per minute
  message: { error: 'Too many requests' },
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    try {
      const siteKeyRaw = (req.query['key'] as string | undefined) || (req.headers['x-site-key'] as string | undefined);
      const siteKey = typeof siteKeyRaw === 'string' ? siteKeyRaw.trim() : '';
      // Use stdout to ensure panel log visibility in some runtimes.
      console.log('[Ingest] rate limit hit', {
        site_key: siteKey || null,
        req_ip: req.ip,
        cf_ip: req.headers['cf-connecting-ip'],
        xff: req.headers['x-forwarded-for'],
        key: rateLimitKey(req),
      });
    } catch {}
    res.status(options.statusCode).json(options.message);
  },
});

const router = Router();

// ─── Auditoria de Leads (retenção curta) ─────────────────────────────────────
// O produto não é CRM. Guardamos apenas uma janela pequena para auditoria.
const LEAD_AUDIT_KEEP_PER_SITE = 20;

async function pruneOldLeadEvents(siteKey: string, keep = LEAD_AUDIT_KEEP_PER_SITE) {
  const k = Math.max(1, Number(keep || LEAD_AUDIT_KEEP_PER_SITE));
  // Remove tudo que estiver "além" dos N mais recentes (por event_time + id).
  // Usamos subquery para manter compatibilidade com Postgres.
  await pool.query(
    `
    DELETE FROM web_events
    WHERE site_key = $1
      AND event_name = 'Lead'
      AND id IN (
        SELECT id
        FROM web_events
        WHERE site_key = $1
          AND event_name = 'Lead'
        ORDER BY event_time DESC, id DESC
        OFFSET $2
      )
    `,
    [siteKey, k]
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EngagementBucket = 'low' | 'medium' | 'high';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const UserDataSchema = z.object({
  client_ip_address: z.string().optional(),
  client_user_agent: z.string().optional(),
  em: z.union([z.string(), z.array(z.string())]).optional(),
  ph: z.union([z.string(), z.array(z.string())]).optional(),
  fn: z.union([z.string(), z.array(z.string())]).optional(),
  ln: z.union([z.string(), z.array(z.string())]).optional(),
  ct: z.union([z.string(), z.array(z.string())]).optional(),
  st: z.union([z.string(), z.array(z.string())]).optional(),
  zp: z.union([z.string(), z.array(z.string())]).optional(),
  country: z.union([z.string(), z.array(z.string())]).optional(),
  db: z.union([z.string(), z.array(z.string())]).optional(),
  fbp: z.string().optional(),
  fbc: z.string().optional(),
  external_id: z.string().optional(),
}).catchall(z.unknown());

const TelemetrySchema = z.object({
  dwell_time_ms: z.number().nonnegative().optional(),
  visible_time_ms: z.number().nonnegative().optional(),
  max_scroll_pct: z.number().min(0).max(100).optional(),
  clicks_total: z.number().nonnegative().optional(),
  clicks_cta: z.number().nonnegative().optional(),
  page_path: z.string().optional(),
  page_title: z.string().optional(),
  load_time_ms: z.number().nonnegative().optional(),
  screen_width: z.number().optional(),
  screen_height: z.number().optional(),
  pixel_ratio: z.number().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  platform: z.string().optional(),
  connection_type: z.string().optional(),
  device_fingerprint: z.string().optional(),
  is_bot: z.boolean().optional(),
}).catchall(z.unknown());

const IngestEventSchema = z.object({
  event_id: z.string().optional(),
  event_name: z.string().min(1).max(100),
  event_time: z.number().int().positive().optional(),
  event_source_url: z.string().url().refine(val => val.startsWith('http://') || val.startsWith('https://')).optional().or(z.literal('')),
  action_source: z.string().optional().default('website'),
  user_data: UserDataSchema.optional(),
  custom_data: z.record(z.string(), z.unknown()).optional(),
  telemetry: TelemetrySchema.optional(),
});

type IngestEvent = z.infer<typeof IngestEventSchema>;

// ─── PII Hashing (padrão Meta CAPI) ─────────────────────────────────────────
// Ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters

/**
 * SHA-256 a string. Retorna '' se vazio.
 * Se já parecer um hash hex de 64 chars, retorna como está (já hasheado no client).
 */
function hashPii(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  // Se já é hash SHA-256 (64 hex chars), não re-hasheia
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
  return createHash('sha256').update(v).digest('hex');
}

const normalizers: Record<string, (v: string) => string> = {
  em: (v) => v.trim().toLowerCase(),
  ph: (v) => {
    let digits = v.replace(/[^0-9]/g, '');
    // Se o telefone já vier com DDI (ex: 5511999999999 tem 12 ou 13 dígitos), mantém.
    // Se vier sem (ex: 11999999999 tem 10 ou 11), adiciona 55 por padrão.
    // Mas como o usuário informou que o form já manda com DDI, priorizamos não mexer se parecer completo.
    if (digits.length === 10 || digits.length === 11) {
      digits = '55' + digits;
    }
    return digits;
  },
  fn: (v) => v.trim().toLowerCase(),
  ln: (v) => v.trim().toLowerCase(),
  ct: (v) => v.trim().toLowerCase(),
  st: (v) => v.trim().toLowerCase(),
  zp: (v) => v.trim().toLowerCase().replace(/\s+/g, ''),
  country: (v) => v.trim().toLowerCase(),
  db: (v) => v.replace(/[^0-9]/g, ''),   // YYYYMMDD
};

function normalizeAndHash(field: string, value: string | string[] | undefined, options?: { ip?: string, country?: string }): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;

  // Se já for um hash (64 hex characters), retorna em caixa baixa, 
  // anulando o normalizer para não destruir o hash
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return raw.toLowerCase();
  }

  let norm = normalizers[field] ? normalizers[field](raw) : raw.trim();

  // Especial para telefone (ph): se veio sem DDI (10-11 dígitos), tenta injetar dinamicamente
  if (field === 'ph' && norm && (norm.length === 10 || norm.length === 11)) {
    let digits = norm;
    let iso = (options?.country || '').toUpperCase().trim();
    if (!iso && options?.ip) {
      const g = geoFromGeoipLite(options.ip);
      if (g.country) iso = g.country;
    }
    const targetCountry = iso || 'BR';
    const ddi = DDI_LIST.find(d => d.country === targetCountry)?.code;
    if (ddi && !digits.startsWith(ddi)) {
      digits = ddi + digits;
    } else if (targetCountry === 'BR' && !digits.startsWith('55')) {
      digits = '55' + digits;
    }
    norm = digits;
  }

  if (!norm) return undefined;
  return hashPii(norm);
}

/**
 * buildCapiUserData devolve em/ph/fn/ln como string[] (formato Meta CAPI).
 * site_visitors.*_hash são VARCHAR(64): passar array ao node-pg gera literal tipo `{abc...}`
 * e estoura o limite (erro 22001).
 */
function visitorPiiHashScalar(val: string[] | undefined): string | undefined {
  if (!val || !val.length) return undefined;
  const s = typeof val[0] === 'string' ? val[0].trim() : '';
  if (!s) return undefined;
  return s.length > 64 ? s.slice(0, 64) : s;
}

function firstNonEmptyString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const t = val.trim();
    return t ? t : undefined;
  }
  if (Array.isArray(val) && typeof val[0] === 'string') {
    const t = val[0].trim();
    return t ? t : undefined;
  }
  return undefined;
}

/**
 * External_id para persistência em `site_visitors`.
 * Regra: NÃO usar `event_id` como fallback primário (isso cria 1 visitor por evento e derruba o banco).
 */
function deriveVisitorExternalIdForStorage(input: {
  external_id?: unknown;
  fbp?: string | null;
  fbc?: string | null;
  em?: string[] | undefined;
  ph?: string[] | undefined;
  client_ip_address?: string | undefined;
  client_user_agent?: string | undefined;
  eventId: string;
}) {
  const ext = firstNonEmptyString(input.external_id);
  if (ext) return ext;

  const fbp = (input.fbp || '').trim();
  if (fbp) return `fbp_${createHash('sha256').update(fbp).digest('hex').slice(0, 32)}`;

  const fbc = (input.fbc || '').trim();
  if (fbc) return `fbc_${createHash('sha256').update(fbc).digest('hex').slice(0, 32)}`;

  const em = visitorPiiHashScalar(input.em);
  if (em) return `em_${em}`;

  const ph = visitorPiiHashScalar(input.ph);
  if (ph) return `ph_${ph}`;

  const ip = (input.client_ip_address || '').trim();
  const ua = (input.client_user_agent || '').trim();
  if (ip || ua) return `fp_${createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)}`;

  // Último recurso (deve ser raríssimo): ainda evita string gigante.
  return `anon_${createHash('sha256').update(input.eventId).digest('hex').slice(0, 16)}`;
}

// ─── Engagement scoring ───────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function pickStringField(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function computeEngagement(event: IngestEvent): { score: number; bucket: EngagementBucket } | null {
  if (!event?.telemetry) return null;
  if (event.event_name !== 'PageEngagement' && event.event_name !== 'PageView') return null;
  if (event.telemetry.is_bot) return null;

  const t = event.telemetry;
  const dwellMs = toNumber(t.dwell_time_ms);
  const visibleMs = toNumber(t.visible_time_ms);
  const scroll = toNumber(t.max_scroll_pct);
  const clicks = toNumber(t.clicks_total);
  const ctaClicks = toNumber(t.clicks_cta);
  const loadTimeMs = toNumber(t.load_time_ms);

  let score = 0;

  // Dwell (usa visible_time se disponível)
  const effectiveDwell = visibleMs > 0 ? visibleMs : dwellMs;
  if (effectiveDwell >= 120_000) score += 40;
  else if (effectiveDwell >= 60_000) score += 35;
  else if (effectiveDwell >= 15_000) score += 25;
  else if (effectiveDwell >= 5_000) score += 12;

  // Scroll depth
  if (scroll >= 90) score += 30;
  else if (scroll >= 70) score += 22;
  else if (scroll >= 50) score += 15;
  else if (scroll >= 20) score += 8;

  // Cliques gerais
  score += Math.min(clicks * 3, 15);

  // CTA (sinal mais forte de intenção)
  score += Math.min(ctaClicks * 12, 35);

  // Penaliza carregamentos muito lentos (UX ruim → engagement artificial)
  if (loadTimeMs > 5000) score -= 5;

  score = Math.max(0, Math.min(100, score));

  const bucket: EngagementBucket = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  return { score, bucket };
}

const META_CUSTOM_TIMEZONE = 'America/Sao_Paulo';

function getTimeDimensions(eventTimeSec: number) {
  const d = new Date(eventTimeSec * 1000);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: META_CUSTOM_TIMEZONE,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      hour12: false,
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const hour = parseInt(map.hour ?? '', 10);
    const dom = parseInt(map.day ?? '', 10);
    if (Number.isFinite(hour) && Number.isFinite(dom)) {
      return {
        event_day: map.weekday,
        event_day_in_month: dom,
        event_month: map.month,
        event_time_interval: `${hour}-${hour + 1}`,
        event_hour: hour,
      };
    }
  } catch {
    // fall through
  }

  const hour = d.getUTCHours();
  return {
    event_day: days[d.getUTCDay()],
    event_day_in_month: d.getUTCDate(),
    event_month: months[d.getUTCMonth()],
    event_time_interval: `${hour}-${hour + 1}`,
    event_hour: hour,
  };
}

// ─── Deduplication (in-memory fallback + Postgres) ───────────────────────────
// Aumentado para 100k e TTL 48h para cobrir janelas maiores de duplicidade
const recentEventIds = new LRUCache({
  max: 100000,
  ttl: 48 * 60 * 60 * 1000,
});

function isDuplicate(siteKey: string, eventId: string): boolean {
  const key = `${siteKey}:${eventId}`;
  if (recentEventIds.has(key)) return true;
  recentEventIds.set(key, true);
  return false;
}

// ─── CAPI payload builder ─────────────────────────────────────────────────────

function resolveClientIp(req: Request, userData: NonNullable<IngestEvent['user_data']>) {
  return getClientIp(req) || userData.client_ip_address || '';
}

/** URL http(s) válida para event_source_url (CAPI / eventos website). */
function isValidHttpUrl(s: string | undefined | null): s is string {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t.startsWith('http://') && !t.startsWith('https://')) return false;
  try {
    const u = new URL(t);
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** Valores permitidos em `action_source` (server event). Ingest usa default Zod `website`. */
const META_CAPI_ACTION_SOURCES = [
  'email',
  'website',
  'app',
  'phone_call',
  'chat',
  'physical_store',
  'system_generated',
  'other',
] as const;

function actionSourceForCapi(raw: string | undefined): CapiEvent['action_source'] | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase();
  return (META_CAPI_ACTION_SOURCES as readonly string[]).includes(t)
    ? (t as CapiEvent['action_source'])
    : undefined;
}

/** `referrer_url` no nível do evento CAPI (não só em custom_data). @see Meta server-event parameters */
function pickReferrerUrlForCapi(
  customData: Record<string, unknown>,
  telemetry: Record<string, unknown>
): string | undefined {
  const candidates = [
    pickStringField(customData, 'referrer'),
    pickStringField(telemetry, 'referrer'),
    pickStringField(customData, 'document_referrer'),
  ];
  for (const c of candidates) {
    if (isValidHttpUrl(c)) return c.trim();
  }
  return undefined;
}

/** Meta Events Manager costuma alertar ROAS quando estes eventos não trazem value+currency. */
const META_ROAS_HINT_EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout']);

/**
 * Monta `custom_data` enviado ao CAPI a partir do ingest (campos comerciais + atribuição).
 */
function buildMetaCustomDataForCapi(
  eventName: string,
  cd: Record<string, unknown>,
  tl: Record<string, unknown>
): { metaCustomData: Record<string, unknown>; refUrl: string | undefined } {
  const refUrl = pickReferrerUrlForCapi(cd, tl);
  const metaCustomData: Record<string, unknown> = {};

  const metaCustomFields = [
    'value',
    'currency',
    'content_name',
    'content_category',
    'content_ids',
    'content_type',
    'contents',
    'num_items',
    'order_id',
    'predicted_ltv',
    'search_string',
    'status',
    'delivery_category',
  ];

  for (const f of metaCustomFields) {
    if (cd[f] !== undefined && cd[f] !== null && cd[f] !== '') {
      if (f === 'value') {
        const val = parseFloat(String(cd[f]));
        if (!Number.isNaN(val)) metaCustomData[f] = val;
      } else {
        metaCustomData[f] = cd[f];
      }
    }
  }

  if (META_ROAS_HINT_EVENTS.has(eventName)) {
    if (metaCustomData['value'] === undefined) {
      metaCustomData['value'] = 0;
    }
    metaCustomData['currency'] = normalizeMetaCurrencyCode(metaCustomData['currency']);
  } else {
    if (metaCustomData['value'] !== undefined) {
      metaCustomData['currency'] = normalizeMetaCurrencyCode(metaCustomData['currency']);
    } else {
      delete metaCustomData['currency'];
    }
  }

  if (!metaCustomData['content_name']) {
    if (cd['content_name'] && cd['content_name'] !== '') {
      metaCustomData['content_name'] = cd['content_name'];
    } else if (cd['page_title'] && cd['page_title'] !== '') {
      metaCustomData['content_name'] = cd['page_title'];
    } else if (tl['page_title'] && tl['page_title'] !== '') {
      metaCustomData['content_name'] = tl['page_title'];
    }
  }

  if (!metaCustomData['content_type'] && metaCustomData['value'] !== undefined) {
    const n = Number(metaCustomData['value']);
    if (!Number.isNaN(n) && n > 0) {
      metaCustomData['content_type'] = 'product';
    }
  }

  const attributionFields: [string, unknown][] = [
    ['utm_source', cd['utm_source'] || tl['utm_source']],
    ['utm_medium', cd['utm_medium'] || tl['utm_medium']],
    ['utm_campaign', cd['utm_campaign'] || tl['utm_campaign']],
    ['utm_term', cd['utm_term'] || tl['utm_term']],
    ['utm_content', cd['utm_content'] || tl['utm_content']],
    ['page_path', cd['page_path'] || tl['page_path']],
    ['page_title', cd['page_title'] || tl['page_title']],
    ...(refUrl ? [] : ([['referrer', cd['referrer'] || tl['referrer']]] as [string, unknown][])),
    ['traffic_source', cd['traffic_source']],
  ];
  for (const [key, val] of attributionFields) {
    if (val !== undefined && val !== null && val !== '') {
      metaCustomData[key] = val;
    }
  }

  return { metaCustomData, refUrl };
}

function joinOriginAndPath(originOrBase: string, pagePath: string): string {
  let raw = originOrBase.trim();
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://${raw.replace(/^\/+/, '')}`;
  }
  const base = new URL(raw);
  const path = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return `${base.origin}${path}`;
}

function headerOriginFromReferer(referer: string | undefined): string | undefined {
  if (!referer || typeof referer !== 'string') return undefined;
  try {
    return new URL(referer.trim()).origin;
  } catch {
    return undefined;
  }
}

const siteFallbackOriginCache = new LRUCache({
  max: 2000,
  ttl: 10 * 60 * 1000,
});

async function lookupSiteCanonicalOrigin(siteKey: string): Promise<string | undefined> {
  const cached = siteFallbackOriginCache.get(siteKey) as string | undefined;
  if (cached !== undefined) {
    return cached.length > 0 ? cached : undefined;
  }
  try {
    const { rows } = await pool.query<{ host: string | null }>(
      `SELECT COALESCE(NULLIF(TRIM(s.tracking_domain), ''), NULLIF(TRIM(s.domain), '')) AS host
       FROM sites s WHERE s.site_key = $1 LIMIT 1`,
      [siteKey]
    );
    const host = rows[0]?.host?.trim();
    if (!host) {
      siteFallbackOriginCache.set(siteKey, '');
      return undefined;
    }
    const hostOnly = host.replace(/^https?:\/\//i, '').split('/')[0];
    const origin = `https://${hostOnly}`;
    siteFallbackOriginCache.set(siteKey, origin);
    return origin;
  } catch {
    siteFallbackOriginCache.set(siteKey, '');
    return undefined;
  }
}

/**
 * Meta CAPI: event_source_url obrigatório para eventos website.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices
 */
async function resolveEventSourceUrlForIngest(
  event: IngestEvent,
  req: Request,
  siteKey: string
): Promise<string> {
  const action = (event.action_source || 'website').toLowerCase();
  if (action !== 'website') {
    const raw = (event.event_source_url || '').trim();
    return isValidHttpUrl(raw) ? raw : '';
  }

  const cd = (event.custom_data ?? {}) as Record<string, unknown>;
  const tl = (event.telemetry ?? {}) as Record<string, unknown>;
  const pagePath =
    pickStringField(cd, 'page_path') ||
    pickStringField(tl, 'page_path') ||
    '/';

  // page_location costuma ser location.href (com hash); event_url às vezes era só origin+path — priorizar o mais completo.
  const candidates: (string | undefined)[] = [
    typeof event.event_source_url === 'string' ? event.event_source_url : undefined,
    pickStringField(cd, 'page_location'),
    pickStringField(cd, 'event_url'),
    pickStringField(cd, 'page_url'),
    typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
  ];
  for (const c of candidates) {
    if (isValidHttpUrl(c)) return c.trim();
  }

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (isValidHttpUrl(originHeader)) {
    const composed = joinOriginAndPath(originHeader, pagePath);
    if (isValidHttpUrl(composed)) return composed;
  }

  const refOrigin = headerOriginFromReferer(req.headers.referer);
  if (refOrigin) {
    const composed = joinOriginAndPath(refOrigin, pagePath);
    if (isValidHttpUrl(composed)) return composed;
  }

  const fromDb = await lookupSiteCanonicalOrigin(siteKey);
  if (fromDb) {
    const composed = joinOriginAndPath(fromDb, pagePath);
    if (isValidHttpUrl(composed)) return composed;
    if (isValidHttpUrl(fromDb)) return fromDb;
  }

  const envFallback = process.env.CAPI_FALLBACK_EVENT_SOURCE_URL?.trim();
  if (isValidHttpUrl(envFallback)) return envFallback!;

  console.warn(
    '[Ingest] event_source_url ausente para evento website (CAPI). Defina domain/tracking_domain no site ou CAPI_FALLBACK_EVENT_SOURCE_URL.',
    { siteKey, event_name: event.event_name }
  );
  return '';
}

const FALLBACK_CAPI_UA =
  (typeof process !== 'undefined' && process.env.CAPI_FALLBACK_USER_AGENT?.trim()) ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Meta CAPI: client_user_agent obrigatório para website — prioriza navigator (corpo) sobre o header da requisição ao ingest. */
function resolveClientUserAgentForCapi(
  req: Request,
  userData: NonNullable<IngestEvent['user_data']>
): string {
  const fromBody =
    typeof userData.client_user_agent === 'string' ? userData.client_user_agent.trim() : '';
  if (fromBody) return fromBody;
  const fromHeader = (req.get('user-agent') || '').trim();
  if (fromHeader) return fromHeader;
  return FALLBACK_CAPI_UA;
}

async function buildCapiUserData(
  req: Request,
  userData: NonNullable<IngestEvent['user_data']>,
  siteKey: string,
  customData: Record<string, unknown>
) {
  const clientIp = resolveClientIp(req, userData);
  const clientUserAgent = resolveClientUserAgentForCapi(req, userData);
  const geoHint = await resolveServerGeoHint(req, clientIp);
  const pickCustom = (field: string) => {
    const val = customData[field];
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') return item;
      }
    }
    return undefined;
  };

  const pickRaw = (field: string) => {
    const fromUser = (userData as Record<string, unknown>)[field];
    if (typeof fromUser === 'string' || Array.isArray(fromUser)) return fromUser as string | string[];
    const fromCustom = pickCustom(field);
    return fromCustom ? fromCustom : undefined;
  };

  // Monta campos com prioridade: payload hasheado > payload raw > geo
  const pick = (field: string) =>
    normalizeAndHash(field, pickRaw(field), { ip: clientIp, country: pickCustom('country') });

  const ct =
    pick('ct') ??
    (geoHint.city ? hashPii(normalizers.ct(geoHint.city)) : undefined);
  const st =
    pick('st') ??
    (geoHint.region ? hashPii(normalizers.st(geoHint.region)) : undefined);
  const country =
    pick('country') ??
    (geoHint.country ? hashPii(normalizers.country(geoHint.country)) : undefined);
  const fbp = preserveMetaClickIds(userData.fbp || pickCustom('fbp'));
  const fbc = preserveMetaClickIds(userData.fbc || pickCustom('fbc'));
  const externalIdRaw = userData.external_id || pickCustom('external_id');
  const zp = pick('zp');
  const db = pick('db');

  if (process.env.DEBUG_ATTRIBUTION === '1' && (fbc || fbp)) {
    console.log(`[Ingest] Attribution debug — fbc: ${!!fbc}, fbp: ${!!fbp}`);
  }

  // Helper to wrap in array (Meta CAPI requires arrays for PII fields, except for external_id/fbc/fbp)
  const wrap = (val: string | undefined): string[] | undefined => (val ? [val] : undefined);
  const em1 = pick('em');
  const ph1 = pick('ph');
  const derivedExternalId = externalIdRaw ? String(externalIdRaw).trim() : (em1 || ph1);

  return {
    client_ip_address: clientIp,
    client_user_agent: clientUserAgent,
    em: wrap(em1),
    ph: wrap(ph1),
    fn: wrap(pick('fn')),
    ln: wrap(pick('ln')),
    ct: wrap(ct),
    st: wrap(st),
    country: wrap(country),
    zp: wrap(zp),
    db: wrap(db),
    fbp,
    fbc,
    // Se o frontend não mandar external_id, derivamos a partir de em/ph (já hasheados).
    // Isso aumenta a correspondência no CAPI sem exigir login.
    external_id: derivedExternalId || undefined,
  };
}

// ─── Retry com exponential backoff ───────────────────────────────────────────

async function sendCapiWithRetry(
  siteKey: string,
  payload: CapiEvent,
  maxAttempts = 3
): Promise<void> {
  let lastErrorStr = 'Unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await capiService.sendEvent(siteKey, payload);

      // Since we changed sendEvent to return the error object instead of throwing:
      if (res && typeof res === 'object' && ('ok' in res) && !res.ok) {
        lastErrorStr = res.error || 'API Error';
        throw new Error(lastErrorStr);
      }

      // Success
      return;
    } catch (err: any) {
      if (attempt === maxAttempts) {
        console.error(`[CAPI] Final failure after ${maxAttempts} attempts for site = ${siteKey}: `, err.message || err);
        // Save exactly ONCE to outbox
        await capiService.saveToOutbox(siteKey, payload, err.message || String(err));
        return;
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 10_000); // 2s, 4s, 8s (max 10s)
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.options('/events', cors()); // Added OPTIONS route for CORS preflight
router.post('/events', cors(), ingestLimiter, async (req, res) => { // Applied cors() and ingestLimiter middleware
  const siteKey = (req.query['key'] as string | undefined) || req.headers['x-site-key'] as string | undefined;

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing site key' });
  }

  // Handle text/plain body from sendBeacon fallback (JSON sent as text/plain to avoid CORS preflight)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON in text/plain body' }); }
  }

  // Validação e sanitização com Zod
  const parsed = IngestEventSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid event payload', details: parsed.error.flatten() });
  }

  const event = parsed.data;

  // Recusa bots
  if (event.telemetry?.is_bot === true) {
    console.log('[Ingest] Ignored bot event:', event.event_name, event.user_data?.client_user_agent);
    return res.status(202).json({ status: 'ignored' });
  }

  // Calcula engagement ANTES de persistir
  const engagement = computeEngagement(event);
  if (engagement) {
    event.telemetry = {
      ...event.telemetry,
      engagement_score: engagement.score,
      engagement_bucket: engagement.bucket,
    };
  }

  // Calculate base time, defaulting to now
  let eventTimeSec = event.event_time ?? Math.floor(Date.now() / 1000);
  const maxFutureSec = Math.floor(Date.now() / 1000) + 300;
  if (eventTimeSec > maxFutureSec) {
    eventTimeSec = Math.floor(Date.now() / 1000);
  }

  const eventTimeMs = eventTimeSec * 1000;
  const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;
  const eventName = event.event_name;

  // ─── 1. Deduplicação (In-Memory) ──────────────────────────────────
  if (isDuplicate(siteKey, eventId)) {
    return res.status(202).json({ status: 'ignored_duplicate' });
  }

  // ─── 1b. Quota check (plan-based monthly event limit) ────────────
  const quota = await checkEventQuota(siteKey, eventName);
  if (!quota.allowed) {
    try {
      console.log('[Ingest] quota limit hit', {
        site_key: siteKey,
        used: quota.used,
        limit: quota.limit,
        req_ip: req.ip,
        cf_ip: req.headers['cf-connecting-ip'],
        xff: req.headers['x-forwarded-for'],
      });
    } catch {}
    // Important UX/SaaS behavior: don't break the client pixel/web events.
    // We intentionally return 202 so the browser doesn't treat it as a hard failure and start retry loops.
    return res.status(202).json({
      status: 'ignored_over_quota',
      error: 'event_limit_reached',
      message:
        `Cota mensal de eventos atingida para este site (${quota.used}/${quota.limit}). ` +
        `O Pixel WEB continua funcionando normalmente. ` +
        `O envio SERVER (CAPI/GA4) volta automaticamente no próximo ciclo ou após aumentar seu plano.`,
    });
  }

  // DB dedup is handled by ON CONFLICT — no need for a separate SELECT query
  try {
    const eventSourceUrl = await resolveEventSourceUrlForIngest(event, req, siteKey);

    // fbc/fbp com Parameter Builder oficial Meta (appendix + formato) — ver meta-param-builder-ingest.ts
    event.user_data = mergeUserDataWithMetaParamBuilder(
      req,
      eventSourceUrl,
      event.user_data ?? undefined
    ) as IngestEvent['user_data'];

    // Build enriched user data BEFORE persisting to DB
    // This ensures the server-side IP is saved in web_events for later recovery by Enrichment
    const rawUserData = event.user_data ?? {};
    const capiUser = await buildCapiUserData(req, rawUserData, siteKey, event.custom_data ?? {});
    const enrichedUserData = { ...rawUserData, ...capiUser };

    let result;
    if (eventName === 'PageEngagement') {
      result = await pool.query(`
        INSERT INTO web_events (
          site_key, event_id, event_name, event_time, event_source_url,
          user_data, custom_data, telemetry
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (site_key, event_id)
        DO UPDATE SET
          telemetry = web_events.telemetry || EXCLUDED.telemetry,
          event_time = EXCLUDED.event_time
        RETURNING id
      `, [
        siteKey, eventId, eventName, new Date(eventTimeMs), eventSourceUrl,
        enrichedUserData, event.custom_data ?? null, event.telemetry ?? null,
      ]);
    } else {
      result = await pool.query(`
        INSERT INTO web_events (
          site_key, event_id, event_name, event_time, event_source_url,
          user_data, custom_data, telemetry
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(site_key, event_id) DO NOTHING
        RETURNING id
      `, [
        siteKey, eventId, eventName, new Date(eventTimeMs), eventSourceUrl,
        enrichedUserData, event.custom_data ?? null, event.telemetry ?? null,
      ]);
    }

    if ((result?.rowCount ?? 0) === 0) {
      return res.status(202).json({ status: 'ignored_duplicate' });
    }

    // Auditoria: mantém só os 20 Leads mais recentes por site.
    if (eventName === 'Lead') {
      pruneOldLeadEvents(siteKey).catch(() => {});
    }

    // ── Visitor profile + integrations_meta update (parallel, non-blocking for response) ──
    {
      // capiUser already built above (before INSERT)

      const fbc = capiUser.fbc;
      const fbp = capiUser.fbp;
      const em = capiUser.em;
      const ph = capiUser.ph;
      const fn = capiUser.fn;
      const ln = capiUser.ln;
      const extId = deriveVisitorExternalIdForStorage({
        external_id: capiUser.external_id,
        fbp,
        fbc,
        em,
        ph,
        client_ip_address: capiUser.client_ip_address,
        client_user_agent: capiUser.client_user_agent,
        eventId,
      });

      const trafficSourceValue = buildVisitorTrafficSourceString(
        event.custom_data as Record<string, unknown> | undefined,
        eventSourceUrl
      );

      // Run visitor UPSERT and integrations_meta update in parallel
      await Promise.all([
        pool.query(`
          INSERT INTO site_visitors (
            site_key, external_id, fbc, fbp, email_hash, phone_hash, first_name_hash, last_name_hash,
            last_traffic_source, first_traffic_source, total_events, last_event_name, last_ip, last_user_agent
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 1, $10, $11, $12
          )
          ON CONFLICT (site_key, external_id) DO UPDATE SET
            fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
            fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
            email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
            phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
            first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
            last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
            first_traffic_source = COALESCE(site_visitors.first_traffic_source, EXCLUDED.first_traffic_source),
            last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
            last_event_name = EXCLUDED.last_event_name,
            last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
            last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
            total_events = site_visitors.total_events + 1,
            last_seen_at = NOW()
          WHERE
            site_visitors.last_seen_at < NOW() - INTERVAL '20 seconds'
            OR (site_visitors.fbc IS NULL AND EXCLUDED.fbc IS NOT NULL)
            OR (site_visitors.fbp IS NULL AND EXCLUDED.fbp IS NOT NULL)
            OR (site_visitors.email_hash IS NULL AND EXCLUDED.email_hash IS NOT NULL)
            OR (site_visitors.phone_hash IS NULL AND EXCLUDED.phone_hash IS NOT NULL)
            OR (site_visitors.first_name_hash IS NULL AND EXCLUDED.first_name_hash IS NOT NULL)
            OR (site_visitors.last_name_hash IS NULL AND EXCLUDED.last_name_hash IS NOT NULL)
            OR (site_visitors.last_ip IS NULL AND EXCLUDED.last_ip IS NOT NULL)
            OR (site_visitors.last_user_agent IS NULL AND EXCLUDED.last_user_agent IS NOT NULL)
            OR site_visitors.last_event_name IS DISTINCT FROM EXCLUDED.last_event_name
        `, [
          siteKey,
          extId,
          fbc,
          fbp,
          visitorPiiHashScalar(em),
          visitorPiiHashScalar(ph),
          visitorPiiHashScalar(fn),
          visitorPiiHashScalar(ln),
          trafficSourceValue,
          eventName,
          capiUser.client_ip_address,
          capiUser.client_user_agent,
        ]).catch(err => console.error('[Ingest] User Profile UPSERT error:', err)),

        pool.query(
          `UPDATE integrations_meta i
           SET last_ingest_at = NOW(), last_ingest_event_name = $1, last_ingest_event_id = $2, last_ingest_event_source_url = $3
           FROM sites s WHERE s.site_key = $4 AND i.site_id = s.id`,
          [eventName, eventId, eventSourceUrl, siteKey]
        ).catch(() => {}),
      ]);

      // ── 2. Envio CAPI (assíncrono com retry) ─────────────────────────────
      // Mapeamento vs Meta: event_source_url + client_user_agent + action_source (website);
      // user_data (fbc, fbp, IP, hashes); custom_data (value/currency, UTMs, etc.);
      // referrer_url no nível do evento quando houver URL absoluta.
      // @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
      const cd = event.custom_data ?? {};
      const tl = event.telemetry ?? {} as Record<string, unknown>;
      const { metaCustomData, refUrl } = buildMetaCustomDataForCapi(eventName, cd, tl);

      const actionSrc = actionSourceForCapi(event.action_source);

      const capiPayload: CapiEvent = {
        event_name: eventName,
        event_time: eventTimeSec,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        ...(actionSrc ? { action_source: actionSrc } : {}),
        ...(refUrl ? { referrer_url: refUrl } : {}),
        user_data: capiUser,
        ...(Object.keys(metaCustomData).length > 0
          ? { custom_data: metaCustomData }
          : {}),
      };




      // Fire-and-forget com retry — não bloqueia a resposta HTTP
      sendCapiWithRetry(siteKey, capiPayload).catch(() => { });

      // ── 3. Envio GA4 (Server-side) ───────────────────────────────────────
      // Também assíncrono para não impactar latência
      ga4Service.sendEvent(
        siteKey,
        eventName,
        { ...event.custom_data, ...event.telemetry },
        {
          client_id: event.user_data?.external_id || undefined, // Idealmente cookie _ga, usando fallback
          user_id: undefined, // Se tiver login, mapear aqui
          ip_address: capiUser.client_ip_address,
          user_agent: capiUser.client_user_agent,
          fbp: capiUser.fbp,
          fbc: capiUser.fbc,
          external_id: Array.isArray(capiUser.external_id) ? capiUser.external_id[0] : capiUser.external_id
        }
      ).catch(err => console.error('[Ingest] GA4 error:', err));
    }

    return res.status(202).json({ status: 'received' });
  } catch (err: any) {
    console.error('[Ingest] Erro ao persistir evento:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message || err.toString() });
  }
});

router.options('/batch', cors());
router.post('/batch', cors(), ingestLimiter, async (req, res) => {
  const siteKey = (req.query['key'] as string | undefined) || req.headers['x-site-key'] as string | undefined;

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing site key' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON in text/plain body' }); }
  }

  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Expected an array of events' });
  }

  // ── Quota check (plan-based monthly event limit) ──
  const batchQuota = await checkEventQuota(siteKey);
  if (!batchQuota.allowed) {
    return res.status(429).json({
      error: 'event_limit_reached',
      message: `Monthly event limit reached (${batchQuota.used}/${batchQuota.limit}). Upgrade your plan.`,
    });
  }

  // ── Phase 1: Validate, dedup in-memory, and prepare all events ──
  type PreparedEvent = {
    event: IngestEvent;
    eventId: string;
    eventTimeSec: number;
    eventTimeMs: number;
    eventName: string;
    eventSourceUrl: string;
  };

  const prepared: PreparedEvent[] = [];
  const results: Record<string, unknown>[] = [];
  const indexMap: number[] = []; // maps prepared index → original body index

  for (let i = 0; i < body.length; i++) {
    const parsed = IngestEventSchema.safeParse(body[i]);
    if (!parsed.success) {
      results[i] = { status: 'error', details: parsed.error.flatten() };
      continue;
    }
    const event = parsed.data;

    if (event.telemetry?.is_bot === true) {
      results[i] = { status: 'ignored', reason: 'bot' };
      continue;
    }

    const engagement = computeEngagement(event);
    if (engagement) {
      event.telemetry = { ...event.telemetry, engagement_score: engagement.score, engagement_bucket: engagement.bucket };
    }

    // Base time, defaulting to now
    let eventTimeSec = event.event_time ?? Math.floor(Date.now() / 1000);

    // Only clamp timestamps that are unreasonably in the future (>5 min clock drift)
    const maxFutureSec = Math.floor(Date.now() / 1000) + 300;
    if (eventTimeSec > maxFutureSec) {
      eventTimeSec = Math.floor(Date.now() / 1000);
    }

    const eventTimeMs = eventTimeSec * 1000;
    const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;

    if (isDuplicate(siteKey, eventId)) {
      results[i] = { status: 'duplicate', event_id: eventId };
      continue;
    }

    const eventSourceUrl = await resolveEventSourceUrlForIngest(event, req, siteKey);
    const eventMerged = {
      ...event,
      user_data: mergeUserDataWithMetaParamBuilder(
        req,
        eventSourceUrl,
        event.user_data ?? undefined
      ) as IngestEvent['user_data'],
    };
    prepared.push({
      event: eventMerged,
      eventId,
      eventTimeSec,
      eventTimeMs,
      eventName: event.event_name,
      eventSourceUrl,
    });
    indexMap.push(i);
  }

  if (prepared.length === 0) {
    // Fill any remaining gaps
    for (let i = 0; i < body.length; i++) { if (!results[i]) results[i] = { status: 'skipped' }; }
    return res.status(202).json({ results });
  }

  try {
    // ── Phase 2: Bulk INSERT via unnest ──
    const siteKeys: string[] = [];
    const eventIds: string[] = [];
    const eventNames: string[] = [];
    const eventTimes: Date[] = [];
    const eventSourceUrls: string[] = [];
    const userDatas: (object | null)[] = [];
    const customDatas: (object | null)[] = [];
    const telemetries: (object | null)[] = [];

    for (const p of prepared) {
      siteKeys.push(siteKey);
      eventIds.push(p.eventId);
      eventNames.push(p.eventName);
      eventTimes.push(new Date(p.eventTimeMs));
      eventSourceUrls.push(p.eventSourceUrl);
      userDatas.push(p.event.user_data ?? null);
      customDatas.push(p.event.custom_data ?? null);
      telemetries.push(p.event.telemetry ?? null);
    }

    const bulkResult = await pool.query(`
      INSERT INTO web_events (site_key, event_id, event_name, event_time, event_source_url, user_data, custom_data, telemetry)
      SELECT * FROM unnest(
        $1::varchar[], $2::varchar[], $3::varchar[], $4::timestamp[],
        $5::text[], $6::jsonb[], $7::jsonb[], $8::jsonb[]
      ) AS t(site_key, event_id, event_name, event_time, event_source_url, user_data, custom_data, telemetry)
      ON CONFLICT(site_key, event_id) DO NOTHING
      RETURNING event_id
    `, [siteKeys, eventIds, eventNames, eventTimes, eventSourceUrls,
      userDatas.map(d => d ? JSON.stringify(d) : null),
      customDatas.map(d => d ? JSON.stringify(d) : null),
      telemetries.map(d => d ? JSON.stringify(d) : null),
    ]);

    const insertedIds = new Set((bulkResult.rows as { event_id: string }[]).map(r => r.event_id));

    // Mark results
    for (let j = 0; j < prepared.length; j++) {
      const origIdx = indexMap[j];
      if (insertedIds.has(prepared[j].eventId)) {
        results[origIdx] = { status: 'processed', event_id: prepared[j].eventId };
      } else {
        results[origIdx] = { status: 'duplicate', event_id: prepared[j].eventId };
      }
    }

    // ── Phase 3: Fire-and-forget side effects for inserted events ──
    const inserted = prepared.filter(p => insertedIds.has(p.eventId));

    if (inserted.length > 0) {
      // Auditoria: mantém só os 20 Leads mais recentes por site (executa 1x por batch quando houver Lead inserido).
      if (inserted.some((p) => p.eventName === 'Lead')) {
        pruneOldLeadEvents(siteKey).catch(() => {});
      }

      // Update integrations_meta once
      pool.query(
        `UPDATE integrations_meta i SET last_ingest_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
        [siteKey]
      ).catch(() => {});

      // Visitor UPSERTs + CAPI + GA4 — all fire-and-forget per event
      for (const p of inserted) {
        const capiUser = await buildCapiUserData(req, p.event.user_data || {}, siteKey, p.event.custom_data ?? {});
        const extId = deriveVisitorExternalIdForStorage({
          external_id: capiUser.external_id,
          fbp: capiUser.fbp,
          fbc: capiUser.fbc,
          em: capiUser.em,
          ph: capiUser.ph,
          client_ip_address: capiUser.client_ip_address,
          client_user_agent: capiUser.client_user_agent,
          eventId: p.eventId,
        });
        const trafficSourceValue = buildVisitorTrafficSourceString(
          p.event.custom_data as Record<string, unknown> | undefined,
          p.eventSourceUrl
        );

        pool.query(`
          INSERT INTO site_visitors (
            site_key, external_id, fbc, fbp, email_hash, phone_hash, first_name_hash, last_name_hash,
            last_traffic_source, first_traffic_source, total_events, last_event_name, last_ip, last_user_agent
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,1,$10,$11,$12)
          ON CONFLICT (site_key, external_id) DO UPDATE SET
            fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
            fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
            email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
            phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
            first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
            last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
            first_traffic_source = COALESCE(site_visitors.first_traffic_source, EXCLUDED.first_traffic_source),
            last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
            last_event_name = EXCLUDED.last_event_name,
            last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
            last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
            total_events = site_visitors.total_events + 1,
            last_seen_at = NOW()
          WHERE
            site_visitors.last_seen_at < NOW() - INTERVAL '20 seconds'
            OR (site_visitors.fbc IS NULL AND EXCLUDED.fbc IS NOT NULL)
            OR (site_visitors.fbp IS NULL AND EXCLUDED.fbp IS NOT NULL)
            OR (site_visitors.email_hash IS NULL AND EXCLUDED.email_hash IS NOT NULL)
            OR (site_visitors.phone_hash IS NULL AND EXCLUDED.phone_hash IS NOT NULL)
            OR (site_visitors.first_name_hash IS NULL AND EXCLUDED.first_name_hash IS NOT NULL)
            OR (site_visitors.last_name_hash IS NULL AND EXCLUDED.last_name_hash IS NOT NULL)
            OR (site_visitors.last_ip IS NULL AND EXCLUDED.last_ip IS NOT NULL)
            OR (site_visitors.last_user_agent IS NULL AND EXCLUDED.last_user_agent IS NOT NULL)
            OR site_visitors.last_event_name IS DISTINCT FROM EXCLUDED.last_event_name
        `, [
          siteKey,
          extId,
          capiUser.fbc,
          capiUser.fbp,
          visitorPiiHashScalar(capiUser.em),
          visitorPiiHashScalar(capiUser.ph),
          visitorPiiHashScalar(capiUser.fn),
          visitorPiiHashScalar(capiUser.ln),
          trafficSourceValue,
          p.eventName,
          capiUser.client_ip_address,
          capiUser.client_user_agent,
        ]).catch(err => console.error('[Ingest/Batch] User Profile UPSERT error:', err));

        // CAPI payload (espelha POST /events: custom_data + referrer_url + action_source)
        const cd = p.event.custom_data ?? {};
        const tl = p.event.telemetry ?? {} as Record<string, unknown>;
        const { metaCustomData, refUrl } = buildMetaCustomDataForCapi(p.eventName, cd, tl);

        const actionSrc = actionSourceForCapi(p.event.action_source);

        sendCapiWithRetry(siteKey, {
          event_name: p.eventName, event_time: p.eventTimeSec, event_id: p.eventId,
          event_source_url: p.eventSourceUrl,
          ...(actionSrc ? { action_source: actionSrc } : {}),
          ...(refUrl ? { referrer_url: refUrl } : {}),
          user_data: capiUser,
          ...(Object.keys(metaCustomData).length > 0 ? { custom_data: metaCustomData } : {}),
        }).catch(() => {});

        ga4Service.sendEvent(siteKey, p.eventName, { ...p.event.custom_data, ...p.event.telemetry }, {
          client_id: p.event.user_data?.external_id || undefined, user_id: undefined,
          ip_address: capiUser.client_ip_address, user_agent: capiUser.client_user_agent,
          fbp: capiUser.fbp, fbc: capiUser.fbc,
          external_id: Array.isArray(capiUser.external_id) ? capiUser.external_id[0] : capiUser.external_id,
        }).catch(err => console.error('[Ingest/Batch] GA4 error:', err));
      }
    }
  } catch (e) {
    console.error('Batch ingest error:', e);
    for (let i = 0; i < body.length; i++) { if (!results[i]) results[i] = { status: 'error', error: 'Internal server error' }; }
  }

  // Fill any missing slots
  for (let i = 0; i < body.length; i++) { if (!results[i]) results[i] = { status: 'skipped' }; }
  return res.status(202).json({ results });
});

export default router;
