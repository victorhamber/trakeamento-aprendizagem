import { Router, Request } from 'express';
import { createHash } from 'crypto';
import geoip from 'geoip-lite';
import { z } from 'zod';
import { pool } from '../db/pool';
import { capiService, CapiService, CapiEvent } from '../services/capi';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type EngagementBucket = 'low' | 'medium' | 'high';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const UserDataSchema = z.object({
  client_ip_address:  z.string().optional(),
  client_user_agent:  z.string().optional(),
  em:         z.union([z.string(), z.array(z.string())]).optional(),
  ph:         z.union([z.string(), z.array(z.string())]).optional(),
  fn:         z.union([z.string(), z.array(z.string())]).optional(),
  ln:         z.union([z.string(), z.array(z.string())]).optional(),
  ct:         z.union([z.string(), z.array(z.string())]).optional(),
  st:         z.union([z.string(), z.array(z.string())]).optional(),
  zp:         z.union([z.string(), z.array(z.string())]).optional(),
  country:    z.union([z.string(), z.array(z.string())]).optional(),
  db:         z.union([z.string(), z.array(z.string())]).optional(),
  fbp:        z.string().optional(),
  fbc:        z.string().optional(),
  external_id: z.string().optional(),
}).catchall(z.unknown());

const TelemetrySchema = z.object({
  dwell_time_ms:      z.number().nonnegative().optional(),
  visible_time_ms:    z.number().nonnegative().optional(),
  max_scroll_pct:     z.number().min(0).max(100).optional(),
  clicks_total:       z.number().nonnegative().optional(),
  clicks_cta:         z.number().nonnegative().optional(),
  page_path:          z.string().optional(),
  page_title:         z.string().optional(),
  load_time_ms:       z.number().nonnegative().optional(),
  screen_width:       z.number().optional(),
  screen_height:      z.number().optional(),
  pixel_ratio:        z.number().optional(),
  timezone:           z.string().optional(),
  language:           z.string().optional(),
  platform:           z.string().optional(),
  connection_type:    z.string().optional(),
  device_fingerprint: z.string().optional(),
  is_bot:             z.boolean().optional(),
}).catchall(z.unknown());

