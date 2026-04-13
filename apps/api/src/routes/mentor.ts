import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { findOwnedSiteByKey } from '../lib/site-access';
import { llmService } from '../services/llm';
import { mentorCoachInputSchema } from '../services/agent-tools';

type MentorItem = { id: string; text: string; hints?: string[] };
type MentorPhase = { id: string; order: number; title: string; badge?: string; note?: string; items: MentorItem[] };
type MentorChecklistFile = { phases: MentorPhase[] };

let checklistCache: MentorChecklistFile | null = null;

function resolveChecklistPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'data', 'meta-ads-mentor-checklist.json'),
    path.join(process.cwd(), 'dist', 'data', 'meta-ads-mentor-checklist.json'),
    path.join(process.cwd(), 'src', 'data', 'meta-ads-mentor-checklist.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function loadChecklist(): MentorChecklistFile {
  if (checklistCache) return checklistCache;
  const filePath = resolveChecklistPath();
  checklistCache = JSON.parse(fs.readFileSync(filePath, 'utf8')) as MentorChecklistFile;
  return checklistCache;
}

function normalizeLandingUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, '');
  return `https://${s.replace(/\/+$/, '')}`;
}

async function fetchLandingPageContent(url: string): Promise<string | null> {
  try {
    const u = String(url || '').trim();
    if (!u || !u.startsWith('http')) return null;
    const response = await axios.get(u, {
      headers: {
        'User-Agent': 'TrajettuBot/1.0 (Mentor Coach)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 8000,
      maxContentLength: 500_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    let html = typeof response.data === 'string' ? response.data : '';
    if (!html) return null;
    html = html
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
      .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gim, '');
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12_000);
    return text.length ? text : null;
  } catch {
    return null;
  }
}

const router = Router();

router.get('/checklist', requireAuth, (_req, res) => {
  try {
    res.json(loadChecklist());
  } catch {
    res.status(500).json({ error: 'checklist_load_failed' });
  }
});

router.post('/coach', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const body = req.body || {};
  const parsedInput = mentorCoachInputSchema.safeParse({
    siteKey: typeof body.site_key === 'string' ? body.site_key : '',
    focusPhaseId: typeof body.focus_phase_id === 'string' ? body.focus_phase_id : undefined,
    completedItemIds: Array.isArray(body.completed_item_ids)
      ? body.completed_item_ids.filter((x: unknown): x is string => typeof x === 'string')
      : [],
    campaignId: typeof body.campaign_id === 'string' ? body.campaign_id : undefined,
  });

  if (!parsedInput.success) {
    return res.status(400).json({
      error: 'invalid_input',
      details: parsedInput.error.flatten(),
    });
  }

  const input = parsedInput.data;
  const site = await findOwnedSiteByKey(auth.accountId, input.siteKey);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const siteKey = site.siteKey;
  const focusPhaseId = input.focusPhaseId || null;
  const completedIds = input.completedItemIds;
  const completedSet = new Set(completedIds);
  const campaignId = input.campaignId || null;
  const siteId = site.id;

  const metaRow = await pool.query(
    `SELECT enabled,
            pixel_id,
            (capi_token_enc IS NOT NULL) AS has_capi,
            (marketing_token_enc IS NOT NULL) AS has_marketing,
            (fb_user_token_enc IS NOT NULL) AS has_fb,
            last_ingest_at,
            last_capi_status
     FROM integrations_meta
     WHERE site_id = $1`,
    [siteId]
  );
  const meta = metaRow.rows[0] || {};
  const enabled = meta.enabled !== false;
  const pixelConfigured = enabled && !!meta.pixel_id;
  const capiConfigured = enabled && !!meta.has_capi;
  const metaConnected = enabled && (!!meta.has_marketing || !!meta.has_fb);

  // Landing page recorte (opcional): usa tracking_domain/domain cadastrados no site.
  let landingPage: Record<string, unknown> | null = null;
  try {
    const hostRow = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(tracking_domain), ''), NULLIF(TRIM(domain), '')) AS host
       FROM sites WHERE id = $1 LIMIT 1`,
      [siteId]
    );
    const host = hostRow.rows?.[0]?.host ? String(hostRow.rows[0].host) : '';
    const lpUrl = normalizeLandingUrl(host);
    const content = lpUrl ? await fetchLandingPageContent(lpUrl) : null;
    const contentOk = typeof content === 'string' && content.length > 0;
    landingPage = {
      url: lpUrl || null,
      content: contentOk ? content : '',
      content_source: contentOk ? 'http_html_text' : lpUrl ? 'fetch_failed_or_empty' : 'no_url',
      content_note: contentOk
        ? 'Texto obtido pelo servidor Trajettu via HTTP GET do HTML publico (scripts/estilos removidos; texto plano, ate ~12000 caracteres). Nao e renderizacao JS completa nem screenshot.'
        : lpUrl
          ? 'Fetch da URL falhou ou retornou vazio (rede, bloqueio, bot, SPA sem conteudo no HTML inicial). Nao invente copy da pagina.'
          : 'Nenhuma URL de landing definida para este site (domain/tracking_domain vazio).',
    };
  } catch {
    landingPage = null;
  }

  let metricsAgg: Record<string, unknown> | null = null;
  let campaignLabel: string | null = null;
  try {
    const r = await pool.query(
      `SELECT
        COALESCE(SUM(spend), 0)::numeric AS spend,
        COALESCE(SUM(impressions), 0)::bigint AS impressions,
        COALESCE(SUM(clicks), 0)::bigint AS clicks,
        COALESCE(SUM(unique_link_clicks), 0)::bigint AS unique_link_clicks,
        COALESCE(SUM(landing_page_views), 0)::bigint AS landing_page_views,
        COALESCE(SUM(purchases), 0)::bigint AS purchases,
        MAX(date_start)::text AS last_insight_date,
        MAX(campaign_name) AS campaign_name_sample
      FROM meta_insights_daily
      WHERE site_id = $1
        AND date_start >= (CURRENT_DATE - INTERVAL '14 days')
        AND campaign_id IS NOT NULL
        AND (adset_id IS NULL OR adset_id = '')
        AND (ad_id IS NULL OR ad_id = '')
        AND ($2::text IS NULL OR campaign_id = $2::text)`,
      [siteId, campaignId]
    );
    const row = r.rows[0];
    if (row && Number(row.impressions) > 0) {
      const impr = Number(row.impressions);
      const uclk = Number(row.unique_link_clicks || row.clicks || 0);
      const ctrPct = impr > 0 ? (uclk / impr) * 100 : null;
      metricsAgg = {
        spend: Number(row.spend),
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        unique_link_clicks: Number(row.unique_link_clicks),
        landing_page_views: Number(row.landing_page_views),
        purchases: Number(row.purchases),
        ctr_pct: ctrPct,
        last_insight_date: row.last_insight_date,
        window_days: 14,
        campaign_id_filtered: campaignId,
      };
      if (campaignId && row.campaign_name_sample) {
        campaignLabel = row.campaign_name_sample as string;
      }
    }
  } catch {
    metricsAgg = null;
  }

  const checklist = loadChecklist();
  const phases = [...checklist.phases].sort((a, b) => a.order - b.order);

  const checklist_progress = phases.map((ph) => {
    const total = ph.items.length;
    const completed = ph.items.filter((it) => completedSet.has(it.id)).length;
    const incomplete = ph.items.filter((it) => !completedSet.has(it.id));
    return {
      phase_id: ph.id,
      phase_title: ph.title,
      completed,
      total,
      incomplete_item_texts: incomplete.slice(0, 5).map((it) => it.text),
    };
  });

  let focus_phase: { id: string; title: string; note: string } | null = null;
  if (focusPhaseId) {
    const ph = phases.find((p) => p.id === focusPhaseId);
    if (ph) {
      focus_phase = { id: ph.id, title: ph.title, note: ph.note || '' };
    }
  }
  if (!focus_phase) {
    const firstIncomplete = phases.find((ph) => ph.items.some((it) => !completedSet.has(it.id)));
    if (firstIncomplete) {
      focus_phase = {
        id: firstIncomplete.id,
        title: firstIncomplete.title,
        note: firstIncomplete.note || '',
      };
    }
  }

  const next_items_across_phases: Array<{ phase_id: string; item_id: string; text: string }> = [];
  for (const ph of phases) {
    for (const it of ph.items) {
      if (completedSet.has(it.id)) continue;
      next_items_across_phases.push({ phase_id: ph.id, item_id: it.id, text: it.text });
      if (next_items_across_phases.length >= 12) break;
    }
    if (next_items_across_phases.length >= 12) break;
  }

  const mentorContext: Record<string, unknown> = {
    checklist_progress,
    focus_phase,
    next_items_across_phases,
    completed_item_ids: completedIds,
    landing_page: landingPage,
    site_signals: {
      pixel_configured: pixelConfigured,
      capi_configured: capiConfigured,
      meta_connected: metaConnected,
      integration_enabled: enabled,
      last_ingest_at: meta.last_ingest_at ?? null,
      last_capi_status: meta.last_capi_status ?? null,
    },
    metrics_aggregate: metricsAgg,
    campaign: campaignId ? { id: campaignId, name: campaignLabel } : null,
  };

  try {
    const markdown = await llmService.generateMentorGuidance(siteKey, mentorContext);
    res.json({ markdown });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal_error';
    res.status(500).json({ error: message });
  }
});

export default router;
