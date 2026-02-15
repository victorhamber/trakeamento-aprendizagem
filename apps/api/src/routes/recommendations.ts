import { Router } from 'express';
import { diagnosisService } from '../services/diagnosis';

const router = Router();

router.post('/generate', async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });
  const campaignId =
    typeof req.query.campaign_id === 'string' && req.query.campaign_id.trim() ? req.query.campaign_id.trim() : null;

  try {
    const report = await diagnosisService.generateReport(siteKey as string, 7, campaignId);
    res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'internal_error';
    res.status(500).json({ error: message });
  }
});

export default router;
