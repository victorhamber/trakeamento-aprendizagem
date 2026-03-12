import { pool } from '../db/pool';

async function optimizeDb() {
  console.log('Starting Database Optimization...');

  try {
    // 1. Limpeza da capi_outbox
    // Delete events that failed 5 or more times, or older than 7 days
    console.log('Cleaning up capi_outbox...');
    const delRes = await pool.query(`
      DELETE FROM capi_outbox
      WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'
    `);
    console.log(`Deleted ${delRes.rowCount} stale events from capi_outbox.`);

    // 2. Criar índices faltantes e importantes
    console.log('Adding indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_capi_outbox_queue 
      ON capi_outbox (next_attempt_at, attempts)
      WHERE attempts < 5;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_capi_outbox_site_key 
      ON capi_outbox (site_key);
    `);
    
    console.log('Added missing indexes for capi_outbox.');

    // 3. VACUUM ANALYZE
    console.log('Running VACUUM ANALYZE on key tables...');
    await pool.query('VACUUM ANALYZE capi_outbox;');
    await pool.query('VACUUM ANALYZE web_events;');
    await pool.query('VACUUM ANALYZE purchases;');
    await pool.query('VACUUM ANALYZE meta_insights_daily;');
    
    console.log('Database Optimization completed successfully!');
  } catch (error) {
    console.error('Error during database optimization:', error);
  } finally {
    await pool.end();
  }
}

optimizeDb();
