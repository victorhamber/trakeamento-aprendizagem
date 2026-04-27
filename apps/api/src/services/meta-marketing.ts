import axios from 'axios';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';
import { summarizeMetaMarketingError } from '../lib/meta-api-error';
import { META_GRAPH_API_VERSION } from '../lib/meta-graph-version';
import { addDaysToYmd, getMetaReportTimeZone, getYmdInReportTz } from '../lib/meta-report-timezone';

export class MetaMarketingService {
  private summarizeMetaError(err: unknown): string {
    return summarizeMetaMarketingError(err);
  }

  private isRetryableMetaError(err: unknown): boolean {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status;
    const fb: any = (err.response?.data as any)?.error;
    const code = fb?.code;
    const sub = fb?.error_subcode;
    const msg = String(fb?.message || err.message || '').toLowerCase();

    // Meta às vezes responde 400 com "Service temporarily unavailable" (code=2, subcode=1504044).
    if (code === 2) return true;
    if (sub === 1504044) return true;
    if (status === 429 || status === 503 || status === 502 || status === 504) return true;
    if (msg.includes('temporarily unavailable') || msg.includes('unknown error')) return true;
    return false;
  }

  /** Batch Graph retorna HTTP 200 com itens code=400 — parse lança Error com corpo JSON da Meta. */
  private isRetryableBatchParseError(err: unknown): boolean {
    const msg = String((err as Error)?.message || '');
    if (!msg.includes('Batch item HTTP')) return false;
    const lower = msg.toLowerCase();
    if (lower.includes('temporarily unavailable')) return true;
    if (lower.includes('"code":2') || lower.includes('"code": 2')) return true;
    if (lower.includes('1504044')) return true;
    if (lower.includes('unknown error')) return true;
    return false;
  }

  private async withMetaRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const retryable = this.isRetryableMetaError(err) || this.isRetryableBatchParseError(err);
        if (!retryable || attempt >= maxAttempts) throw err;
        const backoffMs = Math.min(35_000, 1000 * Math.pow(2, attempt - 1));
        console.warn(
          `[MetaSync] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms: ${this.summarizeMetaError(err)}`
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    // should be unreachable
    throw new Error('Meta retry loop exhausted');
  }

  private dedupeInsightRows(
    rows: Record<string, unknown>[],
    keyOf: (row: Record<string, unknown>) => string
  ): Record<string, unknown>[] {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(keyOf(r), r);
    return Array.from(map.values());
  }

