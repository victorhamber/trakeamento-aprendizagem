import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import ingestRoutes from './routes/ingest';
import webhookRoutes, {
  customWebhookParseBodyMiddleware,
  customWebhookPostHandler,
  customWebhookRawBodyParser,
} from './routes/webhooks';
import authRoutes from './routes/auth';
import sitesRoutes from './routes/sites';
import integrationsRoutes from './routes/integrations';
import sdkRoutes from './routes/sdk';
import aiRoutes from './routes/ai';
import oauthRoutes from './routes/oauth';
import statsRoutes from './routes/stats';
import { pool } from './db/pool';
import metaRoutes from './routes/meta';
import recommendationRoutes from './routes/recommendations';
import mentorRoutes from './routes/mentor';
import notificationRoutes from './routes/notifications';
import uploadRoutes from './routes/upload';
import { formsRouter } from './routes/forms';
import publicRoutes from './routes/public';
import adminRoutes from './routes/admin';
import dashboardRoutes from './routes/dashboard';
import mobileRoutes from './routes/mobile';
import crypto from 'crypto';
import { mergeUserDataWithMetaParamBuilder } from './lib/meta-param-builder-ingest';
import { getClientIp } from './lib/ip';

import { ensureSchema } from './db/schema';
import { capiService } from './services/capi';

import compression from 'compression';

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Compressão Gzip para todas as respostas
app.use(compression());

// Middleware de CORS manual
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Lista de origens permitidas (dashboard em prod + localhost)
  const allowedOrigins = [
    process.env.PUBLIC_DASHBOARD_BASE_URL,
    'https://app.trajettu.com',
    'https://adm.trajettu.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ].filter(Boolean) as string[];

  // Rotas públicas que devem ser acessíveis de qualquer lugar
  const isPublicRoute =
    req.path.startsWith('/sdk') ||
    req.path.startsWith('/ingest') ||
    req.path.startsWith('/public');
  const isAllowedOrigin = !!origin && allowedOrigins.some(o => origin.startsWith(o));

  if (origin) {
    if (isPublicRoute) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'Origin not allowed' });
      }
      return res.status(403).json({ error: 'Origin not allowed' });
    }
  } else if (isPublicRoute) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Key, x-site-key');

  if (req.method === 'OPTIONS') return res.sendStatus(204);

  next();
});
/**
 * Webhook personalizado: lê o corpo bruto antes do JSON global para aceitar
 * JSON, text/plain com JSON, form-urlencoded (ex.: campo `data`) sem perder campos.
 * A rota `POST /custom/:id` foi removida do router para não duplicar.
 */
app.post(
  '/webhooks/custom/:id',
  customWebhookRawBodyParser,
  customWebhookParseBodyMiddleware,
  async (req, res, next) => {
    try {
      await customWebhookPostHandler(req, res);
    } catch (err) {
      next(err);
    }
  }
);
/** Webhooks (Hotmart, custom, etc.) podem exceder o default 100kb do body-parser. */
app.use('/webhooks', bodyParser.json({ type: '*/*', limit: '5mb' }));
// Parse text/plain as JSON for sendBeacon fallback (uses text/plain to avoid CORS preflight)
app.use('/ingest', bodyParser.text({ type: 'text/plain' }));
app.use(bodyParser.json());
app.use(cookieParser());

import path from 'path';
const uploadsPath = path.join(process.cwd(), 'uploads');
import fs from 'fs';
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
app.use('/uploads', express.static(uploadsPath));

