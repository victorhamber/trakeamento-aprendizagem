import { pool } from '../db/pool';
import { llmService } from './llm';
import { metaMarketingService } from './meta-marketing';

export class DiagnosisService {
  public async generateReport(
    siteKey: string,
    days = 7,
    campaignId?: string | null,
    options?: { datePreset?: string; since?: string; until?: string }
  ) {
    const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
    const siteId = siteRow.rowCount ? (siteRow.rows[0].id as number) : null;
    const parseDate = (value: string) => {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const datePresetRaw = options?.datePreset?.trim() || '';
    const sinceRaw = options?.since?.trim() || '';
    const untilRaw = options?.until?.trim() || '';
    const customSince = sinceRaw ? parseDate(sinceRaw) : null;
    const customUntil = untilRaw ? parseDate(untilRaw) : null;
    const hasCustomRange = !!customSince && !!customUntil;
    const now = new Date();

    let since: Date;
    let until: Date;
    let preset = 'last_7d';
    let daysNum = Number.isFinite(Number(days)) ? Math.min(90, Math.max(1, Math.trunc(Number(days)))) : 7;

    if (hasCustomRange) {
      const start = customSince!.getTime() > customUntil!.getTime() ? customUntil! : customSince!;
      const end = customSince!.getTime() > customUntil!.getTime() ? customSince! : customUntil!;
      since = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      until = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
      preset = 'custom';
      daysNum = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)));
    } else if (datePresetRaw) {
      preset = datePresetRaw;
      if (datePresetRaw === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        daysNum = 1;
      } else if (datePresetRaw === 'yesterday') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        until = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        daysNum = 1;
      } else if (datePresetRaw === 'last_14d') {
        daysNum = 14;
        since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
        until = now;
      } else if (datePresetRaw === 'last_30d') {
        daysNum = 30;
        since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
        until = now;
      } else if (datePresetRaw === 'maximum') {
        since = new Date('2000-01-01T00:00:00Z');
        until = now;
        daysNum = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)));
      } else {
        daysNum = 7;
        since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
        until = now;
        preset = 'last_7d';
      }
    } else {
      daysNum = Number.isFinite(Number(days)) ? Math.min(90, Math.max(1, Math.trunc(Number(days)))) : 7;
      since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      until = now;
      preset = daysNum <= 7 ? 'last_7d' : daysNum <= 14 ? 'last_14d' : daysNum <= 30 ? 'last_30d' : 'last_30d';
    }

    const metaAgg = await pool.query(
      `
      SELECT
        COALESCE(SUM(spend), 0)::numeric AS spend,
        COALESCE(SUM(impressions), 0)::bigint AS impressions,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(unique_clicks), 0)::bigint AS unique_clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(inline_link_clicks), 0)::bigint AS inline_link_clicks,
        COALESCE(SUM(outbound_clicks), 0)::bigint AS outbound_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(reach), 0)::bigint AS reach,
        AVG(frequency)::numeric AS frequency_avg,
        AVG(cpc)::numeric AS cpc_avg,
        AVG(ctr)::numeric AS ctr_avg,
        AVG(unique_ctr)::numeric AS unique_ctr_avg,
        AVG(cpm)::numeric AS cpm_avg,
        COALESCE(SUM(leads), 0)::bigint AS leads,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        AVG(cost_per_lead)::numeric AS cost_per_lead_avg,
        AVG(cost_per_purchase)::numeric AS cost_per_purchase_avg
      FROM meta_insights_daily
      WHERE site_id = $1 AND date_start >= $2 AND date_start < $3
      ${campaignId ? 'AND campaign_id = $4' : ''}
      `,
      campaignId ? [siteId || 0, since, until, campaignId] : [siteId || 0, since, until]
    );

    const sitePageViews = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS pageviews,
        AVG(
          CASE
            WHEN (telemetry->>'load_time_ms') IS NULL THEN NULL
            WHEN (telemetry->>'load_time_ms')::numeric = 0 THEN NULL
            ELSE (telemetry->>'load_time_ms')::numeric
          END
        )::numeric AS avg_load_time_ms
      FROM web_events
      WHERE site_key = $1
        AND event_name = 'PageView'
        AND event_time >= $2
        AND event_time < $3
      `,
      [siteKey, since, until]
    );

    const siteEngagement = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS engagement_events,
        AVG(
          CASE
            WHEN (telemetry->>'dwell_time_ms') IS NULL THEN NULL
            WHEN (telemetry->>'dwell_time_ms')::numeric = 0 THEN NULL
            ELSE (telemetry->>'dwell_time_ms')::numeric
          END
        )::numeric AS avg_dwell_time_ms,
        AVG(
          CASE
            WHEN (telemetry->>'max_scroll_pct') IS NULL THEN NULL
            WHEN (telemetry->>'max_scroll_pct')::numeric = 0 THEN NULL
            ELSE (telemetry->>'max_scroll_pct')::numeric
          END
        )::numeric AS avg_max_scroll_pct,
        COALESCE(SUM((telemetry->>'clicks_total')::int), 0)::bigint AS clicks_total,
        COALESCE(SUM((telemetry->>'clicks_cta')::int), 0)::bigint AS clicks_cta,
        COALESCE(SUM(CASE
          WHEN (telemetry->>'dwell_time_ms')::numeric < 5000
            AND COALESCE((telemetry->>'max_scroll_pct')::numeric, 0) < 10
            AND COALESCE((telemetry->>'clicks_total')::int, 0) = 0
          THEN 1 ELSE 0 END), 0)::bigint AS bounces_est
      FROM web_events
      WHERE site_key = $1
        AND event_name = 'PageEngagement'
        AND event_time >= $2
        AND event_time < $3
      `,
      [siteKey, since, until]
    );

    const salesData = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS sales,
        COALESCE(SUM(amount), 0)::numeric AS revenue
      FROM purchases
      WHERE site_key = $1 AND created_at >= $2 AND created_at < $3
      `,
      [siteKey, since, until]
    );

    const m = metaAgg.rows[0] || {};
    const pv = sitePageViews.rows[0] || {};
    const se = siteEngagement.rows[0] || {};
    const s = salesData.rows[0] || {};

    let spend = Number(m.spend || 0);
    let impressions = Number(m.impressions || 0);
    let clicks = Number(m.clicks || 0);
    let uniqueClicks = Number(m.unique_clicks || 0);
    let uniqueLinkClicks = Number(m.unique_link_clicks || 0);
    let outboundClicks = Number(m.outbound_clicks || 0);
    let landingPageViews = Number(m.landing_page_views || 0);
    let leads = Number(m.leads || 0);
    let initiatesCheckout = Number(m.initiates_checkout || 0);
    let purchases = Number(m.purchases || 0);

    const hasMetaData = spend > 0 || impressions > 0 || clicks > 0 || landingPageViews > 0;
    if (!hasMetaData && campaignId && siteId) {
      try {
        const liveRows = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
        const live = liveRows.find((row: { campaign_id?: string }) => row.campaign_id === campaignId);
        if (live) {
          spend = Number(live.spend || 0);
          impressions = Number(live.impressions || 0);
          clicks = Number(live.clicks || 0);
          uniqueClicks = Number(live.unique_clicks || 0);
          uniqueLinkClicks = Number(live.unique_link_clicks || 0);
          outboundClicks = Number(live.outbound_clicks || 0);
          landingPageViews = Number(live.landing_page_views || 0);
          leads = Number(live.leads || 0);
          initiatesCheckout = Number(live.initiates_checkout || 0);
          purchases = Number(live.purchases || 0);
        }
      } catch (err) {
        void err;
      }
    }

    const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
    const pct = (n: number) => Math.round(n * 10000) / 100;

    const baseClicks = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
    const resultMetric = purchases > 0 ? purchases : leads > 0 ? leads : landingPageViews;
    const derived = {
      ctr_calc_pct: pct(safeDiv(clicks, impressions)),
      cpm_calc: Math.round(safeDiv(spend, impressions) * 1000 * 100) / 100,
      cpc_calc: Math.round(safeDiv(spend, clicks) * 100) / 100,
      click_to_lp_rate_pct: pct(safeDiv(landingPageViews, baseClicks)),
      connect_rate_pct: pct(safeDiv(landingPageViews, baseClicks)),
      result_metric: resultMetric,
      lp_to_purchase_rate_pct: pct(safeDiv(Number(s.sales || 0), landingPageViews)),
      pv_to_purchase_rate_pct: pct(safeDiv(Number(s.sales || 0), Number(pv.pageviews || 0))),
      cta_per_engagement: Math.round(safeDiv(Number(se.clicks_cta || 0), Number(se.engagement_events || 0)) * 1000) / 1000,
      bounce_est_rate_pct: pct(safeDiv(Number(se.bounces_est || 0), Number(se.engagement_events || 0))),
    };

    const signals: Array<{ area: string; signal: string; weight: number; evidence: string }> = [];

    if (spend <= 0 || impressions <= 0) {
      signals.push({
        area: 'entrega',
        signal: 'sem_entrega',
        weight: 0.95,
        evidence: `Spend=${spend}, Impressions=${impressions}`,
      });
    } else {
      const ctr = derived.ctr_calc_pct;
      const lpRate = derived.click_to_lp_rate_pct;
      const dwell = Number(se.avg_dwell_time_ms || 0);
      const avgLoad = Number(pv.avg_load_time_ms || 0);
      const sales = Number(s.sales || 0);

      if (ctr < 0.8) {
        signals.push({
          area: 'criativo_publico',
          signal: 'ctr_baixo',
          weight: 0.75,
          evidence: `CTR≈${ctr}% (calc), Clicks=${clicks}, Impressions=${impressions}`,
        });
      }

      if (lpRate > 0 && lpRate < 55) {
        signals.push({
          area: 'clique_para_landing',
          signal: 'lpv_baixo',
          weight: 0.7,
          evidence: `LandingPageViews=${landingPageViews}, Clicks=${clicks}, Taxa≈${lpRate}%`,
        });
      }

      if (avgLoad > 3500) {
        signals.push({
          area: 'site_performance',
          signal: 'site_lento',
          weight: 0.65,
          evidence: `Avg load≈${Math.round(avgLoad)}ms`,
        });
      }

      if (dwell > 0 && dwell < 8000) {
        signals.push({
          area: 'promessa_ux',
          signal: 'baixo_engajamento',
          weight: 0.65,
          evidence: `Avg dwell≈${Math.round(dwell)}ms, Avg scroll≈${Math.round(Number(se.avg_max_scroll_pct || 0))}%`,
        });
      }

      if (sales === 0 && Number(pv.pageviews || 0) > 0) {
        signals.push({
          area: 'conversao_oferta',
          signal: 'sem_conversao',
          weight: 0.7,
          evidence: `PageViews=${Number(pv.pageviews || 0)}, Vendas=${sales}`,
        });
      }
    }

    signals.sort((a, b) => b.weight - a.weight);

    const snapshot = {
      site_key: siteKey,
      period_days: daysNum,
      since: since.toISOString(),
      meta: {
        spend,
        impressions,
        clicks,
        unique_clicks: uniqueClicks,
        unique_link_clicks: uniqueLinkClicks,
        reach: Number(m.reach || 0),
        frequency_avg: m.frequency_avg !== null && m.frequency_avg !== undefined ? Number(m.frequency_avg) : null,
        cpm_avg: m.cpm_avg !== null && m.cpm_avg !== undefined ? Number(m.cpm_avg) : null,
        cpc_avg: m.cpc_avg !== null && m.cpc_avg !== undefined ? Number(m.cpc_avg) : null,
        ctr_avg: m.ctr_avg !== null && m.ctr_avg !== undefined ? Number(m.ctr_avg) : null,
        unique_ctr_avg: m.unique_ctr_avg !== null && m.unique_ctr_avg !== undefined ? Number(m.unique_ctr_avg) : null,
        link_clicks: Number(m.link_clicks || 0),
        inline_link_clicks: Number(m.inline_link_clicks || 0),
        outbound_clicks: outboundClicks,
        landing_page_views: landingPageViews,
        leads,
        adds_to_cart: Number(m.adds_to_cart || 0),
        initiates_checkout: initiatesCheckout,
        purchases,
        connect_rate_pct: derived.connect_rate_pct,
        result_metric: derived.result_metric,
        cost_per_lead_avg: m.cost_per_lead_avg !== null && m.cost_per_lead_avg !== undefined ? Number(m.cost_per_lead_avg) : null,
        cost_per_purchase_avg:
          m.cost_per_purchase_avg !== null && m.cost_per_purchase_avg !== undefined ? Number(m.cost_per_purchase_avg) : null,
      },
      site: {
        pageviews: Number(pv.pageviews || 0),
        avg_load_time_ms: pv.avg_load_time_ms !== null && pv.avg_load_time_ms !== undefined ? Math.round(Number(pv.avg_load_time_ms)) : null,
        engagement_events: Number(se.engagement_events || 0),
        avg_dwell_time_ms: se.avg_dwell_time_ms !== null && se.avg_dwell_time_ms !== undefined ? Math.round(Number(se.avg_dwell_time_ms)) : null,
        avg_max_scroll_pct: se.avg_max_scroll_pct !== null && se.avg_max_scroll_pct !== undefined ? Math.round(Number(se.avg_max_scroll_pct)) : null,
        clicks_total: Number(se.clicks_total || 0),
        clicks_cta: Number(se.clicks_cta || 0),
        bounces_est: Number(se.bounces_est || 0),
      },
      sales: {
        purchases: Number(s.sales || 0),
        revenue: Number(s.revenue || 0),
      },
      derived,
      signals: signals.slice(0, 8),
    };

    const analysis = await llmService.generateAnalysisForSite(siteKey, snapshot);

    // 4. Salvar Relatório
    const result = await pool.query(`
      INSERT INTO recommendation_reports (site_key, analysis_text)
      VALUES ($1, $2)
      RETURNING *
    `, [siteKey, analysis]);

    return result.rows[0];
  }
}

export const diagnosisService = new DiagnosisService();
