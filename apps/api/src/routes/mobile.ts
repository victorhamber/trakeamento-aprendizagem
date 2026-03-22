import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { isWebPushConfigured } from '../services/web-push-notify';

const router = Router();

router.use(requireAuth);

/** VAPID público para o browser assinar Web Push (HTTPS ou localhost). */
router.get('/web-push-config', (_req, res) => {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || '';
  if (!publicKey) {
    return res.json({ enabled: false, publicKey: null });
  }
  return res.json({ enabled: true, publicKey });
});

type PushSubscriptionJSON = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

/** Registra subscription do navegador para alertas de venda (Web Push). */
router.post('/register-web-push', async (req, res) => {
  const auth = req.auth!;
  const sub = req.body?.subscription as PushSubscriptionJSON | undefined;
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint.trim() : '';
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh.trim() : '';
  const authKey = typeof sub?.keys?.auth === 'string' ? sub.keys.auth.trim() : '';

  if (!endpoint || !p256dh || !authKey) {
    return res.status(400).json({ error: 'subscription com endpoint e keys é obrigatório' });
  }
  if (!isWebPushConfigured()) {
    return res.status(503).json({ error: 'Web Push não configurado no servidor (VAPID)' });
  }

  try {
    await pool.query(
      `INSERT INTO web_push_subscriptions (account_id, endpoint, p256dh, auth_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth_key = EXCLUDED.auth_key,
         created_at = NOW()`,
      [auth.accountId, endpoint, p256dh, authKey]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Mobile] register-web-push error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/unregister-web-push', async (req, res) => {
  const auth = req.auth!;
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (!endpoint) {
    return res.status(400).json({ error: 'endpoint é obrigatório' });
  }
  try {
    await pool.query(
      'DELETE FROM web_push_subscriptions WHERE account_id = $1 AND endpoint = $2',
      [auth.accountId, endpoint]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Mobile] unregister-web-push error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Register Expo push token for this account (mobile app). */
router.post('/register-push', async (req, res) => {
  const auth = req.auth!;
  const { pushToken, platform } = req.body || {};
  if (!pushToken || typeof pushToken !== 'string') {
    return res.status(400).json({ error: 'pushToken is required' });
  }

  try {
    await pool.query(
      `INSERT INTO push_tokens (account_id, push_token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, push_token) DO UPDATE SET created_at = NOW()`,
      [auth.accountId, pushToken.trim(), (platform || 'expo').toString().slice(0, 20)]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Mobile] register-push error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Unregister push token (e.g. on logout). */
router.post('/unregister-push', async (req, res) => {
  const auth = req.auth!;
  const { pushToken } = req.body || {};
  if (!pushToken || typeof pushToken !== 'string') {
    return res.status(400).json({ error: 'pushToken is required' });
  }

  try {
    await pool.query(
      'DELETE FROM push_tokens WHERE account_id = $1 AND push_token = $2',
      [auth.accountId, pushToken.trim()]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Mobile] unregister-push error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