const IngestEventSchema = z.object({
  event_id:         z.string().optional(),
  event_name:       z.string().min(1).max(100),
  event_time:       z.number().int().positive().optional(),
  event_source_url: z.string().url().optional().or(z.literal('')),
  action_source:    z.string().optional().default('website'),
  user_data:        UserDataSchema.optional(),
  custom_data:      z.record(z.string(), z.unknown()).optional(),
  telemetry:        TelemetrySchema.optional(),
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
  em:      (v) => v.trim().toLowerCase(),
  ph:      (v) => v.replace(/[^0-9]/g, ''),   // apenas dígitos, E.164 sem +
  fn:      (v) => v.trim().toLowerCase(),
  ln:      (v) => v.trim().toLowerCase(),
  ct:      (v) => v.trim().toLowerCase(),
  st:      (v) => v.trim().toLowerCase(),
  zp:      (v) => v.trim().toLowerCase().replace(/\s+/g, ''),
  country: (v) => v.trim().toLowerCase(),
  db:      (v) => v.replace(/[^0-9]/g, ''),   // YYYYMMDD
};

function normalizeAndHash(field: string, value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
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

  const t           = event.telemetry;
  const dwellMs     = toNumber(t.dwell_time_ms);
  const visibleMs   = toNumber(t.visible_time_ms);
  const scroll      = toNumber(t.max_scroll_pct);
  const clicks      = toNumber(t.clicks_total);
  const ctaClicks   = toNumber(t.clicks_cta);
  const loadTimeMs  = toNumber(t.load_time_ms);

  let score = 0;

  // Dwell (usa visible_time se disponível)
  const effectiveDwell = visibleMs > 0 ? visibleMs : dwellMs;
  if (effectiveDwell >= 120_000) score += 40;
  else if (effectiveDwell >= 60_000) score += 35;
  else if (effectiveDwell >= 15_000) score += 25;
  else if (effectiveDwell >= 5_000)  score += 12;

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
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
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
// Para produção: troque pelo Redis com TTL de 24h
const recentEventIds = new Map<string, number>();
const DEDUP_TTL_MS   = 24 * 60 * 60 * 1000;

function isDuplicate(siteKey: string, eventId: string): boolean {
  const key = `${siteKey}:${eventId}`;
  const now = Date.now();

  // Limpa entradas velhas (lazy cleanup)
  if (recentEventIds.size > 10_000) {
    for (const [k, ts] of recentEventIds) {
      if (now - ts > DEDUP_TTL_MS) recentEventIds.delete(k);
    }
  }

  if (recentEventIds.has(key)) return true;
  recentEventIds.set(key, now);
  return false;
}

// ─── CAPI payload builder ─────────────────────────────────────────────────────

function resolveClientIp(req: Request, userData: NonNullable<IngestEvent['user_data']>) {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
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
  siteKey: string
) {
  const clientIp        = resolveClientIp(req, userData);
  const clientUserAgent = req.headers['user-agent'] || userData.client_user_agent || '';
  const geo             = resolveGeo(clientIp);

  // Monta campos com prioridade: payload hasheado > payload raw > geo
  const pick = (field: string) =>
    normalizeAndHash(field, (userData as Record<string, unknown>)[field] as string | string[] | undefined);

  const ct      = pick('ct') ?? (geo.city    ? hashPii(normalizers.ct(geo.city))    : undefined);
  const st      = pick('st') ?? (geo.region  ? hashPii(normalizers.st(geo.region))  : undefined);
  const country = pick('country') ?? (geo.country ? hashPii(normalizers.country(geo.country)) : undefined);

  return {
    client_ip_address: clientIp,
    client_user_agent: clientUserAgent,
    em:          pick('em'),
    ph:          pick('ph'),
    fn:          pick('fn'),
    ln:          pick('ln'),
    ct,
    st,
    country,
    zp:          pick('zp'),
    db:          pick('db'),
    fbp:         userData.fbp,
    fbc:         userData.fbc,
    external_id: userData.external_id ? hashPii(userData.external_id) : undefined,
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
        console.error(`[CAPI] Falha após ${maxAttempts} tentativas para site=${siteKey}:`, err);
        return;
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 10_000); // 2s, 4s, 8s (max 10s)
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post('/events', async (req, res) => {
  const siteKey = (req.query['key'] as string | undefined) || req.headers['x-site-key'] as string | undefined;

  if (!siteKey) {
    return res.status(400).json({ error: 'Missing site key' });
  }

  // Validação e sanitização com Zod
  const parsed = IngestEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid event payload', details: parsed.error.flatten() });
  }

  const event = parsed.data;

  // Recusa bots
  if (event.telemetry?.is_bot === true) {
    return res.status(202).json({ status: 'ignored' });
  }

  // Calcula engagement ANTES de persistir
  const engagement = computeEngagement(event);
  if (engagement) {
    event.telemetry = {
      ...event.telemetry,
      engagement_score:  engagement.score,
      engagement_bucket: engagement.bucket,
    };
  }

  // Gera IDs estáveis
  const eventTimeSec  = event.event_time ?? Math.floor(Date.now() / 1000);
  const eventTimeMs   = eventTimeSec * 1000;
  const eventId       = event.event_id   || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;
  const eventName     = event.event_name;
  const eventSourceUrl = event.event_source_url || '';
  const timeDimensions = getTimeDimensions(eventTimeSec);

  // Deduplicação em memória (rápida) — o ON CONFLICT no Postgres é a garantia definitiva
  if (isDuplicate(siteKey, eventId)) {
    return res.status(202).json({ status: 'duplicate' });
  }

  try {
    // ── 1. Persistir no Postgres ──────────────────────────────────────────
    const query = `
      INSERT INTO web_events (
        site_key, event_id, event_name, event_time,
        event_source_url, user_data, custom_data, telemetry, raw_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (site_key, event_id) DO NOTHING
      RETURNING id
    `;

    const result = await pool.query(query, [
      siteKey,
      eventId,
      eventName,
      new Date(eventTimeMs),
      eventSourceUrl,
      event.user_data   ?? null,
      event.custom_data ?? null,
      event.telemetry   ?? null,
      event,
    ]);

    // ── 2. Envio CAPI (assíncrono com retry) ─────────────────────────────
    if ((result.rowCount ?? 0) > 0) {
      const userData   = event.user_data ?? {};
      const capiUser   = buildCapiUserData(req, userData, siteKey);
      const geo        = resolveGeo(capiUser.client_ip_address || '');

      const capiPayload = {
        event_name:       eventName,
        event_time:       eventTimeSec,
        event_id:         eventId,
        event_source_url: eventSourceUrl,
        user_data:        capiUser,
        custom_data: {
          ...event.custom_data,
          event_time:       eventTimeSec,
          event_url:        eventSourceUrl,
          event_day:        timeDimensions.event_day,
          event_day_in_month: timeDimensions.event_day_in_month,
          event_month:      timeDimensions.event_month,
          event_time_interval: timeDimensions.event_time_interval,
          event_hour:       timeDimensions.event_hour,
          page_title:       event.custom_data?.['page_title'],
          client_ip_address: capiUser.client_ip_address,
          client_user_agent: capiUser.client_user_agent,
          external_id:     userData.external_id,
          fbp:             userData.fbp ?? capiUser.fbp,
          fbc:             userData.fbc ?? capiUser.fbc,
          country:         geo.country,
          state:           geo.region,
          city:            geo.city,
          // Telemetria relevante para otimização do Meta
          engagement_score:  engagement?.score,
          engagement_bucket: engagement?.bucket,
          dwell_time_ms:     event.telemetry?.dwell_time_ms,
          visible_time_ms:   event.telemetry?.visible_time_ms,
          max_scroll_pct:    event.telemetry?.max_scroll_pct,
          clicks_cta:        event.telemetry?.clicks_cta,
          // Campos padrão Meta
          content_name:   event.custom_data?.['page_title'],
          content_type:   event.custom_data?.['content_type'] ?? 'product',
        },
      };

      // Fire-and-forget com retry — não bloqueia a resposta HTTP
      sendCapiWithRetry(siteKey, capiPayload).catch(() => {});
    }

    return res.status(202).json({ status: 'received' });
  } catch (err) {
    console.error('[Ingest] Erro ao persistir evento:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