  private async fetchAdSetMetaMap(
    token: string,
    adsetIds: string[]
  ): Promise<Map<string, { optimizationGoal: string | null; optimizedEventName: string | null }>> {
    const out = new Map<string, { optimizationGoal: string | null; optimizedEventName: string | null }>();
    const uniq = Array.from(new Set(adsetIds.filter(Boolean)));
    if (!uniq.length) return out;

    // Graph API batch aceita até 50 itens por request.
    const chunks: string[][] = [];
    for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));

    for (const chunk of chunks) {
      const batchPayload = chunk.map((id) => ({
        method: 'GET',
        relative_url: `${encodeURIComponent(id)}?fields=optimization_goal,promoted_object`,
      }));

      const body = new URLSearchParams();
      body.append('access_token', token);
      body.append('batch', JSON.stringify(batchPayload));

      const res = await this.withMetaRetry(
        () =>
          axios.post(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/`, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 120_000,
          }),
        'adset-meta batch'
      );

      const arr = res.data;
      if (!Array.isArray(arr)) continue;

      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const adsetId = chunk[i];
        const code = typeof item?.code === 'number' ? item.code : 0;
        if (code < 200 || code >= 300) continue;
        if (!item?.body || typeof item.body !== 'string') continue;
        try {
          const parsed = JSON.parse(item.body);
          const optimizationGoal =
            parsed?.optimization_goal && typeof parsed.optimization_goal === 'string'
              ? parsed.optimization_goal
              : null;

          const promoted = parsed?.promoted_object;
          const optimizedEventName =
            (promoted?.custom_event_type && String(promoted.custom_event_type)) ||
            (promoted?.event_name && String(promoted.event_name)) ||
            (promoted?.custom_event_str && String(promoted.custom_event_str)) ||
            null;

          out.set(adsetId, { optimizationGoal, optimizedEventName });
        } catch {
          // ignore bad JSON
        }
      }
    }

    return out;
  }
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

    // Preferir token do OAuth (por usuário/conta) — marketing_token só como fallback legado.
    const tokenCandidates = [row.fb_user_token_enc, row.marketing_token_enc].filter(
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

  /**
   * Maior valor entre vários action_type (cada um avaliado à parte).
   * Útil quando o Ads Manager mostra um número sob um alias (ex.: pixel offsite)
   * e outro campo da API traz só initiate_checkout — getActionCount pegaria só o primeiro.
   */
  private getMaxActionCountAcross(actions: unknown, actionTypes: string[]): number {
    const list = MetaMarketingService.asArray(actions);
    let max = 0;
    for (const actionType of actionTypes) {
      const matches = list.filter(
        (a) => MetaMarketingService.getActionType(a) === actionType
      );
      if (matches.length === 0) continue;
      const val = Math.max(
        ...matches.map((m) => this.asInt(MetaMarketingService.getValueField(m)) ?? 0)
      );
      if (val > max) max = val;
    }
    return max;
  }

  private getInitiateCheckoutCount(actions: unknown): number {
    return this.getMaxActionCountAcross(actions, [
      'initiate_checkout',
      'omni_initiated_checkout',
      'offsite_conversion.fb_pixel_initiate_checkout',
    ]);
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
    'action_values',       // returned as array [{action_type, value}] — purchase revenue
    'cost_per_action_type',
    'date_start',
    'date_stop',
    'objective',
    'results',
    'result_rate',
    'quality_ranking',
    'engagement_rate_ranking',
    'conversion_rate_ranking',
  ] as const;

  /**
   * Resolve the date range that will be synced, given a preset or explicit range.
   * Returns ISO date strings for the since/until window.
   */
  private resolveDateRange(
    datePreset: string,
    timeRange?: { since: string; until: string }
  ): { since: string; until: string } {
    const tz = getMetaReportTimeZone();
    const todayStr = getYmdInReportTz(new Date(), tz);
    // Meta (#3018): o início do período não pode ser mais antigo que ~37 meses.
    // Usamos 35 meses a partir do 1º do mês UTC para sobrar margem (evita since tipo 2023-02-28 falhar).
    const minAllowedSince = (() => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(d.getUTCMonth() - 35);
      return getYmdInReportTz(d, tz);
    })();

    if (timeRange) {
      const since = timeRange.since < minAllowedSince ? minAllowedSince : timeRange.since;
      return { since, until: timeRange.until };
    }

    if (datePreset === 'today') return { since: todayStr, until: todayStr };
    if (datePreset === 'yesterday') {
      const y = addDaysToYmd(todayStr, -1);
      return { since: y, until: y };
    }
    if (datePreset === 'last_7d')
      return { since: addDaysToYmd(todayStr, -7), until: todayStr };
    if (datePreset === 'last_14d')
      return { since: addDaysToYmd(todayStr, -14), until: todayStr };
    if (datePreset === 'last_30d')
      return { since: addDaysToYmd(todayStr, -30), until: todayStr };
    if (datePreset === 'maximum')
      return { since: minAllowedSince, until: todayStr };

    // default
    return { since: addDaysToYmd(todayStr, -7), until: todayStr };
  }

  /**
   * Presets como `maximum` geram anos de linhas com time_increment=1; a Meta costuma falhar (1504044 / timeout).
   * Mantemos no máx. ~13 meses por sync; linhas mais antigas em meta_insights_daily permanecem até outro sync menor.
   */
  private clampInsightsSyncRange(range: { since: string; until: string }): { since: string; until: string } {
    const MAX_DAYS = 400;
    const a = new Date(`${range.since}T12:00:00.000Z`);
    const b = new Date(`${range.until}T12:00:00.000Z`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return range;
    const diff = Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
    if (diff <= MAX_DAYS) return range;
    const cappedSince = addDaysToYmd(range.until, -MAX_DAYS);
    console.warn(
      `[MetaSync] Insights window capped to ${MAX_DAYS}d (requested ~${diff}d: ${range.since} → ${range.until})`
    );
    return { since: cappedSince, until: range.until };
  }

  private async fetchAllPages(url: string, params: any): Promise<Record<string, unknown>[]> {
    let allData: Record<string, unknown>[] = [];
    let currentUrl: string | null = url;
    let currentParams = params;

    while (currentUrl) {
      const apiRes: any = await this.withMetaRetry(
        () => axios.get(currentUrl as string, { params: currentParams }),
        'insights page'
      );
      const data = apiRes.data?.data;
      if (Array.isArray(data)) {
        allData = allData.concat(data);
      }

      const nextUrl: any = apiRes.data?.paging?.next;
      if (nextUrl && typeof nextUrl === 'string') {
        currentUrl = nextUrl;
        currentParams = {}; // 'next' URL already contains all tokens and parameters
      } else {
        currentUrl = null;
      }
    }
    return allData;
  }

  /** Query string para insights no formato esperado pela Graph API (time_range JSON). */
  private buildInsightsRelativeUrl(
    adAccountId: string,
    level: 'ad' | 'adset' | 'campaign',
    fields: string,
    since: string,
    until: string
  ): string {
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const f = encodeURIComponent(fields);
    return `${encodeURIComponent(adAccountId)}/insights?level=${level}&time_increment=1&limit=500&fields=${f}&time_range=${timeRange}`;
  }

  private parseBatchInsightItem(item: { code?: number; body?: string }): {
    data: Record<string, unknown>[];
    nextUrl: string | null;
  } {
    const code = typeof item.code === 'number' ? item.code : 0;
    if (code < 200 || code >= 300 || !item.body) {
      throw new Error(`Batch item HTTP ${code}: ${item.body || ''}`);
    }
    let parsed: { data?: unknown; paging?: { next?: string } };
    try {
      parsed = JSON.parse(item.body) as typeof parsed;
    } catch {
      throw new Error('Batch item body is not JSON');
    }
    const data = Array.isArray(parsed.data)
      ? (parsed.data.filter(MetaMarketingService.isRecord) as Record<string, unknown>[])
      : [];
    const nextUrl =
      parsed.paging?.next && typeof parsed.paging.next === 'string' ? parsed.paging.next : null;
    return { data, nextUrl };
  }

  /**
   * Primeira página dos três níveis de insights em uma única chamada batch (Graph API),
   * reduzindo 3 HTTP round-trips para 1. Paginação seguinte usa GET direto (URLs em paging.next).
   */
  private async fetchInsightsFirstPagesBatch(
    token: string,
    adAccountId: string,
    since: string,
    until: string,
    adFields: string,
    adSetFields: string,
    campaignFields: string
  ): Promise<[
    { data: Record<string, unknown>[]; nextUrl: string | null },
    { data: Record<string, unknown>[]; nextUrl: string | null },
    { data: Record<string, unknown>[]; nextUrl: string | null },
  ]> {
    const ruAd = this.buildInsightsRelativeUrl(adAccountId, 'ad', adFields, since, until);
    const ruAdset = this.buildInsightsRelativeUrl(adAccountId, 'adset', adSetFields, since, until);
    const ruCamp = this.buildInsightsRelativeUrl(adAccountId, 'campaign', campaignFields, since, until);

    const batchPayload = [
      { method: 'GET', relative_url: ruAd },
      { method: 'GET', relative_url: ruAdset },
      { method: 'GET', relative_url: ruCamp },
    ];

    const body = new URLSearchParams();
    body.append('access_token', token);
    body.append('batch', JSON.stringify(batchPayload));

    return await this.withMetaRetry(async () => {
      const res = await axios.post(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 120_000,
        }
      );

      const arr = res.data;
      if (!Array.isArray(arr) || arr.length !== 3) {
        throw new Error('Unexpected batch response shape');
      }

      const a = this.parseBatchInsightItem(arr[0]);
      const b = this.parseBatchInsightItem(arr[1]);
      const c = this.parseBatchInsightItem(arr[2]);
      return [
        { data: a.data, nextUrl: a.nextUrl },
        { data: b.data, nextUrl: b.nextUrl },
        { data: c.data, nextUrl: c.nextUrl },
      ];
    }, 'insights first-pages batch');
  }

  private async fetchRemainingPagesFromNext(firstNextUrl: string | null): Promise<Record<string, unknown>[]> {
    if (!firstNextUrl) return [];
    let allData: Record<string, unknown>[] = [];
    let currentUrl: string | null = firstNextUrl;
    while (currentUrl) {
      const apiRes: any = await this.withMetaRetry(
        () => axios.get(currentUrl as string),
        'insights next page'
      );
      const data = apiRes.data?.data;
      if (Array.isArray(data)) {
        allData = allData.concat(data);
      }
      const nextUrl: unknown = apiRes.data?.paging?.next;
      currentUrl = nextUrl && typeof nextUrl === 'string' ? nextUrl : null;
    }
    return allData;
  }

  public async syncDailyInsights(
    siteId: number,
    datePreset: string = 'last_7d',
    timeRange?: { since: string; until: string }
  ) {
    const cfg = await this.getConfig(siteId);
    if (!cfg) return;

    // Resolve the actual date window so we can delete stale rows before inserting
    const range = this.clampInsightsSyncRange(this.resolveDateRange(datePreset, timeRange));

    try {
      const baseUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.adAccountId}/insights`;

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

      // Meta frequentemente dá HTTP 500 / "reduce the amount of data" em ranges grandes.
      // Para deixar robusto (usuário final não controla período), quebramos em chunks menores.
      const MAX_CHUNK_DAYS = 45;
      const buildChunks = (sinceYmd: string, untilYmd: string): Array<{ since: string; until: string }> => {
        const out: Array<{ since: string; until: string }> = [];
        let cur = sinceYmd;
        while (cur <= untilYmd) {
          const candidateUntil = addDaysToYmd(cur, MAX_CHUNK_DAYS - 1);
          const u = candidateUntil <= untilYmd ? candidateUntil : untilYmd;
          out.push({ since: cur, until: u });
          cur = addDaysToYmd(u, 1);
        }
        return out;
      };

      const chunks = buildChunks(range.since, range.until);
      let adInsights: Record<string, unknown>[] = [];
      let adSetInsights: Record<string, unknown>[] = [];
      let campaignInsights: Record<string, unknown>[] = [];

      for (const c of chunks) {
        const timeParams = { time_range: { since: c.since, until: c.until } };
        try {
          const [ad0, adset0, camp0] = await this.fetchInsightsFirstPagesBatch(
            cfg.token,
            cfg.adAccountId,
            c.since,
            c.until,
            adFields,
            adSetFields,
            campaignFields
          );
          const [adRest, adsetRest, campRest] = await Promise.all([
            this.fetchRemainingPagesFromNext(ad0.nextUrl),
            this.fetchRemainingPagesFromNext(adset0.nextUrl),
            this.fetchRemainingPagesFromNext(camp0.nextUrl),
          ]);
          adInsights = adInsights.concat(ad0.data, adRest);
          adSetInsights = adSetInsights.concat(adset0.data, adsetRest);
          campaignInsights = campaignInsights.concat(camp0.data, campRest);
        } catch (batchErr) {
          console.warn('[MetaSync] insights batch failed, using parallel GET:', this.summarizeMetaError(batchErr));
          const [a, b, d] = await Promise.all([
            this.fetchAllPages(baseUrl, { access_token: cfg.token, level: 'ad', ...timeParams, time_increment: 1, fields: adFields, limit: 500 }),
            this.fetchAllPages(baseUrl, { access_token: cfg.token, level: 'adset', ...timeParams, time_increment: 1, fields: adSetFields, limit: 500 }),
            this.fetchAllPages(baseUrl, { access_token: cfg.token, level: 'campaign', ...timeParams, time_increment: 1, fields: campaignFields, limit: 500 }),
          ]);
          adInsights = adInsights.concat(a);
          adSetInsights = adSetInsights.concat(b);
          campaignInsights = campaignInsights.concat(d);
        }
      }

      console.log(
        `[MetaSync] site=${siteId} range=${range.since}→${range.until} ` +
        `campaigns=${campaignInsights.length} adsets=${adSetInsights.length} ads=${adInsights.length}`
      );

      // Dedupe defensivo (Meta pode devolver páginas com interseção em casos raros)
      adInsights = this.dedupeInsightRows(adInsights, (r) => `${String((r as any).ad_id || '')}|${String((r as any).date_start || '')}`);
      adSetInsights = this.dedupeInsightRows(adSetInsights, (r) => `${String((r as any).adset_id || '')}|${String((r as any).date_start || '')}`);
      campaignInsights = this.dedupeInsightRows(campaignInsights, (r) => `${String((r as any).campaign_id || '')}|${String((r as any).date_start || '')}`);

      // ── Fetch AdSet metadata (optimization goal + promoted_object) ────────
      const adsetIds = adSetInsights
        .map((r) => MetaMarketingService.asString((r as any).adset_id))
        .filter(Boolean) as string[];
      const adsetMetaMap = await this.fetchAdSetMetaMap(cfg.token, adsetIds);

      // ── Create Map of AdSet -> Objective/OptimizationGoal/CustomEvent ─────
      const adSetMap = new Map<
        string,
        {
          objective: string | null;
          optimizationGoal: string | null;
          optimizedEventName: string | null;
          customName: string | null;
        }
      >();

      for (const row of adSetInsights) {
        const adsetId = MetaMarketingService.asString((row as any).adset_id);
        if (!adsetId) continue;
        const vals = this.getInsightValues(siteId, row);
        // getInsightValues:
        // ... costPerLead(21), costPerPurchase(22), objective(23), results(24), resultRate(25),
        // dateStart(26), dateStop(27), rawPayload(28), customEventName(29), customEventCount(30)
        const meta = adsetMetaMap.get(adsetId) || null;
        adSetMap.set(adsetId, {
          objective: vals[23] as string | null,
          optimizationGoal: meta?.optimizationGoal ?? null,
          optimizedEventName: meta?.optimizedEventName ?? null,
          customName: vals[29] as string | null,
        });
      }

      // ── Idempotência + concorrência: lock por site durante o sync ─────────
      // Evita duas requisições simultâneas inserirem o mesmo (site_id, *, date_start).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [siteId, 9701]);

        // ── DELETE existing rows for this site+range before re-inserting ────
        await client.query(
          `DELETE FROM meta_insights_daily
           WHERE site_id = $1
             AND date_start >= $2
             AND date_start <= $3`,
          [siteId, range.since, range.until]
        );

        // ── Insert fresh rows ───────────────────────────────────────────────
        for (const row of campaignInsights) await this.persistCampaignInsight(siteId, row, client);
        for (const row of adSetInsights) await this.persistAdSetInsight(siteId, row, adsetMetaMap, client);
        for (const row of adInsights) await this.persistAdInsight(siteId, row, adSetMap, client);

        await client.query('COMMIT');
      } catch (txErr) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw txErr;
      } finally {
        client.release();
      }

      return {
        count: adInsights.length + adSetInsights.length + campaignInsights.length,
      };
    } catch (error: unknown) {
      console.error('[MetaSync] syncDailyInsights failed:', summarizeMetaMarketingError(error));
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
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.adAccountId}/insights`;

    const rows = await this.fetchAllPages(url, {
      access_token: cfg.token,
      level: 'campaign',
      ...(timeRange ? { time_range: timeRange } : { date_preset: datePreset }),
      fields,
      limit: 500,
    });

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
      const initiatesCheckout = this.getInitiateCheckoutCount(actions);
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
        link_clicks: linkClicks,
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
   *   objective, results, result_rate,
   *   date_start, date_stop, raw_payload,
   *   custom_event_name, custom_event_count
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
    const initiatesCheckout = this.getInitiateCheckoutCount(actions);

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

  private getInsightRankings(row: Record<string, unknown>): [string | null, string | null, string | null] {
    return [
      MetaMarketingService.asString((row as any).quality_ranking),
      MetaMarketingService.asString((row as any).engagement_rate_ranking),
      MetaMarketingService.asString((row as any).conversion_rate_ranking),
    ];
  }

  private async persistAdInsight(
    siteId: number,
    row: Record<string, unknown>,
    adSetMap?: Map<
      string,
      {
        objective: string | null;
        optimizationGoal: string | null;
        optimizedEventName: string | null;
        customName: string | null;
      }
    >
    ,
    client?: PoolClient
  ) {
    // syncDailyInsights deletes rows for this site+range before calling persist*,
    // so a plain INSERT is safe and avoids fragile partial-index ON CONFLICT logic.

    const adsetId = MetaMarketingService.asString(row.adset_id);
    const parent = adsetId && adSetMap ? adSetMap.get(adsetId) : null;
    const values = this.getInsightValues(siteId, row);
    const rankings = this.getInsightRankings(row);

    // Override objective and custom_event_name/count if missing/mismatched but present in parent
    if (parent) {
      // values[23] = objective
      // values[29] = custom_event_name
      // values[30] = custom_event_count

      if (!values[23] || (values[23] as string).includes('OUTCOME') || (values[23] as string).includes('CONVERSION')) {
        if (parent.objective) values[23] = parent.objective;
      }

      if (!values[29] && parent.customName) {
        values[29] = parent.customName;
        // Se temos o nome do custom event do pai, tentamos buscar nas actions do filho por esse nome específico
        const actions = row.actions;
        if (actions) {
          // Procura nas actions do filho usando o nome do pai
          // O prefixo pode ser offsite_conversion.custom. ou omni_custom.
          // Mas o getCustomEvent já varreu tudo e não achou.
          // Talvez seja um custom conversion pixel specific.
          // Vamos tentar achar a action que corresponde a esse nome
          const list = MetaMarketingService.asArray(actions);
          for (const item of list) {
            const type = MetaMarketingService.getActionType(item) || '';
            if (type.endsWith(parent.customName)) {
              const val = this.asInt(MetaMarketingService.getValueField(item));
              if (val !== null) {
                values[30] = val; // Atualiza count
                break;
              }
            }
          }
        }
      }
    }

    const q = client ?? pool;
    await q.query(
      `INSERT INTO meta_insights_daily (
        site_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count,
        optimization_goal, optimized_event_name,
        quality_ranking, engagement_rate_ranking, conversion_rate_ranking
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.ad_id),
        MetaMarketingService.asString(row.ad_name),
        MetaMarketingService.asString(row.adset_id),
        MetaMarketingService.asString(row.adset_name),
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...values,
        parent?.optimizationGoal ?? null,
        parent?.optimizedEventName ?? null,
        rankings[0],
        rankings[1],
        rankings[2],
      ]
    );
  }

  private async persistAdSetInsight(
    siteId: number,
    row: Record<string, unknown>,
    adsetMetaMap: Map<string, { optimizationGoal: string | null; optimizedEventName: string | null }>,
    client?: PoolClient
  ) {
    const adsetId = MetaMarketingService.asString((row as any).adset_id);
    const meta = (adsetId ? adsetMetaMap.get(adsetId) : null) || null;
    const rankings = this.getInsightRankings(row);
    const q = client ?? pool;
    await q.query(
      `INSERT INTO meta_insights_daily (
        site_id, adset_id, adset_name, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count,
        optimization_goal, optimized_event_name,
        quality_ranking, engagement_rate_ranking, conversion_rate_ranking
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31,
        $32, $33, $34, $35, $36,
        $37, $38, $39, $40, $41
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.adset_id),
        MetaMarketingService.asString(row.adset_name),
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...this.getInsightValues(siteId, row),
        meta?.optimizationGoal ?? null,
        meta?.optimizedEventName ?? null,
        rankings[0],
        rankings[1],
        rankings[2],
      ]
    );
  }

  private async persistCampaignInsight(siteId: number, row: Record<string, unknown>, client?: PoolClient) {
    const q = client ?? pool;
    const rankings = this.getInsightRankings(row);
    await q.query(
      `INSERT INTO meta_insights_daily (
        site_id, campaign_id, campaign_name,
        spend, impressions, clicks, unique_clicks, link_clicks, unique_link_clicks, inline_link_clicks, outbound_clicks, video_3s_views, landing_page_views,
        reach, frequency, cpc, ctr, unique_ctr, cpm,
        leads, contacts, purchases, adds_to_cart, initiates_checkout, cost_per_lead, cost_per_purchase,
        objective, results, result_rate,
        date_start, date_stop, raw_payload, custom_event_name, custom_event_count,
        optimization_goal, optimized_event_name,
        quality_ranking, engagement_rate_ranking, conversion_rate_ranking
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29,
        $30, $31, $32, $33, $34,
        $35, $36, $37, $38, $39
      )`,
      [
        siteId,
        MetaMarketingService.asString(row.campaign_id),
        MetaMarketingService.asString(row.campaign_name),
        ...this.getInsightValues(siteId, row),
        null,
        null,
        rankings[0],
        rankings[1],
        rankings[2],
      ]
    );
  }
}

export const metaMarketingService = new MetaMarketingService();
