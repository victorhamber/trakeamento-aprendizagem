import { Router, Request } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { encryptString } from '../lib/crypto';

const router = Router();

/** Janela de datas alinhada à aba Campanhas (presets + custom). */
export function parseMetaCampaignDateWindow(req: Request) {
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
    until = addDays(e, 1);
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

  return { since, until, preset, days, hasCustomRange, sinceRaw, untilRaw };
}

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

    const { ad_account_id, pixel_id, enabled } = req.body;
    const capi_token = req.body.capi_token ? String(req.body.capi_token).replace(/\s+/g, '') : undefined;
    const marketing_token = req.body.marketing_token ? String(req.body.marketing_token).replace(/\s+/g, '') : undefined;

    // Tokens CAPI válidos do Meta começam com EAA e têm 100+ chars. Ignorar valores curtos (browser autofill).
    const capiEnc = (capi_token && capi_token.length >= 20) ? encryptString(capi_token) : undefined;
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

    res.json({ success: true });
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

    const { since, until, preset, days, hasCustomRange, sinceRaw, untilRaw } = parseMetaCampaignDateWindow(req);

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

      if (customEventCount > 0 && (objective.includes('custom') || objective.includes('conversion') || results === 0)) {
        return {
          value: results > 0 ? results : customEventCount,
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

/** Métricas do site por utm_campaign (Pixel/CAPI) + investido quando bate com nome de campanha na Meta. */
router.get('/campaigns/first-party', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const siteRow = await pool.query(
      'SELECT site_key FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );
    if (!siteRow.rowCount) return res.status(404).json({ error: 'Site not found' });

    const siteKey = siteRow.rows[0].site_key as string;
    const { since, until, preset, days } = parseMetaCampaignDateWindow(req);

    const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

    const eventsResult = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(we.custom_data->>'utm_campaign'), ''), '') AS utm_key,
        COUNT(*) FILTER (WHERE we.event_name = 'PageView')::bigint AS visits,
        COUNT(*) FILTER (WHERE we.event_name = 'Lead')::bigint AS leads,
        COUNT(*) FILTER (WHERE we.event_name = 'InitiateCheckout')::bigint AS initiate_checkout,
        COUNT(*) FILTER (WHERE we.event_name = 'Purchase')::bigint AS purchases,
        COUNT(*) FILTER (WHERE we.event_name = 'AddToCart')::bigint AS add_to_cart,
        COUNT(*) FILTER (WHERE we.event_name = 'PageEngagement')::bigint AS page_engagement,
        COUNT(DISTINCT NULLIF(TRIM(COALESCE(we.user_data->>'fbp', we.user_data->>'external_id', '')), ''))::bigint AS unique_visitors
      FROM web_events we
      WHERE we.site_key = $1
        AND we.event_time >= $2
        AND we.event_time < $3
      GROUP BY 1
      ORDER BY
        COUNT(*) FILTER (WHERE we.event_name = 'PageView') DESC,
        COUNT(*) FILTER (WHERE we.event_name = 'Purchase') DESC
      `,
      [siteKey, since, until]
    );

    const metaCampaignAgg = await pool.query(
      `
      SELECT
        campaign_id,
        MAX(NULLIF(TRIM(campaign_name), '')) AS campaign_name,
        COALESCE(SUM(spend), 0)::numeric AS spend,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        COALESCE(SUM(leads), 0)::bigint AS leads,
        COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(impressions), 0)::bigint AS impressions
      FROM meta_insights_daily
      WHERE site_id = $1
        AND campaign_id IS NOT NULL
        AND adset_id IS NULL
        AND ad_id IS NULL
        AND date_start >= $2
        AND date_start < $3
      GROUP BY campaign_id
      `,
      [siteId, since, until]
    );

    type MetaCampRollup = {
      campaign_id: string;
      spend: number;
      purchases: number;
      initiates_checkout: number;
      leads: number;
      adds_to_cart: number;
      landing_page_views: number;
      link_clicks: number;
      unique_link_clicks: number;
      clicks: number;
      impressions: number;
    };

    const metaByNorm = new Map<string, MetaCampRollup>();
    for (const r of metaCampaignAgg.rows) {
      const name = String(r.campaign_name || '');
      const k = normKey(name);
      if (!k) continue;
      const prev = metaByNorm.get(k);
      const row: MetaCampRollup = {
        campaign_id: String(r.campaign_id),
        spend: Number(r.spend || 0),
        purchases: Number(r.purchases || 0),
        initiates_checkout: Number(r.initiates_checkout || 0),
        leads: Number(r.leads || 0),
        adds_to_cart: Number(r.adds_to_cart || 0),
        landing_page_views: Number(r.landing_page_views || 0),
        link_clicks: Number(r.link_clicks || 0),
        unique_link_clicks: Number(r.unique_link_clicks || 0),
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
      };
      if (!prev) {
        metaByNorm.set(k, row);
      } else {
        metaByNorm.set(k, {
          campaign_id: prev.campaign_id,
          spend: prev.spend + row.spend,
          purchases: prev.purchases + row.purchases,
          initiates_checkout: prev.initiates_checkout + row.initiates_checkout,
          leads: prev.leads + row.leads,
          adds_to_cart: prev.adds_to_cart + row.adds_to_cart,
          landing_page_views: prev.landing_page_views + row.landing_page_views,
          link_clicks: prev.link_clicks + row.link_clicks,
          unique_link_clicks: prev.unique_link_clicks + row.unique_link_clicks,
          clicks: prev.clicks + row.clicks,
          impressions: prev.impressions + row.impressions,
        });
      }
    }

    const purchaseOrdersResult = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(utm_campaign), ''), '') AS utm_key,
        COUNT(*)::bigint AS n
      FROM purchases
      WHERE site_key = $1
        AND COALESCE(platform_date, created_at) >= $2
        AND COALESCE(platform_date, created_at) < $3
        AND (
          status IS NULL
          OR LOWER(status) IN ('approved', 'paid', 'completed', 'active', 'confirmed', 'complete')
        )
      GROUP BY 1
      `,
      [siteKey, since, until]
    );
    const ordersByUtm = new Map<string, number>();
    for (const r of purchaseOrdersResult.rows) {
      ordersByUtm.set(String(r.utm_key || ''), Number(r.n || 0));
    }

    type Tier = 'strong' | 'medium' | 'low' | 'none';
    const raw = eventsResult.rows.map((row) => {
      const utmKey = String(row.utm_key || '');
      const visits = Number(row.visits || 0);
      const leadsWeb = Number(row.leads || 0);
      const purchasesWeb = Number(row.purchases || 0);
      const initiateWeb = Number(row.initiate_checkout || 0);
      const addToCartWeb = Number(row.add_to_cart || 0);
      const page_engagement = Number(row.page_engagement || 0);
      const unique_visitors = Number(row.unique_visitors || 0);
      const label = utmKey === '' ? 'Tráfego sem nome no link' : utmKey;
      const mk = normKey(utmKey);
      const metaM = mk && metaByNorm.has(mk) ? metaByNorm.get(mk)! : null;
      const ordersN = ordersByUtm.get(utmKey) ?? 0;

      const funnel_source: 'meta' | 'site' = metaM ? 'meta' : 'site';
      const leads = metaM ? metaM.leads : leadsWeb;
      const purchases = metaM
        ? metaM.purchases
        : Math.max(purchasesWeb, ordersN);
      const initiate_checkout = metaM ? metaM.initiates_checkout : initiateWeb;
      const add_to_cart = metaM ? metaM.adds_to_cart : addToCartWeb;
      const investido = metaM != null ? Math.round(metaM.spend * 100) / 100 : null;

      const convNumerator = purchases > 0 ? purchases : leads;
      const conversion_rate = visits > 0 ? (convNumerator / visits) * 100 : 0;
      const score =
        purchases * 10000 + leads * 100 + initiate_checkout * 10 + visits * 0.001 + add_to_cart;
      return {
        utm_campaign: utmKey || null,
        label,
        visits,
        unique_visitors,
        leads,
        purchases,
        initiate_checkout,
        add_to_cart,
        page_engagement,
        conversion_rate: Math.round(conversion_rate * 100) / 100,
        investido,
        funnel_source,
        meta_campaign_id: metaM?.campaign_id ?? null,
        purchases_web_events: purchasesWeb,
        purchases_orders_table: ordersN,
        score,
      };
    });

    const nonzero = raw.filter(
      (r) =>
        r.visits + r.leads + r.purchases + r.initiate_checkout + r.add_to_cart + r.page_engagement > 0
    );
    const sorted = [...nonzero].sort((a, b) => b.score - a.score);
    const n = sorted.length;
    const data = sorted.map((r, i) => {
      const { score, ...rest } = r;
      const total = r.visits + r.leads + r.purchases;
      let performance_tier: Tier = 'none';
      if (total === 0) performance_tier = 'none';
      else if (n <= 1) performance_tier = 'strong';
      else if (i < Math.ceil(n / 3)) performance_tier = 'strong';
      else if (i < Math.ceil((2 * n) / 3)) performance_tier = 'medium';
      else performance_tier = 'low';
      return { ...rest, performance_tier, rank: i + 1 };
    });

    const hasInsights = metaCampaignAgg.rows.length > 0;
    const matchedAny = data.some((row) => row.investido != null);
    const spend_source = matchedAny ? 'matched' : hasInsights ? 'unmatched' : 'none';

    res.json({
      data,
      days,
      preset,
      spend_source,
      meta_campaign_rows: metaCampaignAgg.rows.length,
      spend_matched_count: data.filter((row) => row.investido != null).length,
      top_label: data[0]?.label ?? null,
    });
  } catch (err: any) {
    console.error('campaigns/first-party error:', err);
    res.status(500).json({ error: err.message });
  }
});

