import { Router, Request } from 'express';
import { createHash } from 'crypto';
import geoip from 'geoip-lite';
import { z } from 'zod';
import { pool } from '../db/pool';
import { capiService, CapiService, CapiEvent } from '../services/capi';
import { Ga4Service } from '../services/ga4';
import rateLimit from 'express-rate-limit'; // Added import for express-rate-limit
import cors from 'cors'; // Added import for cors

const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

const ga4Service = new Ga4Service(pool);

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // limit each IP to 300 requests per minute
  message: { error: 'Too many requests' },
});

const router = Router();

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

function normalizeAndHash(field: string, value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;

  // Se já for um hash (64 hex characters), retorna em caixa baixa, 
  // anulando o normalizer para não destruir o hash
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return raw.toLowerCase();
  }

  const norm = normalizers[field] ? normalizers[field](raw) : raw.trim();
  if (!norm) return undefined;
  return hashPii(norm);
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

function buildTrafficSourceValue(customData: Record<string, unknown> | undefined): string | undefined {
  if (!customData) return undefined;

  const trafficSource = pickStringField(customData, 'traffic_source');
  if (trafficSource && !trafficSource.toLowerCase().startsWith('trk_')) return trafficSource;

  const params = new URLSearchParams();
  const utmSource = pickStringField(customData, 'utm_source');
  const utmMedium = pickStringField(customData, 'utm_medium');
  const utmCampaign = pickStringField(customData, 'utm_campaign');
  const utmTerm = pickStringField(customData, 'utm_term');
  const utmContent = pickStringField(customData, 'utm_content');
  if (utmSource) params.set('utm_source', utmSource);
  if (utmMedium) params.set('utm_medium', utmMedium);
  if (utmCampaign) params.set('utm_campaign', utmCampaign);
  if (utmTerm) params.set('utm_term', utmTerm);
  if (utmContent) params.set('utm_content', utmContent);
  const utmString = params.toString();
  if (utmString) return utmString;

  const taTs = pickStringField(customData, 'ta_ts');
  if (taTs && !taTs.toLowerCase().startsWith('trk_')) return taTs;

  return undefined;
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

function getTimeDimensions(eventTimeSec: number) {
  const d = new Date(eventTimeSec * 1000);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const hour = d.getHours();

  return {
    event_day: days[d.getDay()],
    event_day_in_month: d.getDate(),
    event_month: months[d.getMonth()],
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
  return (req.headers['cf-connecting-ip'] as string)?.trim()
    || (req.headers['x-real-ip'] as string)?.trim()
    || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || userData.client_ip_address
    || '';
}

function resolveGeo(clientIp: string) {
  const cleanIp = clientIp.replace(/^::ffff:/, '');
  if (!cleanIp || cleanIp.length <= 6) return {};
  const geo = geoip.lookup(cleanIp);
  if (!geo) return {};
  return {
    city: geo.city || undefined,
    region: geo.region || undefined,
    country: geo.country || undefined,
  };
}

function buildCapiUserData(
  req: Request,
  userData: NonNullable<IngestEvent['user_data']>,
  siteKey: string,
  customData: Record<string, unknown>
) {
  const clientIp = resolveClientIp(req, userData);
  const clientUserAgent = req.headers['user-agent'] || userData.client_user_agent || '';
  const geo = resolveGeo(clientIp);
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
    normalizeAndHash(field, pickRaw(field));

  const ct = pick('ct') ?? (geo.city ? hashPii(normalizers.ct(geo.city)) : undefined);
  const st = pick('st') ?? (geo.region ? hashPii(normalizers.st(geo.region)) : undefined);
  const country = pick('country') ?? (geo.country ? hashPii(normalizers.country(geo.country)) : undefined);
  const fbp = userData.fbp || pickCustom('fbp');
  const fbc = userData.fbc || pickCustom('fbc');
  const externalIdRaw = userData.external_id || pickCustom('external_id');

  return {
    client_ip_address: clientIp,
    client_user_agent: clientUserAgent,
    em: pick('em'),
    ph: pick('ph'),
    fn: pick('fn'),
    ln: pick('ln'),
    ct,
    st,
    country,
    zp: pick('zp'),
    db: pick('db'),
    fbp,
    fbc,
    external_id: externalIdRaw ? [hashPii(String(externalIdRaw))!] : undefined,
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
  
  // Défense in Depth: CAPI strict future time validation
  // Meta will reject if event_time is > 60s in the future. If the client clock is ahead, it will fail.
  // We clamp down to the server's current time minus a tiny safety buffer (1 minute).
  // If the server clock itself is behind (as discovered), this safely anchors reality to the server time,
  // which will appear as "in the past" to Meta (which they allow up to 7 days).
  const currentServerSec = Math.floor(Date.now() / 1000) - 60; 
  if (eventTimeSec > currentServerSec) {
    eventTimeSec = currentServerSec;
  }

  const eventTimeMs = eventTimeSec * 1000;
  const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;
  const eventName = event.event_name;
  const eventSourceUrl = event.event_source_url || '';

  // ─── 1. Deduplicação (In-Memory) ──────────────────────────────────
  if (isDuplicate(siteKey, eventId)) {
    return res.status(202).json({ status: 'ignored_duplicate' });
  }

  // DB dedup is handled by ON CONFLICT — no need for a separate SELECT query
  try {
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
        event.user_data ?? null, event.custom_data ?? null, event.telemetry ?? null,
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
        event.user_data ?? null, event.custom_data ?? null, event.telemetry ?? null,
      ]);
    }

    if ((result?.rowCount ?? 0) === 0) {
      return res.status(202).json({ status: 'ignored_duplicate' });
    }

    // ── Visitor profile + integrations_meta update (parallel, non-blocking for response) ──
    {
      const userData = event.user_data ?? {};
      const capiUser = buildCapiUserData(req, userData, siteKey, event.custom_data ?? {});

      const fbc = capiUser.fbc;
      const fbp = capiUser.fbp;
      const em = capiUser.em;
      const ph = capiUser.ph;
      const fn = capiUser.fn;
      const ln = capiUser.ln;
      let extId = Array.isArray(capiUser.external_id) && capiUser.external_id.length > 0
        ? capiUser.external_id[0]
        : `anon_${eventId}`;

      const trafficSourceValue = buildTrafficSourceValue(event.custom_data);

      // Run visitor UPSERT and integrations_meta update in parallel
      await Promise.all([
        pool.query(`
          INSERT INTO site_visitors (
            site_key, external_id, fbc, fbp, email_hash, phone_hash, first_name_hash, last_name_hash, last_traffic_source, total_events, last_event_name, last_ip, last_user_agent
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12
          )
          ON CONFLICT (site_key, external_id) DO UPDATE SET
            fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
            fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
            email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
            phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
            first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
            last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
            last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
            last_event_name = EXCLUDED.last_event_name,
            last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
            last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
            total_events = site_visitors.total_events + 1,
            last_seen_at = NOW()
        `, [
          siteKey, extId, fbc, fbp, em, ph, fn, ln, trafficSourceValue, eventName, capiUser.client_ip_address, capiUser.client_user_agent
        ]).catch(err => console.error('[Ingest] User Profile UPSERT error:', err)),

        pool.query(
          `UPDATE integrations_meta i
           SET last_ingest_at = NOW(), last_ingest_event_name = $1, last_ingest_event_id = $2, last_ingest_event_source_url = $3
           FROM sites s WHERE s.site_key = $4 AND i.site_id = s.id`,
          [eventName, eventId, eventSourceUrl, siteKey]
        ).catch(() => {}),
      ]);

      // ── 2. Envio CAPI (assíncrono com retry) ─────────────────────────────
      // custom_data: campos padrão do Meta + dados de atribuição enriquecidos
      // Ref: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/custom-data
      const cd = event.custom_data ?? {};
      const tl = event.telemetry ?? {} as Record<string, unknown>;
      const metaCustomData: Record<string, unknown> = {};

      // Campos padrão do Meta custom_data
      const metaCustomFields = [
        'value', 'currency', 'content_name', 'content_category',
        'content_ids', 'content_type', 'contents', 'num_items',
        'order_id', 'predicted_ltv', 'search_string', 'status',
        'delivery_category',
      ];

      for (const f of metaCustomFields) {
        // Correção: apenas inclui se não for undefined/null E (se for value/currency) não for string vazia
        // Facebook rejeita value="" ou currency=""
        if (cd[f] !== undefined && cd[f] !== null && cd[f] !== '') {
          // Parse float para value se vier como string
          if (f === 'value') {
            const val = parseFloat(cd[f] as string);
            if (!isNaN(val)) metaCustomData[f] = val;
          } else {
            metaCustomData[f] = cd[f];
          }
        }
      }

      // Validação de Currency (se tem value, precisa de currency válida)
      if (metaCustomData['value'] !== undefined) {
        if (!metaCustomData['currency']) {
          metaCustomData['currency'] = 'BRL'; // Default BRL se não informado
        }
      } else {
        // Se não tem value, remove currency para evitar warning de "missing value parameter"
        delete metaCustomData['currency'];
      }
      // Fallbacks para campos comuns
      if (!metaCustomData['content_name']) {
        if (cd['content_name'] && cd['content_name'] !== '') {
          metaCustomData['content_name'] = cd['content_name'];
        } else if (cd['page_title'] && cd['page_title'] !== '') {
          metaCustomData['content_name'] = cd['page_title'];
        } else if (tl['page_title'] && tl['page_title'] !== '') {
          metaCustomData['content_name'] = tl['page_title'];
        }
      }
      // content_type só faz sentido em eventos de comércio (Purchase, AddToCart, etc.)
      // Para PageView/PageEngagement, o Meta ignora e pode poluir o payload
      if (!metaCustomData['content_type'] && metaCustomData['value'] !== undefined) {
        metaCustomData['content_type'] = 'product';
      }

      // ── Dados de atribuição para o Meta CAPI ──────────────────────────────
      // APENAS campos que o Meta utiliza para atribuição e análise.
      // Dados de engajamento (dwell_time, scroll, clicks) e dispositivo (screen, platform, 
      // timezone, language, connection_type) ficam apenas no DB para o agente IA.
      // O Meta ignora esses campos e eles só poluem o payload.
      const attributionFields: [string, unknown][] = [
        // UTM parameters — essenciais para atribuição
        ['utm_source', cd['utm_source'] || tl['utm_source']],
        ['utm_medium', cd['utm_medium'] || tl['utm_medium']],
        ['utm_campaign', cd['utm_campaign'] || tl['utm_campaign']],
        ['utm_term', cd['utm_term'] || tl['utm_term']],
        ['utm_content', cd['utm_content'] || tl['utm_content']],
        // Dados de página — úteis para content_name fallback
        ['page_path', cd['page_path'] || tl['page_path']],
        ['page_title', cd['page_title'] || tl['page_title']],
        ['referrer', cd['referrer'] || tl['referrer']],
        // Fonte de tráfego
        ['traffic_source', cd['traffic_source']],
      ];
      for (const [key, val] of attributionFields) {
        if (val !== undefined && val !== null && val !== '') {
          metaCustomData[key] = val;
        }
      }

      const capiPayload: CapiEvent = {
        event_name: eventName,
        event_time: eventTimeSec,
        event_id: eventId,
        event_source_url: eventSourceUrl,
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

    // CAPI future time validation (defense against client clock drift or server drift)
    const currentServerSec = Math.floor(Date.now() / 1000) - 60;
    if (eventTimeSec > currentServerSec) {
      eventTimeSec = currentServerSec;
    }

    const eventTimeMs = eventTimeSec * 1000;
    const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;

    if (isDuplicate(siteKey, eventId)) {
      results[i] = { status: 'duplicate', event_id: eventId };
      continue;
    }

    prepared.push({
      event,
      eventId,
      eventTimeSec,
      eventTimeMs,
      eventName: event.event_name,
      eventSourceUrl: event.event_source_url || '',
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
      // Update integrations_meta once
      pool.query(
        `UPDATE integrations_meta i SET last_ingest_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
        [siteKey]
      ).catch(() => {});

      // Visitor UPSERTs + CAPI + GA4 — all fire-and-forget per event
      for (const p of inserted) {
        const capiUser = buildCapiUserData(req, p.event.user_data || {}, siteKey, p.event.custom_data ?? {});
        const extId = Array.isArray(capiUser.external_id) && capiUser.external_id.length > 0
          ? capiUser.external_id[0] : `anon_${p.eventId}`;
        const trafficSourceValue = buildTrafficSourceValue(p.event.custom_data);

        pool.query(`
          INSERT INTO site_visitors (
            site_key, external_id, fbc, fbp, email_hash, phone_hash, first_name_hash, last_name_hash, last_traffic_source, total_events, last_event_name, last_ip, last_user_agent
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12)
          ON CONFLICT (site_key, external_id) DO UPDATE SET
            fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
            fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
            email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
            phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
            first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
            last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
            last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
            last_event_name = EXCLUDED.last_event_name,
            last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
            last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
            total_events = site_visitors.total_events + 1,
            last_seen_at = NOW()
        `, [
          siteKey, extId, capiUser.fbc, capiUser.fbp, capiUser.em, capiUser.ph,
          capiUser.fn, capiUser.ln, trafficSourceValue, p.eventName,
          capiUser.client_ip_address, capiUser.client_user_agent,
        ]).catch(err => console.error('[Ingest/Batch] User Profile UPSERT error:', err));

        // CAPI payload
        const cd = p.event.custom_data ?? {};
        const tl = p.event.telemetry ?? {} as Record<string, unknown>;
        const metaCustomData: Record<string, unknown> = {};
        const metaCustomFields = [
          'value', 'currency', 'content_name', 'content_category',
          'content_ids', 'content_type', 'contents', 'num_items',
          'order_id', 'predicted_ltv', 'search_string', 'status', 'delivery_category',
        ];
        for (const f of metaCustomFields) {
          if (cd[f] !== undefined && cd[f] !== null && cd[f] !== '') {
            if (f === 'value') { const val = parseFloat(cd[f] as string); if (!isNaN(val)) metaCustomData[f] = val; }
            else metaCustomData[f] = cd[f];
          }
        }
        if (metaCustomData['value'] !== undefined) { if (!metaCustomData['currency']) metaCustomData['currency'] = 'BRL'; }
        else delete metaCustomData['currency'];
        if (!metaCustomData['content_name']) {
          if (cd['page_title'] && cd['page_title'] !== '') metaCustomData['content_name'] = cd['page_title'];
          else if (tl['page_title'] && tl['page_title'] !== '') metaCustomData['content_name'] = tl['page_title'];
        }
        const attributionFields: [string, unknown][] = [
          ['utm_source', cd['utm_source'] || tl['utm_source']], ['utm_medium', cd['utm_medium'] || tl['utm_medium']],
          ['utm_campaign', cd['utm_campaign'] || tl['utm_campaign']], ['utm_term', cd['utm_term'] || tl['utm_term']],
          ['utm_content', cd['utm_content'] || tl['utm_content']], ['page_path', cd['page_path'] || tl['page_path']],
          ['page_title', cd['page_title'] || tl['page_title']], ['referrer', cd['referrer'] || tl['referrer']],
          ['traffic_source', cd['traffic_source']],
        ];
        for (const [key, val] of attributionFields) {
          if (val !== undefined && val !== null && val !== '') metaCustomData[key] = val;
        }

        sendCapiWithRetry(siteKey, {
          event_name: p.eventName, event_time: p.eventTimeSec, event_id: p.eventId,
          event_source_url: p.eventSourceUrl, user_data: capiUser,
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
