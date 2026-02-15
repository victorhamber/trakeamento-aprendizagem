import { Router } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/campaigns/metrics', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

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

    const queryMetrics = async () =>
      pool.query(
        `
        SELECT
          campaign_id,
          MAX(campaign_name) AS campaign_name,
          COALESCE(SUM(spend), 0)::numeric AS spend,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint AS clicks,
          COALESCE(SUM(unique_clicks), 0)::bigint AS unique_clicks,
          COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint AS outbound_clicks,
          COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
          COALESCE(SUM(leads), 0)::bigint AS leads,
          COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
          COALESCE(SUM(purchases), 0)::bigint AS purchases
        FROM meta_insights_daily
        WHERE site_id = $1
          AND campaign_id IS NOT NULL
          AND date_start >= $2
          AND date_start < $3
        GROUP BY campaign_id
        ORDER BY spend DESC, impressions DESC
        `,
        [siteId, since, until]
      );

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

    if (!(result.rowCount || 0)) {
      try {
        const liveRows = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
        if (liveRows.length) return res.json({ campaigns: liveRows, days });
      } catch (err: any) {
        metaError =
          metaError ||
          err?.response?.data?.error?.message ||
          err?.response?.data?.error?.error_user_msg ||
          err?.response?.data?.error?.error_user_title ||
          err?.message ||
          'Falha ao consultar campanhas na Meta.';
      }
      return res.json({ campaigns: [], days, meta_error: metaError });
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
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
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
        leads: Number(row.leads || 0),
        initiates_checkout: Number(row.initiates_checkout || 0),
        purchases: Number(row.purchases || 0),
      };
    });

    res.json({ campaigns: rows, days, meta_error: metaError });
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
