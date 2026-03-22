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

const APPROVED_PURCHASE_STATUSES = `('approved', 'paid', 'completed', 'active')`;

function parseYmdLocal(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

/** Início/fim do dia civil em UTC a partir de Y-M-D (evita deslocamento servidor vs Postgres timestamptz). */
function startUtcFromYmd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function endUtcFromYmd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/** Alinhado ao dashboard web: presets + máximo + período personalizado (?since=&until=) */
function resolveMobilePeriod(
  period: string,
  sinceStr?: string,
  untilStr?: string
): { start: Date; end: Date } | { error: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'custom') {
    if (!sinceStr || !untilStr) {
      return { error: 'Para período personalizado, informe since e until (YYYY-MM-DD).' };
    }
    const a = parseYmdLocal(sinceStr);
    const b = parseYmdLocal(untilStr);
    if (!a || !b) {
      return { error: 'Datas inválidas. Use o formato YYYY-MM-DD.' };
    }
    let start = startUtcFromYmd(a.y, a.m, a.d);
    let end = endUtcFromYmd(b.y, b.m, b.d);
    if (start.getTime() > end.getTime()) {
      return { error: 'A data inicial não pode ser maior que a final.' };
    }
    if (start.getTime() > now.getTime()) {
      return { error: 'O período não pode estar inteiro no futuro.' };
    }
    const endCap = end.getTime() > now.getTime() ? now : end;
    return { start, end: endCap };
  }

  switch (period) {
    case 'yesterday': {
      const yStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      return { start: yStart, end: todayStart };
    }
    case 'last_7d':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
    case 'last_14d':
      return { start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), end: now };
    case 'last_15d':
      return { start: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000), end: now };
    case 'last_30d':
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
    case 'maximum':
      return { start: new Date(Date.UTC(1970, 0, 1, 0, 0, 0, 0)), end: now };
    case 'today':
    default:
      return { start: todayStart, end: now };
  }
}

function parseSiteIds(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  const s = String(raw);
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Filtro de sites para SQL: `null` = todos os sites (evita `[]` com tipo ambíguo no node-pg).
 */
function siteIdFilterParam(siteIds: number[]): number[] | null {
  return siteIds.length > 0 ? siteIds : null;
}

/** Mobile app: KPI do período, gráfico diário, últimas vendas — filtros ?period=&sites=1,2 */
router.get('/mobile-summary', async (req, res) => {
  const auth = req.auth!;
  const period = (req.query.period as string) || 'today';
  const since = typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' ? req.query.until.trim() : undefined;
  const siteIds = parseSiteIds(req.query.sites);
  const siteFilter = siteIdFilterParam(siteIds);
  const bounds = resolveMobilePeriod(period, since, until);
  if ('error' in bounds) {
    return res.status(400).json({ error: bounds.error });
  }
  const { start, end } = bounds;

  try {
    const [aggRes, chartRes, recentRes, sitesRes] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int as sales,
          COALESCE(SUM(p.amount), 0)::float as revenue
         FROM purchases p
         WHERE p.site_key = ANY(
           SELECT site_key FROM sites
           WHERE account_id = $1
             AND ($4::int[] IS NULL OR id = ANY($4))
         )
           AND p.created_at >= $2::timestamptz
           AND p.created_at <= $3::timestamptz
           AND p.status IN ${APPROVED_PURCHASE_STATUSES}`,
        [auth.accountId, start, end, siteFilter]
      ),
      pool.query(
        `SELECT
          TO_CHAR(p.created_at, 'YYYY-MM-DD') as date,
          COALESCE(SUM(p.amount), 0)::float as revenue,
          COUNT(*)::int as sales
         FROM purchases p
         WHERE p.site_key = ANY(
           SELECT site_key FROM sites
           WHERE account_id = $1
             AND ($4::int[] IS NULL OR id = ANY($4))
         )
           AND p.created_at >= $2::timestamptz
           AND p.created_at <= $3::timestamptz
           AND p.status IN ${APPROVED_PURCHASE_STATUSES}
         GROUP BY 1
         ORDER BY 1 ASC`,
        [auth.accountId, start, end, siteFilter]
      ),
      pool.query(
        `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, p.created_at, s.name as site_name
         FROM purchases p
         JOIN sites s ON s.site_key = p.site_key AND s.account_id = $1
         WHERE p.status IN ${APPROVED_PURCHASE_STATUSES}
           AND p.created_at >= $2::timestamptz
           AND p.created_at <= $3::timestamptz
           AND ($4::int[] IS NULL OR s.id = ANY($4))
         ORDER BY p.created_at DESC
         LIMIT 20`,
        [auth.accountId, start, end, siteFilter]
      ),
      pool.query(`SELECT COUNT(*)::int as c FROM sites WHERE account_id = $1`, [auth.accountId]),
    ]);

    const agg = aggRes.rows[0] || { sales: 0, revenue: 0 };
    const chart = (chartRes.rows || []).map((r: any) => ({
      date: String(r.date),
      revenue: Number(r.revenue || 0),
      sales: Number(r.sales || 0),
    }));
    const recent = (recentRes.rows || []).map((r: any) => ({
      id: r.id,
      orderId: r.order_id,
      platform: r.platform,
      amount: r.amount != null ? Number(r.amount) : null,
      currency: r.currency,
      createdAt: r.created_at,
      siteName: r.site_name,
    }));

    res.json({
      period,
      periodSales: Number(agg.sales || 0),
      periodRevenue: Number(agg.revenue || 0),
      sitesCount: Number(sitesRes.rows[0]?.c || 0),
      chart,
      recentPurchases: recent,
    });
  } catch (err) {
    console.error('Dashboard mobile-summary Error:', err);
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
