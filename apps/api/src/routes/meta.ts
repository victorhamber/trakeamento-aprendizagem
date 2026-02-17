import { Router } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { encryptString } from '../lib/crypto';

const router = Router();

router.put('/', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const { ad_account_id, pixel_id, capi_token, marketing_token, enabled } = req.body;

    // Fetch existing config to preserve tokens if not provided
    const existing = await pool.query('SELECT meta_config FROM sites WHERE id = $1', [siteId]);
    const currentConfig = existing.rows[0]?.meta_config || {};

    const newConfig = {
      ...currentConfig,
      ad_account_id: ad_account_id || currentConfig.ad_account_id,
      pixel_id: pixel_id || currentConfig.pixel_id,
      enabled: enabled !== undefined ? enabled : currentConfig.enabled,
    };

    if (capi_token) newConfig.capi_token = capi_token;
    if (marketing_token) newConfig.marketing_token = marketing_token;

    await pool.query('UPDATE sites SET meta_config = $1 WHERE id = $2', [newConfig, siteId]);

    // Also update integrations_meta table for consistency
    const capiEnc = capi_token ? encryptString(capi_token) : undefined;
    const marketingEnc = marketing_token ? encryptString(marketing_token) : undefined;
    
    await pool.query(
      `INSERT INTO integrations_meta (site_id, pixel_id, capi_token_enc, marketing_token_enc, ad_account_id, enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (site_id) DO UPDATE SET
         pixel_id = COALESCE($2, integrations_meta.pixel_id),
         capi_token_enc = COALESCE($3, integrations_meta.capi_token_enc),
         marketing_token_enc = COALESCE($4, integrations_meta.marketing_token_enc),
         ad_account_id = COALESCE($5, integrations_meta.ad_account_id),
         enabled = COALESCE($6, integrations_meta.enabled),
         updated_at = NOW()`,
      [siteId, pixel_id, capiEnc, marketingEnc, ad_account_id, enabled]
    );

    res.json({ success: true, meta: newConfig });
  } catch (err: any) {
    console.error('Update Meta config error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/metrics', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const level = (req.query.level as string) || 'campaign'; // campaign, adset, ad
    const parentId = (req.query.parent_id as string) || null;

    const parseDate = (value: string) => {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const datePresetRaw = typeof req.query.date_preset === 'string' ? req.query.date_preset.trim() : '';
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
    const untilRaw = typeof req.query.until === 'string' ? req.query.until.trim() : '';
    const customSince = sinceRaw ? parseDate(sinceRaw) : null;
    const customUntil = untilRaw ? parseDate(untilRaw) : null;
    const hasCustomRange = !!customSince && !!customUntil;
    const now = new Date();

    let since: Date;
    let until: Date;
    let preset = 'last_7d';
    let days = 7;

    if (hasCustomRange) {
      const start = customSince!.getTime() > customUntil!.getTime() ? customUntil! : customSince!;
      const end = customSince!.getTime() > customUntil!.getTime() ? customSince! : customUntil!;
      since = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      until = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
      preset = 'custom';
      days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)));
    } else if (datePresetRaw) {
      preset = datePresetRaw;
      if (datePresetRaw === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        days = 1;
      } else if (datePresetRaw === 'yesterday') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        until = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        days = 1;
      } else if (datePresetRaw === 'last_14d') {
        days = 14;
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        until = now;
      } else if (datePresetRaw === 'last_30d') {
        days = 30;
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        until = now;
      } else if (datePresetRaw === 'maximum') {
        since = new Date('2000-01-01T00:00:00Z');
        until = now;
        days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)));
      } else {
        days = 7;
        since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        until = now;
        preset = 'last_7d';
      }
    } else {
      const daysRaw = Number(req.query.days || 7);
      days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;
      since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      until = now;
      preset = days <= 7 ? 'last_7d' : days <= 14 ? 'last_14d' : days <= 30 ? 'last_30d' : 'last_30d';
    }

    let metaError: string | null = null;

    const queryMetrics = async () => {
      let groupBy = 'campaign_id';
      let nameField = 'MAX(campaign_name) AS name';
      let idField = 'campaign_id AS id';
      let whereClause = 'AND campaign_id IS NOT NULL';

      if (level === 'adset') {
        groupBy = 'adset_id';
        nameField = 'MAX(adset_name) AS name';
        idField = 'adset_id AS id';
        whereClause = 'AND adset_id IS NOT NULL';
        if (parentId) {
          whereClause += ` AND campaign_id = '${parentId}'`;
        }
      } else if (level === 'ad') {
        groupBy = 'ad_id';
        nameField = 'MAX(ad_name) AS name';
        idField = 'ad_id AS id';
        whereClause = 'AND ad_id IS NOT NULL';
        if (parentId) {
          whereClause += ` AND adset_id = '${parentId}'`;
        }
      }

      return pool.query(
        `
        SELECT
          ${idField},
          ${nameField},
          COALESCE(SUM(spend), 0)::numeric AS spend,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint AS clicks,
          COALESCE(SUM(unique_clicks), 0)::bigint AS unique_clicks,
          COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint AS outbound_clicks,
          COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
          COALESCE(SUM(leads), 0)::bigint AS leads,
          COALESCE(SUM(contacts), 0)::bigint AS contacts,
          COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
          COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
          COALESCE(SUM(purchases), 0)::bigint AS purchases
        FROM meta_insights_daily
        WHERE site_id = $1
          ${whereClause}
          AND date_start >= $2
          AND date_start < $3
        GROUP BY ${groupBy}
        ORDER BY spend DESC, impressions DESC
        `,
        [siteId, since, until]
      );
    };

    let result = await queryMetrics();

    if (!(result.rowCount || 0)) {
      try {
        await metaMarketingService.syncDailyInsights(siteId, preset, hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined);
      } catch (err: any) {
        metaError =
          err?.response?.data?.error?.message ||
          err?.response?.data?.error?.error_user_msg ||
          err?.response?.data?.error?.error_user_title ||
          err?.message ||
          'Falha ao sincronizar dados da Meta.';
      }
      result = await queryMetrics();
    }

    // Se ainda vazio, tenta fetch live (apenas se level for campaign, para simplificar fallback)
    if (!(result.rowCount || 0) && level === 'campaign') {
       // ... existing fallback logic for campaign ...
       // (Mantido simples por enquanto, idealmente o syncDailyInsights já resolve tudo)
    }

    const rows = result.rows.map((row) => {
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const clicks = Number(row.clicks || 0);
      const uniqueClicks = Number(row.unique_clicks || 0);
      const uniqueLinkClicks = Number(row.unique_link_clicks || 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      return {
        id: row.id,
        name: row.name,
        spend,
        impressions,
        clicks,
        unique_clicks: uniqueClicks,
        unique_link_clicks: uniqueLinkClicks,
        ctr,
        cpc,
        cpm,
        outbound_clicks: Number(row.outbound_clicks || 0),
        landing_page_views: Number(row.landing_page_views || 0),
        contacts: Number(row.contacts || 0),
        leads: Number(row.leads || 0),
        adds_to_cart: Number(row.adds_to_cart || 0),
        initiates_checkout: Number(row.initiates_checkout || 0),
        purchases: Number(row.purchases || 0),
      };
    });

    res.json({ data: rows, days, meta_error: metaError });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { date_preset, site_id } = req.body || {};
    const siteId = Number(site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const preset = typeof date_preset === 'string' && date_preset.trim() ? date_preset.trim() : 'last_7d';
    const result = await metaMarketingService.syncDailyInsights(siteId, preset);
    res.json({ status: 'success', synced_records: result?.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
