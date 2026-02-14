import { Router } from 'express';
import axios from 'axios';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString } from '../lib/crypto';
import { decryptString } from '../lib/crypto';

const router = Router();
const fbApiVersion = 'v19.0';

const requireSiteOwnership = async (accountId: number, siteId: number) => {
  const result = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId]);
  return (result.rowCount || 0) > 0;
};

router.get('/sites/:siteId/meta', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    `SELECT pixel_id, ad_account_id,
            enabled,
            (capi_token_enc IS NOT NULL) as has_capi_token,
            (marketing_token_enc IS NOT NULL) as has_marketing_token,
            (fb_user_token_enc IS NOT NULL) as has_facebook_connection,
            fb_user_id
     FROM integrations_meta WHERE site_id = $1`,
    [siteId]
  );
  return res.json({ meta: result.rows[0] || null });
});

router.put('/sites/:siteId/meta', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const { pixel_id, capi_token, marketing_token, ad_account_id, enabled } = req.body || {};
  const pixelId = typeof pixel_id === 'string' ? pixel_id.trim() : null;
  const adAccountId = typeof ad_account_id === 'string' ? ad_account_id.trim() : null;
  const capiTokenEnc = typeof capi_token === 'string' && capi_token.trim() ? encryptString(capi_token.trim()) : null;
  const marketingTokenEnc =
    typeof marketing_token === 'string' && marketing_token.trim() ? encryptString(marketing_token.trim()) : null;
  const enabledBool = typeof enabled === 'string' ? enabled === 'true' : typeof enabled === 'boolean' ? enabled : null;

  await pool.query(
    `INSERT INTO integrations_meta (site_id, pixel_id, capi_token_enc, marketing_token_enc, ad_account_id, enabled)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE))
     ON CONFLICT (site_id) DO UPDATE SET
       pixel_id = COALESCE(EXCLUDED.pixel_id, integrations_meta.pixel_id),
       capi_token_enc = COALESCE(EXCLUDED.capi_token_enc, integrations_meta.capi_token_enc),
       marketing_token_enc = COALESCE(EXCLUDED.marketing_token_enc, integrations_meta.marketing_token_enc),
       ad_account_id = COALESCE(EXCLUDED.ad_account_id, integrations_meta.ad_account_id),
       enabled = COALESCE(EXCLUDED.enabled, integrations_meta.enabled),
       updated_at = NOW()`,
    [siteId, pixelId, capiTokenEnc, marketingTokenEnc, adAccountId, enabledBool]
  );

  return res.json({ ok: true });
});

router.delete('/sites/:siteId/meta/facebook', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  await pool.query(
    `UPDATE integrations_meta
     SET fb_user_id = NULL,
         fb_user_token_enc = NULL,
         fb_token_expires_at = NULL,
         updated_at = NOW()
     WHERE site_id = $1`,
    [siteId]
  );
  return res.json({ ok: true });
});

router.get('/sites/:siteId/meta/adaccounts', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const row = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = row.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  const token = decryptString(tokenEnc);
  const response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/me/adaccounts`, {
    params: { fields: 'id,name,account_id,disable_reason,currency,timezone_name,business', access_token: token, limit: 200 },
  });
  return res.json({ ad_accounts: response.data.data || [] });
});

router.get('/sites/:siteId/meta/pixels', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const adAccountId = String(req.query.ad_account_id || '');
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!adAccountId) return res.status(400).json({ error: 'Missing ad_account_id' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const row = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = row.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  const token = decryptString(tokenEnc);
  const response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(adAccountId)}/adspixels`, {
    params: { fields: 'id,name', access_token: token, limit: 200 },
  });
  return res.json({ pixels: response.data.data || [] });
});

router.get('/sites/:siteId/meta/campaigns', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const metaRow = await pool.query('SELECT fb_user_token_enc, ad_account_id FROM integrations_meta WHERE site_id = $1', [
    siteId,
  ]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  const adAccountId = String(req.query.ad_account_id || metaRow.rows[0]?.ad_account_id || '');
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });
  if (!adAccountId) return res.status(400).json({ error: 'Missing ad_account_id' });

  const token = decryptString(tokenEnc);
  const response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(adAccountId)}/campaigns`, {
    params: { fields: 'id,name,status,effective_status', access_token: token, limit: 200 },
  });

  return res.json({ campaigns: response.data.data || [] });
});

router.patch('/sites/:siteId/meta/campaigns/:campaignId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const campaignId = String(req.params.campaignId || '');
  const { status } = req.body || {};
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!campaignId) return res.status(400).json({ error: 'Invalid campaignId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });
  if (status !== 'PAUSED' && status !== 'ACTIVE') return res.status(400).json({ error: 'Invalid status' });

  const metaRow = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  const token = decryptString(tokenEnc);
  await axios.post(
    `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(campaignId)}`,
    null,
    { params: { status, access_token: token } }
  );

  return res.json({ ok: true });
});

router.get('/sites/:siteId/ga', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    `SELECT measurement_id, enabled, (api_secret_enc IS NOT NULL) as has_api_secret
     FROM integrations_ga WHERE site_id = $1`,
    [siteId]
  );
  return res.json({ ga: result.rows[0] || null });
});

router.put('/sites/:siteId/ga', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const { measurement_id, api_secret, enabled } = req.body || {};
  const measurementId = typeof measurement_id === 'string' ? measurement_id.trim() : null;
  const apiSecretEnc = typeof api_secret === 'string' && api_secret.trim() ? encryptString(api_secret.trim()) : null;
  const enabledBool = typeof enabled === 'string' ? enabled === 'true' : typeof enabled === 'boolean' ? enabled : null;

  await pool.query(
    `INSERT INTO integrations_ga (site_id, measurement_id, api_secret_enc, enabled)
     VALUES ($1, $2, $3, COALESCE($4, TRUE))
     ON CONFLICT (site_id) DO UPDATE SET
       measurement_id = COALESCE(EXCLUDED.measurement_id, integrations_ga.measurement_id),
       api_secret_enc = COALESCE(EXCLUDED.api_secret_enc, integrations_ga.api_secret_enc),
       enabled = COALESCE(EXCLUDED.enabled, integrations_ga.enabled),
       updated_at = NOW()`,
    [siteId, measurementId, apiSecretEnc, enabledBool]
  );

  return res.json({ ok: true });
});

export default router;

