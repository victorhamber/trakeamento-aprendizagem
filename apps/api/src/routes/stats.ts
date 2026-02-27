import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/debug', async (req, res) => {
  try {
    const evts = await pool.query('SELECT site_key, event_name, event_time, raw_payload->>$$user_data$$ AS ud FROM web_events ORDER BY created_at DESC LIMIT 5');
    const errs = await pool.query('SELECT * FROM capi_outbox ORDER BY created_at DESC LIMIT 5');
    const meta = await pool.query('SELECT site_id, last_capi_status, last_capi_error FROM integrations_meta LIMIT 5');
    res.json({ events: evts.rows, errors: errs.rows, meta: meta.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/overview', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const period = (req.query.period as string) || 'today';
  const currency = (req.query.currency as string) || 'BRL';
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;

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
       AND ($4::int IS NULL OR s.id = $4::int)
       AND e.event_time >= $2
       AND e.event_time <= $3`,
    [auth.accountId, start, end, siteId]
  );

  const purchasesPeriod = await pool.query(
    `SELECT 
       COUNT(*)::int as c, 
       COALESCE(SUM(CASE WHEN p.status = 'approved' AND p.currency = $5 THEN p.amount ELSE 0 END), 0) as total_revenue
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.account_id = $1
       AND ($4::int IS NULL OR s.id = $4::int)
       AND p.created_at >= $2
       AND p.created_at <= $3`,
    [auth.accountId, start, end, siteId, currency]
  );

  const reportsPeriod = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM recommendation_reports r
     JOIN sites s ON s.site_key = r.site_key
     WHERE s.account_id = $1
       AND ($4::int IS NULL OR s.id = $4::int)
       AND r.created_at >= $2
       AND r.created_at <= $3`,
    [auth.accountId, start, end, siteId]
  );

  return res.json({
    sites: sites.rows[0]?.c || 0,
    events_today: eventsPeriod.rows[0]?.c || 0,
    purchases_today: purchasesPeriod.rows[0]?.c || 0,
    total_revenue: purchasesPeriod.rows[0]?.total_revenue || 0,
    reports_7d: reportsPeriod.rows[0]?.c || 0,
  });
});

// ─── TEMPORARY DEBUG: remove after issue is resolved ────────────────────────
router.get('/debug-purchases', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const result = await pool.query(
    `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, p.status, p.created_at
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.account_id = $1
     ORDER BY p.created_at DESC
     LIMIT 10`,
    [auth.accountId]
  );
  return res.json({ purchases: result.rows });
});

router.get('/debug-events', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const result = await pool.query(
    `SELECT e.event_id, e.event_name, e.event_time, e.user_data, e.custom_data
     FROM web_events e
     JOIN sites s ON s.site_key = e.site_key
     WHERE s.account_id = $1
     ORDER BY e.event_time DESC
     LIMIT 10`,
    [auth.accountId]
  );
  return res.json({ events: result.rows });
});

