import { Router } from 'express';
import { metaMarketingService } from '../services/meta-marketing';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { date_preset, site_id } = req.body || {};
    const siteId = Number(site_id);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Missing site_id' });

    const auth = req.auth!;
    const owns = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
    if (!owns.rowCount) return res.status(404).json({ error: 'Site not found' });

    const result = await metaMarketingService.syncDailyInsights(siteId, date_preset || 'yesterday');
    res.json({ status: 'success', synced_records: result?.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
