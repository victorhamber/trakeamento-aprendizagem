import { Router, Request } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { encryptString } from '../lib/crypto';
import { summarizeMetaMarketingError } from '../lib/meta-api-error';
import {
  addDaysToYmd,
  calendarDaysInclusive,
  getMetaReportTimeZone,
  getYmdInReportTz,
  startOfZonedDayUtc,
} from '../lib/meta-report-timezone';

const router = Router();

// Evita martelar o sync quando o DB está vazio (ex.: site sem campanhas no período).
// Isso reduz rate-limit (429) e deixa a UI mais leve sem afetar aprendizado/otimização.
const META_SYNC_COOLDOWN_MS = 5 * 60_000;
const lastAutoSyncAttemptAt = new Map<string, number>();
function canAttemptAutoSync(key: string, now = Date.now()): boolean {
  const prev = lastAutoSyncAttemptAt.get(key) || 0;
  if (now - prev < META_SYNC_COOLDOWN_MS) return false;
  lastAutoSyncAttemptAt.set(key, now);
  return true;
}

function toReportYmd(raw: string, tz: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return getYmdInReportTz(d, tz);
}

/** Janela de datas alinhada à aba Campanhas (presets + custom). Usa META_INSIGHTS_TIMEZONE (padrão America/Sao_Paulo). */
export function parseMetaCampaignDateWindow(req: Request) {
  const datePresetRaw =
    typeof req.query.date_preset === 'string' ? req.query.date_preset.trim() : '';
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
  const untilRaw = typeof req.query.until === 'string' ? req.query.until.trim() : '';
  const tz = getMetaReportTimeZone();
  const now = new Date();
  const todayYmd = getYmdInReportTz(now, tz);

  const ymdS = sinceRaw ? toReportYmd(sinceRaw, tz) : null;
  const ymdE = untilRaw ? toReportYmd(untilRaw, tz) : null;
  const hasCustomRange = !!ymdS && !!ymdE;

  let since: Date;
  let until: Date;
  let preset = 'last_7d';
  let days = 7;

  if (hasCustomRange) {
    const startY = ymdS! <= ymdE! ? ymdS! : ymdE!;
    const endY = ymdS! <= ymdE! ? ymdE! : ymdS!;
    since = startOfZonedDayUtc(startY, tz);
    until = startOfZonedDayUtc(addDaysToYmd(endY, 1), tz);
    preset = 'custom';
    days = Math.max(1, calendarDaysInclusive(startY, endY));
  } else if (datePresetRaw) {
    preset = datePresetRaw;
    if (datePresetRaw === 'today') {
      since = startOfZonedDayUtc(todayYmd, tz);
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
      days = 1;
    } else if (datePresetRaw === 'yesterday') {
      const y = addDaysToYmd(todayYmd, -1);
      since = startOfZonedDayUtc(y, tz);
      until = startOfZonedDayUtc(todayYmd, tz);
      days = 1;
    } else if (datePresetRaw === 'last_7d') {
      days = 7;
      since = startOfZonedDayUtc(addDaysToYmd(todayYmd, -days), tz);
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
    } else if (datePresetRaw === 'last_14d') {
      days = 14;
      since = startOfZonedDayUtc(addDaysToYmd(todayYmd, -days), tz);
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
    } else if (datePresetRaw === 'last_30d') {
      days = 30;
      since = startOfZonedDayUtc(addDaysToYmd(todayYmd, -days), tz);
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
    } else if (datePresetRaw === 'maximum') {
      since = new Date('2000-01-01T00:00:00Z');
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
      days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
    } else {
      days = 7;
      since = startOfZonedDayUtc(addDaysToYmd(todayYmd, -days), tz);
      until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
      preset = 'last_7d';
    }
  } else {
    const daysRaw = Number(req.query.days || 7);
    days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;
    since = startOfZonedDayUtc(addDaysToYmd(todayYmd, -days), tz);
    until = startOfZonedDayUtc(addDaysToYmd(todayYmd, 1), tz);
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
        groupBy = 'm.campaign_id';
        nameField = 'MAX(m.campaign_name) AS name';
        idField = 'm.campaign_id AS id';
        levelFilter = 'AND m.campaign_id IS NOT NULL AND m.adset_id IS NULL AND m.ad_id IS NULL';
      }

      // Na visão campanha, optimization_goal / optimized_event_name vêm dos conjuntos (linhas adset).
      // Usamos o conjunto com maior gasto no período como referência única.
      if (level === 'campaign') {
        return pool.query(
          `
          WITH adset_opt AS (
            SELECT DISTINCT ON (campaign_id)
              campaign_id,
              optimization_goal,
              optimized_event_name
            FROM (
              SELECT
                campaign_id,
                adset_id,
                COALESCE(SUM(spend), 0)::numeric AS spend_sum,
                MAX(optimization_goal) AS optimization_goal,
                MAX(optimized_event_name) AS optimized_event_name
              FROM meta_insights_daily
              WHERE site_id = $1
                AND adset_id IS NOT NULL AND ad_id IS NULL
                AND date_start >= $2
                AND date_start < $3
              GROUP BY campaign_id, adset_id
            ) t
            ORDER BY campaign_id, spend_sum DESC NULLS LAST
          )
          SELECT
            ${idField},
            ${nameField},
            MAX(m.objective)                                  AS objective,
            COALESCE(MAX(a.optimization_goal), MAX(m.optimization_goal)) AS optimization_goal,
            COALESCE(MAX(a.optimized_event_name), MAX(m.optimized_event_name)) AS optimized_event_name,
            COALESCE(SUM(m.results), 0)::bigint               AS results,
            COALESCE(SUM(m.spend), 0)::numeric              AS spend,
            COALESCE(SUM(m.impressions), 0)::bigint          AS impressions,
            COALESCE(SUM(m.frequency), 0)::numeric           AS frequency,
            COALESCE(SUM(m.clicks), 0)::bigint               AS clicks,
            COALESCE(SUM(m.unique_clicks), 0)::bigint        AS unique_clicks,
            COALESCE(SUM(m.link_clicks), 0)::bigint          AS link_clicks,
            COALESCE(SUM(m.unique_link_clicks), 0)::bigint   AS unique_link_clicks,
            COALESCE(SUM(m.outbound_clicks), 0)::bigint      AS outbound_clicks,
            COALESCE(SUM(m.video_3s_views), 0)::bigint       AS video_3s_views,
            COALESCE(SUM(m.landing_page_views), 0)::bigint   AS landing_page_views,
            COALESCE(SUM(m.reach), 0)::bigint                AS reach,
            COALESCE(SUM(m.leads), 0)::bigint                AS leads,
            COALESCE(SUM(m.contacts), 0)::bigint             AS contacts,
            COALESCE(SUM(m.adds_to_cart), 0)::bigint         AS adds_to_cart,
            COALESCE(SUM(m.initiates_checkout), 0)::bigint   AS initiates_checkout,
            COALESCE(SUM(m.purchases), 0)::bigint            AS purchases,
            COALESCE(SUM(m.custom_event_count), 0)::bigint   AS custom_event_count,
            MAX(m.custom_event_name)                         AS custom_event_name
          FROM meta_insights_daily m
          LEFT JOIN adset_opt a ON a.campaign_id = m.campaign_id
          WHERE m.site_id = $1
            ${levelFilter}
            AND m.date_start >= $2
            AND m.date_start < $3
          GROUP BY ${groupBy}
          ORDER BY spend DESC, impressions DESC
          `,
          params
        );
      }

      return pool.query(
        `
        SELECT
          ${idField},
          ${nameField},
          MAX(objective)                                  AS objective,
          MAX(optimization_goal)                          AS optimization_goal,
          MAX(optimized_event_name)                       AS optimized_event_name,
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
      const syncKey = `metrics:${siteId}:${preset}:${hasCustomRange ? `${sinceRaw}:${untilRaw}` : ''}:${level}:${parentId || ''}`;
      if (canAttemptAutoSync(syncKey)) {
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

function linkBaseFromRow(row: Record<string, unknown>) {
  const link = Number(row.link_clicks || 0);
  const ulink = Number(row.unique_link_clicks || 0);
  const clicks = Number(row.clicks || 0);
  return link > 0 ? link : ulink > 0 ? ulink : clicks;
}

function resolveObjectiveMetric(row: Record<string, any>) {
  const objective = String(row.objective || '').toLowerCase();
  const optimizationGoal = String(row.optimization_goal || '').toLowerCase();
  const optimizedEventNameRaw = row.optimized_event_name ? String(row.optimized_event_name) : '';
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

  // Preferir o "optimization goal" real quando for conversão/personalizado,
  // mesmo que o objective da campanha seja "purchase/sales".
  const optHintsCustom =
    optimizationGoal.includes('custom') ||
    optimizationGoal.includes('offsite') ||
    optimizationGoal.includes('conversion') ||
    optimizationGoal.includes('conversions');

  // Se o adset tem um evento otimizado explícito (promoted_object),
  // mostramos isso mesmo que o optimization_goal não venha com os "hints" esperados.
  if (optHintsCustom || !!optimizedEventNameRaw) {
    const ev = customEventName || optimizedEventNameRaw;
    return {
      value: results > 0 ? results : customEventCount,
      label: ev ? `Evento ${ev}` : 'Evento personalizado',
    };
  }
  if (objective.includes('lead')) return { value: leads, label: 'Leads' };
  if (objective.includes('purchase') || objective.includes('sale'))
    return { value: purchases, label: 'Compras' };
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
}

/**
 * Funil usado no gargalo: clique → página → checkout → compra.
 * Não usamos “carrinho” da Meta aqui — muitas contas têm 0 nesse campo mesmo com checkout cheio,
 * o que gerava alerta falso de “100% de perda”.
 */
function analyzeFunnelBottleneck(row: Record<string, unknown>): {
  bottleneck: { from: string; to: string; drop_pct: number; severity: 'high' | 'medium' | 'low' } | null;
  bottleneck_plain: string;
} {
  const impressions = Number(row.impressions || 0);
  const link = linkBaseFromRow(row);
  const lp = Number(row.landing_page_views || 0);
  const checkout = Number(row.initiates_checkout || 0);
  const purchases = Number(row.purchases || 0);

  const minFrom = 5;

  if (checkout >= 1 && purchases === 0) {
    const sev: 'high' | 'medium' | 'low' = checkout >= 5 ? 'high' : 'medium';
    const plain =
      checkout === 1
        ? 'Uma pessoa começou o checkout, mas ninguém concluiu compra neste período. Vale olhar pagamento (cartão, Pix, boleto), preço final e se a página de pagamento abre bem no celular.'
        : `Foram ${checkout} inícios de checkout e nenhuma compra concluída no período. O problema costuma estar depois da página de venda: forma de pagamento, surpresa de preço ou erro na finalização — não é falta de clique no anúncio.`;
    return {
      bottleneck: {
        from: 'Checkout',
        to: 'Compra concluída',
        drop_pct: 100,
        severity: sev,
      },
      bottleneck_plain: plain,
    };
  }

  const stages: { label: string; v: number }[] = [];
  if (impressions >= 200) stages.push({ label: 'Quem viu o anúncio', v: impressions });
  if (link > 0) stages.push({ label: 'Cliques no link', v: link });
  stages.push({ label: 'Visitas à página', v: lp });
  stages.push({ label: 'Checkout', v: checkout });
  stages.push({ label: 'Compras', v: purchases });

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

  let bottleneck_plain =
    'Ainda são poucos dados para apontar um problema claro; tente um período maior ou espere mais cliques.';

  if (worst) {
    if (worst.from === 'Cliques no link' && worst.to === 'Visitas à página') {
      const kept = Math.round((lp / Math.max(link, 1)) * 100);
      bottleneck_plain = `Dos ${link} cliques no anúncio, só ${lp} chegaram a contar como visita na página (${kept}%). Quem clica e some rápido costuma ser página lenta, site fora do ar ou anúncio que não combina com a página.`;
    } else if (worst.from === 'Visitas à página' && worst.to === 'Checkout') {
      const pct = lp > 0 ? Math.round((checkout / lp) * 100) : 0;
      bottleneck_plain = `Na página, ${checkout} de ${lp} pessoas foram para o checkout (cerca de ${pct}%). Quem lê a página mas não avança costuma ser texto confuso, oferta fraca ou botão difícil de achar no celular.`;
    } else if (worst.from === 'Quem viu o anúncio' && worst.to === 'Cliques no link') {
      const ctr = Math.round((link / Math.max(impressions, 1)) * 10000) / 100;
      bottleneck_plain = `Pouca gente clica no anúncio em relação a quem viu (cerca de ${ctr}% de cliques). Vale testar outra imagem, outro texto ou outro público.`;
    } else {
      bottleneck_plain = `O maior desnível está entre “${worst.from}” e “${worst.to}”: cai cerca de ${worst.drop_pct}% da etapa anterior. É aí que vale focar primeiro.`;
    }
  }

  return { bottleneck: worst, bottleneck_plain };
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
    present_label = 'Tem gente clicando; se a venda ainda é baixa, mexa na página e na oferta.';
  }

  let future: 'promising' | 'uncertain' | 'limited' = 'uncertain';
  let future_label = 'O próximo passo é testar página, preço e pagamento.';
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

/** Janela imediatamente anterior com a mesma duração [prevSince, prevUntil) alinhada ao funil. */
export function previousMetaCampaignWindow(since: Date, until: Date): { prevSince: Date; prevUntil: Date } {
  const dur = until.getTime() - since.getTime();
  return { prevUntil: since, prevSince: new Date(since.getTime() - dur) };
}

function funnelCompareLabel(preset: string, hasCustom: boolean): string {
  if (hasCustom) return 'Período anterior (mesma duração)';
  if (preset === 'today') return 'Ontem';
  if (preset === 'yesterday') return 'Dia anterior ao mostrado';
  if (preset === 'last_7d') return '7 dias anteriores';
  if (preset === 'last_14d') return '14 dias anteriores';
  if (preset === 'last_30d') return '30 dias anteriores';
  return 'Período anterior';
}

function mapRawRowToFunnelResponse(r: Record<string, unknown>) {
  const o = { ...r, spend: Number(r.spend || 0) };
  const { bottleneck, bottleneck_plain } = analyzeFunnelBottleneck(o);
  const hints = presentAndFutureHints(o);
  const link = linkBaseFromRow(o);
  const lp = Number(r.landing_page_views || 0);
  const checkout = Number(r.initiates_checkout || 0);
  const purchases = Number(r.purchases || 0);
  const resolvedObjective = resolveObjectiveMetric(r as any);
  const funnel = {
    link_clicks: link,
    landing_page_views: lp,
    objective_metric: Number(resolvedObjective.value || 0),
    adds_to_cart: Number(r.adds_to_cart || 0),
    initiates_checkout: checkout,
    purchases,
    impressions: Number(r.impressions || 0),
  };
  const lp_rate_pct = link > 0 ? Math.round((lp / link) * 1000) / 10 : 0;
  const checkout_rate_pct = lp > 0 ? Math.round((checkout / lp) * 1000) / 10 : 0;
  const purchase_rate_pct = checkout > 0 ? Math.round((purchases / checkout) * 1000) / 10 : 0;
  const meta_revenue = Number((r as any).meta_revenue || 0);
  const meta_roas = o.spend > 0 ? Math.round((meta_revenue / o.spend) * 1000) / 1000 : 0;

  return {
    id: r.id,
    name: r.name || '—',
    objective_metric: Number(resolvedObjective.value || 0),
    objective_metric_label: String(resolvedObjective.label || 'Objetivo'),
    spend: o.spend,
    meta_revenue,
    meta_roas,
    funnel,
    funnel_rates: {
      lp_from_clicks_pct: lp_rate_pct,
      checkout_from_lp_pct: checkout_rate_pct,
      purchase_from_checkout_pct: purchase_rate_pct,
    },
    bottleneck,
    bottleneck_plain,
    ...hints,
    meta_rankings: {
      quality:
        typeof (r as any).quality_ranking === 'string' && String((r as any).quality_ranking).trim()
          ? String((r as any).quality_ranking).trim()
          : null,
      engagement_rate:
        typeof (r as any).engagement_rate_ranking === 'string' && String((r as any).engagement_rate_ranking).trim()
          ? String((r as any).engagement_rate_ranking).trim()
          : null,
      conversion_rate:
        typeof (r as any).conversion_rate_ranking === 'string' && String((r as any).conversion_rate_ranking).trim()
          ? String((r as any).conversion_rate_ranking).trim()
          : null,
    },
    adset_name:
      typeof r.adset_name === 'string' && r.adset_name.trim() ? String(r.adset_name).trim() : null,
    first_party_page:
      typeof r.first_party_page === 'string' && r.first_party_page.trim()
        ? String(r.first_party_page).trim()
        : null,
  };
}

/** Página mais vista no site por anúncio, quando utm_campaign = nome da campanha e utm_content = id do anúncio. */
async function loadFirstPartyTopPagePerAd(
  siteKey: string,
  since: Date,
  until: Date,
  campaignNameTrimmed: string,
  adIds: string[]
): Promise<Map<string, string>> {
  if (campaignNameTrimmed.length < 2 || adIds.length === 0) return new Map();

  const pageRes = await pool.query(
    `
    WITH ranked AS (
      SELECT
        trim(both from coalesce(we.custom_data->>'utm_content', '')) AS ad_ref,
        nullif(
          trim(both from coalesce(
            nullif(trim(both from coalesce(we.custom_data->>'page_path', '')), ''),
            nullif(trim(both from coalesce(we.custom_data->>'page_title', '')), '')
          )),
          ''
        ) AS page_label,
        count(*)::bigint AS c,
        row_number() OVER (
          PARTITION BY trim(both from coalesce(we.custom_data->>'utm_content', ''))
          ORDER BY count(*) DESC
        ) AS rn
      FROM web_events we
      WHERE we.site_key = $1
        AND we.event_time >= $2
        AND we.event_time < $3
        AND we.event_name = 'PageView'
        AND length(trim($4)) >= 2
        AND lower(trim(regexp_replace(coalesce(we.custom_data->>'utm_campaign', ''), '\\s+', ' ', 'g')))
           = lower(trim(regexp_replace($4, '\\s+', ' ', 'g')))
        AND trim(coalesce(we.custom_data->>'utm_content', '')) <> ''
        AND trim(coalesce(we.custom_data->>'utm_content', '')) = any($5::text[])
      GROUP BY 1, 2
    )
    SELECT ad_ref, page_label
    FROM ranked
    WHERE rn = 1 AND page_label IS NOT NULL
    `,
    [siteKey, since, until, campaignNameTrimmed, adIds]
  );

  const m = new Map<string, string>();
  for (const row of pageRes.rows) {
    const ref = String(row.ad_ref || '');
    const label = String(row.page_label || '');
    if (ref && label) m.set(ref, label);
  }
  return m;
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

    const { since, until, days, preset, hasCustomRange, sinceRaw, untilRaw } = parseMetaCampaignDateWindow(req);

    const forceRefresh =
      req.query.force === '1' || req.query.force === 'true' || req.query.force === 'yes';
    let meta_error: string | null = null;
    if (forceRefresh) {
      try {
        await metaMarketingService.syncDailyInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
      } catch (syncErr) {
        meta_error = summarizeMetaMarketingError(syncErr);
        console.warn('[funnel-breakdown] force syncDailyInsights failed:', meta_error);
      }
    }

    let groupBy: string;
    let nameField: string;
    let idField: string;
    let levelFilter: string;
    const params: unknown[] = [siteId, since, until, campaignId];

    if (level === 'campaign') {
      groupBy = 'm.campaign_id';
      nameField = 'MAX(m.campaign_name) AS name';
      idField = 'm.campaign_id AS id';
      levelFilter = 'AND m.campaign_id = $4 AND m.adset_id IS NULL AND m.ad_id IS NULL';
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

    const extraAdFields = level === 'ad' ? ', MAX(adset_name) AS adset_name' : '';
    const orderByFunnel =
      level === 'ad'
        ? `ORDER BY COALESCE(SUM(purchases), 0) DESC, COALESCE(SUM(initiates_checkout), 0) DESC, COALESCE(SUM(spend), 0) DESC NULLS LAST, COALESCE(SUM(impressions), 0) DESC`
        : `ORDER BY COALESCE(SUM(spend), 0) DESC NULLS LAST, COALESCE(SUM(impressions), 0) DESC`;

    const rankScoreSql = (field: string) => `
      MIN(
        CASE
          WHEN ${field} IS NULL OR btrim(${field}::text) = '' THEN NULL
          WHEN lower(${field}::text) LIKE 'above_%' THEN 3
          WHEN lower(${field}::text) LIKE 'average%' THEN 2
          WHEN lower(${field}::text) LIKE 'below_%' THEN 1
          ELSE NULL
        END
      )
    `;
    const rankLabelSql = (scoreExpr: string) => `
      CASE
        WHEN ${scoreExpr} = 1 THEN 'below_average'
        WHEN ${scoreExpr} = 2 THEN 'average'
        WHEN ${scoreExpr} = 3 THEN 'above_average'
        ELSE NULL
      END
    `;

    const funnelSql =
      level === 'campaign'
        ? `
      WITH adset_opt AS (
        SELECT DISTINCT ON (campaign_id)
          campaign_id,
          optimization_goal,
          optimized_event_name
        FROM (
          SELECT
            campaign_id,
            adset_id,
            COALESCE(SUM(spend), 0)::numeric AS spend_sum,
            MAX(optimization_goal) AS optimization_goal,
            MAX(optimized_event_name) AS optimized_event_name
          FROM meta_insights_daily
          WHERE site_id = $1
            AND campaign_id = $4
            AND adset_id IS NOT NULL AND ad_id IS NULL
            AND date_start >= $2
            AND date_start < $3
          GROUP BY campaign_id, adset_id
        ) t
        ORDER BY campaign_id, spend_sum DESC NULLS LAST
      )
      , ad_rank AS (
        SELECT
          ad.campaign_id,
          ${rankLabelSql(rankScoreSql('ad.quality_ranking'))} AS quality_ranking,
          ${rankLabelSql(rankScoreSql('ad.engagement_rate_ranking'))} AS engagement_rate_ranking,
          ${rankLabelSql(rankScoreSql('ad.conversion_rate_ranking'))} AS conversion_rate_ranking
        FROM meta_insights_daily ad
        WHERE ad.site_id = $1
          AND ad.campaign_id = $4
          AND ad.ad_id IS NOT NULL
          AND ad.date_start >= $2
          AND ad.date_start < $3
          AND COALESCE(ad.spend, 0) > 0
        GROUP BY 1
      )
      SELECT
        ${idField},
        ${nameField},
        MAX(m.objective) AS objective,
        COALESCE(MAX(a.optimization_goal), MAX(m.optimization_goal)) AS optimization_goal,
        COALESCE(MAX(a.optimized_event_name), MAX(m.optimized_event_name)) AS optimized_event_name,
        COALESCE(SUM(m.results), 0)::bigint AS results,
        COALESCE(SUM(m.spend), 0)::numeric AS spend,
        COALESCE(SUM((
          SELECT COALESCE(SUM((av->>'value')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(m.raw_payload->'action_values', '[]'::jsonb)) av
          WHERE av->>'action_type' = 'purchase'
        )), 0)::numeric AS meta_revenue,
        COALESCE(SUM(m.impressions), 0)::bigint AS impressions,
        COALESCE(SUM(m.clicks), 0)::bigint AS clicks,
        COALESCE(SUM(m.link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(m.unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(m.landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(m.leads), 0)::bigint AS leads,
        COALESCE(SUM(m.contacts), 0)::bigint AS contacts,
        COALESCE(SUM(m.adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(m.initiates_checkout), 0)::bigint AS initiates_checkout,
        COALESCE(SUM(m.purchases), 0)::bigint AS purchases,
        COALESCE(SUM(m.custom_event_count), 0)::bigint AS custom_event_count,
        MAX(m.custom_event_name) AS custom_event_name,
        MAX(ar.quality_ranking) AS quality_ranking,
        MAX(ar.engagement_rate_ranking) AS engagement_rate_ranking,
        MAX(ar.conversion_rate_ranking) AS conversion_rate_ranking
      FROM meta_insights_daily m
      LEFT JOIN adset_opt a ON a.campaign_id = m.campaign_id
      LEFT JOIN ad_rank ar ON ar.campaign_id = m.campaign_id
      WHERE m.site_id = $1
        AND m.date_start >= $2
        AND m.date_start < $3
        ${levelFilter}
      GROUP BY ${groupBy}
      ${orderByFunnel}
    `
        : `
      SELECT
        ${idField},
        ${nameField},
        MAX(objective) AS objective,
        MAX(optimization_goal) AS optimization_goal,
        MAX(optimized_event_name) AS optimized_event_name,
        COALESCE(SUM(results), 0)::bigint AS results,
        COALESCE(SUM(spend), 0)::numeric AS spend,
        COALESCE(SUM((
          SELECT COALESCE(SUM((av->>'value')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(raw_payload->'action_values', '[]'::jsonb)) av
          WHERE av->>'action_type' = 'purchase'
        )), 0)::numeric AS meta_revenue,
        COALESCE(SUM(impressions), 0)::bigint AS impressions,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(leads), 0)::bigint AS leads,
        COALESCE(SUM(contacts), 0)::bigint AS contacts,
        COALESCE(SUM(adds_to_cart), 0)::bigint AS adds_to_cart,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(custom_event_count), 0)::bigint AS custom_event_count,
        MAX(custom_event_name) AS custom_event_name,
        ${rankLabelSql(rankScoreSql('quality_ranking'))} AS quality_ranking,
        ${rankLabelSql(rankScoreSql('engagement_rate_ranking'))} AS engagement_rate_ranking,
        ${rankLabelSql(rankScoreSql('conversion_rate_ranking'))} AS conversion_rate_ranking
        ${extraAdFields}
      FROM meta_insights_daily
      WHERE site_id = $1
        AND date_start >= $2
        AND date_start < $3
        ${levelFilter}
      GROUP BY ${groupBy}
      ${orderByFunnel}
    `;

    let result = await pool.query(funnelSql, params);

    /** Campanhas novas podem ainda não estar no DB; a lista de métricas só sincroniza se o resultado global estiver vazio. */
    if (!(result.rowCount || 0)) {
      const syncKey = `funnel:${siteId}:${preset}:${hasCustomRange ? `${sinceRaw}:${untilRaw}` : ''}:${campaignId}:${level}:${adsetId || ''}`;
      if (canAttemptAutoSync(syncKey)) {
        try {
          await metaMarketingService.syncDailyInsights(
            siteId,
            preset,
            hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
          );
          result = await pool.query(funnelSql, params);
        } catch (syncErr) {
          if (!meta_error) meta_error = summarizeMetaMarketingError(syncErr);
          console.warn('[funnel-breakdown] syncDailyInsights failed:', summarizeMetaMarketingError(syncErr));
        }
      }
    }

    let rawRows = result.rows as Record<string, unknown>[];

    if (!rawRows.length && level === 'campaign') {
      try {
        const live = await metaMarketingService.fetchCampaignInsights(
          siteId,
          preset,
          hasCustomRange ? { since: sinceRaw, until: untilRaw } : undefined
        );
        const match = live.find((x) => String(x.campaign_id ?? '') === campaignId);
        if (match) {
          rawRows = [
            {
              id: match.campaign_id,
              name: match.campaign_name,
              spend: match.spend,
              impressions: match.impressions,
              clicks: match.clicks,
              link_clicks: match.link_clicks ?? 0,
              unique_link_clicks: match.unique_link_clicks,
              landing_page_views: match.landing_page_views,
              leads: match.leads,
              adds_to_cart: match.adds_to_cart,
              initiates_checkout: match.initiates_checkout,
              purchases: match.purchases,
            },
          ];
        }
      } catch (liveErr) {
        console.warn('[funnel-breakdown] fetchCampaignInsights failed:', summarizeMetaMarketingError(liveErr));
      }
    }

    if (level === 'ad' && rawRows.length > 0) {
      try {
        const siteKeyRes = await pool.query(
          'SELECT site_key FROM sites WHERE id = $1 AND account_id = $2',
          [siteId, auth.accountId]
        );
        const siteKey = siteKeyRes.rows[0]?.site_key as string | undefined;
        const cnRes = await pool.query(
          `SELECT MAX(campaign_name) AS cn FROM meta_insights_daily
           WHERE site_id = $1 AND date_start >= $2 AND date_start < $3 AND campaign_id = $4`,
          [siteId, since, until, campaignId]
        );
        const campaignNameUtm = String(cnRes.rows[0]?.cn || '').trim();
        const adIds = rawRows.map((r) => String(r.id || '')).filter(Boolean);
        if (siteKey && campaignNameUtm.length >= 2 && adIds.length > 0) {
          const pageMap = await loadFirstPartyTopPagePerAd(
            siteKey,
            since,
            until,
            campaignNameUtm,
            adIds
          );
          for (const r of rawRows) {
            const id = String(r.id || '');
            const pg = pageMap.get(id);
            if (pg) (r as Record<string, unknown>).first_party_page = pg;
          }
        }
      } catch (fpErr) {
        console.warn(
          '[funnel-breakdown] first-party page per ad failed:',
          fpErr instanceof Error ? fpErr.message : summarizeMetaMarketingError(fpErr)
        );
      }
    }

    const rows = rawRows.map((r) => mapRawRowToFunnelResponse(r));

    const wantCompare =
      req.query.compare === '1' || req.query.compare === 'true' || req.query.compare === 'yes';
    let compare_rows: ReturnType<typeof mapRawRowToFunnelResponse>[] | null = null;
    let compare_label: string | null = null;
    if (wantCompare && preset !== 'maximum') {
      const { prevSince, prevUntil } = previousMetaCampaignWindow(since, until);
      const prevParams = [...params];
      prevParams[1] = prevSince;
      prevParams[2] = prevUntil;
      const prevResult = await pool.query(funnelSql, prevParams);
      compare_rows = (prevResult.rows as Record<string, unknown>[]).map((r) => mapRawRowToFunnelResponse(r));
      compare_label = funnelCompareLabel(preset, hasCustomRange);
    }

    res.json({
      campaign_id: campaignId,
      level,
      days,
      preset,
      adset_id: adsetId || null,
      generated_at: new Date().toISOString(),
      meta_error,
      rows,
      compare_rows,
      compare_label,
    });
  } catch (err: unknown) {
    console.error('campaigns/funnel-breakdown error:', summarizeMetaMarketingError(err));
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
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