app.use('/auth', authRoutes);
app.use('/sites', sitesRoutes);
app.use('/integrations', integrationsRoutes);
app.use('/ai', aiRoutes);
app.use('/oauth', oauthRoutes);
app.use('/stats', statsRoutes);
app.use('/sdk', sdkRoutes);
app.use('/ingest', ingestRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/meta', metaRoutes);
app.use('/recommendations', recommendationRoutes);
app.use('/mentor', mentorRoutes);
app.use('/notifications', notificationRoutes);
app.use('/upload', uploadRoutes);
app.use('/public', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/mobile', mobileRoutes);
app.use('/', formsRouter);

app.get('/', (req, res) => {
  res.send('API Running');
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'db_error';
    res.status(500).json({ status: 'error', db: message });
  }
});

function normalizeRequestHost(req: express.Request): string {
  const raw = String(req.headers['x-forwarded-host'] || req.get('host') || '').trim().toLowerCase();
  const host = (raw.split(',')[0] || '').trim();
  return host.replace(/:\d+$/, '').replace(/\.$/, '');
}

function normalizeRequestProto(req: express.Request): 'http' | 'https' {
  const xf = String(req.headers['x-forwarded-proto'] || '').trim().toLowerCase();
  if (xf === 'https') return 'https';
  if (xf === 'http') return 'http';
  return (req.protocol === 'https' ? 'https' : 'http') as 'http' | 'https';
}

function safeSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(s)) return null;
  const reserved = new Set([
    'auth','sites','integrations','ai','oauth','stats','sdk','ingest','webhooks','meta','recommendations',
    'mentor','notifications','upload','public','admin','dashboard','mobile','health','uploads',
  ]);
  if (reserved.has(s)) return null;
  return s;
}

function mergeQueryIntoDestination(destUrl: string, incoming: URLSearchParams): string {
  const u = new URL(destUrl);
  // preserva tudo do clique (utm_*, fbclid/gclid, etc.) sem sobrescrever parâmetros fixos no destino
  incoming.forEach((v, k) => {
    if (!k) return;
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  });
  return u.toString();
}

function destinationLooksLikeHotmart(destUrl: string): boolean {
  try {
    const u = new URL(destUrl);
    const h = u.hostname.toLowerCase();
    return h === 'pay.hotmart.com' || h.endsWith('.hotmart.com') || h.endsWith('.hotmart.com.br');
  } catch {
    return false;
  }
}

function buildHotmartSckToken(opts: { externalId: string; fbp?: string; fbc?: string; maxChars?: number | null }) {
  // sck recebe um token curto. Mantemos compatibilidade com o padrão já usado no SDK: trk_base64(eid|fbc|fbp)
  // Se estourar o orçamento, reduz para trk_base64(eid||) (ainda garante identidade cross-device).
  const eid = (opts.externalId || '').trim();
  if (!eid) return '';
  const payloadFull = `${eid}|${(opts.fbc || '').trim()}|${(opts.fbp || '').trim()}`;
  const full = `trk_${Buffer.from(payloadFull).toString('base64')}`;
  const budget = typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars > 8 ? opts.maxChars : null;
  if (!budget) return full;
  if (full.length <= budget) return full;
  const payloadShort = `${eid}||`;
  return `trk_${Buffer.from(payloadShort).toString('base64')}`;
}

function parseHotmartSckMaxChars(): number | null {
  const raw = (process.env.HOTMART_SCK_MAX_CHARS || '').trim();
  if (!raw) return 280;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 280;
  return n;
}

function pickForwardParams(opts: {
  incoming: URLSearchParams;
  destinationUrl: string;
  // ids internos (para pixel/capi) — para Hotmart preferimos sck ao invés de empilhar params
  externalId: string;
  fbp?: string;
  fbc?: string;
}): URLSearchParams {
  const isHotmart = destinationLooksLikeHotmart(opts.destinationUrl);
  const allowBase = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'click_id',
    'fbclid',
    'gclid',
    'gbraid',
    'wbraid',
    'msclkid',
    'ttclid',
    'twclid',
  ]);

  // Para destinos não-Hotmart, podemos repassar ids (sem duplicar), porque não costuma quebrar.
  const allowNonHotmartExtra = new Set(['external_id', 'fbp', 'fbc']);

  const out = new URLSearchParams();

  // 1) Repassa allowlist base (sem estourar)
  opts.incoming.forEach((v, k) => {
    const key = String(k || '').trim();
    if (!key) return;
    const lower = key.toLowerCase();
    const val = String(v || '').trim();
    if (!val) return;

    if (allowBase.has(lower)) {
      const maxLen = isHotmart ? 160 : 500;
      out.set(lower, val.length > maxLen ? val.slice(0, maxLen) : val);
      return;
    }

    if (!isHotmart && allowNonHotmartExtra.has(lower)) {
      // repassa ids se vierem do clique (sem inventar aqui)
      const maxLen = 500;
      out.set(lower, val.length > maxLen ? val.slice(0, maxLen) : val);
      return;
    }
  });

  // 2) Estratégia Hotmart: preferir sck=trk_... e evitar empilhar fbp/fbc/external_id
  if (isHotmart) {
    if (!out.has('sck') && !opts.incoming.get('sck')) {
      const sck = buildHotmartSckToken({
        externalId: opts.externalId,
        fbp: opts.fbp,
        fbc: opts.fbc,
        maxChars: parseHotmartSckMaxChars(),
      });
      if (sck) out.set('sck', sck);
    }
    // Nunca anexar fbp/fbc/external_id no checkout Hotmart aqui para evitar conflito/bug de pagamento.
    out.delete('external_id');
    out.delete('fbp');
    out.delete('fbc');
  } else {
    // 3) Outros destinos: garantir ids (se não existirem) para manter match do pixel do Trajettu
    if (opts.externalId && !out.has('external_id')) out.set('external_id', opts.externalId);
    if (opts.fbp && !out.has('fbp')) out.set('fbp', opts.fbp);
    if (opts.fbc && !out.has('fbc')) out.set('fbc', opts.fbc);
  }

  return out;
}

