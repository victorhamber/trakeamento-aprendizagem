import { Router } from 'express';
import geoip from 'geoip-lite';
import { pool } from '../db/pool';
import { capiService, CapiService } from '../services/capi';

const router = Router();

type EngagementBucket = 'low' | 'medium' | 'high';

type IngestUserData = {
  client_ip_address?: string;
  client_user_agent?: string;
  em?: string | string[];
  ph?: string | string[];
  fn?: string | string[];
  ln?: string | string[];
  ct?: string | string[];
  st?: string | string[];
  zp?: string | string[];
  country?: string | string[];
  db?: string | string[];
  fbp?: string;
  fbc?: string;
  external_id?: string;
  [key: string]: unknown;
};

type IngestEvent = {
  event_id?: string;
  event_name?: string;
  event_time?: number;
  event_source_url?: string;
  user_data?: IngestUserData;
  custom_data?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function computeEngagement(event: IngestEvent): { score: number; bucket: EngagementBucket } | null {
  if (!event || !event.telemetry) return null;
  if (event.event_name !== 'PageEngagement' && event.event_name !== 'PageView') return null;

  const t = event.telemetry || {};
  const dwellMs = toNumber(t.dwell_time_ms);
  const scroll = toNumber(t.max_scroll_pct);
  const clicks = toNumber(t.clicks_total);
  const ctaClicks = toNumber(t.clicks_cta);

  let score = 0;

  if (dwellMs >= 60000) score += 40;
  else if (dwellMs >= 15000) score += 30;
  else if (dwellMs >= 5000) score += 15;

  if (scroll >= 80) score += 30;
  else if (scroll >= 50) score += 20;
  else if (scroll >= 20) score += 10;

  score += Math.min(clicks * 4, 20);
  score += Math.min(ctaClicks * 10, 30);

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  let bucket: EngagementBucket = 'low';
  if (score >= 70) bucket = 'high';
  else if (score >= 40) bucket = 'medium';

  return { score, bucket };
}

router.post('/events', async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  const event = req.body as IngestEvent;

  const engagement = computeEngagement(event);
  if (engagement) {
    event.telemetry = {
      ...(event.telemetry || {}),
      engagement_score: engagement.score,
      engagement_bucket: engagement.bucket,
    };
  }

  if (!siteKey || !event.event_name) {
    return res.status(400).json({ error: 'Missing site key or event data' });
  }

  try {
    // 1. Persistir o evento raw no Postgres
    const query = `
      INSERT INTO web_events (
        site_key, event_id, event_name, event_time, 
        event_source_url, user_data, custom_data, telemetry, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (site_key, event_id) DO NOTHING
      RETURNING id
    `;

    const eventTimeMs = event.event_time ? event.event_time * 1000 : Date.now();
    const eventTimeSec = event.event_time ?? Math.floor(eventTimeMs / 1000);
    const eventId = event.event_id || `evt_${eventTimeSec}_${Math.random().toString(36).slice(2, 8)}`;
    const eventSourceUrl = event.event_source_url || '';
    const eventName = typeof event.event_name === 'string' ? event.event_name : String(event.event_name || '');
    const values = [
      siteKey,
      eventId,
      eventName,
      new Date(eventTimeMs),
      eventSourceUrl,
      event.user_data,
      event.custom_data,
      event.telemetry,
      event
    ];

    const result = await pool.query(query, values);

    // 2. Envio CAPI (Assíncrono na prática, aqui direto para MVP)
    if ((result.rowCount || 0) > 0) {
      // Prepara payload CAPI
      const userData = event.user_data || {};
      const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
      const clientIp = req.ip || userData.client_ip_address || '';
      const clientUserAgent = req.headers['user-agent'] || userData.client_user_agent || '';

      // Tenta recuperar geolocalização se não vier no payload
      let ct = pick(userData.ct);
      let st = pick(userData.st);
      let zp = pick(userData.zp);
      let country = pick(userData.country);

      if (clientIp && clientIp.length > 6) {
        const geo = geoip.lookup(clientIp);
        if (geo) {
          if (!ct) ct = CapiService.hash(geo.city);
          if (!st) st = CapiService.hash(geo.region);
          if (!country) country = CapiService.hash(geo.country);
          // if (!zp) zp = CapiService.hash(geo.zip); // Zip from geoip is often inaccurate
        }
      }

      const capiPayload = {
        event_name: eventName,
        event_time: eventTimeSec,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        user_data: {
          client_ip_address: clientIp,
          client_user_agent: clientUserAgent,
          em: pick(userData.em),
          ph: pick(userData.ph),
          fn: pick(userData.fn),
          ln: pick(userData.ln),
          ct,
          st,
          zp,
          country,
          db: pick(userData.db),
          fbp: userData.fbp,
          fbc: userData.fbc,
          external_id: userData.external_id ? CapiService.hash(userData.external_id) : undefined
        },
        custom_data: {
          ...event.custom_data,
          ...(event.telemetry || {}),
          engagement_score: engagement?.score,
          engagement_bucket: engagement?.bucket,
          content_name: event.custom_data?.page_title,
          content_type: event.custom_data?.content_type || 'product'
        }
      };

      // Não aguarda o envio para não bloquear a resposta do ingest (fire and forget)
      capiService.sendEvent(String(siteKey), capiPayload).catch(err => console.error("Async CAPI error", err));
    }

    res.status(202).json({ status: 'received' });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
