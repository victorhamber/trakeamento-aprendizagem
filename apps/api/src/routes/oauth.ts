import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { encryptString } from '../lib/crypto';
import { getJwtSecret } from '../lib/jwt';

const router = Router();

const fbApiVersion = 'v19.0';

router.get('/meta/start', requireAuth, async (req, res) => {
  const siteId = Number(req.query.site_id);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });
  const auth = req.auth!;

  const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!(owns.rowCount || 0)) return res.status(404).json({ error: 'Site not found' });

  const appId = process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID is missing' });

  const redirectUri = process.env.META_OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/meta/callback';

  const nonce = Math.random().toString(36).slice(2);
  const state = jwt.sign(
    { siteId, accountId: auth.accountId, nonce },
    getJwtSecret(),
    { expiresIn: '10m' }
  );

  res.cookie('meta_oauth_nonce', nonce, {
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });

  const scope = [
    'ads_read',
    'ads_management',
    'business_management',
  ].join(',');

  const url =
    `https://www.facebook.com/${fbApiVersion}/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&auth_type=rerequest`;

  const wantsJson = String(req.query.json || '') === '1' || req.headers.accept?.includes('application/json');
  if (wantsJson) return res.json({ url });
  return res.redirect(url);
});

router.get('/meta/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code/state');

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return res.status(500).send('META_APP_ID/META_APP_SECRET missing');

  const redirectUri = process.env.META_OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/meta/callback';
  const dashboardBase = process.env.PUBLIC_DASHBOARD_BASE_URL || 'http://localhost:3000';

  let payload: any;
  try {
    payload = jwt.verify(String(state), getJwtSecret());
  } catch {
    return res.status(400).send('Invalid state');
  }

  // CSRF protection is handled by the signed JWT state parameter itself.
  // Cookie-based nonce was removed because it doesn't survive cross-domain
  // redirects (API and dashboard on different subdomains).

  const siteId = Number(payload.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).send('Invalid site');

  try {
    const tokenRes = await axios.get(`https://graph.facebook.com/${fbApiVersion}/oauth/access_token`, {
      params: {
        client_id: appId,
        redirect_uri: redirectUri,
        client_secret: appSecret,
        code: String(code),
      },
    });

    const shortToken = tokenRes.data.access_token as string;

    const longRes = await axios.get(`https://graph.facebook.com/${fbApiVersion}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
    });

    const longToken = longRes.data.access_token as string;
    const expiresIn = Number(longRes.data.expires_in || 0);
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    const me = await axios.get(`https://graph.facebook.com/${fbApiVersion}/me`, {
      params: { fields: 'id', access_token: longToken },
    });

    const fbUserId = String(me.data.id);

    const tokenEnc = encryptString(longToken);

    await pool.query(
      `INSERT INTO integrations_meta (site_id, fb_user_id, fb_user_token_enc, fb_token_expires_at, marketing_token_enc)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (site_id) DO UPDATE SET
         fb_user_id = EXCLUDED.fb_user_id,
         fb_user_token_enc = EXCLUDED.fb_user_token_enc,
         fb_token_expires_at = EXCLUDED.fb_token_expires_at,
         marketing_token_enc = EXCLUDED.marketing_token_enc,
         updated_at = NOW()`,
      [siteId, fbUserId, tokenEnc, expiresAt, tokenEnc]
    );

    return res.redirect(`${dashboardBase}/sites/${siteId}?tab=meta&connected=1`);
  } catch (err: any) {
    return res.status(500).send(err?.response?.data?.error?.message || err?.message || 'OAuth error');
  }
});

export default router;
