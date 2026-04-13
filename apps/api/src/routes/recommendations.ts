import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { llmService } from '../services/llm';
import { findOwnedSiteById, findOwnedSiteByKey } from '../lib/site-access';
import { addDaysToYmd, getMetaReportTimeZone, getYmdInReportTz, startOfZonedDayUtc } from '../lib/meta-report-timezone';
import { recommendationChatInputSchema, recommendationGenerateInputSchema } from '../services/agent-tools';

const router = Router();

router.post('/generate', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const rawBody = req.body || {};
  const rawSiteKey = req.query.key || req.headers['x-site-key'];
  const daysRaw = Number(req.query.days || 7);

  const parsedInput = recommendationGenerateInputSchema.safeParse({
    siteKey: typeof rawSiteKey === 'string' ? rawSiteKey : '',
    campaignId: typeof req.query.campaign_id === 'string' ? req.query.campaign_id : '',
    datePreset: typeof req.query.date_preset === 'string' ? req.query.date_preset : undefined,
    since: typeof req.query.since === 'string' ? req.query.since : undefined,
    until: typeof req.query.until === 'string' ? req.query.until : undefined,
    days: Number.isFinite(daysRaw) ? Math.trunc(daysRaw) : 7,
    force: req.query.force === 'true' || req.query.force === '1',
    utmFilters: {
      utm_source: typeof req.query.utm_source === 'string' ? req.query.utm_source : undefined,
      utm_medium: typeof req.query.utm_medium === 'string' ? req.query.utm_medium : undefined,
      utm_campaign: typeof req.query.utm_campaign === 'string' ? req.query.utm_campaign : undefined,
      utm_content: typeof req.query.utm_content === 'string' ? req.query.utm_content : undefined,
      utm_term: typeof req.query.utm_term === 'string' ? req.query.utm_term : undefined,
      click_id: typeof req.query.click_id === 'string' ? req.query.click_id : undefined,
    },
    userContext: {
      stated_objective: typeof rawBody.objective === 'string' ? rawBody.objective : undefined,
      landing_page_url: typeof rawBody.landing_page_url === 'string' ? rawBody.landing_page_url : undefined,
      selected_ad_ids: Array.isArray(rawBody.selected_ad_ids)
        ? rawBody.selected_ad_ids.filter((id: unknown): id is string => typeof id === 'string')
        : undefined,
    },
    analysisProfile:
      typeof req.query.analysis_profile === 'string'
        ? req.query.analysis_profile
        : typeof rawBody.analysis_profile === 'string'
          ? rawBody.analysis_profile
          : undefined,
  });

  if (!parsedInput.success) {
    return res.status(400).json({
      error: 'invalid_input',
      details: parsedInput.error.flatten(),
    });
  }

  const input = parsedInput.data;
  const ownedSite = await findOwnedSiteByKey(auth.accountId, input.siteKey);
  if (!ownedSite) return res.status(404).json({ error: 'Site not found' });

  try {
    const reportOptions = {
      siteId: ownedSite.id,
      datePreset: input.datePreset,
      since: input.since,
      until: input.until,
      force: input.force,
      userContext: input.userContext,
      analysisProfile: input.analysisProfile,
      ...(input.utmFilters || {}),
    };

    const report = await diagnosisService.generateReport(input.siteKey, input.days, input.campaignId, reportOptions);
    res.json({
      ...report,
      context: {
        campaign_id: input.campaignId,
        date_preset: input.datePreset,
        since: input.since,
        until: input.until,
        analysis_profile: input.analysisProfile,
        ...(input.utmFilters || {}),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal_error';
    res.status(500).json({ error: message });
  }
});

function resolveSinceUntilYmd(datePreset?: string, since?: string, until?: string): { sinceYmd: string; untilYmd: string } {
  const tz = getMetaReportTimeZone();
  const today = getYmdInReportTz(new Date(), tz);
  const preset = (datePreset || '').trim();
  if (since && until) return { sinceYmd: since.slice(0, 10), untilYmd: until.slice(0, 10) };
  if (preset === 'today') return { sinceYmd: today, untilYmd: today };
  if (preset === 'yesterday') {
    const y = addDaysToYmd(today, -1);
    return { sinceYmd: y, untilYmd: y };
  }
  if (preset === 'last_14d') return { sinceYmd: addDaysToYmd(today, -14), untilYmd: today };
  if (preset === 'last_30d') return { sinceYmd: addDaysToYmd(today, -30), untilYmd: today };
  return { sinceYmd: addDaysToYmd(today, -7), untilYmd: today };
}

const FUNNEL_BENCHMARKS = {
  visit_to_ic: {
    bad: 0.03,
    ok: 0.06,
    good: 0.12,
    strong: 0.12,
  },
  ic_to_purchase: {
    bad: 0.15,
    ok: 0.25,
    good: 0.40,
    strong: 0.40,
  },
  visit_to_purchase: {
    bad: 0.01,
    ok: 0.02,
    good: 0.04,
    strong: 0.04,
  },
};

router.post('/chat', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const rawBody = req.body || {};
  const rawSiteId =
    typeof req.query.site_id === 'string' && req.query.site_id.trim() ? Number(req.query.site_id) : undefined;

  const parsedInput = recommendationChatInputSchema.safeParse({
    siteKey: typeof req.query.key === 'string'
      ? req.query.key
      : typeof req.headers['x-site-key'] === 'string'
        ? req.headers['x-site-key']
        : undefined,
    siteId: Number.isFinite(rawSiteId) ? Math.trunc(rawSiteId!) : undefined,
    campaignId: typeof req.query.campaign_id === 'string' ? req.query.campaign_id : '',
    datePreset: typeof req.query.date_preset === 'string' ? req.query.date_preset : undefined,
    since: typeof req.query.since === 'string' ? req.query.since : undefined,
    until: typeof req.query.until === 'string' ? req.query.until : undefined,
    messages: Array.isArray((rawBody as { messages?: unknown[] }).messages)
      ? ((rawBody as { messages?: unknown[] }).messages as unknown[])
      : [],
  });

  if (!parsedInput.success) {
    return res.status(400).json({
      error: 'invalid_input',
      details: parsedInput.error.flatten(),
    });
  }

  const input = parsedInput.data;

  try {
    const ownedSite = input.siteKey
      ? await findOwnedSiteByKey(auth.accountId, input.siteKey)
      : await findOwnedSiteById(auth.accountId, input.siteId!);

    if (!ownedSite) return res.status(404).json({ error: 'Site not found' });

    const siteId = ownedSite.id;
    const siteKey = ownedSite.siteKey;
    const { sinceYmd, untilYmd } = resolveSinceUntilYmd(input.datePreset, input.since, input.until);
    const tz = getMetaReportTimeZone();
    const sinceUtc = startOfZonedDayUtc(sinceYmd, tz);
    const untilUtc = startOfZonedDayUtc(addDaysToYmd(untilYmd, 1), tz);

    const funnel = await pool.query(
      `
      SELECT
        MAX(campaign_name) AS campaign_name,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS link_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS visits,
        COALESCE(SUM(initiates_checkout), 0)::bigint AS initiates_checkout,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        COALESCE(SUM(spend), 0)::numeric AS spend
      FROM meta_insights_daily
      WHERE site_id = $1
        AND campaign_id = $2
        AND date_start >= $3
        AND date_start < $4
        AND adset_id IS NULL AND ad_id IS NULL
      `,
      [siteId, input.campaignId, sinceUtc, untilUtc]
    );

    const f = funnel.rows[0] || {};
    const visits = Number(f.visits || 0);
    const ic = Number(f.initiates_checkout || 0);
    const purchases = Number(f.purchases || 0);
    const visitToIc = visits > 0 ? ic / visits : 0;
    const icToPurchase = ic > 0 ? purchases / ic : 0;
    const visitToPurchase = visits > 0 ? purchases / visits : 0;

    const snapshot = {
      site_id: siteId,
      site_key: siteKey,
      campaign_id: input.campaignId,
      campaign_name: String(f.campaign_name || ''),
      period: { date_preset: input.datePreset || 'last_7d', since: sinceYmd, until: untilYmd, report_timezone: tz },
      funnel: {
        link_clicks: Number(f.link_clicks || 0),
        visits,
        initiates_checkout: ic,
        purchases,
        spend: Number(f.spend || 0),
        rates: {
          visit_to_ic: visitToIc,
          ic_to_purchase: icToPurchase,
          visit_to_purchase: visitToPurchase,
        },
      },
      benchmarks: FUNNEL_BENCHMARKS,
    };

    const systemPrompt = [
      'Voce e um analista de performance de Direct Response para Meta Ads.',
      'Voce responde em Portugues (Brasil).',
      'Voce NAO inventa dados: use apenas o snapshot JSON fornecido.',
      'Seu formato e chat: responda curto e acionavel.',
      'Faca NO MAXIMO 1 pergunta por mensagem (para guiar o usuario).',
      'Use benchmarks globais para classificar as taxas (ruim/ok/bom/excelente) e sugerir proximos testes.',
      'Se o usuario pedir, voce aprofunda com checklists.',
    ].join('\n');

    const userContent = `Contexto (JSON):\n${JSON.stringify(snapshot, null, 2)}\n\nHistorico:\n${JSON.stringify(input.messages.slice(-12), null, 2)}\n\nResponda agora ao usuario (ultima mensagem e a mais recente).`;
    const answer = await llmService.chatOnce(siteKey, systemPrompt, userContent, 700);
    res.json({ answer, snapshot });
  } catch (err: unknown) {
    console.error('[recommendations/chat] error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
