process.env.TZ = 'America/Sao_Paulo';
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

  if (origin) {
    if (isPublicRoute) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.some(o => origin.startsWith(o))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      // Fallback permissivo para evitar bloqueios de CORS enquanto debugamos
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
// Policy (storage optimization, 30-day analytical window, no strict regulatory requirements):
//   web_events             → 30 days   (high volume)
//   capi_outbox            → 7 days    + remove permanently failed (attempts >= 5)
//   recommendation_reports → no age delete; one row per (site_key, campaign_id, date_preset) via UPSERT
//   purchases              → 12 months (commercial/financial history)
//   meta_insights_daily     → 90 days   (aggregated metrics)
//   site_visitors          → 90 days   (last_seen_at; limits growth)
//   password_resets        → delete expired tokens
//   notifications          → delete read notifications older than 90 days
//   global_notifications   → delete expired (expires_at < NOW())
async function runDataRetentionCleanup() {
  try {
    console.log('[GarbageCollector] Started retention cleanup routine...');

    const resultEvents = await pool.query(
      `DELETE FROM web_events WHERE event_time < NOW() - INTERVAL '30 days'`
    );

    const resultOutbox = await pool.query(
      `DELETE FROM capi_outbox WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'`
    );

    const resultPurchases = await pool.query(
      `DELETE FROM purchases WHERE created_at < NOW() - INTERVAL '12 months'`
    );

    const resultInsights = await pool.query(
      `DELETE FROM meta_insights_daily WHERE date_start < CURRENT_DATE - INTERVAL '90 days'`
    );

    const resultVisitors = await pool.query(
      `DELETE FROM site_visitors WHERE last_seen_at < NOW() - INTERVAL '90 days'`
    );

    const resultPasswordResets = await pool.query(
      `DELETE FROM password_resets WHERE expires_at < NOW()`
    );

    const resultNotifications = await pool.query(
      `DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '90 days'`
    );

    const resultGlobalNotif = await pool.query(
      `DELETE FROM global_notifications WHERE expires_at IS NOT NULL AND expires_at < NOW()`
    );

    console.log(
      `[GarbageCollector] Cleanup finished. ` +
      `web_events=${resultEvents.rowCount} capi_outbox=${resultOutbox.rowCount} ` +
      `purchases=${resultPurchases.rowCount} meta_insights_daily=${resultInsights.rowCount} ` +
      `site_visitors=${resultVisitors.rowCount} password_resets=${resultPasswordResets.rowCount} ` +
      `notifications=${resultNotifications.rowCount} global_notifications=${resultGlobalNotif.rowCount}`
    );
  } catch (e) {
    console.error('[GarbageCollector] Failed to execute cleanup query:', e);
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
