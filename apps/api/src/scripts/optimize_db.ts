import { pool } from '../db/pool';

async function optimizeDb() {
  console.log('Starting Database Optimization...\n');

  try {
    // 1. Cleanup stale data
    console.log('── Phase 1: Data retention cleanup ──');

    const cleanups = [
      { label: 'web_events (30d)', sql: `DELETE FROM web_events WHERE event_time < NOW() - INTERVAL '30 days'` },
      { label: 'capi_outbox (7d / failed)', sql: `DELETE FROM capi_outbox WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'` },
      { label: 'capi_dead_letter (30d)', sql: `DELETE FROM capi_outbox_dead_letter WHERE created_at < NOW() - INTERVAL '30 days'` },
      { label: 'mentor_chat (60d)', sql: `DELETE FROM mentor_chat_history WHERE created_at < NOW() - INTERVAL '60 days'` },
      { label: 'site_visitors (90d)', sql: `DELETE FROM site_visitors WHERE last_seen_at < NOW() - INTERVAL '90 days'` },
      { label: 'purchases (12m)', sql: `DELETE FROM purchases WHERE created_at < NOW() - INTERVAL '12 months'` },
      { label: 'meta_insights (90d)', sql: `DELETE FROM meta_insights_daily WHERE date_start < CURRENT_DATE - INTERVAL '90 days'` },
      { label: 'password_resets (expired)', sql: `DELETE FROM password_resets WHERE expires_at < NOW()` },
      { label: 'notifications (read 90d)', sql: `DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '90 days'` },
    ];

    for (const c of cleanups) {
      const r = await pool.query(c.sql);
      console.log(`  ${c.label}: ${r.rowCount} rows deleted`);
    }

    // 2. Strip heavy JSONB payloads (keep rows, free storage)
    console.log('\n── Phase 2: Strip stale JSONB payloads ──');

    const strips = [
      { label: 'purchases.raw_payload (7d)', sql: `UPDATE purchases SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND created_at < NOW() - INTERVAL '7 days'` },
      { label: 'meta_insights.raw_payload (30d)', sql: `UPDATE meta_insights_daily SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND date_start < CURRENT_DATE - INTERVAL '30 days'` },
      { label: 'custom_webhooks.last_payload (30d)', sql: `UPDATE custom_webhooks SET last_payload = NULL WHERE last_payload IS NOT NULL AND updated_at < NOW() - INTERVAL '30 days'` },
    ];

    for (const s of strips) {
      const r = await pool.query(s.sql);
      console.log(`  ${s.label}: ${r.rowCount} rows stripped`);
    }

    // 3. VACUUM ANALYZE key tables
    console.log('\n── Phase 3: VACUUM ANALYZE ──');

    const tables = [
      'web_events', 'capi_outbox', 'capi_outbox_dead_letter',
      'purchases', 'meta_insights_daily', 'site_visitors',
      'mentor_chat_history', 'notifications',
    ];

    for (const t of tables) {
      try {
        await pool.query(`VACUUM ANALYZE ${t}`);
        console.log(`  ${t}: OK`);
      } catch (err: any) {
        console.warn(`  ${t}: skipped (${err.message})`);
      }
    }

    // 4. Table size report
    console.log('\n── Phase 4: Table size report ──');

    const { rows } = await pool.query(`
      SELECT
        schemaname || '.' || relname AS table,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_size_pretty(pg_relation_size(relid)) AS data_size,
        n_live_tup AS live_rows,
        n_dead_tup AS dead_rows
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20
    `);

    console.log('  Table                              | Total     | Data      | Live Rows  | Dead Rows');
    console.log('  ' + '-'.repeat(95));
    for (const r of rows) {
      const tbl = (r.table as string).padEnd(35);
      const total = (r.total_size as string).padEnd(10);
      const data = (r.data_size as string).padEnd(10);
      const live = String(r.live_rows).padEnd(11);
      const dead = String(r.dead_rows);
      console.log(`  ${tbl}| ${total}| ${data}| ${live}| ${dead}`);
    }

    console.log('\nDatabase Optimization completed successfully!');
  } catch (error) {
    console.error('Error during database optimization:', error);
  } finally {
    await pool.end();
  }
}

optimizeDb();
