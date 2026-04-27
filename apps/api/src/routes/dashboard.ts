import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import {
  addDaysToYmd,
  getMetaReportTimeZone,
  resolveDashboardPeriodRange,
  startOfZonedDayUtc,
} from '../lib/meta-report-timezone';

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
        TO_CHAR(COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
        COALESCE(SUM(p.amount), 0)::float as revenue,
        COUNT(*)::int as sales
      FROM purchases p
      WHERE p.site_key = ANY(
        SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
      )
        AND COALESCE(p.platform_date, p.created_at) >= NOW() - INTERVAL '30 days'
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

type RevenueByCurrencyRow = {
  currency: string;
  revenue: number;
  sales: number;
};

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

/** Normaliza query ?period= (trim, lower, aliases) para bater com o app e o web */
function normalizeMobilePeriodParam(raw: string): string {
  const p = String(raw || 'today').trim().toLowerCase();
  if (p === 'max' || p === 'all' || p === 'tudo' || p === 'full') return 'maximum';
  return p;
}

/** Alinhado ao dashboard web: presets + máximo + período personalizado (?since=&until=) */
function resolveMobilePeriod(
  period: string,
  sinceStr?: string,
  untilStr?: string
): { start: Date | null; end: Date } | { error: string } {
  const now = new Date();
  const tz = getMetaReportTimeZone();

  if (period === 'custom') {
    if (!sinceStr || !untilStr) {
      return { error: 'Para período personalizado, informe since e until (YYYY-MM-DD).' };
    }
    const a = parseYmdLocal(sinceStr);
    const b = parseYmdLocal(untilStr);
    if (!a || !b) {
      return { error: 'Datas inválidas. Use o formato YYYY-MM-DD.' };
    }
    const sinceYmd = `${a.y}-${String(a.m).padStart(2, '0')}-${String(a.d).padStart(2, '0')}`;
    const untilYmd = `${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}`;
    const start = startOfZonedDayUtc(sinceYmd, tz);
    const endInclusive = new Date(startOfZonedDayUtc(addDaysToYmd(untilYmd, 1), tz).getTime() - 1);
    if (start.getTime() > endInclusive.getTime()) {
      return { error: 'A data inicial não pode ser maior que a final.' };
    }
    if (start.getTime() > now.getTime()) {
      return { error: 'O período não pode estar inteiro no futuro.' };
    }
    const end = endInclusive.getTime() > now.getTime() ? now : endInclusive;
    return { start, end };
  }

  if (period === 'maximum') {
    return { start: null, end: now };
  }

  const { start, end } = resolveDashboardPeriodRange(period, now);
  return { start, end };
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

function parseCurrencyFilter(raw: unknown): string | null {
  const value = String(raw || '').trim().toUpperCase();
  if (!value || value === 'ALL' || value === 'TODAS') return null;
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

/** Mobile app: KPI do período, gráfico diário, últimas vendas — filtros ?period=&sites=1,2 */
router.get('/mobile-summary', async (req, res) => {
  const auth = req.auth!;
  const period = normalizeMobilePeriodParam((req.query.period as string) || 'today');
  const since = typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' ? req.query.until.trim() : undefined;
  const siteIds = parseSiteIds(req.query.sites);
  const siteFilter = siteIdFilterParam(siteIds);
  const currencyFilter = parseCurrencyFilter(req.query.currency);
  const bounds = resolveMobilePeriod(period, since, until);
  if ('error' in bounds) {
    return res.status(400).json({ error: bounds.error });
  }
  const { start, end } = bounds;

  try {
    const [aggRes, chartRes, recentRes, sitesRes, revenueByCurrencyRes] = await Promise.all([
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
           AND COALESCE(p.platform_date, p.created_at) <= $3::timestamptz
           AND ($2::timestamptz IS NULL OR COALESCE(p.platform_date, p.created_at) >= $2::timestamptz)
           AND ($5::text IS NULL OR COALESCE(NULLIF(UPPER(TRIM(p.currency)), ''), 'BRL') = $5::text)
           AND p.status IN ${APPROVED_PURCHASE_STATUSES}`,
        [auth.accountId, start, end, siteFilter, currencyFilter]
      ),
      pool.query(
        `SELECT
          TO_CHAR(COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
          COALESCE(SUM(p.amount), 0)::float as revenue,
          COUNT(*)::int as sales
         FROM purchases p
         WHERE p.site_key = ANY(
           SELECT site_key FROM sites
           WHERE account_id = $1
             AND ($4::int[] IS NULL OR id = ANY($4))
         )
           AND COALESCE(p.platform_date, p.created_at) <= $3::timestamptz
           AND ($2::timestamptz IS NULL OR COALESCE(p.platform_date, p.created_at) >= $2::timestamptz)
           AND ($5::text IS NULL OR COALESCE(NULLIF(UPPER(TRIM(p.currency)), ''), 'BRL') = $5::text)
           AND p.status IN ${APPROVED_PURCHASE_STATUSES}
         GROUP BY 1
         ORDER BY 1 ASC`,
        [auth.accountId, start, end, siteFilter, currencyFilter]
      ),
      pool.query(
        `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, COALESCE(p.platform_date, p.created_at) as created_at, s.name as site_name
         FROM purchases p
         JOIN sites s ON s.site_key = p.site_key AND s.account_id = $1
         WHERE p.status IN ${APPROVED_PURCHASE_STATUSES}
           AND COALESCE(p.platform_date, p.created_at) <= $3::timestamptz
           AND ($2::timestamptz IS NULL OR COALESCE(p.platform_date, p.created_at) >= $2::timestamptz)
           AND ($4::int[] IS NULL OR s.id = ANY($4))
           AND ($5::text IS NULL OR COALESCE(NULLIF(UPPER(TRIM(p.currency)), ''), 'BRL') = $5::text)
         ORDER BY COALESCE(p.platform_date, p.created_at) DESC
         LIMIT 50`,
        [auth.accountId, start, end, siteFilter, currencyFilter]
      ),
      pool.query(`SELECT COUNT(*)::int as c FROM sites WHERE account_id = $1`, [auth.accountId]),
      pool.query(
        `SELECT
           COALESCE(NULLIF(UPPER(TRIM(p.currency)), ''), 'BRL') AS currency,
           COALESCE(SUM(p.amount), 0)::float AS revenue,
           COUNT(*)::int AS sales
         FROM purchases p
         JOIN sites s ON s.site_key = p.site_key AND s.account_id = $1
         WHERE p.status IN ${APPROVED_PURCHASE_STATUSES}
           AND COALESCE(p.platform_date, p.created_at) <= $3::timestamptz
           AND ($2::timestamptz IS NULL OR COALESCE(p.platform_date, p.created_at) >= $2::timestamptz)
           AND ($4::int[] IS NULL OR s.id = ANY($4))
         GROUP BY 1
         ORDER BY COUNT(*) DESC, COALESCE(SUM(p.amount), 0) DESC, 1 ASC`,
        [auth.accountId, start, end, siteFilter]
      ),
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
    const revenueByCurrency: RevenueByCurrencyRow[] = (revenueByCurrencyRes.rows || []).map((r: any) => ({
      currency: String(r.currency || 'BRL').toUpperCase(),
      revenue: Number(r.revenue || 0),
      sales: Number(r.sales || 0),
    }));

    res.json({
      period,
      currency: currencyFilter,
      periodSales: Number(agg.sales || 0),
      periodRevenue: Number(agg.revenue || 0),
      sitesCount: Number(sitesRes.rows[0]?.c || 0),
      revenueByCurrency,
      chart,
      recentPurchases: recent,
    });
  } catch (err) {
    console.error('Dashboard mobile-summary Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mobile-purchases', async (req, res) => {
  const auth = req.auth!;
  const period = normalizeMobilePeriodParam((req.query.period as string) || 'today');
  const since = typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
  const until = typeof req.query.until === 'string' ? req.query.until.trim() : undefined;
  const siteIds = parseSiteIds(req.query.sites);
  const siteFilter = siteIdFilterParam(siteIds);
  const currencyFilter = parseCurrencyFilter(req.query.currency);
  const bounds = resolveMobilePeriod(period, since, until);
  if ('error' in bounds) {
    return res.status(400).json({ error: bounds.error });
  }
  const { start, end } = bounds;
  
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  try {
    const recentRes = await pool.query(
      `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, COALESCE(p.platform_date, p.created_at) as created_at, s.name as site_name
       FROM purchases p
       JOIN sites s ON s.site_key = p.site_key AND s.account_id = $1
       WHERE p.status IN ${APPROVED_PURCHASE_STATUSES}
         AND COALESCE(p.platform_date, p.created_at) <= $3::timestamptz
         AND ($2::timestamptz IS NULL OR COALESCE(p.platform_date, p.created_at) >= $2::timestamptz)
         AND ($4::int[] IS NULL OR s.id = ANY($4))
         AND ($5::text IS NULL OR COALESCE(NULLIF(UPPER(TRIM(p.currency)), ''), 'BRL') = $5::text)
       ORDER BY COALESCE(p.platform_date, p.created_at) DESC
       LIMIT $6 OFFSET $7`,
      [auth.accountId, start, end, siteFilter, currencyFilter, limit, offset]
    );

    const recent = (recentRes.rows || []).map((r: any) => ({
      id: r.id,
      orderId: r.order_id,
      platform: r.platform,
      amount: r.amount != null ? Number(r.amount) : null,
      currency: r.currency,
      createdAt: r.created_at,
      siteName: r.site_name,
    }));

    res.json({ purchases: recent });
  } catch (err) {
    console.error('Dashboard mobile-purchases Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/funnel', async (req, res) => {
  const auth = req.auth!;
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const period = (req.query.period as string) || 'last_30d';

  const now = new Date();
  const p = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'maximum'].includes(period)
    ? period
    : 'last_30d';
  const { start, end } = resolveDashboardPeriodRange(p, now);

  try {
    // Query 1: Web Events — usa subquery ANY para acionar o índice (site_key, event_name, event_time)
    const eventsQuery = `
      SELECT
        COUNT(CASE WHEN e.event_name = 'PageView' THEN 1 END)::int as page_views,
        COUNT(CASE WHEN e.event_name = 'PageEngagement' THEN 1 END)::int as engagements,
        COUNT(CASE WHEN e.event_name IN ('Lead', 'CompleteRegistration', 'Contact', 'Schedule') THEN 1 END)::int as leads,
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
        AND COALESCE(p.platform_date, p.created_at) >= $3
        AND COALESCE(p.platform_date, p.created_at) <= $4
        AND p.status IN ('approved', 'paid', 'completed', 'active')
    `;

    const [eventsRes, purchasesRes] = await Promise.all([
      pool.query(eventsQuery, [auth.accountId, siteId, start, end]),
      pool.query(purchasesQuery, [auth.accountId, siteId, start, end])
    ]);

    const events = eventsRes.rows[0] || {};
    const purchases = purchasesRes.rows[0] || {};

    const ev = events as Record<string, number | string | null | undefined>;
    res.json({
      page_views: Number(ev.page_views || 0),
      engagements: Number(ev.engagements || 0),
      leads: Number(ev.leads || 0),
      checkouts: Number(ev.checkouts || 0),
      purchases: Number(purchases.purchases || 0)
    });
  } catch (err) {
    console.error('Dashboard Funnel Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