function linkBaseFromRow(row: Record<string, unknown>) {
  const link = Number(row.link_clicks || 0);
  const ulink = Number(row.unique_link_clicks || 0);
  const clicks = Number(row.clicks || 0);
  return link > 0 ? link : ulink > 0 ? ulink : clicks;
}

/** Maior “perda” relativa entre etapas do funil Meta (para destacar gargalo). */
function computeFunnelBottleneck(row: Record<string, unknown>) {
  const impressions = Number(row.impressions || 0);
  const link = linkBaseFromRow(row);
  const lp = Number(row.landing_page_views || 0);
  const cart = Number(row.adds_to_cart || 0);
  const checkout = Number(row.initiates_checkout || 0);
  const purchases = Number(row.purchases || 0);

  const stages: { key: string; label: string; v: number }[] = [];
  if (impressions >= 50) stages.push({ key: 'imp', label: 'Impressões', v: impressions });
  if (link > 0) stages.push({ key: 'clk', label: 'Cliques no link', v: link });
  if (lp > 0 || link > 0) stages.push({ key: 'lp', label: 'Página (LP)', v: lp });
  if (cart > 0 || checkout > 0 || purchases > 0) stages.push({ key: 'cart', label: 'Carrinho', v: cart });
  stages.push({ key: 'co', label: 'Checkout', v: checkout });
  stages.push({ key: 'pur', label: 'Compras', v: purchases });

  const minFrom = 8;
  let worst: { from: string; to: string; drop_pct: number; severity: 'high' | 'medium' | 'low' } | null =
    null;
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i].v;
    const to = stages[i + 1].v;
    if (from < minFrom) continue;
    const drop = (1 - Math.min(1, to / from)) * 100;
    if (!worst || drop > worst.drop_pct) {
      let severity: 'high' | 'medium' | 'low' = 'low';
      if (drop >= 85) severity = 'high';
      else if (drop >= 50) severity = 'medium';
      worst = {
        from: stages[i].label,
        to: stages[i + 1].label,
        drop_pct: Math.round(drop * 10) / 10,
        severity,
      };
    }
  }

  if (checkout >= 5 && purchases === 0 && (!worst || worst.drop_pct < 50)) {
    worst = {
      from: 'Checkout',
      to: 'Compra',
      drop_pct: 100,
      severity: 'high',
    };
  }

  return worst;
}

