import { Router, Request } from 'express';
import { createHash } from 'crypto';
import geoip from 'geoip-lite';
import { z } from 'zod';
import { pool } from '../db/pool';
import { capiService, CapiService, CapiEvent } from '../services/capi';
import rateLimit from 'express-rate-limit'; // Added import for express-rate-limit
import cors from 'cors'; // Added import for cors

const LRUCache = require('lru-cache').LRUCache || require('lru-cache');

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
    event_time_interval: `${hour} -${hour + 1} `,
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
    external_id: externalIdRaw ? hashPii(externalIdRaw) : undefined,
  };
}

// ─── Retry com exponential backoff ───────────────────────────────────────────

async function sendCapiWithRetry(
  siteKey: string,
  payload: CapiEvent,
  maxAttempts = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await capiService.sendEvent(siteKey, payload);
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(`[CAPI] Falha após ${maxAttempts} tentativas para site = ${siteKey}: `, err);
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

  // Gera IDs estáveis
  const eventTimeSec = event.event_time ?? Math.floor(Date.now() / 1000);
  const eventTimeMs = eventTimeSec * 1000;
  const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)} `;
  const eventName = event.event_name;
  const eventSourceUrl = event.event_source_url || '';
  const timeDimensions = getTimeDimensions(eventTimeSec);

  await pool.query(
    `UPDATE integrations_meta i
     SET last_ingest_at = NOW(),
  last_ingest_event_name = $1,
  last_ingest_event_id = $2,
  last_ingest_event_source_url = $3
     FROM sites s
     WHERE s.site_key = $4 AND i.site_id = s.id`,
    [eventName, eventId, eventSourceUrl, siteKey]
  );

  // ─── 1. Deduplicação (In-Memory) ──────────────────────────────────
  if (isDuplicate(siteKey, eventId)) {
    console.log(`[Ingest] Ignored duplicate event (memory): ${eventName} (${eventId})`);
    return res.status(202).json({ status: 'ignored_duplicate' });
  }

  // ─── 1.5. Deduplicação (Banco de Dados - Robusta) ──────────────────
  // Garante que se o servidor reiniciar, não perca o histórico recente
  const existing = await pool.query(
    'SELECT 1 FROM web_events WHERE site_key = $1 AND event_id = $2 LIMIT 1',
    [siteKey, eventId]
  );
  if ((existing.rowCount || 0) > 0) {
    console.log(`[Ingest] Ignored duplicate event (db): ${eventName} (${eventId})`);
    return res.status(202).json({ status: 'ignored_duplicate' });
  }

  try {
    const query = `
      INSERT INTO web_events (
        site_key, event_id, event_name, event_time, event_source_url,
        user_data, custom_data, telemetry, raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT(site_key, event_id) DO NOTHING
      RETURNING id
  `;

    const result = await pool.query(query, [
      siteKey,
      eventId,
      eventName,
      new Date(eventTimeMs),
      eventSourceUrl,
      event.user_data ?? null,
      event.custom_data ?? null,
      event.telemetry ?? null,
      event,
    ]);

    // ── 2. Envio CAPI (assíncrono com retry) ─────────────────────────────
    if ((result.rowCount ?? 0) > 0) {
      const userData = event.user_data ?? {};
      const capiUser = buildCapiUserData(req, userData, siteKey, event.custom_data ?? {});

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
        if (cd[f] !== undefined && cd[f] !== null && cd[f] !== '') {
          metaCustomData[f] = cd[f];
        }
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
      if (!metaCustomData['content_type']) {
        metaCustomData['content_type'] = 'product';
      }

      // ── Dados de atribuição (UTM, referrer, página) ──────────────────────
      // Essenciais para match com compras e análises do agente IA
      const attributionFields: [string, unknown][] = [
        // UTM parameters
        ['utm_source', cd['utm_source'] || tl['utm_source']],
        ['utm_medium', cd['utm_medium'] || tl['utm_medium']],
        ['utm_campaign', cd['utm_campaign'] || tl['utm_campaign']],
        ['utm_term', cd['utm_term'] || tl['utm_term']],
        ['utm_content', cd['utm_content'] || tl['utm_content']],
        // Dados de página
        ['page_path', cd['page_path'] || tl['page_path']],
        ['page_title', cd['page_title'] || tl['page_title']],
        ['referrer', cd['referrer'] || tl['referrer']],
        // Fonte de tráfego
        ['traffic_source', cd['traffic_source']],
        // Dados de engajamento
        ['dwell_time_ms', tl['dwell_time_ms']],
        ['max_scroll_pct', tl['max_scroll_pct']],
        ['visible_time_ms', tl['visible_time_ms']],
        ['clicks_total', tl['clicks_total']],
        ['clicks_cta', tl['clicks_cta']],
        // Dados de dispositivo (útil quando pixel é bloqueado no iOS)
        ['screen_width', tl['screen_width']],
        ['screen_height', tl['screen_height']],
        ['platform', tl['platform']],
        ['connection_type', tl['connection_type']],
        ['language', tl['language']],
        ['timezone', tl['timezone']],
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

  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of events' });
  }

  const results = [];
  let successfulIngests = 0;

  for (const rawEvent of req.body) {
    const parsed = IngestEventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      results.push({ status: 'error', details: parsed.error.flatten() });
      continue;
    }
    const event = parsed.data;

    if (event.telemetry?.is_bot === true) {
      results.push({ status: 'ignored', reason: 'bot' });
      continue;
    }

    const engagement = computeEngagement(event);
    if (engagement) {
      event.telemetry = {
        ...event.telemetry,
        engagement_score: engagement.score,
        engagement_bucket: engagement.bucket,
      };
    }

    const eventTimeSec = event.event_time ?? Math.floor(Date.now() / 1000);
    const eventTimeMs = eventTimeSec * 1000;
    const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;
    const eventName = event.event_name;
    const eventSourceUrl = event.event_source_url || '';

    if (isDuplicate(siteKey, eventId)) {
      results.push({ status: 'duplicate', event_id: eventId });
      continue;
    }

    try {
      const query = `
        INSERT INTO web_events(
          site_key, event_id, event_name, event_time,
          event_source_url, user_data, custom_data, telemetry, raw_payload
        ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT(site_key, event_id) DO NOTHING
        RETURNING id
      `;

      const result = await pool.query(query, [
        siteKey,
        eventId,
        eventName,
        new Date(eventTimeMs),
        eventSourceUrl,
        event.user_data ?? null,
        event.custom_data ?? null,
        event.telemetry ?? null,
        event,
      ]);

      if ((result.rowCount || 0) === 0) {
        results.push({ status: 'duplicate', event_id: eventId });
        continue;
      }

      successfulIngests++;

      const capiUser = buildCapiUserData(req, event.user_data || {}, siteKey, event.custom_data ?? {});

      const metaCustomData: Record<string, unknown> = {};
      if (event.custom_data) {
        for (const [k, v] of Object.entries(event.custom_data)) {
          if (k === 'value' && typeof v === 'number') metaCustomData.value = v;
          else if (k === 'currency' && typeof v === 'string') metaCustomData.currency = v;
          else if (k === 'content_name' && typeof v === 'string') metaCustomData.content_name = v;
          else if (k === 'content_category' && typeof v === 'string') metaCustomData.content_category = v;
          else if (k === 'content_ids') metaCustomData.content_ids = v;
          else if (k === 'content_type' && typeof v === 'string') metaCustomData.content_type = v;
          else if (k === 'order_id' && typeof v === 'string') metaCustomData.order_id = v;
          else metaCustomData[k] = v;
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

      sendCapiWithRetry(siteKey, capiPayload).catch(() => { });
      results.push({ status: 'processed', event_id: eventId });

    } catch (e) {
      console.error('Batch ingest error:', e);
      results.push({ status: 'error', error: 'Internal server error' });
    }
  }

  if (successfulIngests > 0) {
    await pool.query(
      `UPDATE integrations_meta i SET last_ingest_at = NOW() FROM sites s WHERE s.site_key = $1 AND i.site_id = s.id`,
      [siteKey]
    );
  }

  return res.status(202).json({ results });
});

export default router;
