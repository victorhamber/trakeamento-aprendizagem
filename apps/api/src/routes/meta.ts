import { Router } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/campaigns/metrics', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    const daysRaw = Number(req.query.days || 7);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const preset = days <= 7 ? 'last_7d' : days <= 30 ? 'last_30d' : days <= 90 ? 'last_90d' : 'last_30d';

    const queryMetrics = async () =>
      pool.query(
        `
        SELECT
          campaign_id,
          MAX(campaign_name) AS campaign_name,
          COALESCE(SUM(spend), 0)::numeric AS spend,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint AS clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint AS outbound_clicks,
          COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
          COALESCE(SUM(leads), 0)::bigint AS leads,
          COALESCE(SUM(purchases), 0)::bigint AS purchases
        FROM meta_insights_daily
        WHERE site_id = $1
          AND campaign_id IS NOT NULL
          AND date_start >= $2
        GROUP BY campaign_id
        ORDER BY spend DESC, impressions DESC
        `,
        [siteId, since]
      );

    let result = await queryMetrics();

    if (!(result.rowCount || 0)) {
      await metaMarketingService.syncDailyInsights(siteId, preset);
      result = await queryMetrics();
    }

    if (!(result.rowCount || 0)) {
      const liveRows = await metaMarketingService.fetchCampaignInsights(siteId, preset);
      return res.json({ campaigns: liveRows, days });
    }

    const rows = result.rows.map((row) => {
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const clicks = Number(row.clicks || 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      return {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        spend,
        impressions,
        clicks,
        ctr,
        cpc,
        cpm,
        outbound_clicks: Number(row.outbound_clicks || 0),
        landing_page_views: Number(row.landing_page_views || 0),
        leads: Number(row.leads || 0),
        purchases: Number(row.purchases || 0),
      };
    });

    res.json({ campaigns: rows, days });
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
