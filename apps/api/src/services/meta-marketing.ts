import axios from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

export class MetaMarketingService {
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static asArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
      ? (value.filter(MetaMarketingService.isRecord) as Array<Record<string, unknown>>)
      : [];
  }

  private static asString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  private static getActionType(item: Record<string, unknown>): string | null {
    const v = item.action_type;
    return typeof v === 'string' ? v : null;
  }

  private static getValueField(item: Record<string, unknown>): string | number | null {
    const v = item.value;
    if (typeof v === 'string' || typeof v === 'number') return v;
    return null;
  }

  private isProbablyValidToken(token: string): boolean {
    const t = token.trim();
    if (t.length < 20) return false;
    if (/\s/.test(t)) return false;
    if (!/^[A-Za-z0-9._|-]+$/.test(t)) return false;
    return true;
  }

  private async getConfig(siteId: number) {
    const result = await pool.query(
      `SELECT marketing_token_enc, fb_user_token_enc, ad_account_id, enabled
       FROM integrations_meta
       WHERE site_id = $1`,
      [siteId]
    );
    if (!(result.rowCount || 0)) throw new Error('Integração Meta não configurada.');
    const row = result.rows[0];
    if (row.enabled === false) throw new Error('Integração Meta desativada.');
    if (!row.ad_account_id) throw new Error('Ad Account ID não configurado.');
    const adAccountId = this.normalizeAdAccountId(String(row.ad_account_id || ''));
    if (!adAccountId) throw new Error('Ad Account ID inválido.');

    const tokenCandidates = [row.marketing_token_enc, row.fb_user_token_enc].filter(
      Boolean
    ) as string[];
    for (const enc of tokenCandidates) {
      try {
        const token = decryptString(enc).trim().replace(/\s+/g, '');
        if (this.isProbablyValidToken(token)) return { token, adAccountId };
      } catch {
        continue;
      }
    }

    throw new Error('Token Meta inválido ou ausente.');
  }

  private normalizeAdAccountId(value: string): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
  }

  private asNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private asInt(v: unknown): number | null {
    const n = this.asNumber(v);
    if (n === null) return null;
    const i = Math.trunc(n);
    return Number.isFinite(i) ? i : null;
  }

  /**
   * Normalize the 'results' field from Meta API which can be a number or a complex object.
   * Format: [ { values: [ { value: '1', ... } ], indicator: '...' } ]
   */
  private normalizeResults(v: unknown): number | null {
    if (v === null || v === undefined) return null;

    // Direct number/string
    const simple = this.asInt(v);
    if (simple !== null) return simple;

    // Array structure
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (first && typeof first === 'object') {
        const values = (first as any).values;
        if (Array.isArray(values) && values.length > 0) {
          const val = values[0].value;
          return this.asInt(val);
        }
      }
    }

    return null;
  }

  /**
   * Sum all entries of an action_type from an actions array.
   * The Meta API can return multiple entries for the same action_type (e.g. per window).
   * We pick the last/deduplicated entry — Meta typically returns one per type at insight level,
   * but if duplicates exist we take the max to avoid double-counting.
   */
  private getActionCount(actions: unknown, ...actionTypes: string[]): number | null {
    const list = MetaMarketingService.asArray(actions);
    let found: number | null = null;
    for (const actionType of actionTypes) {
      const matches = list.filter(
        (a) => MetaMarketingService.getActionType(a) === actionType
      );
      if (matches.length === 0) continue;
      // Take max in case of duplicate windows
      const val = Math.max(
        ...matches.map((m) => this.asInt(MetaMarketingService.getValueField(m)) ?? 0)
      );
      if (found === null || val > found) found = val;
      break; // use first matching action type in priority order
    }
    return found;
  }

  private getCostPerAction(costs: unknown, actionType: string): number | null {
    const list = MetaMarketingService.asArray(costs);
    const found = list.find((a) => MetaMarketingService.getActionType(a) === actionType);
    return this.asNumber(found ? MetaMarketingService.getValueField(found) : null);
  }

  /**
   * Extract outbound_clicks from the outbound_clicks array field.
   * The Meta API returns outbound_clicks as an array: [{action_type: "outbound_click", value: "N"}]
   * NOT as a top-level numeric field.
   */
  private getOutboundClicks(row: Record<string, unknown>): number {
    const arr = MetaMarketingService.asArray(row.outbound_clicks);
    if (arr.length > 0) {
      // Sum all entries (usually just one: action_type "outbound_click")
      return arr.reduce((sum, item) => {
        return sum + (this.asInt(MetaMarketingService.getValueField(item)) ?? 0);
      }, 0);
    }
    // Fallback: try as a direct number (shouldn't happen but just in case)
    return this.asInt(row.outbound_clicks) ?? 0;
  }

  private getVideo3sViews(actions: unknown, row: Record<string, unknown>): number {
    const fromActions = this.getActionCount(actions, 'video_view', 'video_3_sec_watched');
    if (fromActions !== null) return fromActions;
    const arr = MetaMarketingService.asArray(row.video_3_sec_watched_actions);
    if (arr.length > 0) {
      return arr.reduce((sum, item) => {
        return sum + (this.asInt(MetaMarketingService.getValueField(item)) ?? 0);
      }, 0);
    }
    return this.asInt(row.video_3_sec_watched_actions) ?? 0;
  }

  private getCustomEvent(actions: unknown): { name: string | null; count: number | null } {
    const list = MetaMarketingService.asArray(actions);
    const prefixOffsite = 'offsite_conversion.custom.';
    const prefixOmni = 'omni_custom.';
    let bestName: string | null = null;
    let bestCount: number | null = null;
    for (const item of list) {
      const actionType = MetaMarketingService.getActionType(item);
      if (!actionType) continue;

      const isCustomOffsite = actionType.startsWith(prefixOffsite) || actionType === 'offsite_conversion.fb_pixel_custom';
      const isCustomOmni = actionType.startsWith(prefixOmni);
      if (!isCustomOffsite && !isCustomOmni) continue;

      const count = this.asInt(MetaMarketingService.getValueField(item));
      if (count === null) continue;

      let name = 'fb_pixel_custom';
      if (actionType.startsWith(prefixOffsite)) name = actionType.slice(prefixOffsite.length);
      else if (actionType.startsWith(prefixOmni)) name = actionType.slice(prefixOmni.length);

      if (bestCount === null || count > bestCount) {
        bestCount = count;
        bestName = name || null;
      }
    }
    return { name: bestName, count: bestCount };
  }

  /**
   * Fields to request from Meta API.
   * Note: outbound_clicks and unique_link_clicks are returned as arrays by Meta,
   * so they must be in the fields list but parsed as arrays, not numbers.
   */
  private static readonly BASE_FIELDS = [
    'campaign_name',
    'campaign_id',
    'spend',
    'impressions',
    'clicks',
    'unique_clicks',
    'reach',
    'frequency',
    'cpm',
    'cpc',
    'ctr',
    'unique_ctr',
    'inline_link_clicks',
    'outbound_clicks',     // returned as array [{action_type, value}]
    'actions',
    'cost_per_action_type',
    'date_start',
    'date_stop',
    'objective',
    'results',
    'result_rate',
  ] as const;

  /**
   * Resolve the date range that will be synced, given a preset or explicit range.
   * Returns ISO date strings for the since/until window.
   */
  private resolveDateRange(
    datePreset: string,
    timeRange?: { since: string; until: string }
  ): { since: string; until: string } {
    if (timeRange) return timeRange;

    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const addDays = (d: Date, n: number) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

    const todayStr = fmt(today);

    if (datePreset === 'today') return { since: todayStr, until: todayStr };
    if (datePreset === 'yesterday') {
      const y = fmt(addDays(today, -1));
      return { since: y, until: y };
    }
    if (datePreset === 'last_7d')
      return { since: fmt(addDays(today, -7)), until: todayStr };
    if (datePreset === 'last_14d')
      return { since: fmt(addDays(today, -14)), until: todayStr };
    if (datePreset === 'last_30d')
      return { since: fmt(addDays(today, -30)), until: todayStr };
    if (datePreset === 'maximum')
      return { since: '2020-01-01', until: todayStr };

    // default
    return { since: fmt(addDays(today, -7)), until: todayStr };
  }

  public async syncDailyInsights(
    siteId: number,
    datePreset: string = 'last_7d',
    timeRange?: { since: string; until: string }
  ) {
    const cfg = await this.getConfig(siteId);
    if (!cfg) return;

    // Resolve the actual date window so we can delete stale rows before inserting
    const range = this.resolveDateRange(datePreset, timeRange);
    const timeParams = { time_range: { since: range.since, until: range.until } };

    try {
      const baseUrl = `https://graph.facebook.com/v19.0/${cfg.adAccountId}/insights`;

      // ── Fetch all three levels ────────────────────────────────────────────

      const adFields = [
        ...MetaMarketingService.BASE_FIELDS,
        'adset_name', 'adset_id', 'ad_name', 'ad_id',
      ].join(',');

      const adSetFields = [
        ...MetaMarketingService.BASE_FIELDS,
        'adset_name', 'adset_id',
      ].join(',');

      const campaignFields = [...MetaMarketingService.BASE_FIELDS].join(',');

      const [adResponse, adSetResponse, campaignResponse] = await Promise.all([
        axios.get(baseUrl, {
          params: { access_token: cfg.token, level: 'ad', ...timeParams, time_increment: 1, fields: adFields, limit: 1000 },
        }),
        axios.get(baseUrl, {
          params: { access_token: cfg.token, level: 'adset', ...timeParams, time_increment: 1, fields: adSetFields, limit: 1000 },
        }),
        axios.get(baseUrl, {
          params: { access_token: cfg.token, level: 'campaign', ...timeParams, time_increment: 1, fields: campaignFields, limit: 1000 },
        }),
      ]);

      const adInsights: Record<string, unknown>[] = adResponse.data.data ?? [];
      const adSetInsights: Record<string, unknown>[] = adSetResponse.data.data ?? [];
      const campaignInsights: Record<string, unknown>[] = campaignResponse.data.data ?? [];

      console.log(
        `[MetaSync] site=${siteId} range=${range.since}→${range.until} ` +
        `campaigns=${campaignInsights.length} adsets=${adSetInsights.length} ads=${adInsights.length}`
      );

      // ── DELETE existing rows for this site+range before re-inserting ──────
      // This guarantees idempotency regardless of whether the DB has the
      // partial unique indexes. Without this, repeated syncs double-count.
      await pool.query(
        `DELETE FROM meta_insights_daily
         WHERE site_id = $1
           AND date_start >= $2
           AND date_start <= $3`,
        [siteId, range.since, range.until]
      );

      // ── Insert fresh rows ─────────────────────────────────────────────────
      for (const row of campaignInsights) await this.persistCampaignInsight(siteId, row);
      for (const row of adSetInsights) await this.persistAdSetInsight(siteId, row);
      for (const row of adInsights) await this.persistAdInsight(siteId, row);

      return {
        count: adInsights.length + adSetInsights.length + campaignInsights.length,
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error('Meta Marketing API Error:', error.response?.data || error.message);
      } else if (error instanceof Error) {
        console.error('Meta Marketing API Error:', error.message);
      } else {
        console.error('Meta Marketing API Error:', error);
      }
      throw error;
    }
  }

  public async fetchCampaignInsights(
    siteId: number,
    datePreset: string = 'last_7d',
    timeRange?: { since: string; until: string }
  ) {
    const cfg = await this.getConfig(siteId);
    if (!cfg) return [];

    const fields = [...MetaMarketingService.BASE_FIELDS].join(',');
    const url = `https://graph.facebook.com/v19.0/${cfg.adAccountId}/insights`;

    const response = await axios.get(url, {
      params: {
        access_token: cfg.token,
        level: 'campaign',
        ...(timeRange ? { time_range: timeRange } : { date_preset: datePreset }),
        fields,
        limit: 500,
      },
    });

    const rows: Record<string, unknown>[] = Array.isArray(response.data?.data)
      ? response.data.data
      : [];

    return rows.map((row) => {
      const actions = row.actions;
      const costs = row.cost_per_action_type;

      const spend = this.asNumber(row.spend) ?? 0;
      const impressions = this.asInt(row.impressions) ?? 0;
      const frequency = this.asNumber(row.frequency) ?? 0;
      const clicks = this.asInt(row.clicks) ?? 0;
      const uniqueClicks = this.asInt(row.unique_clicks) ?? 0;
      const linkClicks = this.getActionCount(actions, 'link_click') ?? 0;
      const uniqueLinkClicksArr = MetaMarketingService.asArray(row.unique_link_clicks);
      const uniqueLinkClicks =
        uniqueLinkClicksArr.length > 0
          ? uniqueLinkClicksArr.reduce(
            (sum, item) => sum + (this.asInt(MetaMarketingService.getValueField(item)) ?? 0),
            0
          )
          : linkClicks > 0
            ? linkClicks
            : uniqueClicks;
      const linkBase = linkClicks > 0 ? linkClicks : uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
      const ctr = impressions > 0 ? (linkBase / impressions) * 100 : 0;
      const cpc = linkBase > 0 ? spend / linkBase : 0;
      const cpm = this.asNumber(row.cpm) ?? (impressions > 0 ? (spend / impressions) * 1000 : 0);

      // outbound_clicks is an array field from Meta, not a scalar
      const outboundClicks = this.getOutboundClicks(row);
      const video3sViews = this.getVideo3sViews(actions, row);

      // unique_link_clicks is also an array field from Meta
      const landingPageViews = this.getActionCount(actions, 'landing_page_view', 'omni_landing_page_view') ?? 0;

      // Contacts: try multiple action_type aliases in priority order
      const contacts =
        this.getActionCount(
          actions,
          'onsite_conversion.messaging_conversation_started_7d',
          'onsite_conversion.total_messaging_connection',
          'contact',
          'omni_contact',
          'onsite_conversion.contact',
          'onsite_conversion.messaging_first_reply',
          'messaging_conversation_started_7d',
          'total_messaging_connection',
          'offsite_conversion.fb_pixel_custom'
        ) ?? 0;

      const leads = this.getActionCount(actions, 'lead', 'omni_lead') ?? 0;
      const addsToCart = this.getActionCount(actions, 'add_to_cart', 'omni_add_to_cart') ?? 0;
      const initiatesCheckout =
        this.getActionCount(actions, 'initiate_checkout', 'omni_initiated_checkout') ?? 0;
      const purchases = this.getActionCount(actions, 'purchase', 'omni_purchase') ?? 0;
      const costPerLead = this.getCostPerAction(costs, 'lead');
      const costPerPurchase = this.getCostPerAction(costs, 'purchase');
      const objective = MetaMarketingService.asString(row.objective);
      const results = this.normalizeResults(row.results) ?? 0;
      const resultRate = this.asNumber(row.result_rate) ?? 0;
      const customEvent = this.getCustomEvent(actions);

      return {
        campaign_id: MetaMarketingService.asString(row.campaign_id),
        campaign_name: MetaMarketingService.asString(row.campaign_name),
        spend,
        impressions,
        frequency,
        clicks,
        unique_clicks: uniqueClicks,
        unique_link_clicks: uniqueLinkClicks,
        ctr,
        cpc,
        cpm,
        outbound_clicks: outboundClicks,
        video_3s_views: video3sViews,
        landing_page_views: landingPageViews,
        contacts,
        leads,
        adds_to_cart: addsToCart,
        initiates_checkout: initiatesCheckout,
        purchases,
        cost_per_lead: costPerLead,
        cost_per_purchase: costPerPurchase,
        objective,
        results,
        result_rate: resultRate,
        custom_event_name: customEvent.name,
        custom_event_count: customEvent.count ?? 0,
      };
    });
  }

  /**
   * Extract all common metric values from a Meta insights row.
   * Returns exactly 31 values matching the column order in persistAdInsight /
   * persistAdSetInsight / persistCampaignInsight (after their respective prefixes).
   *
   * Column order:
   *   spend, impressions, clicks, unique_clicks,
   *   link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
   *   reach, frequency, cpc, ctr, unique_ctr, cpm,
   *   leads, contacts, purchases, adds_to_cart, initiates_checkout,
   *   cost_per_lead, cost_per_purchase,
   *   date_start, date_stop, raw_payload
   */
  private getInsightValues(siteId: number, row: Record<string, unknown>): unknown[] {
    const actions = row.actions;
    const costs = row.cost_per_action_type;

    // --- Scalar fields (Meta returns these as strings) ---
    const spend = this.asNumber(row.spend);
    const impressions = this.asInt(row.impressions);
    const clicks = this.asInt(row.clicks);
    const uniqueClicks = this.asInt(row.unique_clicks);
    const inlineLinkClicks = this.asInt(row.inline_link_clicks);
    const reach = this.asInt(row.reach);
    const frequency = this.asNumber(row.frequency);
    const cpc = this.asNumber(row.cpc);
    const ctr = this.asNumber(row.ctr);
    const uniqueCtr = this.asNumber(row.unique_ctr);
    const cpm = this.asNumber(row.cpm);

    // --- Array fields from Meta API ---

    // link_clicks: from actions array
    const linkClicks = this.getActionCount(actions, 'link_click');

    // unique_link_clicks: Meta returns this as an array [{action_type, value}], NOT a scalar
    const uniqueLinkClicksArr = MetaMarketingService.asArray(row.unique_link_clicks);
    const uniqueLinkClicks =
      uniqueLinkClicksArr.length > 0
        ? uniqueLinkClicksArr.reduce(
          (sum, item) => sum + (this.asInt(MetaMarketingService.getValueField(item)) ?? 0),
          0
        )
        : linkClicks; // fallback to link_clicks if not present

    // outbound_clicks: Meta returns this as an array [{action_type: "outbound_click", value}]
    const outboundClicks = this.getOutboundClicks(row);

    const video3sViews = this.getVideo3sViews(actions, row);

    // landing_page_view: from actions array
    const landingPageViews = this.getActionCount(actions, 'landing_page_view', 'omni_landing_page_view');

    // --- Conversion actions (multiple aliases per type) ---
    const leads = this.getActionCount(actions, 'lead', 'omni_lead');
    const contacts = this.getActionCount(
      actions,
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.total_messaging_connection',
      'contact',
      'omni_contact',
      'onsite_conversion.contact',
      'onsite_conversion.messaging_first_reply',
      'messaging_conversation_started_7d',
      'total_messaging_connection',
      'offsite_conversion.fb_pixel_custom'
    );
    const purchases = this.getActionCount(actions, 'purchase', 'omni_purchase');
    const addsToCart = this.getActionCount(actions, 'add_to_cart', 'omni_add_to_cart');
    const initiatesCheckout = this.getActionCount(
      actions,
      'initiate_checkout',
      'omni_initiated_checkout'
    );

    const costPerLead = this.getCostPerAction(costs, 'lead');
    const costPerPurchase = this.getCostPerAction(costs, 'purchase');
    const objective = MetaMarketingService.asString(row.objective);
    const results = this.normalizeResults(row.results);
    const resultRate = this.asNumber(row.result_rate);
    const customEvent = this.getCustomEvent(actions);

    return [
      spend,
      impressions,
      clicks,
      uniqueClicks,
      linkClicks,
      uniqueLinkClicks,
      inlineLinkClicks,
      outboundClicks,
      video3sViews,
      landingPageViews,
      reach,
      frequency,
      cpc,
      ctr,
      uniqueCtr,
      cpm,
      leads,
      contacts,
      purchases,
      addsToCart,
      initiatesCheckout,
      costPerLead,
      costPerPurchase,
      objective,
      results,
      resultRate,
      MetaMarketingService.asString(row.date_start),
      MetaMarketingService.asString(row.date_stop),
      JSON.stringify(row),
      customEvent.name,
      customEvent.count,
    ];
  }

  private async persistAdInsight(siteId: number, row: Record<string, unknown>) {
    // syncDailyInsights deletes rows for this site+range before calling persist*,
    // so a plain INSERT is safe and avoids fragile partial-index ON CONFLICT logic.
    await pool.query(
      `INSERT INTO meta_insights_daily (
        site_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33,
        $34, $35, $36, $37, $38
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.ad_id),
        MetaMarketingService.asString(row.ad_name),
        MetaMarketingService.asString(row.adset_id),
        MetaMarketingService.asString(row.adset_name),
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...this.getInsightValues(siteId, row),
      ]
    );
  }

  private async persistAdSetInsight(siteId: number, row: Record<string, unknown>) {
    await pool.query(
      `INSERT INTO meta_insights_daily (
        site_id, adset_id, adset_name, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31,
        $32, $33, $34, $35, $36
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.adset_id),
        MetaMarketingService.asString(row.adset_name),
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...this.getInsightValues(siteId, row),
      ]
    );
  }

  private async persistCampaignInsight(siteId: number, row: Record<string, unknown>) {
    await pool.query(
      `INSERT INTO meta_insights_daily (
        site_id, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29,
        $30, $31, $32, $33, $34
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...this.getInsightValues(siteId, row),
      ]
    );
  }
}

export const metaMarketingService = new MetaMarketingService();
