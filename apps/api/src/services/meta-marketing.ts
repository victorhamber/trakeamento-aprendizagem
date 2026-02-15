import axios from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

export class MetaMarketingService {
  private async getConfig(siteId: number) {
    const result = await pool.query(
      `SELECT marketing_token_enc, ad_account_id, enabled
       FROM integrations_meta
       WHERE site_id = $1`,
      [siteId]
    );
    if (!(result.rowCount || 0)) return null;
    const row = result.rows[0];
    if (row.enabled === false) return null;
    if (!row.marketing_token_enc || !row.ad_account_id) return null;
    const adAccountId = this.normalizeAdAccountId(String(row.ad_account_id || ''));
    if (!adAccountId) return null;
    return { token: decryptString(row.marketing_token_enc as string), adAccountId };
  }

  private normalizeAdAccountId(value: string): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
  }

  private asNumber(v: any): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private asInt(v: any): number | null {
    const n = this.asNumber(v);
    if (n === null) return null;
    const i = Math.trunc(n);
    return Number.isFinite(i) ? i : null;
  }

  private getActionCount(actions: any, actionType: string): number | null {
    const list = Array.isArray(actions) ? actions : [];
    const found = list.find((a) => a && a.action_type === actionType);
    return this.asInt(found?.value);
  }

  private getCostPerAction(costs: any, actionType: string): number | null {
    const list = Array.isArray(costs) ? costs : [];
    const found = list.find((a) => a && a.action_type === actionType);
    return this.asNumber(found?.value);
  }

  public async syncDailyInsights(siteId: number, datePreset: string = 'last_7d') {
    const cfg = await this.getConfig(siteId);
    if (!cfg) return;

    try {
      const fields = [
        'campaign_name',
        'campaign_id',
        'adset_name',
        'adset_id',
        'ad_name',
        'ad_id',
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
        'outbound_clicks',
        'actions',
        'cost_per_action_type',
        'date_start',
        'date_stop',
      ].join(',');
      const url = `https://graph.facebook.com/v19.0/${cfg.adAccountId}/insights`;

      const response = await axios.get(url, {
        params: {
          access_token: cfg.token,
          level: 'ad',
          date_preset: datePreset,
          time_increment: 1,
          fields: fields,
          limit: 1000
        }
      });

      const insights = response.data.data;
      console.log(`Fetched ${insights.length} insights records`);

      for (const row of insights) {
        await this.persistInsight(siteId, row);
      }

      return { count: insights.length };
    } catch (error: any) {
      console.error('Meta Marketing API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  public async fetchCampaignInsights(siteId: number, datePreset: string = 'last_7d') {
    const cfg = await this.getConfig(siteId);
    if (!cfg) return [];

    const fields = [
      'campaign_name',
      'campaign_id',
      'spend',
      'impressions',
      'clicks',
      'cpm',
      'cpc',
      'ctr',
      'outbound_clicks',
      'actions',
      'cost_per_action_type',
    ].join(',');
    const url = `https://graph.facebook.com/v19.0/${cfg.adAccountId}/insights`;

    const response = await axios.get(url, {
      params: {
        access_token: cfg.token,
        level: 'campaign',
        date_preset: datePreset,
        fields: fields,
        limit: 500,
      },
    });

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows.map((row: any) => {
      const actions = row.actions;
      const costs = row.cost_per_action_type;
      const spend = this.asNumber(row.spend) || 0;
      const impressions = this.asInt(row.impressions) || 0;
      const clicks = this.asInt(row.clicks) || 0;
      const ctr = this.asNumber(row.ctr) ?? (impressions > 0 ? (clicks / impressions) * 100 : 0);
      const cpc = this.asNumber(row.cpc) ?? (clicks > 0 ? spend / clicks : 0);
      const cpm = this.asNumber(row.cpm) ?? (impressions > 0 ? (spend / impressions) * 1000 : 0);
      const outboundClicks =
        this.asInt(row.outbound_clicks) ?? this.getActionCount(actions, 'outbound_click') ?? 0;
      const landingPageViews = this.getActionCount(actions, 'landing_page_view') ?? 0;
      const leads = this.getActionCount(actions, 'lead') ?? 0;
      const purchases = this.getActionCount(actions, 'purchase') ?? 0;
      const costPerLead = this.getCostPerAction(costs, 'lead');
      const costPerPurchase = this.getCostPerAction(costs, 'purchase');

      return {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        spend,
        impressions,
        clicks,
        ctr,
        cpc,
        cpm,
        outbound_clicks: outboundClicks,
        landing_page_views: landingPageViews,
        leads,
        purchases,
        cost_per_lead: costPerLead,
        cost_per_purchase: costPerPurchase,
      };
    });
  }

  private async persistInsight(siteId: number, row: any) {
    const query = `
      INSERT INTO meta_insights_daily (
        site_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, inline_link_clicks, outbound_clicks, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        date_start, date_stop, raw_payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29,
        $30, $31, $32
      )
      ON CONFLICT (site_id, ad_id, date_start) DO UPDATE SET
        spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        unique_clicks = EXCLUDED.unique_clicks,
        link_clicks = EXCLUDED.link_clicks,
        inline_link_clicks = EXCLUDED.inline_link_clicks,
        outbound_clicks = EXCLUDED.outbound_clicks,
        landing_page_views = EXCLUDED.landing_page_views,
        reach = EXCLUDED.reach,
        frequency = EXCLUDED.frequency,
        cpc = EXCLUDED.cpc,
        ctr = EXCLUDED.ctr,
        unique_ctr = EXCLUDED.unique_ctr,
        cpm = EXCLUDED.cpm,
        leads = EXCLUDED.leads,
        purchases = EXCLUDED.purchases,
        adds_to_cart = EXCLUDED.adds_to_cart,
        initiates_checkout = EXCLUDED.initiates_checkout,
        cost_per_lead = EXCLUDED.cost_per_lead,
        cost_per_purchase = EXCLUDED.cost_per_purchase,
        raw_payload = EXCLUDED.raw_payload
    `;

    const actions = row.actions;
    const costs = row.cost_per_action_type;

    const leadCount = this.getActionCount(actions, 'lead');
    const purchaseCount = this.getActionCount(actions, 'purchase');
    const addToCartCount = this.getActionCount(actions, 'add_to_cart');
    const initiateCheckoutCount = this.getActionCount(actions, 'initiate_checkout');
    const landingPageViews = this.getActionCount(actions, 'landing_page_view');
    const linkClicks = this.getActionCount(actions, 'link_click');

    const costPerLead = this.getCostPerAction(costs, 'lead');
    const costPerPurchase = this.getCostPerAction(costs, 'purchase');

    const values = [
      siteId,
      row.ad_id, row.ad_name, row.adset_id, row.adset_name, row.campaign_id, row.campaign_name,
      this.asNumber(row.spend),
      this.asInt(row.impressions),
      this.asInt(row.clicks),
      this.asInt(row.unique_clicks),
      linkClicks,
      this.asInt(row.inline_link_clicks),
      this.asInt(row.outbound_clicks),
      landingPageViews,
      this.asInt(row.reach),
      this.asNumber(row.frequency),
      this.asNumber(row.cpc),
      this.asNumber(row.ctr),
      this.asNumber(row.unique_ctr),
      this.asNumber(row.cpm),
      leadCount,
      purchaseCount,
      addToCartCount,
      initiateCheckoutCount,
      costPerLead,
      costPerPurchase,
      row.date_start,
      row.date_stop,
      JSON.stringify(row)
    ];

    await pool.query(query, values);
  }
}

export const metaMarketingService = new MetaMarketingService();
