import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import geoip from 'geoip-lite';
import { pixelCountryTokenToIso2, resolvePixelCountryToken } from '../lib/pixel-country';
import { getMetaReportTimeZone, resolveDashboardPeriodRange } from '../lib/meta-report-timezone';

const router = Router();

// Cache curto para evitar 12 queries pesadas a cada refresh do dashboard.
const BEST_TIMES_CACHE_TTL_MS = 120_000; // 2 min
const bestTimesCache = new Map<
  string,
  { at: number; value: any }
>();

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
    const tz = getMetaReportTimeZone();
    const { start: todayReportTzStart } = resolveDashboardPeriodRange('today', now);
    return res.json({
      found: (result.rowCount || 0) > 0,
      row: result.rows[0] || null,
      server_now_utc: now.toISOString(),
      meta_report_timezone: tz,
      today_start_report_calendar_utc: todayReportTzStart.toISOString(),
      note:
        'Compare platform_date/created_at with today_start_report_calendar_utc (início do dia civil no META_INSIGHTS_TIMEZONE) para o filtro "Hoje".',
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
  const p = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'maximum'].includes(period)
    ? period
    : 'today';
  const { start, end } = resolveDashboardPeriodRange(p, now);
  const reportTz = getMetaReportTimeZone();
  const reportTodayYmd = new Intl.DateTimeFormat('sv-SE', { timeZone: reportTz }).format(now).slice(0, 10);
  const reportStartYmd = new Intl.DateTimeFormat('sv-SE', { timeZone: reportTz }).format(start).slice(0, 10);
  const reportEndYmd = new Intl.DateTimeFormat('sv-SE', { timeZone: reportTz }).format(end).slice(0, 10);

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

  // Meta (spend / receita / roas) — usa os rollups de campanha (evita dupla contagem de ad/adset).
  const metaAgg = await pool.query(
    `
      SELECT
        COALESCE(SUM(m.spend), 0)::numeric AS spend,
        COALESCE(SUM((
          SELECT COALESCE(SUM((av->>'value')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(m.raw_payload->'action_values', '[]'::jsonb)) av
          WHERE av->>'action_type' = 'purchase'
        )), 0)::numeric AS meta_revenue
      FROM meta_insights_daily m
      WHERE m.site_id = ANY(
        SELECT id FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
      )
        AND m.campaign_id IS NOT NULL
        AND m.adset_id IS NULL
        AND m.ad_id IS NULL
        AND m.date_start >= $3::date
        AND m.date_start <= $4::date
    `,
    [auth.accountId, siteId, reportStartYmd, reportEndYmd]
  );

  const metaSpend = Number(metaAgg.rows[0]?.spend || 0);
  const metaRevenue = Number(metaAgg.rows[0]?.meta_revenue || 0);
  const metaRoas = metaSpend > 0 ? Math.round((metaRevenue / metaSpend) * 1000) / 1000 : 0;

  return res.json({
    sites: sites.rows[0]?.c || 0,
    events_today: eventsPeriod.rows[0]?.c || 0,
    purchases_today: purchasesPeriod.rows[0]?.c || 0,
    total_revenue: purchasesPeriod.rows[0]?.total_revenue || 0,
    reports_7d: reportsPeriod.rows[0]?.c || 0,
    meta_spend: metaSpend,
    meta_revenue: metaRevenue,
    meta_roas: metaRoas,
    // debug: ajuda a validar se "Hoje" está no fuso correto
    _range: {
      period: p,
      report_timezone: reportTz,
      report_today_ymd: reportTodayYmd,
      report_start_ymd: reportStartYmd,
      report_end_ymd: reportEndYmd,
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
      server_now_utc: now.toISOString(),
    },
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
  const p = ['today', 'last_7d', 'last_30d'].includes(period) ? period : 'last_7d';
  const { start, end } = resolveDashboardPeriodRange(p, now);

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
  const p = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'maximum'].includes(period)
    ? period
    : 'last_30d';
  const { start, end } = resolveDashboardPeriodRange(p, now);

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
  const { start, end } = resolveDashboardPeriodRange(period);
  const reportTz = getMetaReportTimeZone();
  const cacheKey = `a:${auth.accountId}|s:${siteId ?? 'all'}|p:${String(period || '').toLowerCase()}|tz:${reportTz}`;
  const cached = bestTimesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BEST_TIMES_CACHE_TTL_MS) {
    return res.json(cached.value);
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
            EXTRACT(DOW FROM ((COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'UTC') AT TIME ZONE $5::text))::int as dow,
            EXTRACT(HOUR FROM ((COALESCE(p.platform_date, p.created_at) AT TIME ZONE 'UTC') AT TIME ZONE $5::text))::int as hour,
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
          -- Performance: no Purchase, evitar JOINs laterais (web_events/site_visitors) que podem estourar timeout.
          -- Fonte: colunas utm_* + custom_data (CAPI) + raw_payload Hotmart + _capi_debug (gravado pelo webhook).
          WITH purchases_base AS (
            SELECT p.raw_payload, p.utm_source AS col_utm_source, p.custom_data AS purchase_custom_data
            FROM purchases p
            WHERE p.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND COALESCE(p.platform_date, p.created_at) >= $3 AND COALESCE(p.platform_date, p.created_at) <= $4
              AND p.status IN ('approved', 'paid', 'completed', 'active')
            ORDER BY COALESCE(p.platform_date, p.created_at) DESC
            LIMIT 500
          ),
          attributed AS (
            SELECT
              COALESCE(
                NULLIF(btrim(col_utm_source::text), ''),
                NULLIF((purchase_custom_data->>'utm_source')::text, ''),
                NULLIF((purchase_custom_data->>'traffic_source')::text, ''),
                NULLIF((raw_payload->'_capi_debug'->'custom_data'->>'utm_source')::text, ''),
                NULLIF((raw_payload->'_capi_debug'->'custom_data'->>'traffic_source')::text, ''),
                NULLIF((raw_payload->'custom_data'->>'traffic_source')::text, ''),
                NULLIF((raw_payload->'custom_data'->>'utm_source')::text, ''),
                NULLIF((raw_payload->>'utm_source')::text, ''),
                NULLIF((raw_payload->>'src')::text, ''),
                NULLIF((raw_payload->>'sck')::text, ''),
                NULLIF((raw_payload->'trackingParameters'->>'utm_source')::text, ''),
                NULLIF((raw_payload->'tracking_parameters'->>'utm_source')::text, '')
              ) as source
            FROM purchases_base
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
          -- Performance: para Purchase, usamos IP salvo na compra (CAPI debug) e evitamos JOINs laterais.
          WITH purchases_base AS (
            SELECT
              p.raw_payload->'_capi_debug'->'user_data'->>'client_ip_address' as ip
            FROM purchases p
            WHERE p.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND COALESCE(p.platform_date, p.created_at) >= $3 AND COALESCE(p.platform_date, p.created_at) <= $4
              AND p.status IN ('approved', 'paid', 'completed', 'active')
            ORDER BY COALESCE(p.platform_date, p.created_at) DESC
            LIMIT 500
          )
          SELECT ip, NULL::text as pixel_country, COUNT(*)::int as count
          FROM purchases_base
          WHERE ip IS NOT NULL AND btrim(ip::text) <> ''
          GROUP BY 1
          ORDER BY 3 DESC
          LIMIT 100
        `;
      } else {
        // Query na tabela web_events — usa subquery ANY para acionar o índice (site_key, event_name, event_time)
        query = `
          SELECT
            EXTRACT(DOW FROM ((e.event_time AT TIME ZONE 'UTC') AT TIME ZONE $6::text))::int as dow,
            EXTRACT(HOUR FROM ((e.event_time AT TIME ZONE 'UTC') AT TIME ZONE $6::text))::int as hour,
            COUNT(*)::int as count
          FROM web_events e
          WHERE e.site_key = ANY(
            SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
          )
            AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
          GROUP BY 1, 2
          ORDER BY 3 DESC
        `;

        // Performance: evitar LATERAL em site_visitors/purchases sobre todo o período (estourava statement_timeout).
        // Fontes = só o que já está no evento (igual filosofia do ramo Purchase).
        topSourcesQuery = `
          WITH events_base AS (
            SELECT e.custom_data
            FROM web_events e
            WHERE e.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
            ORDER BY e.event_time DESC
            LIMIT 5000
          ),
          attributed AS (
            SELECT
              COALESCE(
                NULLIF(btrim(eb.custom_data->>'traffic_source'), ''),
                NULLIF(btrim(eb.custom_data->>'utm_source'), ''),
                NULL
              ) as source
            FROM events_base eb
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
            SELECT e.site_key, e.user_data, e.event_time
            FROM web_events e
            WHERE e.site_key = ANY(
              SELECT site_key FROM sites WHERE account_id = $1 AND ($2::int IS NULL OR id = $2::int)
            )
              AND e.event_name = ANY($5) AND e.event_time >= $3 AND e.event_time <= $4
            ORDER BY e.event_time DESC
            LIMIT 5000
          ),
          attributed AS (
            SELECT
              NULLIF(btrim(COALESCE(eb.user_data->>'client_ip_address', '')), '') as ip,
              CASE
                WHEN NOT (eb.user_data ? 'country') THEN NULL::text
                WHEN jsonb_typeof(eb.user_data->'country') = 'array'
                  THEN NULLIF(btrim(eb.user_data->'country'->>0), '')
                ELSE NULLIF(btrim(eb.user_data->>'country'), '')
              END AS pixel_country
            FROM events_base eb
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

      // Cada query usa um conjunto diferente de placeholders; não reutilizar o mesmo array (PG rejeita parâmetros a mais).
      const paramsBase = [auth.accountId, siteId, start, end] as const;
      const peakParams = isPurchase
        ? [...paramsBase, reportTz]
        : [...paramsBase, eventNames, reportTz];
      const auxParams = isPurchase ? [...paramsBase] : [...paramsBase, eventNames];

      // Sequencial: menos pico de carga no Postgres; a query de fontes já foi a mais pesada.
      const peakResult = await pool.query(query, peakParams);
      const sourceResult = await pool.query(topSourcesQuery, auxParams);
      const locationResult = await pool.query(topLocationsQuery, auxParams);

      // Resolve IPs em Localizações em memória (rápido com geoip-lite).
      // Se o país do Meta (pixel) e o país do GeoIP baterem, usamos cidade/estado do IP + sufixo · pixel.
      // Se não baterem, ficamos só no país do pixel (evita cidade de datacenter/VPN em outro país).
      const locationCounts = new Map<string, number>();

      const geoFromIp = (ipRaw: string): { iso2: string; locName: string } | null => {
        let ip = ipRaw.trim();
        if (!ip) return null;
        if (ip.includes(',')) ip = ip.split(',')[0].trim();
        ip = ip.replace(/^::ffff:/, '');
        const geo = geoip.lookup(ip);
        if (!geo || !geo.country || geo.country === 'null') return null;
        const iso2 = String(geo.country).toUpperCase();
        const parts: string[] = [];
        if (geo.city && geo.city !== 'null') parts.push(geo.city);
        if (geo.region && geo.region !== 'null') parts.push(geo.region);
        const locName =
          parts.length > 0 ? `${parts.join(', ')} - ${iso2}` : iso2;
        return { iso2, locName };
      };

      locationResult.rows.forEach((row) => {
        const pixelToken =
          row.pixel_country != null ? String(row.pixel_country) : undefined;
        const pixelIso = pixelCountryTokenToIso2(pixelToken);
        const pixelLabel = resolvePixelCountryToken(pixelToken);
        const ipRaw = row.ip != null ? String(row.ip).trim() : '';
        const geo = ipRaw !== '' ? geoFromIp(ipRaw) : null;

        let locName: string | null = null;
        if (pixelIso && geo && geo.iso2 === pixelIso) {
          locName =
            geo.locName.includes(',') || geo.locName.length > 3
              ? `${geo.locName} · pixel`
              : pixelLabel;
        } else if (pixelIso && geo && geo.iso2 !== pixelIso) {
          locName = pixelLabel;
        } else if (pixelLabel) {
          locName = pixelLabel;
        } else if (geo) {
          locName = geo.locName;
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

    // Evita sobrecarregar o Postgres com 12 queries simultâneas.
    const pageview = await getPeak(['PageView']);
    const purchase = await getPeak(['Purchase']);
    const lead = await getPeak(['Lead', 'CompleteRegistration', 'Contact', 'Schedule']);
    const checkout = await getPeak(['InitiateCheckout', 'AddToCart']);

    const out = {
      pageview,
      purchase,
      lead,
      checkout,
      report_timezone: reportTz,
    };
    bestTimesCache.set(cacheKey, { at: Date.now(), value: out });
    return res.json(out);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
