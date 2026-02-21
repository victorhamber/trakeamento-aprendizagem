import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/overview', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const period = (req.query.period as string) || 'today';
  const currency = (req.query.currency as string) || 'BRL';

  const now = new Date();
  let start: Date;
  let end: Date = now;

  // Normaliza truncando horas para as opções baseadas em dias
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      start = todayStart;
      break;
    case 'yesterday':
      start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      end = todayStart;
      break;
    case 'last_7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'last_14d':
      start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      break;
    case 'last_30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'maximum':
      start = new Date(0); // Epoch
      break;
    default: // custom range if sent as yyyy-mm-dd (fallback para simple today)
      start = todayStart;
  }

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const sites = await pool.query('SELECT COUNT(*)::int as c FROM sites WHERE account_id = $1', [auth.accountId]);

  const eventsPeriod = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM web_events e
     JOIN sites s ON s.site_key = e.site_key
     WHERE s.account_id = $1
       AND e.event_time >= $2
       AND e.event_time <= $3`,
    [auth.accountId, start, end]
  );

  const purchasesPeriod = await pool.query(
    `SELECT 
       COUNT(*)::int as c, 
       COALESCE(SUM(CASE WHEN p.status = 'approved' AND p.currency = $4 THEN p.amount ELSE 0 END), 0) as total_revenue
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.account_id = $1
       AND p.created_at >= $2
       AND p.created_at <= $3`,
    [auth.accountId, start, end, currency]
  );

  const reportsPeriod = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM recommendation_reports r
     JOIN sites s ON s.site_key = r.site_key
     WHERE s.account_id = $1
       AND r.created_at >= $2
       AND r.created_at <= $3`,
    [auth.accountId, start, end]
  );

  return res.json({
    sites: sites.rows[0]?.c || 0,
    events_today: eventsPeriod.rows[0]?.c || 0,
    purchases_today: purchasesPeriod.rows[0]?.c || 0,
    total_revenue: purchasesPeriod.rows[0]?.total_revenue || 0,
    reports_7d: reportsPeriod.rows[0]?.c || 0,
  });
});

router.get('/sites/:siteId/quality', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = site.rows[0].site_key;

  try {
    const query = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE user_data->>'fbp' IS NOT NULL OR user_data->>'fbc' IS NOT NULL) as with_fbp_fbc,
        COUNT(*) FILTER (WHERE user_data->>'em' IS NOT NULL OR user_data->>'ph' IS NOT NULL) as with_em_ph,
        COUNT(*) FILTER (WHERE user_data->>'external_id' IS NOT NULL) as with_external_id,
        COUNT(*) FILTER (WHERE user_data->>'client_ip_address' IS NOT NULL AND user_data->>'client_user_agent' IS NOT NULL) as with_ip_ua
      FROM web_events
      WHERE site_key = $1 AND event_time >= NOW() - INTERVAL '7 days'
    `;
    const result = await pool.query(query, [siteKey]);
    const row = result.rows[0];

    const total = parseInt(row.total_events) || 0;

    return res.json({
      total_events: total,
      with_fbp_fbc: parseInt(row.with_fbp_fbc) || 0,
      with_em_ph: parseInt(row.with_em_ph) || 0,
      with_external_id: parseInt(row.with_external_id) || 0,
      with_ip_ua: parseInt(row.with_ip_ua) || 0,
      metrics: {
        fbp_fbc_match_rate: total > 0 ? (parseInt(row.with_fbp_fbc) / total) : 0,
        em_ph_match_rate: total > 0 ? (parseInt(row.with_em_ph) / total) : 0,
        external_id_match_rate: total > 0 ? (parseInt(row.with_external_id) / total) : 0,
      }
    });
  } catch (err) {
    console.error('Failed to fetch quality stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
