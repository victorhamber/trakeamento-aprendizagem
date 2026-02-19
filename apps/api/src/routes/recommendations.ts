import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';

const router = Router();

router.post('/generate', async (req, res) => {
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

export default router;
