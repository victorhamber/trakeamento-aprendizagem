import axios from 'axios';
import { pool } from '../db/pool';
import { llmService } from './llm';
import { metaMarketingService } from './meta-marketing';

export class DiagnosisService {
  // ── Helpers ────────────────────────────────────────────────────────────────

  private async fetchLandingPageContent(url: string): Promise<string | null> {
    try {
      if (!url || !url.startsWith('http')) return null;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'TrakeamentoBot/1.0 (Diagnosis Analysis)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 5000,
        maxContentLength: 500_000,
      });
      if (response.status !== 200) return null;
      let html = typeof response.data === 'string' ? response.data : '';
      if (!html) return null;
      html = html
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
        .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gim, '');
      return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);
    } catch {
      return null;
    }
  }

  private parseDate(value: string | Date): Date | null {
    const d = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

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

    if (options?.since && options?.until) {
      const s = this.parseDate(options.since);
      const u = this.parseDate(options.until);
      if (s && u) {
        const since = s.getTime() <= u.getTime() ? s : u;
        const until = addDays(s.getTime() <= u.getTime() ? u : s, 1);
        const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
        return { since, until, days };
      }
    }

    const preset = options?.datePreset?.trim() || '';
    const today = startOfDay(now);
    if (preset === 'today') return { since: today, until: addDays(today, 1), days: 1 };
    if (preset === 'yesterday') return { since: addDays(today, -1), until: today, days: 1 };
    if (preset === 'last_7d') return { since: addDays(today, -7), until: addDays(today, 1), days: 7 };
    if (preset === 'last_14d') return { since: addDays(today, -14), until: addDays(today, 1), days: 14 };
    if (preset === 'last_30d') return { since: addDays(today, -30), until: addDays(today, 1), days: 30 };
    if (preset === 'maximum') {
      const since = new Date('2020-01-01T00:00:00Z');
      const until = addDays(today, 1);
      return { since, until, days: Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000)) };
    }
    const days = options?.days ? Math.min(90, Math.max(1, Math.trunc(options.days))) : 7;
    return { since: addDays(today, -days), until: addDays(today, 1), days };
  }

  private safeDiv(a: number, b: number) {
    return b > 0 ? a / b : 0;
  }

  private pct(n: number) {
    return Math.round(n * 10000) / 100;
  }

  // ── UTM filter builder ─────────────────────────────────────────────────────

  private buildUtmWhere(baseIndex: number, options?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    click_id?: string;
  }) {
    const clauses: string[] = [];
    const params: string[] = [];
    const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const;
    for (const key of fields) {
      const value = options?.[key]?.trim();
      if (!value) continue;
      params.push(value);
      clauses.push(`AND (custom_data->>'${key}') = $${baseIndex + params.length}`);
    }
    return { clause: clauses.join('\n        '), params };
  }

  // ── Breakdown builder ──────────────────────────────────────────────────────

  private buildBreakdown(rows: Array<Record<string, unknown>>) {
    return rows.map((row) => {
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const clicks = Number(row.clicks || 0);
      const uniqueLinkClicks = Number(row.unique_link_clicks || 0);
      const landingPageViews = Number(row.landing_page_views || 0);
      const leads = Number(row.leads || 0);
      const contacts = Number(row.contacts || 0);
      const purchases = Number(row.purchases || 0);
      const initiatesCheckout = Number(row.initiates_checkout || 0);
      const results = row.results != null ? Number(row.results) : null;
      const objective = row.objective != null ? String(row.objective) : null;
      const video3sViews = Number(row.video_3s_views || 0);

      // Hook Rate = 3-second video views / impressions (measures creative hook effectiveness)
      const hookRatePct = impressions > 0 ? this.pct(this.safeDiv(video3sViews, impressions)) : null;

      // Connect Rate = landing_page_views / link_clicks (measures post-click quality)
      const baseClicks = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
      const connectRatePct = this.pct(this.safeDiv(landingPageViews, baseClicks));

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
        landing_page_views: landingPageViews,
        // ↑ LP Views UI field: people who clicked the ad AND the page loaded (Pixel-measured)
        connect_rate_pct: connectRatePct,
        // ↑ Taxa LP View UI field: % of link clicks that resulted in a landing page view
        hook_rate_pct: hookRatePct,
        // ↑ Hook Rate UI field: % of impressions that watched 3+ seconds (only for video ads)
        leads,
        contacts,
        initiates_checkout: initiatesCheckout,
        purchases,
        cpc_avg: row.cpc_avg != null ? Number(row.cpc_avg) : null,
        cpm_avg: row.cpm_avg != null ? Number(row.cpm_avg) : null,
        ctr_avg: row.ctr_avg != null ? Number(row.ctr_avg) : null,
        frequency_avg: row.frequency_avg != null ? Number(row.frequency_avg) : null,
        ctr_calc_pct: this.pct(this.safeDiv(clicks, impressions)),
        cost_per_result: results && results > 0 ? spend / results : null,
      };
    });
  }

  // ── Main report generator ──────────────────────────────────────────────────

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
    const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
    const siteId = siteRow.rowCount ? (siteRow.rows[0].id as number) : null;

    const range = this.resolveDateRange({ ...options, days });
    const { since, until, days: daysNum } = range;

    // ── Sync Meta data ─────────────────────────────────────────────────────────
    if (siteId && campaignId) {
      try {
        const preset = options?.datePreset || 'last_7d';
        await metaMarketingService.syncDailyInsights(
          siteId,
          preset,
          options?.since && options?.until ? { since: options.since, until: options.until } : undefined
        );
      } catch (err) {
        console.warn('[DiagnosisService] Meta sync failed, using cached data:', err);
      }
    }

    // ── Meta aggregated metrics ────────────────────────────────────────────────
    const metaAgg = await pool.query(
      `SELECT
        COALESCE(SUM(spend), 0)::numeric            AS spend,
        COALESCE(SUM(impressions), 0)::bigint        AS impressions,
        COALESCE(SUM(clicks), 0)::bigint             AS clicks,
        COALESCE(SUM(unique_clicks), 0)::bigint      AS unique_clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(link_clicks), 0)::bigint        AS link_clicks,
        COALESCE(SUM(inline_link_clicks), 0)::bigint AS inline_link_clicks,
        COALESCE(SUM(outbound_clicks), 0)::bigint    AS outbound_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(reach), 0)::bigint              AS reach,
        COALESCE(SUM(video_3s_views), 0)::bigint     AS video_3s_views,
        AVG(frequency)::numeric                      AS frequency_avg,
        AVG(cpc)::numeric                            AS cpc_avg,
        AVG(ctr)::numeric                            AS ctr_avg,
        AVG(unique_ctr)::numeric                     AS unique_ctr_avg,
        AVG(cpm)::numeric                            AS cpm_avg,
        COALESCE(SUM(leads), 0)::bigint              AS leads,
        COALESCE(SUM(contacts), 0)::bigint           AS contacts,
        COALESCE(SUM(purchases), 0)::bigint          AS purchases,
        COALESCE(SUM(adds_to_cart), 0)::bigint       AS adds_to_cart,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        AVG(cost_per_lead)::numeric                  AS cost_per_lead_avg,
        AVG(cost_per_purchase)::numeric              AS cost_per_purchase_avg,
        MAX(objective)                               AS objective,
        COALESCE(SUM(results), 0)::bigint            AS results
      FROM meta_insights_daily
      WHERE site_id = $1
        AND date_start >= $2
        AND date_start < $3
        AND adset_id IS NULL
        AND ad_id IS NULL
        ${campaignId ? 'AND campaign_id = $4' : ''}`,
      campaignId ? [siteId || 0, since, until, campaignId] : [siteId || 0, since, until]
    );

    const utmWhere = this.buildUtmWhere(3, options);

    // ── CAPI metrics (server-side — source of truth for site behavior) ─────────
    let capiMetrics: Record<string, unknown> = {};
    try {
      const capiRes = await pool.query(
        `SELECT
          COUNT(CASE WHEN event_name = 'PageView' THEN 1 END)::int            AS pv_count,
          AVG(CASE WHEN event_name = 'PageView'
            THEN (telemetry->>'load_time_ms')::numeric END)::numeric          AS avg_load_time,
          COUNT(CASE WHEN event_name = 'PageEngagement'
            AND (telemetry->>'max_scroll_pct')::numeric > 50 THEN 1 END)::int AS deep_scroll_count,
          COUNT(CASE WHEN event_name = 'Purchase' THEN 1 END)::int            AS purchase_count,
          COUNT(CASE WHEN event_name = 'Lead' THEN 1 END)::int                AS lead_count,
          COUNT(CASE WHEN event_name = 'InitiateCheckout' THEN 1 END)::int    AS checkout_count,
          AVG(CASE WHEN event_name = 'PageEngagement'
            THEN (telemetry->>'dwell_time_ms')::numeric END)::numeric         AS avg_dwell_time,
          AVG(CASE WHEN event_name = 'PageEngagement'
            THEN (telemetry->>'max_scroll_pct')::numeric END)::numeric        AS avg_scroll_pct
        FROM web_events
        WHERE site_key = $1
          AND event_time >= $2
          AND event_time < $3
          ${utmWhere.clause}`,
        [siteKey, since, until, ...utmWhere.params]
      );
      capiMetrics = capiRes.rows[0] || {};
    } catch (err) {
      console.warn('[DiagnosisService] Failed to fetch CAPI metrics:', err);
    }

    // ── Breakdown by level ─────────────────────────────────────────────────────
    const loadBreakdown = async (level: 'campaign' | 'adset' | 'ad') => {
      const fields =
        level === 'campaign'
          ? { id: 'campaign_id', name: 'campaign_name', where: 'campaign_id IS NOT NULL AND adset_id IS NULL' }
          : level === 'adset'
          ? { id: 'adset_id', name: 'adset_name', where: 'adset_id IS NOT NULL AND ad_id IS NULL' }
          : { id: 'ad_id', name: 'ad_name', where: 'ad_id IS NOT NULL' };

      const params: Array<string | number | Date> = [siteId || 0, since, until];
      let campaignFilter = '';
      if (campaignId) {
        params.push(campaignId);
        campaignFilter = `AND campaign_id = $${params.length}`;
      }
      params.push(10);

      const result = await pool.query(
        `SELECT
          ${fields.id}                                                          AS entity_id,
          ${fields.name}                                                        AS entity_name,
          MAX(objective)                                                        AS objective,
          SUM(results)::bigint                                                  AS results,
          COALESCE(SUM(spend), 0)::numeric                                      AS spend,
          COALESCE(SUM(impressions), 0)::bigint                                 AS impressions,
          COALESCE(SUM(clicks), 0)::bigint                                      AS clicks,
          COALESCE(SUM(unique_link_clicks), 0)::bigint                          AS unique_link_clicks,
          COALESCE(SUM(outbound_clicks), 0)::bigint                             AS outbound_clicks,
          COALESCE(SUM(landing_page_views), 0)::bigint                          AS landing_page_views,
          COALESCE(SUM(video_3s_views), 0)::bigint                              AS video_3s_views,
          COALESCE(SUM(leads), 0)::bigint                                       AS leads,
          COALESCE(SUM(contacts), 0)::bigint                                    AS contacts,
          COALESCE(SUM(initiates_checkout), 0)::bigint                          AS initiates_checkout,
          COALESCE(SUM(purchases), 0)::bigint                                   AS purchases,
          COALESCE(SUM(reach), 0)::bigint                                       AS reach,
          AVG(frequency)::numeric                                               AS frequency_avg,
          AVG(cpc)::numeric                                                     AS cpc_avg,
          AVG(ctr)::numeric                                                     AS ctr_avg,
          AVG(cpm)::numeric                                                     AS cpm_avg
        FROM meta_insights_daily
        WHERE site_id = $1
          AND date_start >= $2
          AND date_start < $3
          ${campaignFilter}
          AND ${fields.where}
        GROUP BY ${fields.id}, ${fields.name}
        ORDER BY spend DESC NULLS LAST
        LIMIT $${params.length}`,
        params
      );
      return this.buildBreakdown(result.rows || []);
    };

    const [campaignBreakdown, adsetBreakdown, adBreakdown] = await Promise.all([
      loadBreakdown('campaign'),
      loadBreakdown('adset'),
      loadBreakdown('ad'),
    ]);

    // ── Site engagement metrics ────────────────────────────────────────────────
    const siteEngagement = await pool.query(
      `SELECT
        COUNT(*)::bigint                                                         AS engagement_events,
        AVG(NULLIF((telemetry->>'dwell_time_ms')::numeric, 0))::numeric          AS avg_dwell_time_ms,
        AVG(NULLIF((telemetry->>'max_scroll_pct')::numeric, 0))::numeric         AS avg_max_scroll_pct,
        AVG(NULLIF((telemetry->>'load_time_ms')::numeric, 0))::numeric           AS avg_load_time_ms,
        COALESCE(SUM((telemetry->>'clicks_total')::int), 0)::bigint              AS clicks_total,
        COALESCE(SUM((telemetry->>'clicks_cta')::int), 0)::bigint                AS clicks_cta,
        COALESCE(SUM(CASE
          WHEN (telemetry->>'dwell_time_ms')::numeric < 5000
            AND COALESCE((telemetry->>'max_scroll_pct')::numeric, 0) < 10
            AND COALESCE((telemetry->>'clicks_total')::int, 0) = 0
          THEN 1 ELSE 0 END), 0)::bigint                                         AS bounces_est
      FROM web_events
      WHERE site_key = $1
        AND event_name = 'PageEngagement'
        AND event_time >= $2
        AND event_time < $3
        ${utmWhere.clause}`,
      [siteKey, since, until, ...utmWhere.params]
    );

    // ── Sales data ─────────────────────────────────────────────────────────────
    const salesData = await pool.query(
      `SELECT COUNT(*)::bigint AS sales, COALESCE(SUM(amount), 0)::numeric AS revenue
       FROM purchases
       WHERE site_key = $1 AND created_at >= $2 AND created_at < $3`,
      [siteKey, since, until]
    );

    // ── Extract raw values ─────────────────────────────────────────────────────
    const m = metaAgg.rows[0] || {};
    const se = siteEngagement.rows[0] || {};
    const s = salesData.rows[0] || {};

    let spend = Number(m.spend || 0);
    let impressions = Number(m.impressions || 0);
    let clicks = Number(m.clicks || 0);
    let uniqueClicks = Number(m.unique_clicks || 0);
    let uniqueLinkClicks = Number(m.unique_link_clicks || 0);
    let outboundClicks = Number(m.outbound_clicks || 0);
    let landingPageViews = Number(m.landing_page_views || 0);
    let video3sViews = Number(m.video_3s_views || 0);
    let leads = Number(m.leads || 0);
    let contacts = Number(m.contacts || 0);
    let initiatesCheckout = Number(m.initiates_checkout || 0);
    let purchases = Number(m.purchases || 0);
    let results = Number(m.results || 0);
    const objective = m.objective != null ? String(m.objective) : null;

    // ── Fallback: live API fetch if DB empty ───────────────────────────────────
    const hasMetaData = spend > 0 || impressions > 0 || clicks > 0 || results > 0;
    if (!hasMetaData && campaignId && siteId) {
      try {
        const preset = options?.datePreset || 'last_7d';
        const liveRows = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          options?.since && options?.until ? { since: options.since, until: options.until } : undefined
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
          video3sViews = Number(live.video_3s_views || 0);
          leads = Number(live.leads || 0);
          contacts = Number(live.contacts || 0);
          initiatesCheckout = Number(live.initiates_checkout || 0);
          purchases = Number(live.purchases || 0);
          results = live.results != null ? Number(live.results) : 0;
        }
      } catch (err) {
        console.warn('[DiagnosisService] Live fetch failed:', err);
      }
    }

    // ── Derive metrics ─────────────────────────────────────────────────────────
    const baseClicks = uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
    const connectRatePct = this.pct(this.safeDiv(landingPageViews, baseClicks));

    // Hook Rate: % of impressions that watched ≥3s of video (measures creative hook power)
    const hookRatePct = impressions > 0 && video3sViews > 0
      ? this.pct(this.safeDiv(video3sViews, impressions))
      : null;

    // Primary result metric: use `results` field (Meta's computed primary metric per objective)
    const resultMetric =
      results > 0 ? results
      : purchases > 0 ? purchases
      : leads > 0 ? leads
      : contacts > 0 ? contacts
      : landingPageViews;

    const costPerResult = results > 0 ? spend / results : null;

    // Internal sales from database (source of truth for revenue)
    const internalSales = Number(s.sales || 0);
    const internalRevenue = Number(s.revenue || 0);
    const roas = spend > 0 ? internalRevenue / spend : null;

    // CAPI values (server-side events — more accurate than Pixel)
    const capiPageViews = Number(capiMetrics.pv_count || 0);
    const capiLeads = Number(capiMetrics.lead_count || 0);
    const capiAvgLoadMs = Number(capiMetrics.avg_load_time || 0);
    const capiAvgDwellMs = Number(capiMetrics.avg_dwell_time || 0);
    const capiAvgScrollPct = Number(capiMetrics.avg_scroll_pct || 0);
    const capiDeepScrollCount = Number(capiMetrics.deep_scroll_count || 0);

    // Use CAPI values when available, fall back to PageEngagement events
    const effectiveDwellMs = capiAvgDwellMs > 0 ? capiAvgDwellMs
      : (se.avg_dwell_time_ms != null ? Math.round(Number(se.avg_dwell_time_ms)) : null);
    const effectiveScrollPct = capiAvgScrollPct > 0 ? capiAvgScrollPct
      : (se.avg_max_scroll_pct != null ? Math.round(Number(se.avg_max_scroll_pct)) : null);
    const effectiveLoadMs = capiAvgLoadMs > 0 ? capiAvgLoadMs
      : (se.avg_load_time_ms != null ? Math.round(Number(se.avg_load_time_ms)) : null);

    // Discrepancy: link clicks vs actual page views (server-confirmed)
    // High gap = tracking issue, slow site, or accidental clicks
    const effectivePageViews = capiPageViews > 0 ? capiPageViews : landingPageViews;
    const clickToLPDiscrepancyPct = baseClicks > 0
      ? this.pct(1 - this.safeDiv(effectivePageViews, baseClicks))
      : null;

    const derived = {
      // Funil Meta
      ctr_calc_pct: this.pct(this.safeDiv(clicks, impressions)),
      cpm_calc: Math.round(this.safeDiv(spend, impressions) * 1000 * 100) / 100,
      cpc_calc: Math.round(this.safeDiv(spend, clicks) * 100) / 100,
      connect_rate_pct: connectRatePct,
      // ↑ "Taxa LP View" na UI: % de cliques que geraram landing_page_views (medido pelo Pixel)
      hook_rate_pct: hookRatePct,
      // ↑ "Hook Rate" na UI: % de impressões que assistiram ≥3s do vídeo (só para ads em vídeo)
      result_metric: resultMetric,
      cost_per_result: costPerResult,
      // Discrepância cliques → visitas reais
      click_to_lp_discrepancy_pct: clickToLPDiscrepancyPct,
      // ↑ Quebra entre cliques do Meta e page views reais (>25% = sinal de problema)
      // Taxas de conversão
      lp_to_result_rate_pct: landingPageViews > 0 && results > 0
        ? this.pct(this.safeDiv(results, landingPageViews)) : null,
      lp_to_purchase_rate_pct: this.pct(this.safeDiv(internalSales, landingPageViews)),
      pv_to_purchase_rate_pct: this.pct(this.safeDiv(internalSales, capiPageViews > 0 ? capiPageViews : Number(se.engagement_events || 0))),
      roas,
      cta_per_engagement: Math.round(
        this.safeDiv(Number(se.clicks_cta || 0), Number(se.engagement_events || 0)) * 1000
      ) / 1000,
      bounce_est_rate_pct: this.pct(
        this.safeDiv(Number(se.bounces_est || 0), Number(se.engagement_events || 0))
      ),
    };

    // ── Signals ────────────────────────────────────────────────────────────────
    const signals: Array<{ area: string; signal: string; weight: number; evidence: string }> = [];

    if (spend <= 0 || impressions <= 0) {
      signals.push({
        area: 'entrega',
        signal: 'sem_entrega',
        weight: 0.95,
        evidence: `Spend=R$${spend.toFixed(2)}, Impressões=${impressions}`,
      });
    } else {
      const ctr = derived.ctr_calc_pct;
      const loadMs = effectiveLoadMs ?? 0;
      const dwellMs = effectiveDwellMs ?? 0;

      // CTR baixo
      if (ctr < 0.8) {
        signals.push({
          area: 'criativo',
          signal: 'ctr_baixo',
          weight: 0.75,
          evidence: `CTR=${ctr.toFixed(2)}% — benchmark esperado: ≥1%. Criativo pode não estar chamando atenção suficiente.`,
        });
      }

      // Connect Rate baixo (cliques que não chegam na página)
      if (connectRatePct > 0 && connectRatePct < 60) {
        signals.push({
          area: 'clique_para_landing',
          signal: 'connect_rate_baixo',
          weight: 0.75,
          evidence: `Taxa LP View=${connectRatePct.toFixed(1)}% — apenas ${connectRatePct.toFixed(1)}% dos cliques viraram visualizações de página. Benchmark: >70%. Investigar velocidade ou redirect.`,
        });
      }

      // Discrepância alta entre cliques Meta e page views CAPI
      if (clickToLPDiscrepancyPct !== null && clickToLPDiscrepancyPct > 30) {
        signals.push({
          area: 'tracking',
          signal: 'discrepancia_cliques_vs_visitas',
          weight: 0.80,
          evidence: `${clickToLPDiscrepancyPct.toFixed(1)}% dos cliques do Meta não geraram page views no servidor. Possível: Pixel mal instalado, site lento ou cliques acidentais.`,
        });
      }

      // Site lento
      if (loadMs > 3500) {
        signals.push({
          area: 'site_performance',
          signal: 'site_lento',
          weight: 0.70,
          evidence: `Tempo de carregamento=${Math.round(loadMs)}ms — acima do crítico (3500ms). Usuários abandonam antes de ver a oferta.`,
        });
      }

      // Engajamento baixo
      if (dwellMs > 0 && dwellMs < 8000) {
        signals.push({
          area: 'landing_page',
          signal: 'baixo_engajamento',
          weight: 0.65,
          evidence: `Dwell time=${Math.round(dwellMs)}ms, Scroll médio=${Math.round(effectiveScrollPct ?? 0)}%. Usuários estão saindo antes de ler a oferta.`,
        });
      }

      // Sem resultado — verificar objetivo antes de disparar
      const objectiveNormalized = (objective || '').toUpperCase();
      const isSalesObjective = ['OUTCOME_SALES', 'CONVERSIONS', 'PURCHASES'].some(o => objectiveNormalized.includes(o));
      const isLeadObjective = ['OUTCOME_LEADS', 'LEAD_GENERATION', 'LEADS', 'CADASTRO'].some(o => objectiveNormalized.includes(o));

      if (isSalesObjective && internalSales === 0 && effectivePageViews > 50) {
        signals.push({
          area: 'conversao',
          signal: 'sem_venda',
          weight: 0.75,
          evidence: `Objetivo de VENDAS com ${effectivePageViews} visitas e 0 compras no banco de dados.`,
        });
      }

      if (isLeadObjective && results === 0 && effectivePageViews > 30) {
        signals.push({
          area: 'conversao',
          signal: 'sem_lead',
          weight: 0.75,
          evidence: `Objetivo de LEAD com ${effectivePageViews} visitas e 0 resultados registrados. Verificar formulário e tracking.`,
        });
      }

      // CPA alto (relativo ao objetivo)
      if (costPerResult != null && costPerResult > 50) {
        signals.push({
          area: 'roi',
          signal: 'custo_por_resultado_alto',
          weight: 0.60,
          evidence: `CPA=R$${costPerResult.toFixed(2)} para objetivo "${objective}". Avaliar se está dentro do LTV/margem do produto.`,
        });
      }

      // Frequência alta = público saturado
      const freq = m.frequency_avg != null ? Number(m.frequency_avg) : 0;
      if (freq > 3.5) {
        signals.push({
          area: 'publico',
          signal: 'frequencia_alta',
          weight: 0.60,
          evidence: `Frequência média=${freq.toFixed(2)} — público pode estar saturado. Considere novos criativos ou expansão de audiência.`,
        });
      }

      // Hook Rate baixo (só relevante se tiver dados de vídeo)
      if (hookRatePct !== null && hookRatePct < 15) {
        signals.push({
          area: 'criativo_video',
          signal: 'hook_rate_baixo',
          weight: 0.60,
          evidence: `Hook Rate=${hookRatePct.toFixed(2)}% — menos de 15% das impressões assistiram 3s do vídeo. Os primeiros segundos não estão prendendo atenção.`,
        });
      }
    }

    signals.sort((a, b) => b.weight - a.weight);

    // ── Landing page + segments ────────────────────────────────────────────────
    let landingPageUrl: string | null = null;
    let landingPageContent: string | null = null;
    const hourlyDistribution: Record<string, number> = {};
    const dayOfWeekDistribution: Record<string, number> = {};

    try {
      const lpParams = [siteKey, since, until, ...utmWhere.params];
      const topUrlRes = await pool.query(
        `SELECT event_source_url, COUNT(*)::bigint AS c
         FROM web_events
         WHERE site_key = $1
           AND event_name = 'PageView'
           AND event_time >= $2
           AND event_time < $3
           ${utmWhere.clause}
         GROUP BY event_source_url
         ORDER BY c DESC
         LIMIT 1`,
        lpParams
      );
      landingPageUrl = topUrlRes.rows[0]?.event_source_url || null;
      if (landingPageUrl) {
        landingPageContent = await this.fetchLandingPageContent(landingPageUrl);
      }

      const [hourlyRes, dowRes] = await Promise.all([
        pool.query(
          `SELECT EXTRACT(HOUR FROM event_time) AS hour, COUNT(*)::int AS c
           FROM web_events
           WHERE site_key = $1 AND event_name = 'PageView'
             AND event_time >= $2 AND event_time < $3 ${utmWhere.clause}
           GROUP BY 1 ORDER BY 1`,
          lpParams
        ),
        pool.query(
          `SELECT EXTRACT(DOW FROM event_time) AS dow, COUNT(*)::int AS c
           FROM web_events
           WHERE site_key = $1 AND event_name = 'PageView'
             AND event_time >= $2 AND event_time < $3 ${utmWhere.clause}
           GROUP BY 1 ORDER BY 1`,
          lpParams
        ),
      ]);
      hourlyRes.rows.forEach((r) => { hourlyDistribution[String(r.hour)] = r.c; });
      dowRes.rows.forEach((r) => { dayOfWeekDistribution[String(r.dow)] = r.c; });
    } catch (err) {
      console.warn('[DiagnosisService] Landing page/segments fetch failed:', err);
    }

    // ── Build snapshot ─────────────────────────────────────────────────────────
    //
    // DATA SOURCE HIERARCHY (most reliable → least):
    //   1. sales.*       — internal database (webhook/API) — absolute truth for revenue
    //   2. capi.*        — server-side events — truth for site behavior
    //   3. meta.*        — Meta Pixel/API — estimated, may have deduplication issues
    //
    // UI FIELD MAPPING:
    //   UI "LP Views"         → meta.landing_page_views  (Pixel: people whose page loaded after clicking)
    //   UI "Taxa LP View"     → meta.connect_rate_pct    (LP Views ÷ Link Clicks)
    //   UI "Hook Rate"        → derived.hook_rate_pct    (3s video views ÷ Impressions)
    //   UI "Objetivo (N)"     → meta.results             (Meta's primary metric per objective)
    //   UI "Finalização"      → meta.initiates_checkout  (InitiateCheckout Pixel event)
    //   UI "Compras"          → meta.purchases           (Purchase Pixel event — may differ from sales.purchases)
    //
    const snapshot = {
      site_key: siteKey,
      period_days: daysNum,
      since: since.toISOString(),
      until: until.toISOString(),

      // ── Meta Ads metrics (from Meta API / Pixel) ──────────────────────────
      meta: {
        objective,
        // `results` = Meta's computed primary metric for this campaign objective.
        // For CADASTRO_GRUPO → results = group join events.
        // For LEAD_GENERATION → results = lead form fills.
        // For OUTCOME_SALES → results = purchase events.
        // THIS IS THE PRIMARY SUCCESS METRIC. Do not treat as secondary.
        results,
        cost_per_result: costPerResult,

        spend,
        impressions,
        reach: Number(m.reach || 0),
        frequency_avg: m.frequency_avg != null ? Number(m.frequency_avg) : null,
        clicks,                    // total clicks (including non-link)
        unique_link_clicks: uniqueLinkClicks,  // link clicks (unique)
        outbound_clicks: outboundClicks,

        // LP Views: people who CLICKED the ad AND whose browser loaded the landing page.
        // Measured by the Meta Pixel. Different from CAPI page_views (server-side).
        landing_page_views: landingPageViews,

        // Connect Rate (Taxa LP View): what % of link clicks resulted in a landing page view.
        // < 70% = investigate site speed, redirects, or accidental clicks.
        connect_rate_pct: connectRatePct,

        // Hook Rate: % of impressions that watched ≥3 seconds of video.
        // null = no video data available. < 15% = weak creative hook.
        hook_rate_pct: hookRatePct,
        video_3s_views: video3sViews,

        leads,
        contacts,
        adds_to_cart: Number(m.adds_to_cart || 0),
        // `initiates_checkout` = "Finalização" in the UI (InitiateCheckout Pixel event)
        initiates_checkout: initiatesCheckout,
        // `purchases` = Purchase Pixel event (may differ from sales.purchases due to deduplication)
        purchases,

        cpm_avg: m.cpm_avg != null ? Number(m.cpm_avg) : null,
        cpc_avg: m.cpc_avg != null ? Number(m.cpc_avg) : null,
        ctr_avg: m.ctr_avg != null ? Number(m.ctr_avg) : null,
        cost_per_lead_avg: m.cost_per_lead_avg != null ? Number(m.cost_per_lead_avg) : null,
        cost_per_purchase_avg: m.cost_per_purchase_avg != null ? Number(m.cost_per_purchase_avg) : null,
      },

      // ── CAPI / Server-side events (source of truth for on-site behavior) ──
      // These come from the server (not the browser Pixel), so they are:
      // - Not affected by ad blockers or iOS privacy restrictions
      // - More accurate for load times, scroll depth, dwell time
      // - Filtered by the same UTM parameters as the campaign
      capi: {
        // Real page views confirmed server-side. Use this over meta.landing_page_views
        // when diagnosing tracking discrepancies.
        page_views: capiPageViews,
        avg_load_time_ms: capiAvgLoadMs != null ? capiAvgLoadMs : 0,       // > 3000ms = critical performance issue
        deep_scroll_count: capiDeepScrollCount, // users who scrolled > 50% of page
        avg_scroll_pct: capiAvgScrollPct != null ? capiAvgScrollPct : 0,       // average scroll depth %
        avg_dwell_time_ms: capiAvgDwellMs != null ? capiAvgDwellMs : 0,      // average time on page (ms)
        leads: capiLeads,
        purchases: Number(capiMetrics.purchase_count || 0),
        checkouts: Number(capiMetrics.checkout_count || 0),
      },

      // ── Site engagement (from PageEngagement events — browser-side) ────────
      site: {
        engagement_events: Number(se.engagement_events || 0),
        avg_dwell_time_ms: se.avg_dwell_time_ms != null ? Math.round(Number(se.avg_dwell_time_ms)) : null,
        avg_max_scroll_pct: se.avg_max_scroll_pct != null ? Math.round(Number(se.avg_max_scroll_pct)) : null,
        avg_load_time_ms: se.avg_load_time_ms != null ? Math.round(Number(se.avg_load_time_ms)) : null,
        clicks_total: Number(se.clicks_total || 0),
        clicks_cta: Number(se.clicks_cta || 0),
        bounces_est: Number(se.bounces_est || 0),
        // Effective (best available) values for analysis:
        effective_dwell_ms: effectiveDwellMs,
        effective_scroll_pct: effectiveScrollPct,
        effective_load_ms: effectiveLoadMs,
      },

      // ── Internal sales database (absolute truth for revenue/conversions) ──
      sales: {
        purchases: internalSales,     // confirmed purchases via webhook/API
        revenue: internalRevenue,      // confirmed revenue
        roas,                          // internalRevenue / spend
      },

      // ── Breakdown by Meta Ads level ────────────────────────────────────────
      meta_breakdown: {
        campaigns: campaignBreakdown,
        adsets: adsetBreakdown,
        ads: adBreakdown,
      },

      // ── Computed/derived metrics ───────────────────────────────────────────
      derived,

      // ── Signals (auto-detected anomalies) ─────────────────────────────────
      signals: signals.slice(0, 8),

      // ── Content & temporal segments ───────────────────────────────────────
      landing_page: {
        url: landingPageUrl,
        content: landingPageContent,
      },
      segments: {
        hourly: hourlyDistribution,        // page views by hour (0-23)
        day_of_week: dayOfWeekDistribution, // page views by weekday (0=Sun, 6=Sat)
      },
    };

    // ── Generate LLM analysis ──────────────────────────────────────────────────
    const analysis = await llmService.generateAnalysisForSite(siteKey, snapshot);

    const reportResult = await pool.query(
      `INSERT INTO recommendation_reports (site_key, analysis_text) VALUES ($1, $2) RETURNING *`,
      [siteKey, analysis]
    );

    return {
      ...reportResult.rows[0],
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