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

  /**
   * Detects unresolved Meta dynamic parameter macros like {{campaign.name}}, {{adset.name}}, {{ad.id}}.
   * Meta substitutes these at click time — if passed literally to DB queries they match nothing.
   */
  private isUnresolvedMacro(value: string): boolean {
    return /\{\{.+?\}\}/.test(value);
  }

  /**
   * Resolve Meta URL template macros using actual campaign/adset/ad data.
   * E.g. {{campaign.name}} → "Campanha Leads", {{ad.id}} → "12345678"
   */
  private resolveMacros(value: string, metaEntities: {
    campaign_id?: string; campaign_name?: string;
    adset_id?: string; adset_name?: string;
    ad_id?: string; ad_name?: string;
  }): string {
    const replacements: Record<string, string | undefined> = {
      '{{campaign.name}}': metaEntities.campaign_name,
      '{{campaign.id}}': metaEntities.campaign_id,
      '{{adset.name}}': metaEntities.adset_name,
      '{{adset.id}}': metaEntities.adset_id,
      '{{ad.name}}': metaEntities.ad_name,
      '{{ad.id}}': metaEntities.ad_id,
    };

    let resolved = value;
    for (const [macro, replacement] of Object.entries(replacements)) {
      if (replacement && resolved.includes(macro)) {
        resolved = resolved.replace(macro, replacement);
      }
    }
    return resolved;
  }

  private buildUtmWhere(baseIndex: number, options?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    click_id?: string;
  }, metaEntities?: {
    campaign_id?: string; campaign_name?: string;
    adset_id?: string; adset_name?: string;
    ad_id?: string; ad_name?: string;
  }) {
    const clauses: string[] = [];
    const params: string[] = [];
    const skipped: string[] = [];
    const resolved: string[] = [];
    const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const;

    for (const key of fields) {
      let value = options?.[key]?.trim();
      if (!value) continue;

      // Try to resolve Meta macros using campaign data
      if (this.isUnresolvedMacro(value) && metaEntities) {
        const original = value;
        value = this.resolveMacros(value, metaEntities);
        if (!this.isUnresolvedMacro(value)) {
          resolved.push(`${key}: "${original}" → "${value}"`);
          console.log(`[DiagnosisService] Resolved macro: ${key}="${original}" → "${value}"`);
        }
      }

      // Skip still-unresolved macros
      if (this.isUnresolvedMacro(value)) {
        skipped.push(`${key}="${value}"`);
        console.warn(`[DiagnosisService] Skipping UTM filter with unresolved macro: ${key}="${value}"`);
        continue;
      }

      params.push(value);
      clauses.push(`AND (custom_data->>'${key}') = $${baseIndex + params.length}`);
    }

    return { clause: clauses.join('\n        '), params, skipped, resolved };
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

      // Hook Rate = 3-second video views / impressions (only meaningful for video ads)
      // null = image ad or no video data — do NOT interpret as poor performance
      const hookRatePct = video3sViews > 0 && impressions > 0
        ? this.pct(this.safeDiv(video3sViews, impressions))
        : null;

      // Connect Rate = landing_page_views / link_clicks
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
        connect_rate_pct: connectRatePct,
        // hook_rate_pct is null for image ads — treat null as "image ad, not applicable"
        hook_rate_pct: hookRatePct,
        video_3s_views: video3sViews,
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
      force?: boolean;
      userContext?: {
        stated_objective?: string;
        landing_page_url?: string;
        creatives?: Array<{ ad_name: string; copy: string; media_description: string }>;
      };
    }
  ) {
    const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
    const siteId = siteRow.rowCount ? (siteRow.rows[0].id as number) : null;

    const range = this.resolveDateRange({ ...options, days });
    const { since, until, days: daysNum } = range;

    // ── Cache check: return recent report if available (TTL 1h) ───────────
    const cacheKey = options?.datePreset || `custom_${daysNum}d`;
    if (!options?.force) {
      try {
        const cached = await pool.query(
          `SELECT * FROM recommendation_reports
           WHERE site_key = $1
             AND COALESCE(campaign_id, '') = COALESCE($2, '')
             AND COALESCE(date_preset, '') = $3
             AND created_at > NOW() - INTERVAL '1 hour'
           ORDER BY created_at DESC LIMIT 1`,
          [siteKey, campaignId || null, cacheKey]
        );
        if (cached.rowCount && cached.rows[0]) {
          console.log(`[DiagnosisService] Cache hit — returning report from ${cached.rows[0].created_at}`);
          return {
            ...cached.rows[0],
            from_cache: true,
            meta_breakdown: { campaigns: [], adsets: [], ads: [] },
            period: {
              since: since.toISOString(),
              until: until.toISOString(),
              days: daysNum,
            },
          };
        }
      } catch (err) {
        console.warn('[DiagnosisService] Cache check failed, proceeding with fresh report:', err);
      }
    }

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

    // ── Resolve Meta UTM macros using campaign entity data ───────────────────
    let metaEntities: { campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string } = {};
    if (campaignId && siteId) {
      try {
        const entityRow = await pool.query(
          `SELECT campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name
           FROM meta_insights_daily
           WHERE site_id = $1 AND campaign_id = $2
           ORDER BY date_start DESC LIMIT 1`,
          [siteId, campaignId]
        );
        if (entityRow.rowCount && entityRow.rows[0]) {
          metaEntities = {
            campaign_id: entityRow.rows[0].campaign_id || campaignId,
            campaign_name: entityRow.rows[0].campaign_name || undefined,
            adset_id: entityRow.rows[0].adset_id || undefined,
            adset_name: entityRow.rows[0].adset_name || undefined,
            ad_id: entityRow.rows[0].ad_id || undefined,
            ad_name: entityRow.rows[0].ad_name || undefined,
          };
        }
      } catch {
        // If lookup fails, macros will remain unresolved (skipped as before)
      }
    }

    const utmWhere = this.buildUtmWhere(3, options, metaEntities);
    if (utmWhere.resolved.length > 0) {
      console.log('[DiagnosisService] Resolved UTM macros:', utmWhere.resolved);
    }
    if (utmWhere.skipped.length > 0) {
      console.warn('[DiagnosisService] UTM macros skipped (unresolved Meta templates):', utmWhere.skipped);
    }

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

    // Hook Rate: only set when video_3s_views > 0 (image ads have no hook rate)
    const hookRatePct = video3sViews > 0 && impressions > 0
      ? this.pct(this.safeDiv(video3sViews, impressions))
      : null;

    const resultMetric =
      results > 0 ? results
        : purchases > 0 ? purchases
          : leads > 0 ? leads
            : contacts > 0 ? contacts
              : landingPageViews;

    const costPerResult = results > 0 ? spend / results : null;

    const internalSales = Number(s.sales || 0);
    const internalRevenue = Number(s.revenue || 0);
    const roas = spend > 0 && internalRevenue > 0 ? internalRevenue / spend : null;

    const capiPageViews = Number(capiMetrics.pv_count || 0);
    const capiLeads = Number(capiMetrics.lead_count || 0);
    const capiAvgLoadMs = Number(capiMetrics.avg_load_time || 0) || null;
    const capiAvgDwellMs = Number(capiMetrics.avg_dwell_time || 0) || null;
    const capiAvgScrollPct = Number(capiMetrics.avg_scroll_pct || 0) || null;
    const capiDeepScrollCount = Number(capiMetrics.deep_scroll_count || 0);

    // Best available values: prefer CAPI (server-side), fallback to PageEngagement (browser-side)
    const effectiveDwellMs = (capiAvgDwellMs && capiAvgDwellMs > 0) ? capiAvgDwellMs
      : (se.avg_dwell_time_ms != null ? Math.round(Number(se.avg_dwell_time_ms)) : null);
    const effectiveScrollPct = (capiAvgScrollPct && capiAvgScrollPct > 0) ? capiAvgScrollPct
      : (se.avg_max_scroll_pct != null ? Math.round(Number(se.avg_max_scroll_pct)) : null);
    const effectiveLoadMs = (capiAvgLoadMs && capiAvgLoadMs > 0) ? capiAvgLoadMs
      : (se.avg_load_time_ms != null ? Math.round(Number(se.avg_load_time_ms)) : null);

    const effectivePageViews = capiPageViews > 0 ? capiPageViews : landingPageViews;
    const clickToLPDiscrepancyPct = baseClicks > 0
      ? this.pct(1 - this.safeDiv(effectivePageViews, baseClicks))
      : null;

    const derived = {
      ctr_calc_pct: this.pct(this.safeDiv(clicks, impressions)),
      cpm_calc: Math.round(this.safeDiv(spend, impressions) * 1000 * 100) / 100,
      cpc_calc: Math.round(this.safeDiv(spend, clicks) * 100) / 100,
      connect_rate_pct: connectRatePct,
      hook_rate_pct: hookRatePct,
      result_metric: resultMetric,
      cost_per_result: costPerResult,
      click_to_lp_discrepancy_pct: clickToLPDiscrepancyPct,
      lp_to_result_rate_pct: landingPageViews > 0 && results > 0
        ? this.pct(this.safeDiv(results, landingPageViews)) : null,
      lp_to_purchase_rate_pct: this.pct(this.safeDiv(internalSales, landingPageViews)),
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
        evidence: `Spend=R$${spend.toFixed(2)}, Impressoes=${impressions}`,
      });
    } else {
      const ctr = derived.ctr_calc_pct;
      const loadMs = effectiveLoadMs ?? 0;
      const dwellMs = effectiveDwellMs ?? 0;

      if (ctr < 0.8) {
        signals.push({
          area: 'criativo',
          signal: 'ctr_baixo',
          weight: 0.75,
          evidence: `CTR=${ctr.toFixed(2)}% — benchmark esperado: >=1%.`,
        });
      }

      if (connectRatePct > 0 && connectRatePct < 60) {
        signals.push({
          area: 'clique_para_landing',
          signal: 'connect_rate_baixo',
          weight: 0.75,
          evidence: `Taxa LP View=${connectRatePct.toFixed(1)}% — benchmark: >70%. Investigar velocidade ou redirect.`,
        });
      }

      if (clickToLPDiscrepancyPct !== null && clickToLPDiscrepancyPct > 30) {
        signals.push({
          area: 'tracking',
          signal: 'discrepancia_cliques_vs_visitas',
          weight: 0.80,
          evidence: `${clickToLPDiscrepancyPct.toFixed(1)}% dos cliques nao geraram page views. Possivel: Pixel mal instalado, site lento ou cliques acidentais.`,
        });
      }

      if (loadMs > 3500) {
        signals.push({
          area: 'site_performance',
          signal: 'site_lento',
          weight: 0.70,
          evidence: `Carregamento=${Math.round(loadMs)}ms — acima do critico (3500ms).`,
        });
      }

      if (dwellMs > 0 && dwellMs < 8000) {
        signals.push({
          area: 'landing_page',
          signal: 'baixo_engajamento',
          weight: 0.65,
          evidence: `Dwell=${Math.round(dwellMs)}ms, Scroll=${Math.round(effectiveScrollPct ?? 0)}%. Usuarios saindo antes de ler a oferta.`,
        });
      }

      // Signal logic uses results (the optimization event), not objective
      // results = 0 with sufficient traffic = real conversion problem
      if (results === 0 && effectivePageViews > 50) {
        signals.push({
          area: 'conversao',
          signal: 'sem_resultado',
          weight: 0.75,
          evidence: `0 resultados com ${effectivePageViews} visitas. Verificar se o evento de otimizacao esta disparando corretamente.`,
        });
      }

      // CPA relativo — alerta se o CPA for 3x mais caro que o CPA medio da campanha.
      // Isso funciona para qualquer nicho, ao inves de um hardcoded R$50.
      if (costPerResult != null && results > 0) {
        const avgCPA = m.cost_per_lead_avg != null ? Number(m.cost_per_lead_avg)
          : m.cost_per_purchase_avg != null ? Number(m.cost_per_purchase_avg) : null;

        // Se temos CPA medio da campanha, compara relativamente; senao, usa threshold absoluto razoavel
        const isHighCPA = avgCPA && avgCPA > 0
          ? costPerResult > avgCPA * 3
          : costPerResult > spend * 0.5; // CPA > 50% do gasto total = muito poucos resultados

        if (isHighCPA) {
          signals.push({
            area: 'roi',
            signal: 'custo_por_resultado_alto',
            weight: 0.65,
            evidence: `CPA=R$${costPerResult.toFixed(2)}${avgCPA ? ` (media da campanha: R$${avgCPA.toFixed(2)})` : ''}. Avaliar se esta dentro do LTV/margem.`,
          });
        }
      }

      // ROAS baixo — alerta quando receita < investimento
      if (roas !== null && roas < 1.0) {
        signals.push({
          area: 'roi',
          signal: 'roas_negativo',
          weight: 0.85,
          evidence: `ROAS=${roas.toFixed(2)}x — receita (R$${internalRevenue.toFixed(2)}) menor que investimento (R$${spend.toFixed(2)}). Campanha esta dando prejuizo.`,
        });
      }

      // CPM alto — pode indicar saturacao de publico ou leilao muito competitivo
      const cpmCalc = derived.cpm_calc;
      if (cpmCalc > 50) {
        signals.push({
          area: 'entrega',
          signal: 'cpm_alto',
          weight: 0.55,
          evidence: `CPM=R$${cpmCalc.toFixed(2)} — acima de R$50. Possivel saturacao de publico ou leilao competitivo.`,
        });
      }

      // Discrepancia de vendas Meta vs Banco
      if (purchases > 0 && internalSales > 0 && Math.abs(purchases - internalSales) > 1) {
        const discpPct = Math.abs(1 - internalSales / purchases) * 100;
        if (discpPct > 20) {
          signals.push({
            area: 'tracking',
            signal: 'discrepancia_vendas',
            weight: 0.70,
            evidence: `Meta reporta ${purchases} compras, banco tem ${internalSales}. Diferenca de ${discpPct.toFixed(0)}%. Verificar atribuicao e webhooks.`,
          });
        }
      }

      const freq = m.frequency_avg != null ? Number(m.frequency_avg) : 0;
      if (freq > 3.5) {
        signals.push({
          area: 'publico',
          signal: 'frequencia_alta',
          weight: 0.60,
          evidence: `Frequencia=${freq.toFixed(2)} — publico pode estar saturado.`,
        });
      }

      if (hookRatePct !== null && hookRatePct < 15) {
        signals.push({
          area: 'criativo_video',
          signal: 'hook_rate_baixo',
          weight: 0.60,
          evidence: `Hook Rate=${hookRatePct.toFixed(2)}% — menos de 15% assistiram 3s do video.`,
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

      // Override with user-provided LP URL (from wizard)
      if (options?.userContext?.landing_page_url) {
        landingPageUrl = options.userContext.landing_page_url;
      }

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

    // ── Trend: previous period comparison ───────────────────────────────────────
    let trend: Record<string, unknown> | null = null;
    try {
      const prevSince = new Date(since.getTime() - (until.getTime() - since.getTime()));
      const prevUntil = since;

      const [prevMetaRes, prevSalesRes] = await Promise.all([
        pool.query(
          `SELECT
            COALESCE(SUM(spend), 0)::numeric AS spend,
            COALESCE(SUM(impressions), 0)::bigint AS impressions,
            COALESCE(SUM(clicks), 0)::bigint AS clicks,
            COALESCE(SUM(results), 0)::bigint AS results
          FROM meta_insights_daily
          WHERE site_id = $1
            AND date_start >= $2 AND date_start < $3
            AND adset_id IS NULL AND ad_id IS NULL
            ${campaignId ? 'AND campaign_id = $4' : ''}`,
          campaignId ? [siteId || 0, prevSince, prevUntil, campaignId] : [siteId || 0, prevSince, prevUntil]
        ),
        pool.query(
          `SELECT COUNT(*)::bigint AS sales, COALESCE(SUM(amount), 0)::numeric AS revenue
           FROM purchases WHERE site_key = $1 AND created_at >= $2 AND created_at < $3`,
          [siteKey, prevSince, prevUntil]
        ),
      ]);

      const pm = prevMetaRes.rows[0] || {};
      const ps = prevSalesRes.rows[0] || {};
      const prevSpend = Number(pm.spend || 0);
      const prevResults = Number(pm.results || 0);
      const prevClicks = Number(pm.clicks || 0);
      const prevImpressions = Number(pm.impressions || 0);
      const prevRevenue = Number(ps.revenue || 0);
      const prevRoas = prevSpend > 0 && prevRevenue > 0 ? prevRevenue / prevSpend : null;
      const prevCPA = prevResults > 0 ? prevSpend / prevResults : null;
      const prevCTR = prevImpressions > 0 ? this.pct(this.safeDiv(prevClicks, prevImpressions)) : 0;

      // Only include trend if there was actual data in the previous period
      if (prevSpend > 0 || prevResults > 0) {
        const pctChange = (curr: number, prev: number) =>
          prev > 0 ? Math.round(((curr - prev) / prev) * 10000) / 100 : null;

        trend = {
          previous_period: {
            since: prevSince.toISOString(),
            until: prevUntil.toISOString(),
          },
          spend: { current: spend, previous: prevSpend, change_pct: pctChange(spend, prevSpend) },
          results: { current: results, previous: prevResults, change_pct: pctChange(results, prevResults) },
          cpa: {
            current: costPerResult,
            previous: prevCPA,
            change_pct: costPerResult && prevCPA ? pctChange(costPerResult, prevCPA) : null,
          },
          ctr: {
            current: derived.ctr_calc_pct,
            previous: prevCTR,
            change_pct: pctChange(derived.ctr_calc_pct, prevCTR),
          },
          roas: {
            current: roas,
            previous: prevRoas,
            change_pct: roas && prevRoas ? pctChange(roas, prevRoas) : null,
          },
        };
      }
    } catch (err) {
      console.warn('[DiagnosisService] Trend calculation failed:', err);
    }

    const snapshot = {
      site_key: siteKey,
      period_days: daysNum,
      since: since.toISOString(),
      until: until.toISOString(),

      // UTM filters actually applied to web_events queries.
      // Macros like {{campaign.name}} are skipped — they never match stored events.
      utm_filters_applied: utmWhere.params.length > 0
        ? Object.fromEntries(
          (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const)
            .filter(k => options?.[k] && !this.isUnresolvedMacro(options[k]!))
            .map(k => [k, options![k]])
        )
        : null,
      utm_filters_skipped: utmWhere.skipped.length > 0 ? utmWhere.skipped : null,

      meta: {
        objective,
        // results = the optimization event count (e.g. CADASTRO_GRUPO, LEAD, PURCHASE).
        // THIS is the primary success metric — not meta.objective.
        // A campaign with objective=OUTCOME_SALES can be optimized for CADASTRO_GRUPO.
        // Always judge success by results, never by purchases/leads unless that IS the event.
        results,
        cost_per_result: costPerResult,
        spend,
        impressions,
        reach: Number(m.reach || 0),
        frequency_avg: m.frequency_avg != null ? Number(m.frequency_avg) : null,
        clicks,
        unique_link_clicks: uniqueLinkClicks,
        outbound_clicks: outboundClicks,
        // landing_page_views = "LP Views" in UI. Pixel-measured (browser-side).
        landing_page_views: landingPageViews,
        // connect_rate_pct = "Taxa LP View" in UI. landing_page_views / link_clicks.
        connect_rate_pct: connectRatePct,
        // hook_rate_pct = null for image ads. Only set when video_3s_views > 0.
        hook_rate_pct: hookRatePct,
        video_3s_views: video3sViews,
        leads,
        contacts,
        adds_to_cart: Number(m.adds_to_cart || 0),
        // initiates_checkout = "Finalizacao" in UI. Only relevant for sales objectives.
        initiates_checkout: initiatesCheckout,
        purchases,
        cpm_avg: m.cpm_avg != null ? Number(m.cpm_avg) : null,
        cpc_avg: m.cpc_avg != null ? Number(m.cpc_avg) : null,
        ctr_avg: m.ctr_avg != null ? Number(m.ctr_avg) : null,
        cost_per_lead_avg: m.cost_per_lead_avg != null ? Number(m.cost_per_lead_avg) : null,
        cost_per_purchase_avg: m.cost_per_purchase_avg != null ? Number(m.cost_per_purchase_avg) : null,
      },

      // CAPI = server-side events. More accurate than Pixel (no ad blockers, no iOS restrictions).
      // If utm_filters_skipped is not null, these values cover ALL site traffic (not just this campaign).
      capi: {
        page_views: capiPageViews,
        avg_load_time_ms: capiAvgLoadMs,
        deep_scroll_count: capiDeepScrollCount,
        avg_scroll_pct: capiAvgScrollPct,
        avg_dwell_time_ms: capiAvgDwellMs,
        leads: capiLeads,
        purchases: Number(capiMetrics.purchase_count || 0),
        checkouts: Number(capiMetrics.checkout_count || 0),
      },

      site: {
        engagement_events: Number(se.engagement_events || 0),
        avg_dwell_time_ms: se.avg_dwell_time_ms != null ? Math.round(Number(se.avg_dwell_time_ms)) : null,
        avg_max_scroll_pct: se.avg_max_scroll_pct != null ? Math.round(Number(se.avg_max_scroll_pct)) : null,
        avg_load_time_ms: se.avg_load_time_ms != null ? Math.round(Number(se.avg_load_time_ms)) : null,
        clicks_total: Number(se.clicks_total || 0),
        clicks_cta: Number(se.clicks_cta || 0),
        bounces_est: Number(se.bounces_est || 0),
        // Effective = best available value (CAPI preferred, PageEngagement as fallback)
        // null = no data from either source
        effective_dwell_ms: effectiveDwellMs,
        effective_scroll_pct: effectiveScrollPct,
        effective_load_ms: effectiveLoadMs,
      },

      sales: {
        purchases: internalSales,
        revenue: internalRevenue,
        roas,
      },

      meta_breakdown: {
        campaigns: campaignBreakdown,
        adsets: adsetBreakdown,
        ads: adBreakdown,
      },

      derived,
      signals: signals.slice(0, 10),
      trend,

      landing_page: {
        url: options?.userContext?.landing_page_url || landingPageUrl,
        content: landingPageContent,
      },
      segments: {
        hourly: hourlyDistribution,
        day_of_week: dayOfWeekDistribution,
      },
      user_context: options?.userContext || null,
    };

    const analysis = await llmService.generateAnalysisForSite(siteKey, snapshot);

    const reportResult = await pool.query(
      `INSERT INTO recommendation_reports (site_key, campaign_id, date_preset, analysis_text) VALUES ($1, $2, $3, $4) RETURNING *`,
      [siteKey, campaignId || null, cacheKey, analysis]
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