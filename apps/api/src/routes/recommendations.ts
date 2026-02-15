import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';

const router = Router();

router.post('/generate', async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });
  const campaignId =
    typeof req.query.campaign_id === 'string' && req.query.campaign_id.trim() ? req.query.campaign_id.trim() : null;
  const datePreset =
    typeof req.query.date_preset === 'string' && req.query.date_preset.trim() ? req.query.date_preset.trim() : undefined;
  const since = typeof req.query.since === 'string' && req.query.since.trim() ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' && req.query.until.trim() ? req.query.until.trim() : undefined;
  const daysRaw = Number(req.query.days || 7);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 7;

  try {
    const report = await diagnosisService.generateReport(siteKey as string, days, campaignId, {
      datePreset,
      since,
      until,
    });
    res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal_error';
    res.status(500).json({ error: message });
  }
});

export default router;
