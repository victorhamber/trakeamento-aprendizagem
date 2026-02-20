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
import { formsRouter } from './routes/forms';
import { ensureSchema } from './db/schema';
import { capiService } from './services/capi';

import compression from 'compression';

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', true);

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

  // Rotas públicas que devem ser acessíveis de qualquer lugar (SDK, Ingest, Forms públicos)
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
    }
  } else {
    // Se não tem origin (ex: curl ou server-to-server), permite se for rota pública
    if (isPublicRoute) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Key, x-site-key');

  if (req.method === 'OPTIONS') return res.sendStatus(204);

  next();
});
app.use('/webhooks', bodyParser.raw({ type: 'application/json' }));
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

  } catch (err) {
    console.error('CRITICAL ERROR during startup:', err);
    process.exit(1);
  }
})();
