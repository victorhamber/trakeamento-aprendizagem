/**
 * Database Monitor — diagnostic script for production performance analysis.
 *
 * Usage:
 *   npx ts-node src/scripts/db_monitor.ts
 *
 * Requires pg_stat_statements to be enabled on the PostgreSQL server.
 * On managed providers (Supabase, RDS, etc.) this is usually already active.
 * To enable manually: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
 */

import { pool } from '../db/pool';

async function printSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function checkTableSizes() {
  await printSection('TABLE SIZES');
  const result = await pool.query(`
    SELECT
      relname AS table_name,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      pg_size_pretty(pg_relation_size(relid)) AS table_size,
      pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
      n_live_tup AS live_rows,
      n_dead_tup AS dead_rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 15
  `);
  console.table(result.rows);
}

async function checkIndexUsage() {
  await printSection('INDEX USAGE (unused indexes waste write performance)');
  const result = await pool.query(`
    SELECT
      schemaname,
      tablename,
      indexname,
      idx_scan AS times_used,
      pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
    LIMIT 20
  `);
  console.table(result.rows);
}

async function checkMissingIndexes() {
  await printSection('SEQUENTIAL SCANS (tables with high seq scans may need indexes)');
  const result = await pool.query(`
    SELECT
      relname AS table_name,
      seq_scan,
      seq_tup_read,
      idx_scan,
      n_live_tup AS live_rows,
      CASE
        WHEN seq_scan > 0 AND idx_scan > 0
          THEN ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 1)
        WHEN idx_scan = 0 THEN 0
        ELSE 100
      END AS index_hit_pct
    FROM pg_stat_user_tables
    WHERE seq_scan > 10
    ORDER BY seq_tup_read DESC
    LIMIT 15
  `);
  console.table(result.rows);
}

async function checkSlowQueries() {
  await printSection('SLOWEST QUERIES (requires pg_stat_statements extension)');
  try {
    const result = await pool.query(`
      SELECT
        ROUND(mean_exec_time::numeric, 2) AS avg_ms,
        ROUND(total_exec_time::numeric, 0) AS total_ms,
        calls,
        ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
        rows,
        LEFT(query, 120) AS query_preview
      FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat%'
        AND query NOT LIKE 'SET %'
        AND query NOT LIKE 'SHOW %'
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `);
    console.table(result.rows);
  } catch {
    console.log('  pg_stat_statements not available. Enable it with:');
    console.log('  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
    console.log('  And add shared_preload_libraries = \'pg_stat_statements\' to postgresql.conf');
  }
}

async function checkBloat() {
  await printSection('TABLE BLOAT (dead rows — run VACUUM if high)');
  const result = await pool.query(`
    SELECT
      relname AS table_name,
      n_live_tup AS live_rows,
      n_dead_tup AS dead_rows,
      CASE
        WHEN n_live_tup + n_dead_tup > 0
          THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
        ELSE 0
      END AS dead_pct,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze
    FROM pg_stat_user_tables
    WHERE n_live_tup + n_dead_tup > 0
    ORDER BY dead_pct DESC
    LIMIT 10
  `);
  console.table(result.rows);
}

async function checkOutboxHealth() {
  await printSection('CAPI OUTBOX HEALTH');
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE attempts = 0) AS pending,
      COUNT(*) FILTER (WHERE attempts BETWEEN 1 AND 4) AS retrying,
      COUNT(*) FILTER (WHERE attempts >= 5) AS permanently_failed,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 hour') AS older_than_1h,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 day') AS older_than_1d,
      COUNT(*) AS total
    FROM capi_outbox
  `);
  console.table(result.rows);
}

async function checkRetentionStats() {
  await printSection('RETENTION STATS');
  const result = await pool.query(`
    SELECT
      'web_events' AS table_name,
      COUNT(*) AS total_rows,
      MIN(event_time) AS oldest_record,
      MAX(event_time) AS newest_record
    FROM web_events
    UNION ALL
    SELECT
      'purchases',
      COUNT(*),
      MIN(created_at),
      MAX(created_at)
    FROM purchases
    UNION ALL
    SELECT
      'capi_outbox',
      COUNT(*),
      MIN(created_at),
      MAX(created_at)
    FROM capi_outbox
    UNION ALL
    SELECT
      'recommendation_reports',
      COUNT(*),
      MIN(created_at),
      MAX(created_at)
    FROM recommendation_reports
  `);
  console.table(result.rows);
}

async function checkActiveIndexes() {
  await printSection('EXISTING INDEXES ON CRITICAL TABLES');
  const result = await pool.query(`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      array_to_string(array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)), ', ') AS columns,
      pg_size_pretty(pg_relation_size(i.oid)) AS size
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relname IN ('web_events', 'purchases', 'site_visitors', 'capi_outbox', 'recommendation_reports')
      AND t.relkind = 'r'
    GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary, i.oid
    ORDER BY t.relname, i.relname
  `);
  console.table(result.rows);
}

(async () => {
  try {
    console.log('\n🔍 Database Performance Monitor');
    console.log(`   Running at: ${new Date().toISOString()}`);

    await checkTableSizes();
    await checkRetentionStats();
    await checkOutboxHealth();
    await checkActiveIndexes();
    await checkIndexUsage();
    await checkMissingIndexes();
    await checkBloat();
    await checkSlowQueries();

    console.log('\n✅ Monitor complete.\n');
  } catch (err) {
    console.error('Monitor error:', err);
  } finally {
    await pool.end();
  }
})();
