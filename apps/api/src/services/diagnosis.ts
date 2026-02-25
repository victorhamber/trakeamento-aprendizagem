import axios from 'axios';
import { pool } from '../db/pool';
import { llmService } from './llm';
import { metaMarketingService } from './meta-marketing';

export class DiagnosisService {
  /**
   * Fetches and extracts text content from a URL.
   */
  private async fetchLandingPageContent(url: string): Promise<string | null> {
    try {
      if (!url || !url.startsWith('http')) return null;

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'TrakeamentoBot/1.0 (Diagnosis Analysis)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        timeout: 5000,
        maxContentLength: 500000 // 500KB limit
      });

      if (response.status !== 200) return null;

      let html = typeof response.data === 'string' ? response.data : '';
      if (!html) return null;

      // Simple HTML stripping
      // 1. Remove scripts and styles
      html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
                 .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "")
                 .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gim, "");
      
      // 2. Remove tags
      let text = html.replace(/<[^>]+>/g, ' ');
      
      // 3. Normalize whitespace
      text = text.replace(/\s+/g, ' ').trim();

      return text.slice(0, 3000); // Limit to 3000 chars
    } catch (err) {
      // Silent fail is fine, we just won't have the content
      return null;
    }
  }

  /**
   * Normalize a date string or Date to start-of-day Date object.
   */
  private parseDate(value: string | Date): Date | null {
    const d = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    // Return start-of-day in local timezone
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * Resolve date range from preset or custom range.
   * Returns { since, until } as Date objects (start-of-day, until is exclusive).
   */
  private resolveDateRange(options?: {
    datePreset?: string;
    since?: string;
    until?: string;
    days?: number;
  }): { since: Date; until: Date; days: number } {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d: Date, n: number) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

    // Custom range takes priority
    if (options?.since && options?.until) {
      const s = this.parseDate(options.since);
      const u = this.parseDate(options.until);
      if (s && u) {
        const since = s.getTime() <= u.getTime() ? s : u;
        const until = addDays(s.getTime() <= u.getTime() ? u : s, 1); // exclusive
        const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
        return { since, until, days };
      }
    }

    const preset = options?.datePreset?.trim() || '';
    const today = startOfDay(now);

    if (preset === 'today') {
      return { since: today, until: addDays(today, 1), days: 1 };
    }
    if (preset === 'yesterday') {
      return { since: addDays(today, -1), until: today, days: 1 };
    }
    if (preset === 'last_7d') {
      return { since: addDays(today, -7), until: addDays(today, 1), days: 7 };
    }
    if (preset === 'last_14d') {
      return { since: addDays(today, -14), until: addDays(today, 1), days: 14 };
    }
    if (preset === 'last_30d') {
      return { since: addDays(today, -30), until: addDays(today, 1), days: 30 };
    }
    if (preset === 'maximum') {
      const since = new Date('2020-01-01T00:00:00Z');
      const until = addDays(today, 1);
      const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
      return { since, until, days };
    }

    // Default or fallback: use days parameter or default to 7
    const days = options?.days ? Math.min(90, Math.max(1, Math.trunc(options.days))) : 7;
    return { since: addDays(today, -days), until: addDays(today, 1), days };
  }

  public async generateReport(
    siteKey: string,
    days = 7,
    campaignId?: string | null,
    options?: {
      datePreset?: string;
      since?: string;
      until?: string;
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_content?: string;
      utm_term?: string;
      click_id?: string;
    }
  ) {
    // ── Resolve site and date range ───────────────────────────────────────────
    const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
    const siteId = siteRow.rowCount ? (siteRow.rows[0].id as number) : null;

    const range = this.resolveDateRange({ ...options, days });
    const { since, until, days: daysNum } = range;

    // ── Sync Meta data before analysis (ensures fresh data) ───────────────────
    if (siteId && campaignId) {
      try {
        const preset = options?.datePreset || 'last_7d';
        await metaMarketingService.syncDailyInsights(
          siteId,
          preset,
          options?.since && options?.until
            ? { since: options.since, until: options.until }
            : undefined
        );
        console.log(`[DiagnosisService] Synced Meta data for site ${siteId}`);
      } catch (err) {
        console.warn('[DiagnosisService] Meta sync failed, using cached data:', err);
      }
    }

    // ── Aggregate Meta metrics ────────────────────────────────────────────────
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
        COALESCE(SUM(contacts), 0)::bigint AS contacts,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        AVG(cost_per_lead)::numeric AS cost_per_lead_avg,
        AVG(cost_per_purchase)::numeric AS cost_per_purchase_avg,
        -- Primary result as computed by Meta API
        MAX(objective) AS objective,
        COALESCE(SUM(results), 0)::bigint AS results
      FROM meta_insights_daily
      WHERE site_id = $1
        AND date_start >= $2
        AND date_start < $3
        AND adset_id IS NULL
        AND ad_id IS NULL
      ${campaignId ? 'AND campaign_id = $4' : ''}
      `,
      campaignId ? [siteId || 0, since, until, campaignId] : [siteId || 0, since, until]
    );

    // ── Helper functions ───────────────────────────────────────────────────────
    const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
    const pct = (n: number) => Math.round(n * 10000) / 100;

    const buildBreakdown = (rows: Array<Record<string, unknown>>) =>
      rows.map((row) => {
        const spend = Number(row.spend || 0);
        const impressions = Number(row.impressions || 0);
        const clicks = Number(row.clicks || 0);
        const uniqueLinkClicks = Number(row.unique_link_clicks || 0);
        const outboundClicks = Number(row.outbound_clicks || 0);
        const landingPageViews = Number(row.landing_page_views || 0);
        const leads = Number(row.leads || 0);
        const contacts = Number(row.contacts || 0);
        const purchases = Number(row.purchases || 0);
        const initiatesCheckout = Number(row.initiates_checkout || 0);
        const results = row.results != null ? Number(row.results) : null;
        const objective = row.objective != null ? String(row.objective) : null;
        const baseClicks = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;

        return {
          id: row.entity_id,
          name: row.entity_name,
          objective,
          results,
          spend,
          impressions,
          reach: Number(row.reach || 0),
          clicks,
          unique_link_clicks: uniqueLinkClicks,
          outbound_clicks: outboundClicks,
          landing_page_views: landingPageViews,
          leads,
          contacts,
          initiates_checkout: initiatesCheckout,
          purchases,
          cpc_avg:
            row.cpc_avg !== null && row.cpc_avg !== undefined ? Number(row.cpc_avg) : null,
          cpm_avg:
            row.cpm_avg !== null && row.cpm_avg !== undefined ? Number(row.cpm_avg) : null,
          ctr_avg:
            row.ctr_avg !== null && row.ctr_avg !== undefined ? Number(row.ctr_avg) : null,
          frequency_avg:
            row.frequency_avg !== null && row.frequency_avg !== undefined
              ? Number(row.frequency_avg)
              : null,
          ctr_calc_pct: pct(safeDiv(clicks, impressions)),
          lp_rate_pct: pct(safeDiv(landingPageViews, baseClicks)),
          // Cost per result (if results > 0)
          cost_per_result: results && results > 0 ? spend / results : null,
        };
      });

    // ── Load breakdown by level ────────────────────────────────────────────────
    const loadBreakdown = async (level: 'campaign' | 'adset' | 'ad') => {
      const fields =
        level === 'campaign'
          ? {
              id: 'campaign_id',
              name: 'campaign_name',
              where: 'campaign_id IS NOT NULL AND adset_id IS NULL',
            }
          : level === 'adset'
          ? {
              id: 'adset_id',
              name: 'adset_name',
              where: 'adset_id IS NOT NULL AND ad_id IS NULL',
            }
          : { id: 'ad_id', name: 'ad_name', where: 'ad_id IS NOT NULL' };

      const params: Array<string | number | Date> = [siteId || 0, since, until];
      let campaignFilter = '';
      if (campaignId) {
        params.push(campaignId);
        campaignFilter = `AND campaign_id = $${params.length}`;
      }
      params.push(8); // limit
      const limitParam = `$${params.length}`;

      const result = await pool.query(
        `
        SELECT
          ${fields.id} AS entity_id,
          ${fields.name} AS entity_name,
          MAX(objective) AS objective,
          SUM(results)::bigint AS results,
          COALESCE(SUM(spend), 0)::numeric AS spend,
          COALESCE(SUM(impressions), 0)::bigint AS impressions,
          COALESCE(SUM(clicks), 0)::bigint AS clicks,
          COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint AS outbound_clicks,
          COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
          COALESCE(SUM(leads), 0)::bigint AS leads,
          COALESCE(SUM(contacts), 0)::bigint AS contacts,
          COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
          COALESCE(SUM(purchases), 0)::bigint AS purchases,
          COALESCE(SUM(reach), 0)::bigint AS reach,
          AVG(frequency)::numeric AS frequency_avg,
          AVG(cpc)::numeric AS cpc_avg,
          AVG(ctr)::numeric AS ctr_avg,
          AVG(cpm)::numeric AS cpm_avg
        FROM meta_insights_daily
        WHERE site_id = $1 AND date_start >= $2 AND date_start < $3
          ${campaignFilter}
          AND ${fields.where}
        GROUP BY ${fields.id}, ${fields.name}
        ORDER BY spend DESC NULLS LAST
        LIMIT ${limitParam}
        `,
        params
      );
      return buildBreakdown(result.rows || []);
    };

    const [campaignBreakdown, adsetBreakdown, adBreakdown] = await Promise.all([
      loadBreakdown('campaign'),
      loadBreakdown('adset'),
      loadBreakdown('ad'),
    ]);

    const utmFilters = {
      utm_source: options?.utm_source?.trim() || '',
      utm_medium: options?.utm_medium?.trim() || '',
      utm_campaign: options?.utm_campaign?.trim() || '',
      utm_content: options?.utm_content?.trim() || '',
      utm_term: options?.utm_term?.trim() || '',
      click_id: options?.click_id?.trim() || '',
    };
    const buildUtmWhere = (baseIndex: number) => {
      const clauses: string[] = [];
      const params: string[] = [];
      const add = (key: keyof typeof utmFilters) => {
        const value = utmFilters[key];
        if (!value) return;
        params.push(value);
        clauses.push(`AND (custom_data->>'${key}') = $${baseIndex + params.length}`);
      };
      add('utm_source');
      add('utm_medium');
      add('utm_campaign');
      add('utm_content');
      add('utm_term');
      add('click_id');
      return { clause: clauses.join('\n        '), params };
    };
    const utmWhere = buildUtmWhere(4);

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
        ${utmWhere.clause}
      `,
      [siteKey, since, until, ...utmWhere.params]
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
        ${utmWhere.clause}
      `,
      [siteKey, since, until, ...utmWhere.params]
    );

    // ── Sales data (purchases table) ───────────────────────────────────────────
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

    // ── Extract values ─────────────────────────────────────────────────────────
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
    let contacts = Number(m.contacts || 0);
    let initiatesCheckout = Number(m.initiates_checkout || 0);
    let purchases = Number(m.purchases || 0);
    let results = Number(m.results || 0);
    const objective = m.objective != null ? String(m.objective) : null;

    // ── Fallback: fetch live data if DB is empty ──────────────────────────────
    const hasMetaData =
      spend > 0 || impressions > 0 || clicks > 0 || landingPageViews > 0 || results > 0;
    if (!hasMetaData && campaignId && siteId) {
      try {
        const preset = options?.datePreset || 'last_7d';
        const liveRows = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          options?.since && options?.until
            ? { since: options.since, until: options.until }
            : undefined
        );
        const live = liveRows.find((row) => row.campaign_id === campaignId);
        if (live) {
          spend = Number(live.spend || 0);
          impressions = Number(live.impressions || 0);
          clicks = Number(live.clicks || 0);
          uniqueClicks = Number(live.unique_clicks || 0);
          uniqueLinkClicks = Number(live.unique_link_clicks || 0);
          outboundClicks = Number(live.outbound_clicks || 0);
          landingPageViews = Number(live.landing_page_views || 0);
          leads = Number(live.leads || 0);
          contacts = Number(live.contacts || 0);
          initiatesCheckout = Number(live.initiates_checkout || 0);
          purchases = Number(live.purchases || 0);
          // live data also has results field now
          results = live.results != null ? Number(live.results) : 0;
        }
      } catch (err) {
        console.warn('[DiagnosisService] Live fetch failed:', err);
      }
    }

    // ── Derive metrics ─────────────────────────────────────────────────────────
    const baseClicks = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
    const connectRate = pct(safeDiv(landingPageViews, baseClicks));

    // Use results field as primary result metric; fallback to heuristic
    const resultMetric =
      results > 0
        ? results
        : purchases > 0
        ? purchases
        : leads > 0
        ? leads
        : contacts > 0
        ? contacts
        : landingPageViews;

    const costPerResult = results > 0 ? spend / results : null;

    const derived = {
      ctr_calc_pct: pct(safeDiv(clicks, impressions)),
      cpm_calc: Math.round(safeDiv(spend, impressions) * 1000 * 100) / 100,
      cpc_calc: Math.round(safeDiv(spend, clicks) * 100) / 100,
      connect_rate_pct: connectRate,
      result_metric: resultMetric,
      cost_per_result: costPerResult,
      lp_to_purchase_rate_pct: pct(safeDiv(Number(s.sales || 0), landingPageViews)),
      pv_to_purchase_rate_pct: pct(safeDiv(Number(s.sales || 0), Number(pv.pageviews || 0))),
      cta_per_engagement: Math.round(
        safeDiv(Number(se.clicks_cta || 0), Number(se.engagement_events || 0)) * 1000
      ) / 1000,
      bounce_est_rate_pct: pct(
        safeDiv(Number(se.bounces_est || 0), Number(se.engagement_events || 0))
      ),
    };

    // ── Generate signals ───────────────────────────────────────────────────────
    const signals: Array<{
      area: string;
      signal: string;
      weight: number;
      evidence: string;
    }> = [];

    if (spend <= 0 || impressions <= 0) {
      signals.push({
        area: 'entrega',
        signal: 'sem_entrega',
        weight: 0.95,
        evidence: `Spend=R$${spend.toFixed(2)}, Impressions=${impressions}`,
      });
    } else {
      const ctr = derived.ctr_calc_pct;
      const lpRate = connectRate;
      const dwell = Number(se.avg_dwell_time_ms || 0);
      const avgLoad = Number(pv.avg_load_time_ms || 0);
      const sales = Number(s.sales || 0);

      // Low CTR signal
      if (ctr < 0.8) {
        signals.push({
          area: 'criativo_publico',
          signal: 'ctr_baixo',
          weight: 0.75,
          evidence: `CTR=${ctr.toFixed(2)}% (benchmark: ~1–2%)`,
        });
      }

      // Low landing page view rate
      if (lpRate > 0 && lpRate < 55) {
        signals.push({
          area: 'clique_para_landing',
          signal: 'connect_rate_baixo',
          weight: 0.7,
          evidence: `Connect rate=${lpRate.toFixed(1)}% (benchmark: >70%)`,
        });
      }

      // Slow site
      if (avgLoad > 3500) {
        signals.push({
          area: 'site_performance',
          signal: 'site_lento',
          weight: 0.65,
          evidence: `Load time=${Math.round(avgLoad)}ms (benchmark: <2000ms)`,
        });
      }

      // Low engagement
      if (dwell > 0 && dwell < 8000) {
        signals.push({
          area: 'promessa_ux',
          signal: 'baixo_engajamento',
          weight: 0.65,
          evidence: `Dwell=${Math.round(dwell)}ms, Scroll=${Math.round(Number(se.avg_max_scroll_pct || 0))}% (benchmark: >15s, >50%)`,
        });
      }

      // No conversions
      if (sales === 0 && Number(pv.pageviews || 0) > 50) {
        signals.push({
          area: 'conversao_oferta',
          signal: 'sem_conversao',
          weight: 0.7,
          evidence: `PageViews=${Number(pv.pageviews || 0)}, Sales=0`,
        });
      }

      // High cost per result (if results field is available and cost is high)
      if (
        costPerResult != null &&
        costPerResult > 50 &&
        objective &&
        ['OUTCOME_SALES', 'CONVERSIONS', 'OUTCOME_LEADS', 'LEAD_GENERATION'].some((o) =>
          objective.toUpperCase().includes(o)
        )
      ) {
        signals.push({
          area: 'roi',
          signal: 'custo_por_resultado_alto',
          weight: 0.6,
          evidence: `Custo/resultado=R$${costPerResult.toFixed(2)}, Objetivo=${objective}`,
        });
      }
    }

    signals.sort((a, b) => b.weight - a.weight);

    // ── Detect Landing Page Content ──────────────────────────────────────────
    let landingPageUrl: string | null = null;
    let landingPageContent: string | null = null;

    try {
      const topUrlRes = await pool.query(
        `SELECT event_source_url, COUNT(*)::int as c
         FROM web_events
         WHERE site_key = $1
           AND event_name = 'PageView'
           AND event_time >= $2
           AND event_time < $3
           ${utmWhere.clause}
         GROUP BY event_source_url
         ORDER BY c DESC
         LIMIT 1`,
        [siteKey, since, until, ...utmWhere.params]
      );
      
      landingPageUrl = topUrlRes.rows[0]?.event_source_url || null;
      if (landingPageUrl) {
        landingPageContent = await this.fetchLandingPageContent(landingPageUrl);
      }
    } catch (err) {
      console.warn('[DiagnosisService] Failed to detect landing page:', err);
    }

    // ── Build snapshot ─────────────────────────────────────────────────────────
    const snapshot = {
      site_key: siteKey,
      landing_page: {
        url: landingPageUrl,
        content: landingPageContent
      },
      period_days: daysNum,
      since: since.toISOString(),
      until: until.toISOString(),
      meta: {
        objective,
        results,
        spend,
        impressions,
        clicks,
        unique_clicks: uniqueClicks,
        unique_link_clicks: uniqueLinkClicks,
        reach: Number(m.reach || 0),
        frequency_avg:
          m.frequency_avg !== null && m.frequency_avg !== undefined
            ? Number(m.frequency_avg)
            : null,
        cpm_avg:
          m.cpm_avg !== null && m.cpm_avg !== undefined ? Number(m.cpm_avg) : null,
        cpc_avg:
          m.cpc_avg !== null && m.cpc_avg !== undefined ? Number(m.cpc_avg) : null,
        ctr_avg:
          m.ctr_avg !== null && m.ctr_avg !== undefined ? Number(m.ctr_avg) : null,
        unique_ctr_avg:
          m.unique_ctr_avg !== null && m.unique_ctr_avg !== undefined
            ? Number(m.unique_ctr_avg)
            : null,
        link_clicks: Number(m.link_clicks || 0),
        inline_link_clicks: Number(m.inline_link_clicks || 0),
        outbound_clicks: outboundClicks,
        landing_page_views: landingPageViews,
        leads,
        contacts,
        adds_to_cart: Number(m.adds_to_cart || 0),
        initiates_checkout: initiatesCheckout,
        purchases,
        connect_rate_pct: derived.connect_rate_pct,
        result_metric: derived.result_metric,
        cost_per_result: costPerResult,
        cost_per_lead_avg:
          m.cost_per_lead_avg !== null && m.cost_per_lead_avg !== undefined
            ? Number(m.cost_per_lead_avg)
            : null,
        cost_per_purchase_avg:
          m.cost_per_purchase_avg !== null && m.cost_per_purchase_avg !== undefined
            ? Number(m.cost_per_purchase_avg)
            : null,
      },
      meta_breakdown: {
        campaigns: campaignBreakdown,
        adsets: adsetBreakdown,
        ads: adBreakdown,
      },
      site: {
        pageviews: Number(pv.pageviews || 0),
        avg_load_time_ms:
          pv.avg_load_time_ms !== null && pv.avg_load_time_ms !== undefined
            ? Math.round(Number(pv.avg_load_time_ms))
            : null,
        engagement_events: Number(se.engagement_events || 0),
        avg_dwell_time_ms:
          se.avg_dwell_time_ms !== null && se.avg_dwell_time_ms !== undefined
            ? Math.round(Number(se.avg_dwell_time_ms))
            : null,
        avg_max_scroll_pct:
          se.avg_max_scroll_pct !== null && se.avg_max_scroll_pct !== undefined
            ? Math.round(Number(se.avg_max_scroll_pct))
            : null,
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

    // ── Generate LLM analysis ──────────────────────────────────────────────────
    const analysis = await llmService.generateAnalysisForSite(siteKey, snapshot);

    // ── Save report ────────────────────────────────────────────────────────────
    const result = await pool.query(
      `
      INSERT INTO recommendation_reports (site_key, analysis_text)
      VALUES ($1, $2)
      RETURNING *
    `,
      [siteKey, analysis]
    );

    return {
      ...result.rows[0],
      meta_breakdown: snapshot.meta_breakdown,
      period: {
        since: snapshot.since,
        until: snapshot.until,
        days: snapshot.period_days,
      },
    };
  }
}

export const diagnosisService = new DiagnosisService();
