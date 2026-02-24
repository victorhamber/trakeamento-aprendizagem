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
import notificationRoutes from './routes/notifications';
import { formsRouter } from './routes/forms';
import publicRoutes from './routes/public';
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
app.use('/notifications', notificationRoutes);
app.use('/public', publicRoutes);
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

// ─── 30-Day Garbage Collector ────────────────────────────────────────────────
// Deletes tracking events and logs older than 30 days. Leaves `purchases` intact.
async function runDataRetentionCleanup() {
  try {
    console.log('[GarbageCollector] Started 30-day retention cleanup routine...');
    const resultEvents = await pool.query(`DELETE FROM web_events WHERE event_time < NOW() - INTERVAL '30 days'`);
    const resultOutbox = await pool.query(`DELETE FROM capi_outbox WHERE created_at < NOW() - INTERVAL '30 days'`);
    console.log(`[GarbageCollector] Cleanup finished. Deleted ${resultEvents.rowCount} old web_events and ${resultOutbox.rowCount} old capi_outbox logs.`);
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

    // Start background jobs
    setInterval(() => {
      capiService.processOutbox().catch((err) => console.error('Background CAPI worker error:', err));
    }, 60 * 1000); // Check outbox every minute

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
