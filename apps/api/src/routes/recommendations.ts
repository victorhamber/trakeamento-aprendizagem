import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';

import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { llmService } from '../services/llm';
import { addDaysToYmd, getMetaReportTimeZone, getYmdInReportTz, startOfZonedDayUtc } from '../lib/meta-report-timezone';

const router = Router();

router.post('/generate', requireAuth, async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });
  const campaignId =
    typeof req.query.campaign_id === 'string' && req.query.campaign_id.trim() ? req.query.campaign_id.trim() : null;
  if (!campaignId) return res.status(400).json({ error: 'Missing campaign_id' });
  const datePreset =
    typeof req.query.date_preset === 'string' && req.query.date_preset.trim() ? req.query.date_preset.trim() : undefined;
  const since = typeof req.query.since === 'string' && req.query.since.trim() ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' && req.query.until.trim() ? req.query.until.trim() : undefined;
  const utmSource =
    typeof req.query.utm_source === 'string' && req.query.utm_source.trim() ? req.query.utm_source.trim() : undefined;
  const utmMedium =
    typeof req.query.utm_medium === 'string' && req.query.utm_medium.trim() ? req.query.utm_medium.trim() : undefined;
  const utmCampaign =
    typeof req.query.utm_campaign === 'string' && req.query.utm_campaign.trim()
      ? req.query.utm_campaign.trim()
      : undefined;
  const utmContent =
    typeof req.query.utm_content === 'string' && req.query.utm_content.trim()
      ? req.query.utm_content.trim()
      : undefined;
  const utmTerm =
    typeof req.query.utm_term === 'string' && req.query.utm_term.trim() ? req.query.utm_term.trim() : undefined;
  const clickId =
    typeof req.query.click_id === 'string' && req.query.click_id.trim() ? req.query.click_id.trim() : undefined;
  const daysRaw = Number(req.query.days || 7);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;

  const force = req.query.force === 'true' || req.query.force === '1';

  // User context from wizard (optional)
  const body = req.body || {};
  const userContext = {
    stated_objective: typeof body.objective === 'string' ? body.objective.trim() : undefined,
    landing_page_url: typeof body.landing_page_url === 'string' ? body.landing_page_url.trim() : undefined,
    selected_ad_ids: Array.isArray(body.selected_ad_ids)
      ? body.selected_ad_ids.filter((id: any) => typeof id === 'string')
      : undefined,
  };
  // Remove undefined fields
  const cleanContext = Object.fromEntries(
    Object.entries(userContext).filter(([, v]) => v !== undefined && v !== '')
  );

  try {
    const reportOptions = {
      datePreset,
      since,
      until,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      click_id: clickId,
      force,
      userContext: Object.keys(cleanContext).length > 0 ? cleanContext : undefined,
    } as any;
    const report = await diagnosisService.generateReport(siteKey as string, days, campaignId, reportOptions);
    res.json({
      ...report,
      context: {
        campaign_id: campaignId,
        date_preset: datePreset,
        since,
        until,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
        click_id: clickId,
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
  // default/last_7d
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
  // Prefer site_key when provided (compat com cliente antigo), mas aceite site_id (chat embutido no funil).
  let siteKey = (req.query.key || req.headers['x-site-key']) as string | undefined;
  const siteIdRaw =
    typeof req.query.site_id === 'string' && req.query.site_id.trim() ? Number(req.query.site_id) : undefined;
  if (!siteKey && !Number.isFinite(siteIdRaw)) return res.status(400).json({ error: 'Missing site key' });
  const campaignId =
    typeof req.query.campaign_id === 'string' && req.query.campaign_id.trim() ? req.query.campaign_id.trim() : null;
  if (!campaignId) return res.status(400).json({ error: 'Missing campaign_id' });

  const datePreset =
    typeof req.query.date_preset === 'string' && req.query.date_preset.trim() ? req.query.date_preset.trim() : undefined;
  const since = typeof req.query.since === 'string' && req.query.since.trim() ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' && req.query.until.trim() ? req.query.until.trim() : undefined;

  const body = (req.body || {}) as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && typeof m.content === 'string') : [];

  try {
    let siteId: number | undefined;
    if (siteKey) {
      const siteRow = await pool.query('SELECT id FROM sites WHERE site_key = $1', [siteKey]);
      siteId = siteRow.rows[0]?.id as number | undefined;
    } else {
      const auth = (req as any).auth as { accountId: number } | undefined;
      const owns = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [
        siteIdRaw,
        auth?.accountId,
      ]);
      if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });
      siteKey = String(owns.rows[0].site_key);
      siteId = siteIdRaw;
    }

    const { sinceYmd, untilYmd } = resolveSinceUntilYmd(datePreset, since, until);
    const tz = getMetaReportTimeZone();
    const sinceUtc = startOfZonedDayUtc(sinceYmd, tz);
    const untilUtc = startOfZonedDayUtc(addDaysToYmd(untilYmd, 1), tz);

    // Puxa um snapshot do funil (nível campanha) a partir do DB.
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
      [siteId, campaignId, sinceUtc, untilUtc]
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
      campaign_id: campaignId,
      campaign_name: String(f.campaign_name || ''),
      period: { date_preset: datePreset || 'last_7d', since: sinceYmd, until: untilYmd, report_timezone: tz },
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
      'Você é um analista de performance de Direct Response para Meta Ads.',
      'Você responde em Português (Brasil).',
      'Você NÃO inventa dados: use apenas o snapshot JSON fornecido.',
      'Seu formato é chat: responda curto e acionável.',
      'Faça NO MÁXIMO 1 pergunta por mensagem (para guiar o usuário).',
      'Use benchmarks globais para classificar as taxas (ruim/ok/bom/excelente) e sugerir próximos testes.',
      'Se o usuário pedir, você aprofunda com checklists.',
    ].join('\n');

    const userContent = `Contexto (JSON):\n${JSON.stringify(snapshot, null, 2)}\n\nHistórico:\n${JSON.stringify(messages.slice(-12), null, 2)}\n\nResponda agora ao usuário (última mensagem é a mais recente).`;
    const answer = await llmService.chatOnce(String(siteKey), systemPrompt, userContent, 700);
    res.json({ answer, snapshot });
  } catch (err: any) {
    console.error('[recommendations/chat] error:', err?.message || err);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