function presentAndFutureHints(row: Record<string, unknown>) {
  const spend = Number(row.spend || 0);
  const purchases = Number(row.purchases || 0);
  const checkout = Number(row.initiates_checkout || 0);
  const link = linkBaseFromRow(row);
  const lp = Number(row.landing_page_views || 0);
  const impressions = Number(row.impressions || 0);
  const cpp = purchases > 0 ? spend / purchases : null;

  let present: 'strong' | 'ok' | 'weak' | 'idle' = 'idle';
  let present_label = 'Pouco volume ainda para julgar.';
  if (spend < 3 && link < 15 && impressions < 200) {
    present = 'idle';
    present_label = 'Quase sem gasto ou cliques neste período.';
  } else if (purchases >= 1 && cpp != null && cpp <= 450) {
    present = 'strong';
    present_label = 'Boa leitura agora: há vendas e custo por compra razoável.';
  } else if (purchases >= 1) {
    present = 'ok';
    present_label = 'Há vendas; vale acompanhar custo por compra.';
  } else if (checkout >= 8 && purchases === 0) {
    present = 'weak';
    present_label = 'Muita gente chega no checkout e não compra — foco na página de pagamento/oferta.';
  } else if (link >= 30 && lp / Math.max(link, 1) < 0.25) {
    present = 'weak';
    present_label = 'Cliques altos, pouca gente na página — criativo ou promessa pode não bater com a página.';
  } else if (link >= 20) {
    present = 'ok';
    present_label = 'Tem tráfego; ainda convertendo pouco — teste página e oferta.';
  }

  let future: 'promising' | 'uncertain' | 'limited' = 'uncertain';
  let future_label = 'Resultado depende de testes de página e oferta.';
  if (purchases === 0 && impressions > 2000 && link / Math.max(impressions, 1) < 0.008) {
    future = 'limited';
    future_label = 'CTR muito baixo: difícil escalar sem mudar criativo ou público.';
  } else if (purchases === 0 && lp > 80 && checkout > 0) {
    future = 'promising';
    future_label = 'Interesse na página existe; com ajuste de oferta/checkout pode melhorar.';
  } else if (purchases >= 2) {
    future = 'promising';
    future_label = 'Histórico de vendas ajuda o algoritmo; tende a ter mais estabilidade.';
  } else if (spend > 80 && purchases === 0) {
    future = 'limited';
    future_label = 'Já gastou bastante sem venda — revise funil antes de aumentar verba.';
  }

  return { present, present_label, future, future_label };
}