router.get('/sites/:siteId/quality', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const period = (req.query.period as string) || 'last_7d';
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = site.rows[0].site_key;

  const now = new Date();
  let start: Date;
  let end: Date = now;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today': start = todayStart; break;
    case 'last_7d': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case 'last_30d': start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    default: start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  try {
    const query = `
      WITH combined_events AS (
        SELECT user_data
        FROM web_events
        WHERE site_key = $1 AND event_time >= $2 AND event_time <= $3
          AND (
            (user_data->>'em' IS NOT NULL AND user_data->>'em' != '[]' AND user_data->>'em' != '') OR 
            (user_data->>'ph' IS NOT NULL AND user_data->>'ph' != '[]' AND user_data->>'ph' != '') OR 
            (user_data->>'fn' IS NOT NULL AND user_data->>'fn' != '[]' AND user_data->>'fn' != '') OR 
            (user_data->>'ln' IS NOT NULL AND user_data->>'ln' != '[]' AND user_data->>'ln' != '')
          )
          
        UNION ALL
        
        SELECT raw_payload->'_capi_debug'->'user_data' as user_data
        FROM purchases
        WHERE site_key = $1 AND created_at >= $2 AND created_at <= $3
      )
      SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE user_data->>'fbp' IS NOT NULL OR user_data->>'fbc' IS NOT NULL) as with_fbp_fbc,
        COUNT(*) FILTER (
          WHERE 
            (user_data->>'em' IS NOT NULL AND user_data->>'em' != '[]' AND user_data->>'em' != '') OR 
            (user_data->>'ph' IS NOT NULL AND user_data->>'ph' != '[]' AND user_data->>'ph' != '') OR 
            (user_data->>'fn' IS NOT NULL AND user_data->>'fn' != '[]' AND user_data->>'fn' != '') OR 
            (user_data->>'ln' IS NOT NULL AND user_data->>'ln' != '[]' AND user_data->>'ln' != '')
        ) as with_pii,
        COUNT(*) FILTER (WHERE user_data->>'external_id' IS NOT NULL AND user_data->>'external_id' != '') as with_external_id,
        COUNT(*) FILTER (WHERE user_data->>'client_ip_address' IS NOT NULL AND user_data->>'client_user_agent' IS NOT NULL) as with_ip_ua
      FROM combined_events;
    `;
    const result = await pool.query(query, [siteKey, start, end]);
    const row = result.rows[0];

    const total = parseInt(row.total_events) || 0;

    return res.json({
      total_events: total,
      with_fbp_fbc: parseInt(row.with_fbp_fbc) || 0,
      with_pii: parseInt(row.with_pii) || 0,
      with_external_id: parseInt(row.with_external_id) || 0,
      with_ip_ua: parseInt(row.with_ip_ua) || 0,
      metrics: {
        fbp_fbc_match_rate: total > 0 ? (parseInt(row.with_fbp_fbc) / total) : 0,
        pii_match_rate: total > 0 ? (parseInt(row.with_pii) / total) : 0,
        external_id_match_rate: total > 0 ? (parseInt(row.with_external_id) / total) : 0,
      }
    });
  } catch (err) {
    console.error('Failed to fetch quality stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sales-daily', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const period = (req.query.period as string) || 'last_30d';
  const currency = (req.query.currency as string) || 'BRL';
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;

  const now = new Date();
  let start: Date;
  const end: Date = now;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today': start = todayStart; break;
    case 'yesterday': start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000); break;
    case 'last_7d': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case 'last_14d': start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); break;
    case 'last_30d': start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    case 'maximum': start = new Date(0); break;
    default: start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  try {
    const result = await pool.query(
      `SELECT
         TO_CHAR(p.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
         COUNT(*)::int as count,
         COALESCE(SUM(CASE WHEN p.status = 'approved' AND p.currency = $5 THEN p.amount ELSE 0 END), 0)::float as revenue
       FROM purchases p
       JOIN sites s ON s.site_key = p.site_key
       WHERE s.account_id = $1
         AND ($4::int IS NULL OR s.id = $4::int)
         AND p.created_at >= $2
         AND p.created_at <= $3
       GROUP BY TO_CHAR(p.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
       ORDER BY date ASC`,
      [auth.accountId, start, end, siteId, currency]
    );

    return res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to fetch sales-daily:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/best-times', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const period = (req.query.period as string) || 'last_30d';
  
  const now = new Date();
  let start: Date;
  
  // Default to 30 days for meaningful data
  if (period === 'last_7d') start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === 'last_14d') start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  else if (period === 'last_30d') start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  else if (period === 'maximum') start = new Date(0);
  else start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    // Queries para encontrar picos por tipo de evento
    const getPeak = async (eventNames: string[]) => {
      // Pico de Dia da Semana
      const dayQuery = `
        SELECT EXTRACT(DOW FROM e.event_time)::int as dow, COUNT(*)::int as count
        FROM web_events e
        JOIN sites s ON s.site_key = e.site_key
        WHERE s.account_id = $1 AND ($2::int IS NULL OR s.id = $2::int)
          AND e.event_name = ANY($3) AND e.event_time >= $4
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
      `;
      // Pico de Hora
      const hourQuery = `
        SELECT EXTRACT(HOUR FROM e.event_time)::int as hour, COUNT(*)::int as count
        FROM web_events e
        JOIN sites s ON s.site_key = e.site_key
        WHERE s.account_id = $1 AND ($2::int IS NULL OR s.id = $2::int)
          AND e.event_name = ANY($3) AND e.event_time >= $4
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
      `;

      const [dayRes, hourRes] = await Promise.all([
        pool.query(dayQuery, [auth.accountId, siteId, eventNames, start]),
        pool.query(hourQuery, [auth.accountId, siteId, eventNames, start])
      ]);

      return {
        best_day: dayRes.rows[0]?.dow ?? null,
        best_hour: hourRes.rows[0]?.hour ?? null,
        total: dayRes.rows[0]?.count ?? 0 // count do dia com mais vendas serve como proxy de volume
      };
    };

    const [purchase, lead, checkout] = await Promise.all([
      getPeak(['Purchase']),
      getPeak(['Lead', 'CompleteRegistration', 'Contact', 'Schedule']),
      getPeak(['InitiateCheckout', 'AddToCart'])
    ]);

    return res.json({
      purchase,
      lead,
      checkout
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
