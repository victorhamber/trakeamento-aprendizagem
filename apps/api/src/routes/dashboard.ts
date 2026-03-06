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
    // Vendas últimos 30 dias
    // Se siteId for fornecido, filtra por ele. Senão, pega de todos os sites da conta.
    const query = `
      SELECT
        TO_CHAR(p.created_at, 'YYYY-MM-DD') as date,
        COALESCE(SUM(p.amount), 0)::float as revenue,
        COUNT(*)::int as sales
      FROM purchases p
      JOIN sites s ON s.site_key = p.site_key
      WHERE s.account_id = $1
        AND ($2::int IS NULL OR s.id = $2::int)
        AND p.created_at >= NOW() - INTERVAL '30 days'
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

  try {
    // Funil últimos 30 dias
    const query = `
      SELECT
        COUNT(CASE WHEN e.event_name = 'PageView' THEN 1 END)::int as page_views,
        COUNT(CASE WHEN e.event_name = 'PageEngagement' THEN 1 END)::int as engagements,
        COUNT(CASE WHEN e.event_name = 'InitiateCheckout' THEN 1 END)::int as checkouts,
        COUNT(CASE WHEN e.event_name = 'Purchase' THEN 1 END)::int as purchases
      FROM web_events e
      JOIN sites s ON s.site_key = e.site_key
      WHERE s.account_id = $1
        AND ($2::int IS NULL OR s.id = $2::int)
        AND e.event_time >= NOW() - INTERVAL '30 days'
    `;

    const result = await pool.query(query, [auth.accountId, siteId]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Dashboard Funnel Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
