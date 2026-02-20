import { Router } from 'express';
import axios from 'axios';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString } from '../lib/crypto';
import { decryptString } from '../lib/crypto';
import { capiService } from '../services/capi';

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
    `SELECT pixel_id,
            ad_account_id,
            enabled,
            capi_test_event_code,
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

  const { pixel_id, capi_token, marketing_token, ad_account_id, enabled, capi_test_event_code } = req.body || {};
  const pixelId = typeof pixel_id === 'string' ? pixel_id.trim() : null;
  const adAccountId = typeof ad_account_id === 'string' ? ad_account_id.trim() : null;
  const capiTokenEnc =
    typeof capi_token === 'string' && capi_token.trim() ? encryptString(capi_token.trim().replace(/\s+/g, '')) : null;
  const hasTestEventCode = Object.prototype.hasOwnProperty.call(req.body || {}, 'capi_test_event_code');
  const capiTestEventCodeRaw =
    typeof capi_test_event_code === 'string' ? capi_test_event_code.trim().replace(/\s+/g, '') : '';
  const capiTestEventCode = capiTestEventCodeRaw ? capiTestEventCodeRaw : null;
  const marketingTokenEnc =
    typeof marketing_token === 'string' && marketing_token.trim()
      ? encryptString(marketing_token.trim().replace(/\s+/g, ''))
      : null;
  const enabledBool = typeof enabled === 'string' ? enabled === 'true' : typeof enabled === 'boolean' ? enabled : null;

  await pool.query(
    `INSERT INTO integrations_meta (site_id, pixel_id, capi_token_enc, capi_test_event_code, marketing_token_enc, ad_account_id, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE))
     ON CONFLICT (site_id) DO UPDATE SET
       pixel_id = COALESCE(EXCLUDED.pixel_id, integrations_meta.pixel_id),
       capi_token_enc = COALESCE(EXCLUDED.capi_token_enc, integrations_meta.capi_token_enc),
       capi_test_event_code = CASE WHEN $8 THEN EXCLUDED.capi_test_event_code ELSE integrations_meta.capi_test_event_code END,
       marketing_token_enc = COALESCE(EXCLUDED.marketing_token_enc, integrations_meta.marketing_token_enc),
       ad_account_id = COALESCE(EXCLUDED.ad_account_id, integrations_meta.ad_account_id),
       enabled = COALESCE(EXCLUDED.enabled, integrations_meta.enabled),
       updated_at = NOW()`,
    [siteId, pixelId, capiTokenEnc, capiTestEventCode, marketingTokenEnc, adAccountId, enabledBool, hasTestEventCode]
  );

  return res.json({ ok: true });
});

router.post('/sites/:siteId/meta/test-capi', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const siteRow = await pool.query('SELECT site_key, domain FROM sites WHERE id = $1', [siteId]);
  const site = siteRow.rows[0];
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const domain = typeof site.domain === 'string' ? site.domain.trim() : '';
  const eventSourceUrl = domain
    ? (domain.startsWith('http://') || domain.startsWith('https://') ? domain : `https://${domain}`)
    : ((req.headers.origin as string | undefined) || 'https://example.com');
  const clientIp =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    || req.ip
    || '127.0.0.1';
  const clientUserAgent = (req.headers['user-agent'] as string | undefined) || 'server_test';
  const eventId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const eventTime = Math.floor(Date.now() / 1000);

  const result = await capiService.sendEventDetailed(site.site_key, {
    event_name: 'PageView',
    event_time: eventTime,
    event_id: eventId,
    event_source_url: eventSourceUrl,
    user_data: {
      client_ip_address: clientIp,
      client_user_agent: clientUserAgent,
    },
  });

  return res.json({
    event_id: eventId,
    event_source_url: eventSourceUrl,
    ...result,
  });
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

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

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

  const finalAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  const response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(finalAdAccountId)}/adspixels`, {
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

  const finalAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  let response;
  try {
    response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(finalAdAccountId)}/campaigns`, {
      params: {
        fields: 'id,name,status,effective_status,objective',
        access_token: token,
        limit: 200,
        effective_status: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'PENDING_REVIEW', 'WITH_ISSUES'],
      },
    });
  } catch {
    response = await axios.get(`https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(finalAdAccountId)}/campaigns`, {
      params: { fields: 'id,name,status,effective_status,objective', access_token: token, limit: 200 },
    });
  }

  const adsets: any[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(finalAdAccountId)}/adsets`;
  let nextParams: any = { fields: 'campaign_id,optimization_goal,promoted_object', access_token: token, limit: 500 };
  while (nextUrl) {
    const adsetRes: any = await axios.get(nextUrl, nextParams ? { params: nextParams } : undefined);
    const data = Array.isArray(adsetRes.data?.data) ? adsetRes.data.data : [];
    adsets.push(...data);
    nextUrl = adsetRes.data?.paging?.next || null;
    nextParams = null;
  }

  const optByCampaign = new Map<
    string,
    { counts: Record<string, number>; promoted: Record<string, unknown> | null }
  >();

  for (const adset of adsets) {
    const campaignId = typeof adset.campaign_id === 'string' ? adset.campaign_id : null;
    if (!campaignId) continue;
    const opt = typeof adset.optimization_goal === 'string' ? adset.optimization_goal : null;
    const promoted =
      adset.promoted_object && typeof adset.promoted_object === 'object'
        ? (adset.promoted_object as Record<string, unknown>)
        : null;

    let entry = optByCampaign.get(campaignId);
    if (!entry) {
      entry = { counts: {}, promoted: null };
      optByCampaign.set(campaignId, entry);
    }

    if (opt) {
      entry.counts[opt] = (entry.counts[opt] || 0) + 1;
    }

    if (!entry.promoted && promoted) {
      entry.promoted = promoted;
    }
  }

  const campaigns = (response.data.data || []).map((c: any) => {
    const entry = c?.id ? optByCampaign.get(String(c.id)) : undefined;
    let optimizationGoal: string | null = null;
    if (entry) {
      let best = 0;
      for (const [key, count] of Object.entries(entry.counts)) {
        if (count > best) {
          best = count;
          optimizationGoal = key;
        }
      }
    }
    return {
      ...c,
      optimization_goal: optimizationGoal,
      promoted_object: entry?.promoted || null,
    };
  });

  return res.json({ campaigns });
});

router.get('/sites/:siteId/meta/adsets', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const campaignId = typeof req.query.campaign_id === 'string' ? req.query.campaign_id.trim() : '';
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const metaRow = await pool.query('SELECT fb_user_token_enc, ad_account_id FROM integrations_meta WHERE site_id = $1', [
    siteId,
  ]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  const adAccountId = String(req.query.ad_account_id || metaRow.rows[0]?.ad_account_id || '');
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });
  if (!adAccountId) return res.status(400).json({ error: 'Missing ad_account_id' });

  const finalAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  const adsets: any[] = [];
  let nextUrl: string | null = campaignId
    ? `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(campaignId)}/adsets`
    : `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(finalAdAccountId)}/adsets`;
  let nextParams: any = {
    fields: 'id,name,status,effective_status,campaign_id,optimization_goal,promoted_object',
    access_token: token,
    limit: 500,
  };
  while (nextUrl) {
    const adsetRes: any = await axios.get(nextUrl, nextParams ? { params: nextParams } : undefined);
    const data = Array.isArray(adsetRes.data?.data) ? adsetRes.data.data : [];
    adsets.push(...data);
    nextUrl = adsetRes.data?.paging?.next || null;
    nextParams = null;
  }

  return res.json({ adsets });
});

router.get('/sites/:siteId/meta/ads', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const adsetId = typeof req.query.adset_id === 'string' ? req.query.adset_id.trim() : '';
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!adsetId) return res.status(400).json({ error: 'Missing adset_id' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });

  const metaRow = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  const ads: any[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(adsetId)}/ads`;
  let nextParams: any = {
    fields: 'id,name,status,effective_status,adset_id,campaign_id',
    access_token: token,
    limit: 500,
  };
  while (nextUrl) {
    const adsRes: any = await axios.get(nextUrl, nextParams ? { params: nextParams } : undefined);
    const data = Array.isArray(adsRes.data?.data) ? adsRes.data.data : [];
    ads.push(...data);
    nextUrl = adsRes.data?.paging?.next || null;
    nextParams = null;
  }

  return res.json({ ads });
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

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  await axios.post(
    `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(campaignId)}`,
    null,
    { params: { status, access_token: token } }
  );

  return res.json({ ok: true });
});

