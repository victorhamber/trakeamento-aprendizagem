import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import ingestRoutes from './routes/ingest';
import webhookRoutes from './routes/webhooks';
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
app.use('/webhooks', bodyParser.json({ type: '*/*' }));
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

// ─── Data Retention Garbage Collector ────────────────────────────────────────
// Retention policy (SaaS-optimized — keeps DB lean for multi-tenant scale):
//   web_events              → 30 days   (high volume, event_time based)
//   capi_outbox             → 7 days    + remove permanently failed (attempts >= 5)
//   capi_outbox_dead_letter → 30 days   (audit trail, then discard)
//   purchases               → 12 months (commercial/financial history)
//   purchases.raw_payload   → NULL after 7 days (data already in typed columns)
//   meta_insights_daily     → 90 days   (aggregated metrics)
//   meta_insights.raw_payload → NULL after 30 days (metrics already in typed columns)
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
      { label: 'meta_insights_daily', sql: `DELETE FROM meta_insights_daily WHERE date_start < CURRENT_DATE - INTERVAL '90 days'` },
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
        sql: `UPDATE meta_insights_daily SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND date_start < CURRENT_DATE - INTERVAL '30 days'`,
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
        setTimeout(runOutboxWorker, 60 * 1000); // Schedule next run AFTER completion
      }
    };
    setTimeout(runOutboxWorker, 60 * 1000); // First run 1 minute after boot

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
