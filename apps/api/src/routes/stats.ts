import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import geoip from 'geoip-lite';
import { resolvePixelCountryToken } from '../lib/pixel-country';

const router = Router();

// TEMPORARY: Diagnostic endpoint to debug purchase visibility issues
router.get('/debug-purchase/:orderId', requireAuth, async (req, res) => {
  const orderId = req.params.orderId;
  try {
    const result = await pool.query(
      `SELECT order_id, platform, amount, currency, status, platform_date, created_at, buyer_email_hash, fbp, fbc
       FROM purchases WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return res.json({
      found: (result.rowCount || 0) > 0,
      row: result.rows[0] || null,
      server_now_utc: now.toISOString(),
      today_start_utc: todayStart.toISOString(),
      note: 'Compare platform_date/created_at with today_start to see if it falls within "Hoje" filter',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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

  const sites = await pool.query('SELECT COUNT(*)::int as c FROM sites WHERE account_id = $1', [auth.accountId]);

  const eventsPeriod = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM web_events e
     WHERE e.site_key = ANY(
       SELECT site_key FROM sites WHERE account_id = $1 AND ($4::int IS NULL OR id = $4::int)
     )
       AND e.event_time >= $2
       AND e.event_time <= $3`,
    [auth.accountId, start, end, siteId]
  );

  const purchasesPeriod = await pool.query(
    `SELECT
       COUNT(*)::int as c,
       COALESCE(SUM(CASE WHEN p.status IN ('approved', 'paid', 'completed', 'active') AND p.currency = $5 THEN p.amount ELSE 0 END), 0) as total_revenue
     FROM purchases p
     WHERE p.site_key = ANY(
       SELECT site_key FROM sites WHERE account_id = $1 AND ($4::int IS NULL OR id = $4::int)
     )
        AND COALESCE(p.platform_date, p.created_at) >= $2
        AND COALESCE(p.platform_date, p.created_at) <= $3`,
    [auth.accountId, start, end, siteId, currency]
  );

  const reportsPeriod = await pool.query(
    `SELECT COUNT(*)::int as c
     FROM recommendation_reports r
     WHERE r.site_key = ANY(
       SELECT site_key FROM sites WHERE account_id = $1 AND ($4::int IS NULL OR id = $4::int)
     )
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
    const QUALITY_SAMPLE_LIMIT = 50000;
    const query = `
      WITH combined_events AS (
        (SELECT user_data
        FROM web_events
        WHERE site_key = $1 AND event_time >= $2 AND event_time <= $3
          AND (
            (user_data->>'em' IS NOT NULL AND user_data->>'em' != '[]' AND user_data->>'em' != '') OR 
            (user_data->>'ph' IS NOT NULL AND user_data->>'ph' != '[]' AND user_data->>'ph' != '') OR 
            (user_data->>'fn' IS NOT NULL AND user_data->>'fn' != '[]' AND user_data->>'fn' != '') OR 
            (user_data->>'ln' IS NOT NULL AND user_data->>'ln' != '[]' AND user_data->>'ln' != '')
          )
        ORDER BY event_time DESC
        LIMIT ${QUALITY_SAMPLE_LIMIT})

        UNION ALL

        (SELECT raw_payload->'_capi_debug'->'user_data' as user_data
        FROM purchases
        WHERE site_key = $1 AND COALESCE(platform_date, created_at) >= $2 AND COALESCE(platform_date, created_at) <= $3
        ORDER BY COALESCE(platform_date, created_at) DESC
        LIMIT ${QUALITY_SAMPLE_LIMIT})
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
         TO_CHAR(COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') as date,
         COUNT(*)::int as count,
         COALESCE(SUM(CASE WHEN p.status IN ('approved', 'paid', 'completed', 'active') AND p.currency = $5 THEN p.amount ELSE 0 END), 0)::float as revenue
       FROM purchases p
       WHERE p.site_key = ANY(
         SELECT site_key FROM sites WHERE account_id = $1 AND ($4::int IS NULL OR id = $4::int)
       )
         AND COALESCE(p.platform_date, p.created_at) >= $2
         AND COALESCE(p.platform_date, p.created_at) <= $3
       GROUP BY 1
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
    // Queries para encontrar picos por tipo de evento
    const getPeak = async (eventNames: string[]) => {
      const isPurchase = eventNames.includes('Purchase');
      let query = '';
      let topSourcesQuery = '';
      let topLocationsQuery = '';

      if (isPurchase) {
        // Query na tabela purchases — usa subquery ANY para acionar o índice (site_key, status, created_at)
        query = `
          SELECT
            EXTRACT(DOW FROM (COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'America/Sao_Paulo'))::int as dow,
            EXTRACT(HOUR FROM (COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'America/Sao_Paulo'))::int as hour,
            COUNT(*)::int as count
          FROM purchases p
          WHERE p.site_key = ANY(
            SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
          )
            AND COALESCE(p.platform_date, p.created_at) >= $3 AND COALESCE(p.platform_date, p.created_at) <= $4
            AND p.status IN ('approved', 'paid', 'completed', 'active')
          GROUP BY 1, 2
          ORDER BY 3 DESC
        `;

        topSourcesQuery = `
          WITH purchases_base AS (
            SELECT
              p.site_key,
              COALESCE(p.platform_date, p.created_at) as created_at,
              p.raw_payload,
              p.buyer_email_hash,
              p.fbp,
              p.fbc,
              p.raw_payload->>'_extracted_external_id' AS extracted_external_id
            FROM purchases p
            WHERE p.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND COALESCE(p.platform_date, p.created_at) >= $3 AND COALESCE(p.platform_date, p.created_at) <= $4
              AND p.status IN ('approved', 'paid', 'completed', 'active')
          ),
          attributed AS (
            SELECT
              COALESCE(
                sv_source.source,
                ic_source.source,
                ev_source.source,
                ic_site_source.source,
                NULLIF(pb.raw_payload->'custom_data'->>'traffic_source', ''),
                NULLIF(pb.raw_payload->'custom_data'->>'utm_source', ''),
                NULLIF(pb.raw_payload->>'utm_source', ''),
                NULLIF(pb.raw_payload->>'src', ''),
                NULLIF(pb.raw_payload->>'sck', ''),
                NULLIF(pb.raw_payload->'trackingParameters'->>'utm_source', '')
              ) as source
            FROM purchases_base pb
            LEFT JOIN LATERAL (
              SELECT
                CASE
                  WHEN sv.last_traffic_source IS NULL OR btrim(sv.last_traffic_source) = '' THEN NULL
                  WHEN lower(sv.last_traffic_source) LIKE 'trk_%' THEN NULL
                  WHEN sv.last_traffic_source ~* '(^|[?&])utm_source=' THEN
                    NULLIF((regexp_match(sv.last_traffic_source, '(?:^|[?&])utm_source=([^&#]+)'))[1], '')
                  ELSE sv.last_traffic_source
                END as source
              FROM site_visitors sv
              WHERE sv.site_key = pb.site_key
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND sv.email_hash = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND sv.fbp = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND sv.fbc = pb.fbc)
                )
              ORDER BY sv.last_seen_at DESC
              LIMIT 1
            ) sv_source ON TRUE
            LEFT JOIN LATERAL (
              SELECT
                COALESCE(
                  NULLIF(e.custom_data->>'traffic_source', ''),
                  NULLIF(e.custom_data->>'utm_source', '')
                ) as source
              FROM web_events e
              WHERE e.site_key = pb.site_key
                AND e.event_name IN ('InitiateCheckout', 'AddToCart')
                AND e.event_time <= pb.created_at
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND e.user_data->>'em' = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND e.user_data->>'fbp' = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND e.user_data->>'fbc' = pb.fbc)
                  OR (pb.extracted_external_id IS NOT NULL AND e.user_data->>'external_id' = pb.extracted_external_id)
                )
                AND (
                  NULLIF(e.custom_data->>'traffic_source', '') IS NOT NULL
                  OR NULLIF(e.custom_data->>'utm_source', '') IS NOT NULL
                )
              ORDER BY e.event_time DESC
              LIMIT 1
            ) ic_source ON TRUE
            LEFT JOIN LATERAL (
              SELECT
                COALESCE(
                  NULLIF(e.custom_data->>'traffic_source', ''),
                  NULLIF(e.custom_data->>'utm_source', '')
                ) as source
              FROM web_events e
              WHERE e.site_key = pb.site_key
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND e.user_data->>'em' = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND e.user_data->>'fbp' = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND e.user_data->>'fbc' = pb.fbc)
                  OR (pb.extracted_external_id IS NOT NULL AND e.user_data->>'external_id' = pb.extracted_external_id)
                )
                AND e.event_time <= pb.created_at
                AND (
                  NULLIF(e.custom_data->>'traffic_source', '') IS NOT NULL
                  OR NULLIF(e.custom_data->>'utm_source', '') IS NOT NULL
                )
              ORDER BY e.event_time DESC
              LIMIT 1
            ) ev_source ON TRUE
            LEFT JOIN LATERAL (
              SELECT
                COALESCE(
                  NULLIF(e.custom_data->>'traffic_source', ''),
                  NULLIF(e.custom_data->>'utm_source', '')
                ) as source
              FROM web_events e
              WHERE e.site_key = pb.site_key
                AND e.event_name IN ('InitiateCheckout', 'AddToCart')
                AND e.event_time <= pb.created_at
                AND e.event_time >= pb.created_at - INTERVAL '24 hours'
                AND (
                  NULLIF(e.custom_data->>'traffic_source', '') IS NOT NULL
                  OR NULLIF(e.custom_data->>'utm_source', '') IS NOT NULL
                )
              ORDER BY e.event_time DESC
              LIMIT 1
            ) ic_site_source ON TRUE
          )
          SELECT
            COALESCE(
              CASE
                WHEN source IS NULL OR btrim(source) = '' THEN NULL
                WHEN lower(source) LIKE 'trk_%' THEN NULL
                ELSE source
              END,
              'Direct / Unknown'
            ) as source,
            COUNT(*)::int as count
          FROM attributed
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 3
        `;

        topLocationsQuery = `
          WITH purchases_base AS (
            SELECT p.site_key, p.buyer_email_hash, p.fbp, p.fbc,
                   p.raw_payload->'_capi_debug'->'user_data'->>'client_ip_address' as capi_ip,
                   p.raw_payload->>'_extracted_external_id' AS extracted_external_id
            FROM purchases p
            WHERE p.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND COALESCE(p.platform_date, p.created_at) >= $3 AND COALESCE(p.platform_date, p.created_at) <= $4
              AND p.status IN ('approved', 'paid', 'completed', 'active')
          ),
          attributed AS (
            SELECT
              COALESCE(sv_loc.ip, ev_ip.ip, pb.capi_ip) as ip,
              ev_country.pixel_country AS pixel_country
            FROM purchases_base pb
            LEFT JOIN LATERAL (
              SELECT sv.last_ip as ip
              FROM site_visitors sv
              WHERE sv.site_key = pb.site_key
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND sv.email_hash = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND sv.fbp = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND sv.fbc = pb.fbc)
                )
              ORDER BY sv.last_seen_at DESC
              LIMIT 1
            ) sv_loc ON TRUE
            LEFT JOIN LATERAL (
              SELECT e.user_data->>'client_ip_address' as ip
              FROM web_events e
              WHERE e.site_key = pb.site_key
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND e.user_data->>'em' = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND e.user_data->>'fbp' = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND e.user_data->>'fbc' = pb.fbc)
                  OR (pb.extracted_external_id IS NOT NULL AND e.user_data->>'external_id' = pb.extracted_external_id)
                )
                AND e.user_data->>'client_ip_address' IS NOT NULL
              ORDER BY e.event_time DESC
              LIMIT 1
            ) ev_ip ON sv_loc.ip IS NULL
            LEFT JOIN LATERAL (
              SELECT
                CASE
                  WHEN NOT (e.user_data ? 'country') THEN NULL::text
                  WHEN jsonb_typeof(e.user_data->'country') = 'array'
                    THEN NULLIF(btrim(e.user_data->'country'->>0), '')
                  ELSE NULLIF(btrim(e.user_data->>'country'), '')
                END AS pixel_country
              FROM web_events e
              WHERE e.site_key = pb.site_key
                AND (
                  (pb.buyer_email_hash IS NOT NULL AND e.user_data->>'em' = pb.buyer_email_hash)
                  OR (pb.fbp IS NOT NULL AND e.user_data->>'fbp' = pb.fbp)
                  OR (pb.fbc IS NOT NULL AND e.user_data->>'fbc' = pb.fbc)
                  OR (pb.extracted_external_id IS NOT NULL AND e.user_data->>'external_id' = pb.extracted_external_id)
                )
                AND e.user_data->'country' IS NOT NULL
                AND (
                  (jsonb_typeof(e.user_data->'country') = 'array'
                    AND jsonb_array_length(COALESCE(e.user_data->'country', '[]'::jsonb)) > 0)
                  OR (jsonb_typeof(e.user_data->'country') = 'string'
                    AND length(btrim(e.user_data->>'country')) > 0)
                )
              ORDER BY e.event_time DESC
              LIMIT 1
            ) ev_country ON TRUE
          )
          SELECT ip, pixel_country, COUNT(*)::int as count
          FROM attributed
          WHERE (ip IS NOT NULL AND btrim(ip::text) <> '')
             OR (pixel_country IS NOT NULL AND btrim(pixel_country) <> '')
          GROUP BY ip, pixel_country
          ORDER BY 3 DESC
          LIMIT 100
        `;
      } else {
        // Query na tabela web_events — usa subquery ANY para acionar o índice (site_key, event_name, event_time)
        query = `
          SELECT
            EXTRACT(DOW FROM (e.event_time AT TIME ZONE 'America/Sao_Paulo'))::int as dow,
            EXTRACT(HOUR FROM (e.event_time AT TIME ZONE 'America/Sao_Paulo'))::int as hour,
            COUNT(*)::int as count
          FROM web_events e
          WHERE e.site_key = ANY(
            SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
          )
            AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
          GROUP BY 1, 2
          ORDER BY 3 DESC
        `;

        topSourcesQuery = `
          WITH events_base AS (
            SELECT e.site_key, e.event_time, e.user_data, e.custom_data, e.event_source_url
            FROM web_events e
            WHERE e.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
          ),
          attributed AS (
            SELECT
              COALESCE(
                sv_source.source,
                purchase_source.source,
                NULLIF(eb.custom_data->>'traffic_source', ''),
                NULLIF(eb.custom_data->>'utm_source', ''),
                NULL
              ) as source
            FROM events_base eb
            LEFT JOIN LATERAL (
              SELECT
                CASE
                  WHEN sv.last_traffic_source IS NULL OR btrim(sv.last_traffic_source) = '' THEN NULL
                  WHEN lower(sv.last_traffic_source) LIKE 'trk_%' THEN NULL
                  WHEN sv.last_traffic_source ~* '(^|[?&])utm_source=' THEN
                    NULLIF((regexp_match(sv.last_traffic_source, '(?:^|[?&])utm_source=([^&#]+)'))[1], '')
                  ELSE sv.last_traffic_source
                END as source
              FROM site_visitors sv
              WHERE sv.site_key = eb.site_key
                AND (
                  (eb.user_data->>'external_id' IS NOT NULL AND sv.external_id = eb.user_data->>'external_id')
                  OR (eb.user_data->>'em' IS NOT NULL AND sv.email_hash = eb.user_data->>'em')
                  OR (eb.user_data->>'ph' IS NOT NULL AND sv.phone_hash = eb.user_data->>'ph')
                  OR (eb.user_data->>'fbp' IS NOT NULL AND sv.fbp = eb.user_data->>'fbp')
                  OR (eb.user_data->>'fbc' IS NOT NULL AND sv.fbc = eb.user_data->>'fbc')
                )
              ORDER BY sv.last_seen_at DESC
              LIMIT 1
            ) sv_source ON TRUE
            LEFT JOIN LATERAL (
              SELECT
                CASE
                  WHEN sv.last_traffic_source IS NULL OR btrim(sv.last_traffic_source) = '' THEN NULL
                  WHEN lower(sv.last_traffic_source) LIKE 'trk_%' THEN NULL
                  WHEN sv.last_traffic_source ~* '(^|[?&])utm_source=' THEN
                    NULLIF((regexp_match(sv.last_traffic_source, '(?:^|[?&])utm_source=([^&#]+)'))[1], '')
                  ELSE sv.last_traffic_source
                END as source
              FROM purchases pb
              JOIN site_visitors sv ON sv.site_key = pb.site_key
                AND (pb.buyer_email_hash = sv.email_hash OR (pb.fbp IS NOT NULL AND sv.fbp = pb.fbp) OR (pb.fbc IS NOT NULL AND sv.fbc = pb.fbc))
              WHERE pb.site_key = eb.site_key
                AND pb.created_at >= eb.event_time
                AND pb.created_at <= eb.event_time + INTERVAL '7 days'
                AND pb.status IN ('approved', 'paid', 'completed', 'active')
                AND (
                  (eb.user_data->>'em' IS NOT NULL AND pb.buyer_email_hash = eb.user_data->>'em')
                  OR (eb.user_data->>'fbp' IS NOT NULL AND pb.fbp = eb.user_data->>'fbp')
                  OR (eb.user_data->>'fbc' IS NOT NULL AND pb.fbc = eb.user_data->>'fbc')
                )
              ORDER BY pb.created_at ASC
              LIMIT 1
            ) purchase_source ON TRUE
          )
          SELECT
            COALESCE(
              CASE
                WHEN source IS NULL OR btrim(source) = '' THEN NULL
                WHEN lower(source) LIKE 'trk_%' THEN NULL
                ELSE source
              END,
              'Direct / Unknown'
            ) as source,
            COUNT(*)::int as count
          FROM attributed
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 3
        `;

        topLocationsQuery = `
          WITH events_base AS (
            SELECT e.site_key, e.user_data
            FROM web_events e
            WHERE e.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
          ),
          attributed AS (
            SELECT
              COALESCE(
                NULLIF(btrim(COALESCE(eb.user_data->>'client_ip_address', '')), ''),
                sv_loc.ip
              ) as ip,
              CASE
                WHEN NOT (eb.user_data ? 'country') THEN NULL::text
                WHEN jsonb_typeof(eb.user_data->'country') = 'array'
                  THEN NULLIF(btrim(eb.user_data->'country'->>0), '')
                ELSE NULLIF(btrim(eb.user_data->>'country'), '')
              END AS pixel_country
            FROM events_base eb
            LEFT JOIN LATERAL (
              SELECT sv.last_ip as ip
              FROM site_visitors sv
              WHERE sv.site_key = eb.site_key
                AND (
                  (eb.user_data->>'external_id' IS NOT NULL AND sv.external_id = eb.user_data->>'external_id')
                  OR (eb.user_data->>'em' IS NOT NULL AND sv.email_hash = eb.user_data->>'em')
                  OR (eb.user_data->>'ph' IS NOT NULL AND sv.phone_hash = eb.user_data->>'ph')
                  OR (eb.user_data->>'fbp' IS NOT NULL AND sv.fbp = eb.user_data->>'fbp')
                  OR (eb.user_data->>'fbc' IS NOT NULL AND sv.fbc = eb.user_data->>'fbc')
                )
              ORDER BY sv.last_seen_at DESC
              LIMIT 1
            ) sv_loc ON TRUE
          )
          SELECT ip, pixel_country, COUNT(*)::int as count
          FROM attributed
          WHERE (ip IS NOT NULL AND btrim(ip::text) <> '')
             OR (pixel_country IS NOT NULL AND btrim(pixel_country) <> '')
          GROUP BY ip, pixel_country
          ORDER BY 3 DESC
          LIMIT 100
        `;
      }

      const params = isPurchase 
        ? [auth.accountId, siteId, start, end]
        : [auth.accountId, siteId, start, end, eventNames];

      const [peakResult, sourceResult, locationResult] = await Promise.all([
        pool.query(query, params),
        pool.query(topSourcesQuery, params),
        pool.query(topLocationsQuery, params)
      ]);

      // Resolve IPs em Localizações em memória (rápido com geoip-lite)
      const locationCounts = new Map<string, number>();
      
      locationResult.rows.forEach((row) => {
        const pixelLabel = resolvePixelCountryToken(
          row.pixel_country != null ? String(row.pixel_country) : undefined
        );
        let locName: string | null = pixelLabel;
        const ipRaw = row.ip != null ? String(row.ip).trim() : '';
        if (!locName && ipRaw !== '') {
          let ip = ipRaw;
          if (ip.includes(',')) ip = ip.split(',')[0].trim();
          ip = ip.replace(/^::ffff:/, '');

          const geo = geoip.lookup(ip);
          if (geo) {
            const parts: string[] = [];
            if (geo.city && geo.city !== 'null') parts.push(geo.city);
            if (geo.region && geo.region !== 'null') parts.push(geo.region);
            if (parts.length > 0) {
              locName = `${parts.join(', ')} - ${geo.country || 'BR'}`;
            } else if (geo.country && geo.country !== 'null') {
              locName = geo.country;
            }
          }
        }

        if (locName) {
          const n = Number(row.count);
          locationCounts.set(locName, (locationCounts.get(locName) || 0) + (Number.isFinite(n) ? n : 0));
        }
      });
      
      const topLocations = Array.from(locationCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([location, count]) => ({ location, count }));

      // Encontra o melhor horário para cada dia da semana
      const bestByDay = new Map<number, { hour: number; count: number }>();
      let globalBestDay = -1;
      let maxCount = -1;

      peakResult.rows.forEach(row => {
        const dow = row.dow;
        const count = row.count;

        // Atualiza melhor dia global
        if (count > maxCount) {
          maxCount = count;
          globalBestDay = dow;
        }

        // Se ainda não tem melhor horário para esse dia, ou achou um com mais volume
        if (!bestByDay.has(dow)) {
          bestByDay.set(dow, { hour: row.hour, count });
        }
      });

      // Retorna array ordenado por dia da semana (0=Dom, 6=Sab)
      const dailyPeaks = [];
      for (let i = 0; i <= 6; i++) {
        const data = bestByDay.get(i);
        dailyPeaks.push({
          dow: i,
          hour: data?.hour ?? null,
          count: data?.count ?? 0,
          is_best_day: i === globalBestDay
        });
      }

      return {
        daily_peaks: dailyPeaks,
        total_volume: maxCount, // apenas para referência de escala
        top_sources: sourceResult.rows.map(r => ({ source: r.source, count: r.count })),
        top_locations: topLocations
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
