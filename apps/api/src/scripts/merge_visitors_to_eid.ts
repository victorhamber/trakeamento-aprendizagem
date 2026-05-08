import { Pool } from 'pg';

type VisitorRow = {
  id: number;
  site_key: string;
  external_id: string;
  fbp: string | null;
  fbc: string | null;
  email_hash: string | null;
  phone_hash: string | null;
  first_name_hash: string | null;
  last_name_hash: string | null;
  last_traffic_source: string | null;
  first_traffic_source: string | null;
  total_events: number | null;
  last_event_name: string | null;
  last_ip: string | null;
  last_user_agent: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  first_group_tag: string | null;
  last_group_tag: string | null;
  last_group_tag_at: string | null;
  group_tags_history: unknown;
  last_seen_at: string | null;
};

function isNonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== '';
}

function jsonArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}

function mergeTagHistory(primary: string[], secondary: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...primary, ...secondary]) {
    const t = (v || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 50);
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am)) return b;
  if (!Number.isFinite(bm)) return a;
  return bm > am ? b : a;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing DATABASE_URL');

  const dryRun = String(process.env.DRY_RUN || '1').trim() !== '0';
  const maxPairs = Math.max(1, Number(process.env.MAX_PAIRS || 500));
  const siteKeyFilter = String(process.env.SITE_KEY || '').trim();

  const pool = new Pool({
    connectionString: databaseUrl,
    statement_timeout: 60_000,
  });

  // 1) Encontra pares (from_id != eid_) -> (to_id = eid_) por chaves fortes.
  //    Preferimos o eid_ mais recente.
  const pairsRes = await pool.query<{
    site_key: string;
    from_external_id: string;
    to_external_id: string;
  }>(
    `
    WITH non_eid AS (
      SELECT site_key, external_id, email_hash, phone_hash, fbp, fbc, last_seen_at
      FROM site_visitors
      WHERE position('eid_' in external_id) <> 1
        AND (
          email_hash IS NOT NULL OR phone_hash IS NOT NULL OR fbp IS NOT NULL OR fbc IS NOT NULL
        )
    ),
    eid AS (
      SELECT site_key, external_id, email_hash, phone_hash, fbp, fbc, last_seen_at
      FROM site_visitors
      WHERE position('eid_' in external_id) = 1
    ),
    matches AS (
      SELECT
        n.site_key,
        n.external_id AS from_external_id,
        e.external_id AS to_external_id,
        GREATEST(
          CASE WHEN n.email_hash IS NOT NULL AND e.email_hash = n.email_hash THEN 4 ELSE 0 END,
          CASE WHEN n.phone_hash IS NOT NULL AND e.phone_hash = n.phone_hash THEN 3 ELSE 0 END,
          CASE WHEN n.fbp IS NOT NULL AND e.fbp = n.fbp THEN 2 ELSE 0 END,
          CASE WHEN n.fbc IS NOT NULL AND e.fbc = n.fbc THEN 2 ELSE 0 END
        ) AS score,
        COALESCE(e.last_seen_at, e.last_seen_at, NOW()) AS eid_seen_at
      FROM non_eid n
      JOIN eid e
        ON e.site_key = n.site_key
       AND (
         (n.email_hash IS NOT NULL AND e.email_hash = n.email_hash)
         OR (n.phone_hash IS NOT NULL AND e.phone_hash = n.phone_hash)
         OR (n.fbp IS NOT NULL AND e.fbp = n.fbp)
         OR (n.fbc IS NOT NULL AND e.fbc = n.fbc)
       )
      WHERE ($1::text = '' OR n.site_key = $1)
    )
    SELECT DISTINCT ON (site_key, from_external_id)
      site_key,
      from_external_id,
      to_external_id
    FROM matches
    WHERE score > 0
    ORDER BY site_key, from_external_id, score DESC, eid_seen_at DESC
    LIMIT $2
    `,
    [siteKeyFilter, maxPairs]
  );

  const pairs = pairsRes.rows;
  console.log(
    JSON.stringify(
      {
        dry_run: dryRun,
        site_key_filter: siteKeyFilter || null,
        max_pairs: maxPairs,
        pairs_found: pairs.length,
        sample: pairs.slice(0, 10),
      },
      null,
      2
    )
  );

  if (pairs.length === 0) {
    await pool.end();
    return;
  }

  if (dryRun) {
    await pool.end();
    return;
  }

  // 2) Executa em transação para cada par (seguro; evita lock gigante).
  let merged = 0;
  for (const p of pairs) {
    await pool.query('BEGIN');
    try {
      const from = await pool.query<VisitorRow>(
        `SELECT * FROM site_visitors WHERE site_key = $1 AND external_id = $2 LIMIT 1`,
        [p.site_key, p.from_external_id]
      );
      const to = await pool.query<VisitorRow>(
        `SELECT * FROM site_visitors WHERE site_key = $1 AND external_id = $2 LIMIT 1`,
        [p.site_key, p.to_external_id]
      );

      const fromRow = from.rows[0];
      const toRow = to.rows[0];
      if (!fromRow || !toRow) {
        await pool.query('ROLLBACK');
        continue;
      }

      // Atualiza referências em web_events e purchases
      await pool.query(
        `
        UPDATE web_events
        SET user_data = jsonb_set(COALESCE(user_data, '{}'::jsonb), '{external_id}', to_jsonb($3::text), true)
        WHERE site_key = $1 AND (user_data->>'external_id') = $2
        `,
        [p.site_key, p.from_external_id, p.to_external_id]
      );

      await pool.query(
        `UPDATE purchases SET external_id = $3 WHERE site_key = $1 AND external_id::text = $2`,
        [p.site_key, p.from_external_id, p.to_external_id]
      );

      // Merge de campos do visitor (to = eid_)
      const toHist = mergeTagHistory(jsonArrayOfStrings(toRow.group_tags_history), []);
      const fromHist = mergeTagHistory(jsonArrayOfStrings(fromRow.group_tags_history), []);
      const mergedHist = mergeTagHistory(toHist, fromHist);

      const chooseLastGroup = () => {
        const a = toRow.last_group_tag_at;
        const b = fromRow.last_group_tag_at;
        if (!a && !b) return { tag: toRow.last_group_tag || fromRow.last_group_tag || null, at: null };
        const pickFrom = !a ? true : !b ? false : Date.parse(b) > Date.parse(a);
        if (pickFrom) return { tag: fromRow.last_group_tag || toRow.last_group_tag || null, at: b };
        return { tag: toRow.last_group_tag || fromRow.last_group_tag || null, at: a };
      };
      const lastGroup = chooseLastGroup();

      await pool.query(
        `
        UPDATE site_visitors
        SET
          fbc = COALESCE(NULLIF(BTRIM(site_visitors.fbc), ''), $3),
          fbp = COALESCE(NULLIF(BTRIM(site_visitors.fbp), ''), $4),
          email_hash = COALESCE(site_visitors.email_hash, $5),
          phone_hash = COALESCE(site_visitors.phone_hash, $6),
          first_name_hash = COALESCE(site_visitors.first_name_hash, $7),
          last_name_hash = COALESCE(site_visitors.last_name_hash, $8),
          last_traffic_source = COALESCE(NULLIF(BTRIM(site_visitors.last_traffic_source), ''), $9),
          first_traffic_source = COALESCE(NULLIF(BTRIM(site_visitors.first_traffic_source), ''), $10),
          total_events = COALESCE(site_visitors.total_events, 0) + COALESCE($11, 0),
          last_event_name = COALESCE(NULLIF(BTRIM(site_visitors.last_event_name), ''), $12),
          last_ip = COALESCE(NULLIF(BTRIM(site_visitors.last_ip), ''), $13),
          last_user_agent = COALESCE(NULLIF(BTRIM(site_visitors.last_user_agent), ''), $14),
          city = COALESCE(NULLIF(BTRIM(site_visitors.city), ''), $15),
          state = COALESCE(NULLIF(BTRIM(site_visitors.state), ''), $16),
          country = COALESCE(NULLIF(BTRIM(site_visitors.country), ''), $17),
          first_group_tag = COALESCE(NULLIF(BTRIM(site_visitors.first_group_tag), ''), $18),
          last_group_tag = COALESCE(NULLIF(BTRIM($19), ''), site_visitors.last_group_tag),
          last_group_tag_at = COALESCE($20::timestamp, site_visitors.last_group_tag_at),
          group_tags_history = $21::jsonb,
          last_seen_at = GREATEST(COALESCE(site_visitors.last_seen_at, NOW()), COALESCE($22::timestamp, NOW()))
        WHERE site_key = $1 AND external_id = $2
        `,
        [
          p.site_key,
          p.to_external_id,
          isNonEmpty(fromRow.fbc) ? fromRow.fbc : null,
          isNonEmpty(fromRow.fbp) ? fromRow.fbp : null,
          fromRow.email_hash,
          fromRow.phone_hash,
          fromRow.first_name_hash,
          fromRow.last_name_hash,
          fromRow.last_traffic_source,
          fromRow.first_traffic_source,
          fromRow.total_events || 0,
          fromRow.last_event_name,
          fromRow.last_ip,
          fromRow.last_user_agent,
          fromRow.city,
          fromRow.state,
          fromRow.country,
          fromRow.first_group_tag,
          lastGroup.tag,
          lastGroup.at,
          JSON.stringify(mergedHist),
          maxIso(toRow.last_seen_at, fromRow.last_seen_at),
        ]
      );

      // Por fim, remove o visitor duplicado (from)
      await pool.query(`DELETE FROM site_visitors WHERE site_key = $1 AND external_id = $2`, [
        p.site_key,
        p.from_external_id,
      ]);

      await pool.query('COMMIT');
      merged += 1;
    } catch (e) {
      await pool.query('ROLLBACK');
    }
  }

  console.log(JSON.stringify({ merged_pairs: merged }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