router.patch('/sites/:siteId/meta/adsets/:adsetId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const adsetId = String(req.params.adsetId || '');
  const { status } = req.body || {};
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!adsetId) return res.status(400).json({ error: 'Invalid adsetId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });
  if (status !== 'PAUSED' && status !== 'ACTIVE') return res.status(400).json({ error: 'Invalid status' });

  const metaRow = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  await axios.post(
    `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(adsetId)}`,
    null,
    { params: { status, access_token: token } }
  );

  return res.json({ ok: true });
});

router.patch('/sites/:siteId/meta/ads/:adId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const adId = String(req.params.adId || '');
  const { status } = req.body || {};
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!adId) return res.status(400).json({ error: 'Invalid adId' });
  if (!(await requireSiteOwnership(auth.accountId, siteId))) return res.status(404).json({ error: 'Site not found' });
  if (status !== 'PAUSED' && status !== 'ACTIVE') return res.status(400).json({ error: 'Invalid status' });

  const metaRow = await pool.query('SELECT fb_user_token_enc FROM integrations_meta WHERE site_id = $1', [siteId]);
  const tokenEnc = metaRow.rows[0]?.fb_user_token_enc as string | undefined;
  if (!tokenEnc) return res.status(400).json({ error: 'Facebook not connected' });

  let token: string;
  try {
    token = decryptString(tokenEnc);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt Facebook token. Please reconnect.' });
  }

  await axios.post(
    `https://graph.facebook.com/${fbApiVersion}/${encodeURIComponent(adId)}`,
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
