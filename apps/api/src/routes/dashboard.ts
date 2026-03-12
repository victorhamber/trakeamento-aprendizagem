import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Middleware de autenticação obrigatório para o dashboard
router.use(requireAuth);

router.get('/revenue', async (req, res) => {
  const auth = req.auth!;
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;

  try {
    // Vendas últimos 30 dias — usa subquery ANY para permitir uso do índice (site_key, status, created_at)
    const query = `
      SELECT
        TO_CHAR(p.created_at, 'YYYY-MM-DD') as date,
        COALESCE(SUM(p.amount), 0)::float as revenue,
        COUNT(*)::int as sales
      FROM purchases p
      WHERE p.site_key = ANY(
        SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
      )
        AND p.created_at >= NOW() - INTERVAL '30 days'
        AND p.status IN ('approved', 'paid', 'completed', 'active')
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const result = await pool.query(query, [auth.accountId, siteId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Dashboard Revenue Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/funnel', async (req, res) => {
  const auth = req.auth!;
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const period = (req.query.period as string) || 'last_30d';

  const now = new Date();
  let start: Date;
  let end: Date = now;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today': start = todayStart; break;
    case 'yesterday':
      start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      end = todayStart;
      break;
    case 'last_7d': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case 'last_14d': start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); break;
    case 'last_30d': start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    case 'maximum': start = new Date(0); break;
    default: start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  try {
    // Query 1: Web Events — usa subquery ANY para acionar o índice (site_key, event_name, event_time)
    const eventsQuery = `
      SELECT
        COUNT(CASE WHEN e.event_name = 'PageView' THEN 1 END)::int as page_views,
        COUNT(CASE WHEN e.event_name = 'PageEngagement' THEN 1 END)::int as engagements,
        COUNT(CASE WHEN e.event_name = 'InitiateCheckout' THEN 1 END)::int as checkouts
      FROM web_events e
      WHERE e.site_key = ANY(
        SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
      )
        AND e.event_time >= $3
        AND e.event_time <= $4
    `;

    // Query 2: Purchases — usa subquery ANY para acionar o índice (site_key, status, created_at)
    const purchasesQuery = `
      SELECT COUNT(*)::int as purchases
      FROM purchases p
      WHERE p.site_key = ANY(
        SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
      )
        AND p.created_at >= $3
        AND p.created_at <= $4
        AND p.status IN ('approved', 'paid', 'completed', 'active')
    `;

    const [eventsRes, purchasesRes] = await Promise.all([
      pool.query(eventsQuery, [auth.accountId, siteId, start, end]),
      pool.query(purchasesQuery, [auth.accountId, siteId, start, end])
    ]);

    const events = eventsRes.rows[0] || {};
    const purchases = purchasesRes.rows[0] || {};

    res.json({
      page_views: Number(events.page_views || 0),
      engagements: Number(events.engagements || 0),
      checkouts: Number(events.checkouts || 0),
      purchases: Number(purchases.purchases || 0)
    });
  } catch (err) {
    console.error('Dashboard Funnel Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
