import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/overview', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sites = await pool.query('SELECT COUNT(*)::int as c FROM sites WHERE account_id = $1', [auth.accountId]);

  const eventsToday = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM web_events e
     JOIN sites s ON s.site_key = e.site_key
     WHERE s.account_id = $1
       AND e.event_time >= $2
       AND e.event_time < $3`,
    [auth.accountId, start, end]
  );

  const purchasesToday = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.account_id = $1
       AND p.created_at >= $2
       AND p.created_at < $3`,
    [auth.accountId, start, end]
  );

  const reports7d = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM recommendation_reports r
     JOIN sites s ON s.site_key = r.site_key
     WHERE s.account_id = $1
       AND r.created_at >= $2`,
    [auth.accountId, weekAgo]
  );

  return res.json({
    sites: sites.rows[0]?.c || 0,
    events_today: eventsToday.rows[0]?.c || 0,
    purchases_today: purchasesToday.rows[0]?.c || 0,
    reports_7d: reports7d.rows[0]?.c || 0,
  });
});

export default router;