app.get('/:slug', async (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return res.status(404).type('text/plain').send('Not found');

  const host = normalizeRequestHost(req);
  if (!host) return res.status(404).type('text/plain').send('Not found');
  const proto = normalizeRequestProto(req);

  const linkRes = await pool.query(
    `SELECT l.id, l.site_id, l.host, l.name, l.slug, l.destination_url, l.event_name, l.parameters, l.is_active, s.site_key
     FROM site_redirect_links l
     JOIN sites s ON s.id = l.site_id
     WHERE l.host = $1 AND l.slug = $2 AND l.is_active IS TRUE
     LIMIT 1`,
    [host, slug]
  );
  if (!linkRes.rowCount) return res.status(404).type('text/plain').send('Not found');
  const link = linkRes.rows[0] as any;

  const requestUrl = `${proto}://${host}${req.originalUrl || `/${slug}`}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const eventId = `rl_${nowSec}_${crypto.randomBytes(6).toString('hex')}`;

  const incomingQs = new URLSearchParams(String(req.originalUrl || '').split('?')[1] || '');

  // IDs vindos da página de origem (taDecorateUrl). Em go.* não há cookie _fbp do site —
  // sem isso no user_data o CAPI sai só com IP/UA e o Meta não casa/marca o evento.
  const externalIdRaw = (incomingQs.get('external_id') || '').trim();
  const externalId = externalIdRaw || `eid_${crypto.randomBytes(10).toString('hex')}`;
  const fbpFromQs = (incomingQs.get('fbp') || '').trim();
  const fbcFromQs = (incomingQs.get('fbc') || '').trim();

  const userDataBase: Record<string, unknown> = {
    client_ip_address: getClientIp(req),
    client_user_agent: req.headers['user-agent'] || undefined,
    external_id: externalId,
  };
  if (fbpFromQs) userDataBase.fbp = fbpFromQs;
  if (fbcFromQs) userDataBase.fbc = fbcFromQs;

  const user_data = mergeUserDataWithMetaParamBuilder(
    req as any,
    requestUrl,
    userDataBase
  ) as Record<string, unknown>;

  // Query da página de origem tem prioridade (destino externo não carrega pixel nosso).
  user_data.external_id = externalId;
  if (fbpFromQs) user_data.fbp = fbpFromQs;
  if (fbcFromQs) user_data.fbc = fbcFromQs;

  const fbp =
    (typeof user_data.fbp === 'string' ? String(user_data.fbp).trim() : '') || fbpFromQs;
  const fbc =
    (typeof user_data.fbc === 'string' ? String(user_data.fbc).trim() : '') || fbcFromQs;

  // IMPORTANTE: não “inventar” parâmetros no destino (ex.: external_id/fbp/fbc/trk),
  // porque alguns checkouts (Hotmart) podem quebrar com query extra.
  // A gente usa external_id/fbp/fbc internamente para o evento, mas repassa para o destino
  // apenas uma estratégia segura por destino (Hotmart: sck; demais: ids).
  const forwardQs = pickForwardParams({
    incoming: incomingQs,
    destinationUrl: String(link.destination_url),
    externalId,
    fbp: fbp || undefined,
    fbc: fbc || undefined,
  });
  const destination = mergeQueryIntoDestination(String(link.destination_url), forwardQs);

  const custom_data: Record<string, unknown> =
    link.parameters && typeof link.parameters === 'object' && !Array.isArray(link.parameters)
      ? { ...(link.parameters as Record<string, unknown>) }
      : {};

  const passKeys = [
    'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
    'click_id','fbclid','gclid','ttclid','twclid','msclkid','gbraid','wbraid',
  ];
  for (const k of passKeys) {
    const v = forwardQs.get(k);
    if (v && v.trim() && !(k in custom_data)) custom_data[k] = v.trim();
  }
  if (!custom_data.redirect_destination) custom_data.redirect_destination = destination;
  if (!custom_data.redirect_slug) custom_data.redirect_slug = slug;

  const capiPayload = {
    event_name: String(link.event_name || 'PageView'),
    event_time: nowSec,
    event_id: eventId,
    event_source_url: requestUrl,
    action_source: 'website' as const,
    user_data: user_data as any,
    custom_data,
  };

  // Persiste + envia CAPI ANTES do 302 (destino externo não tem nosso pixel).
  // Timeout curto: se a Meta atrasar, ainda redireciona e o outbox/retry cobre o resto.
  const REDIRECT_CAPI_WAIT_MS = 2500;
  try {
    await pool.query(
      `INSERT INTO web_events (site_key, event_id, event_name, event_time, event_source_url, user_data, custom_data, telemetry)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
       ON CONFLICT (site_key, event_id) DO NOTHING`,
      [String(link.site_key), eventId, String(link.event_name), requestUrl, user_data, custom_data, null]
    );
  } catch {}

  try {
    const sendPromise = capiService.sendEvent(String(link.site_key), capiPayload as any).then(async (result) => {
      if (result && typeof result === 'object' && ('ok' in result) && !(result as any).ok) {
        await capiService.saveToOutbox(String(link.site_key), capiPayload as any, (result as any).error || 'API Error');
      }
      return result;
    });
    await Promise.race([
      sendPromise,
      new Promise((resolve) => setTimeout(resolve, REDIRECT_CAPI_WAIT_MS)),
    ]);
    // Se estourou o timeout, não bloqueia o redirect; deixa o envio terminar em background
    // e garante outbox se falhar depois.
    void sendPromise.catch(async (e: any) => {
      try {
        await capiService.saveToOutbox(String(link.site_key), capiPayload as any, e?.message || String(e));
      } catch {}
    });
  } catch (e: any) {
    try {
      await capiService.saveToOutbox(String(link.site_key), capiPayload as any, e?.message || String(e));
    } catch {}
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, destination);
});

// ─── Data Retention Garbage Collector ────────────────────────────────────────
// Retention policy (SaaS-optimized — keeps DB lean for multi-tenant scale):
//   web_events              → 30 days   (high volume, event_time based)
//   capi_outbox             → 7 days    + remove permanently failed (attempts >= 5)
//   capi_outbox_dead_letter → 30 days   (audit trail, then discard)
//   purchases               → 12 months (commercial/financial history)
//   purchases.raw_payload   → NULL after 7 days (data already in typed columns)
//   meta_insights_daily     → 45 days   (aggregated Meta Ads metrics; not pixel events)
//   meta_insights.raw_payload → NULL after 14 days (metrics already in typed columns)
//   site_visitors           → 90 days   (last_seen_at)
//   mentor_chat_history     → 60 days   (AI conversation memory)
//   custom_webhooks.last_payload → NULL after 30 days (debug only)
//   notifications           → read + older than 90 days
//   password_resets         → delete expired tokens
//   global_notifications    → delete expired (expires_at < NOW())
//   recommendation_reports  → no age delete; one row per context via UPSERT
async function runDataRetentionCleanup() {
  try {
    console.log('[GarbageCollector] Started retention cleanup routine...');
    const stats: Record<string, number> = {};

    // ── DELETE operations (remove entire rows) ──────────────────────────
    const deleteTasks: { label: string; sql: string }[] = [
      { label: 'web_events', sql: `DELETE FROM web_events WHERE event_time < NOW() - INTERVAL '30 days'` },
      { label: 'capi_outbox', sql: `DELETE FROM capi_outbox WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'` },
      { label: 'capi_dead_letter', sql: `DELETE FROM capi_outbox_dead_letter WHERE created_at < NOW() - INTERVAL '30 days'` },
      { label: 'purchases', sql: `DELETE FROM purchases WHERE created_at < NOW() - INTERVAL '12 months'` },
      { label: 'meta_insights_daily', sql: `DELETE FROM meta_insights_daily WHERE date_start < CURRENT_DATE - INTERVAL '45 days'` },
      { label: 'site_visitors', sql: `DELETE FROM site_visitors WHERE last_seen_at < NOW() - INTERVAL '90 days'` },
      { label: 'mentor_chat', sql: `DELETE FROM mentor_chat_history WHERE created_at < NOW() - INTERVAL '60 days'` },
      { label: 'password_resets', sql: `DELETE FROM password_resets WHERE expires_at < NOW()` },
      { label: 'notifications', sql: `DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '90 days'` },
      { label: 'global_notifications', sql: `DELETE FROM global_notifications WHERE expires_at IS NOT NULL AND expires_at < NOW()` },
    ];

    for (const task of deleteTasks) {
      try {
        const r = await pool.query(task.sql);
        stats[task.label] = r.rowCount ?? 0;
      } catch (err) {
        console.error(`[GarbageCollector] Failed ${task.label}:`, err);
        stats[task.label] = -1;
      }
    }

    // ── STRIP operations (NULL out heavy JSONB columns, keep the row) ──
    const stripTasks: { label: string; sql: string }[] = [
      {
        label: 'purchases_raw_payload',
        sql: `UPDATE purchases SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND created_at < NOW() - INTERVAL '7 days'`,
      },
      {
        label: 'insights_raw_payload',
        sql: `UPDATE meta_insights_daily SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND date_start < CURRENT_DATE - INTERVAL '14 days'`,
      },
      {
        label: 'webhooks_last_payload',
        sql: `UPDATE custom_webhooks SET last_payload = NULL WHERE last_payload IS NOT NULL AND updated_at < NOW() - INTERVAL '30 days'`,
      },
    ];

    for (const task of stripTasks) {
      try {
        const r = await pool.query(task.sql);
        if ((r.rowCount ?? 0) > 0) stats[task.label] = r.rowCount ?? 0;
      } catch (err) {
        console.error(`[GarbageCollector] Failed ${task.label}:`, err);
      }
    }

    // ── VACUUM ANALYZE on high-churn tables (reclaims disk space) ────────
    const vacuumTables = ['web_events', 'capi_outbox', 'site_visitors', 'purchases', 'meta_insights_daily'];
    for (const table of vacuumTables) {
      try {
        await pool.query(`VACUUM ANALYZE ${table}`);
      } catch {
        // VACUUM can fail inside transactions or on managed DBs — non-fatal
      }
    }

    const summary = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[GarbageCollector] Cleanup finished. ${summary}`);
  } catch (e) {
    console.error('[GarbageCollector] Failed to execute cleanup:', e);
  }
}

(async () => {
  try {
    console.log('Initializing API...');
    await ensureSchema(pool);
    console.log('Database schema ensured.');

    app.listen(port, () => {
      console.log(`API running on port ${port}`);
    });

    // Start background jobs — recursive setTimeout prevents overlapping runs
    const runOutboxWorker = async () => {
      try {
        await capiService.processOutbox();
      } catch (err) {
        console.error('Background CAPI worker error:', err);
      } finally {
        setTimeout(runOutboxWorker, 15 * 1000); // Schedule next run AFTER completion
      }
    };
    setTimeout(runOutboxWorker, 15 * 1000); // First run shortly after boot

    // Start 30-Day Garbage Collector
    setTimeout(() => {
      runDataRetentionCleanup();
      setInterval(runDataRetentionCleanup, 24 * 60 * 60 * 1000); // Every 24 hours
    }, 5 * 60 * 1000); // Delay first execution by 5 minutes after server start to not block boot

  } catch (err) {
    console.error('CRITICAL ERROR during startup:', err);
    process.exit(1);
  }
})();