/** Funil por campanha / conjunto / anúncio (dados Meta Insights no DB). */
router.get('/campaigns/funnel-breakdown', requireAuth, async (req, res) => {
  try {
    const siteId = Number(req.query.site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const campaignId =
      typeof req.query.campaign_id === 'string' ? req.query.campaign_id.trim() : '';
    if (!campaignId) return res.status(400).json({ error: 'Missing campaign_id' });

    const levelRaw = (req.query.level as string) || 'campaign';
    const level = levelRaw === 'adset' || levelRaw === 'ad' ? levelRaw : 'campaign';
    const adsetId = typeof req.query.adset_id === 'string' ? req.query.adset_id.trim() : '';

    const auth = req.auth!;
    const owns = await pool.query(
      'SELECT id FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const { since, until, days, preset } = parseMetaCampaignDateWindow(req);

    let groupBy: string;
    let nameField: string;
    let idField: string;
    let levelFilter: string;
    const params: unknown[] = [siteId, since, until, campaignId];

    if (level === 'campaign') {
      groupBy = 'campaign_id';
      nameField = 'MAX(campaign_name) AS name';
      idField = 'campaign_id AS id';
      levelFilter = 'AND campaign_id = $4 AND adset_id IS NULL AND ad_id IS NULL';
    } else if (level === 'adset') {
      groupBy = 'adset_id';
      nameField = 'MAX(adset_name) AS name';
      idField = 'adset_id AS id';
      levelFilter = 'AND campaign_id = $4 AND adset_id IS NOT NULL AND ad_id IS NULL';
    } else {
      groupBy = 'ad_id';
      nameField = 'MAX(ad_name) AS name';
      idField = 'ad_id AS id';
      if (adsetId) {
        levelFilter = 'AND campaign_id = $4 AND adset_id = $5 AND ad_id IS NOT NULL';
        params.push(adsetId);
      } else {
        levelFilter = 'AND campaign_id = $4 AND ad_id IS NOT NULL';
      }
    }

    const result = await pool.query(
      `
      SELECT
        ${idField},
        ${nameField},
        COALESCE(SUM(spend), 0)::numeric AS spend,
        COALESCE(SUM(impressions), 0)::bigint AS impressions,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(leads), 0)::bigint AS leads,
        COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        COALESCE(SUM(purchases), 0)::bigint AS purchases
      FROM meta_insights_daily
      WHERE site_id = $1
        AND date_start >= $2
        AND date_start < $3
        ${levelFilter}
      GROUP BY ${groupBy}
      ORDER BY spend DESC NULLS LAST, impressions DESC
      `,
      params
    );

    const rows = result.rows.map((r) => {
      const o = { ...r, spend: Number(r.spend || 0) };
      const bottleneck = computeFunnelBottleneck(o);
      const hints = presentAndFutureHints(o);
      const link = linkBaseFromRow(o);
      const lp = Number(r.landing_page_views || 0);
      const checkout = Number(r.initiates_checkout || 0);
      const purchases = Number(r.purchases || 0);
      const funnel = {
        link_clicks: link,
        landing_page_views: lp,
        adds_to_cart: Number(r.adds_to_cart || 0),
        initiates_checkout: checkout,
        purchases,
        impressions: Number(r.impressions || 0),
      };
      const lp_rate_pct = link > 0 ? Math.round((lp / link) * 1000) / 10 : 0;
      const checkout_rate_pct = lp > 0 ? Math.round((checkout / lp) * 1000) / 10 : 0;
      const purchase_rate_pct = checkout > 0 ? Math.round((purchases / checkout) * 1000) / 10 : 0;

      return {
        id: r.id,
        name: r.name || '—',
        spend: o.spend,
        funnel,
        funnel_rates: {
          lp_from_clicks_pct: lp_rate_pct,
          checkout_from_lp_pct: checkout_rate_pct,
          purchase_from_checkout_pct: purchase_rate_pct,
        },
        bottleneck,
        ...hints,
      };
    });

    res.json({
      campaign_id: campaignId,
      level,
      days,
      preset,
      adset_id: adsetId || null,
      rows,
    });
  } catch (err: any) {
    console.error('campaigns/funnel-breakdown error:', err);
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
