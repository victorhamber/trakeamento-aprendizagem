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
    const owns = await pool.query(
      'SELECT id FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const { ad_account_id, pixel_id, capi_token, marketing_token, enabled } = req.body;

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
    const owns = await pool.query(
      'SELECT id FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const level = (req.query.level as string) || 'campaign';
    const parentId = typeof req.query.parent_id === 'string' ? req.query.parent_id.trim() : null;

    const parseDate = (value: string) => {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const datePresetRaw =
      typeof req.query.date_preset === 'string' ? req.query.date_preset.trim() : '';
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
    const untilRaw = typeof req.query.until === 'string' ? req.query.until.trim() : '';
    const customSince = sinceRaw ? parseDate(sinceRaw) : null;
    const customUntil = untilRaw ? parseDate(untilRaw) : null;
    const hasCustomRange = !!customSince && !!customUntil;
    const now = new Date();

    // Helper: normalize to start-of-day to avoid fractional-hour issues
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d: Date, n: number) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

    let since: Date;
    let until: Date;
    let preset = 'last_7d';
    let days = 7;

    if (hasCustomRange) {
      const s = startOfDay(customSince!.getTime() <= customUntil!.getTime() ? customSince! : customUntil!);
      const e = startOfDay(customSince!.getTime() <= customUntil!.getTime() ? customUntil! : customSince!);
      since = s;
      until = addDays(e, 1); // exclusive upper bound
      preset = 'custom';
      days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
    } else if (datePresetRaw) {
      preset = datePresetRaw;
      const today = startOfDay(now);
      if (datePresetRaw === 'today') {
        since = today;
        until = addDays(today, 1);
        days = 1;
      } else if (datePresetRaw === 'yesterday') {
        since = addDays(today, -1);
        until = today;
        days = 1;
      } else if (datePresetRaw === 'last_7d') {
        days = 7;
        since = addDays(today, -days);
        until = addDays(today, 1);
      } else if (datePresetRaw === 'last_14d') {
        days = 14;
        since = addDays(today, -days);
        until = addDays(today, 1);
      } else if (datePresetRaw === 'last_30d') {
        days = 30;
        since = addDays(today, -days);
        until = addDays(today, 1);
      } else if (datePresetRaw === 'maximum') {
        since = new Date('2000-01-01T00:00:00Z');
        until = addDays(today, 1);
        days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
      } else {
        // Unknown preset — default to last_7d
        days = 7;
        since = addDays(startOfDay(now), -days);
        until = addDays(startOfDay(now), 1);
        preset = 'last_7d';
      }
    } else {
      const daysRaw = Number(req.query.days || 7);
      days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;
      since = addDays(startOfDay(now), -days);
      until = addDays(startOfDay(now), 1);
      preset = days <= 7 ? 'last_7d' : days <= 14 ? 'last_14d' : 'last_30d';
    }

    let metaError: string | null = null;
    const forceSync =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      req.query.force === 'yes';

    // ── Build query with parameterized parentId (no SQL injection) ──────────
    const resolveObjectiveMetric = (row: Record<string, any>) => {
      const objective = String(row.objective || '').toLowerCase();
      const leads = Number(row.leads || 0);
      const purchases = Number(row.purchases || 0);
      const initiatesCheckout = Number(row.initiates_checkout || 0);
      const contacts = Number(row.contacts || 0);
      const uniqueLinkClicks = Number(row.unique_link_clicks || 0);
      const clicks = Number(row.clicks || 0);
      const reach = Number(row.reach || 0);
      const results = Number(row.results || 0);
      const customEventCount = Number(row.custom_event_count || 0);
      const customEventName = row.custom_event_name ? String(row.custom_event_name) : '';

      if (customEventCount > 0 && (objective.includes('custom') || objective.includes('conversion'))) {
        return {
          value: customEventCount,
          label: customEventName ? `Evento ${customEventName}` : 'Evento personalizado',
        };
      }
      if (objective.includes('lead')) return { value: leads, label: 'Leads' };
      if (objective.includes('purchase') || objective.includes('sale')) return { value: purchases, label: 'Compras' };
      if (objective.includes('checkout') || objective.includes('initiate')) {
        return { value: initiatesCheckout, label: 'Finalizações' };
      }
      if (objective.includes('message') || objective.includes('messaging') || objective.includes('contact')) {
        return { value: contacts, label: 'Contatos' };
      }
      if (objective.includes('traffic') || objective.includes('link_click')) {
        const val = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
        return { value: val, label: 'Cliques no link' };
      }
      if (objective.includes('engagement')) return { value: clicks, label: 'Engajamentos' };
      if (objective.includes('awareness') || objective.includes('reach') || objective.includes('brand')) {
        return { value: reach, label: 'Alcance' };
      }
      if (results > 0) return { value: results, label: 'Resultados' };
      if (purchases > 0) return { value: purchases, label: 'Compras' };
      if (leads > 0) return { value: leads, label: 'Leads' };
      if (contacts > 0) return { value: contacts, label: 'Contatos' };
      if (initiatesCheckout > 0) return { value: initiatesCheckout, label: 'Finalizações' };
      return { value: 0, label: 'Objetivo' };
    };

    const queryMetrics = async () => {
      let groupBy: string;
      let nameField: string;
      let idField: string;
      let levelFilter: string;
      const params: unknown[] = [siteId, since, until];

      if (level === 'adset') {
        groupBy = 'adset_id';
        nameField = 'MAX(adset_name) AS name';
        idField = 'adset_id AS id';
        if (parentId) {
          levelFilter = 'AND adset_id IS NOT NULL AND campaign_id = $4 AND ad_id IS NULL';
          params.push(parentId);
        } else {
          levelFilter = 'AND adset_id IS NOT NULL AND ad_id IS NULL';
        }
      } else if (level === 'ad') {
        groupBy = 'ad_id';
        nameField = 'MAX(ad_name) AS name';
        idField = 'ad_id AS id';
        if (parentId) {
          levelFilter = 'AND ad_id IS NOT NULL AND adset_id = $4';
          params.push(parentId);
        } else {
          levelFilter = 'AND ad_id IS NOT NULL';
        }
      } else {
        // campaign (default)
        groupBy = 'campaign_id';
        nameField = 'MAX(campaign_name) AS name';
        idField = 'campaign_id AS id';
        levelFilter = 'AND campaign_id IS NOT NULL AND adset_id IS NULL AND ad_id IS NULL';
      }

      return pool.query(
        `
        SELECT
          ${idField},
          ${nameField},
          MAX(objective)                                  AS objective,
          COALESCE(SUM(results), 0)::bigint               AS results,
          COALESCE(SUM(spend), 0)::numeric              AS spend,
          COALESCE(SUM(impressions), 0)::bigint          AS impressions,
          COALESCE(SUM(frequency), 0)::numeric           AS frequency,
          COALESCE(SUM(clicks), 0)::bigint               AS clicks,
          COALESCE(SUM(unique_clicks), 0)::bigint        AS unique_clicks,
          COALESCE(SUM(link_clicks), 0)::bigint          AS link_clicks,
          COALESCE(SUM(unique_link_clicks), 0)::bigint   AS unique_link_clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint      AS outbound_clicks,
          COALESCE(SUM(video_3s_views), 0)::bigint       AS video_3s_views,
          COALESCE(SUM(landing_page_views), 0)::bigint   AS landing_page_views,
          COALESCE(SUM(reach), 0)::bigint                AS reach,
          COALESCE(SUM(leads), 0)::bigint                AS leads,
          COALESCE(SUM(contacts), 0)::bigint             AS contacts,
          COALESCE(SUM(adds_to_cart), 0)::bigint         AS adds_to_cart,
          COALESCE(SUM(initiates_checkout), 0)::bigint   AS initiates_checkout,
          COALESCE(SUM(purchases), 0)::bigint            AS purchases,
          COALESCE(SUM(custom_event_count), 0)::bigint   AS custom_event_count,
          MAX(custom_event_name)                         AS custom_event_name
        FROM meta_insights_daily
        WHERE site_id = $1
          ${levelFilter}
          AND date_start >= $2
          AND date_start < $3
        GROUP BY ${groupBy}
        ORDER BY spend DESC, impressions DESC
        `,
        params
      );
    };

    if (forceSync) {
      try {
        await metaMarketingService.syncDailyInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
      } catch (err: any) {
        metaError =
          err?.response?.data?.error?.message ||
          err?.response?.data?.error?.error_user_msg ||
          err?.response?.data?.error?.error_user_title ||
          err?.message ||
          'Falha ao sincronizar dados da Meta.';
      }
    }

    let result = await queryMetrics();

    // ── Sync from Meta if DB is empty ────────────────────────────────────────
    if (!forceSync && !(result.rowCount || 0)) {
      try {
        await metaMarketingService.syncDailyInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
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

    // ── Fallback: live fetch for campaign level if still empty ───────────────
    if (!(result.rowCount || 0) && level === 'campaign' && !metaError) {
      try {
        const liveRows = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
        if (liveRows.length) {
          const mapped = liveRows.map((row: any) => {
            const resolved = resolveObjectiveMetric(row);
            const impressions = Number(row.impressions || 0);
            const video3sViews = Number(row.video_3s_views || 0);
            const hookRate = impressions > 0 ? (video3sViews / impressions) * 100 : 0;
            return {
              ...row,
              objective_metric: resolved.value,
              objective_metric_label: resolved.label,
              frequency: Number(row.frequency || 0),
              hook_rate: hookRate,
            };
          });
          return res.json({ data: mapped, days, meta_error: null, source: 'live' });
        }
      } catch (err: any) {
        metaError =
          err?.response?.data?.error?.message ||
          err?.message ||
          'Falha ao buscar dados ao vivo da Meta.';
      }
    }

    // ── Map DB rows to response ───────────────────────────────────────────────
    const rows = result.rows.map((row) => {
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const reach = Number(row.reach || 0);
      const clicks = Number(row.clicks || 0);
      const uniqueClicks = Number(row.unique_clicks || 0);
      const linkClicks = Number(row.link_clicks || 0);
      const uniqueLinkClicks = Number(row.unique_link_clicks || 0);
      const video3sViews = Number(row.video_3s_views || 0);
      // Derive CTR/CPC/CPM from aggregated sums (weighted correctly)
      const linkBase = linkClicks > 0 ? linkClicks : uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
      const ctr = impressions > 0 ? (linkBase / impressions) * 100 : 0;
      const cpc = linkBase > 0 ? spend / linkBase : 0;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const hookRate = impressions > 0 ? (video3sViews / impressions) * 100 : 0;
      const frequency = reach > 0 ? impressions / reach : 0;

      const resolved = resolveObjectiveMetric(row);
      return {
        id: row.id,
        name: row.name,
        objective: row.objective || null,
        results: Number(row.results || 0),
        spend,
        impressions,
        frequency,
        clicks,
        unique_clicks: uniqueClicks,
        link_clicks: linkClicks,
        unique_link_clicks: uniqueLinkClicks,
        video_3s_views: video3sViews,
        ctr,
        cpc,
        cpm,
        hook_rate: hookRate,
        outbound_clicks: Number(row.outbound_clicks || 0),
        landing_page_views: Number(row.landing_page_views || 0),
        reach,
        contacts: Number(row.contacts || 0),
        leads: Number(row.leads || 0),
        adds_to_cart: Number(row.adds_to_cart || 0),
        initiates_checkout: Number(row.initiates_checkout || 0),
        purchases: Number(row.purchases || 0),
        custom_event_name: row.custom_event_name || null,
        custom_event_count: Number(row.custom_event_count || 0),
        objective_metric: resolved.value,
        objective_metric_label: resolved.label,
      };
    });

    res.json({ data: rows, days, meta_error: metaError });
  } catch (err: any) {
    console.error('campaigns/metrics error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { date_preset, site_id } = req.body || {};
    const siteId = Number(site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query(
      'SELECT id FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const preset =
      typeof date_preset === 'string' && date_preset.trim() ? date_preset.trim() : 'last_7d';
    const result = await metaMarketingService.syncDailyInsights(siteId, preset);
    res.json({ status: 'success', synced_records: result?.count });
  } catch (err: any) {
    console.error('meta/sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
