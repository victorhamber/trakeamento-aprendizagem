const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const findEnvFile = () => {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '..', '.env'),
    path.resolve(cwd, '..', '..', '.env'),
    path.resolve(cwd, '..', '..', '..', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const envPath = findEnvFile();
if (envPath) {
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('CRITICAL ERROR: DATABASE_URL not found!');
    process.exit(1);
}

// Se o host for o do docker, tenta trocar por localhost para rodar por fora do container
if (connectionString.includes('@meta-ads_tracking-db:')) {
    console.log('Detected Docker hostname, switching to localhost for host execution...');
    connectionString = connectionString.replace('@meta-ads_tracking-db:', '@localhost:');
}

const pool = new Pool({
  connectionString: connectionString,
});

async function optimizeDb() {
  console.log('--- Starting Database Optimization (JS version) ---');

  try {
    // 1. Limpeza da capi_outbox
    console.log('Cleaning up capi_outbox...');
    const delRes = await pool.query(`
      DELETE FROM capi_outbox
      WHERE attempts >= 5 OR created_at < NOW() - INTERVAL '7 days'
    `);
    console.log(`✅ Deleted ${delRes.rowCount || 0} stale events from capi_outbox.`);

    // 2. Criar índices
    console.log('Ensuring indexes exist...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_capi_outbox_queue 
      ON capi_outbox (next_attempt_at, attempts)
      WHERE attempts < 5;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_capi_outbox_site_key 
      ON capi_outbox (site_key);
    `);
    console.log('✅ Specific indexes for outbox checked/created.');

    // 3. VACUUM ANALYZE
    console.log('Running maintenance (VACUUM ANALYZE)...');
    const tables = ['capi_outbox', 'web_events', 'purchases', 'meta_insights_daily'];
    for (const table of tables) {
      console.log(`  - Processing ${table}...`);
      await pool.query(`VACUUM ANALYZE ${table};`);
    }
    
    console.log('🚀 Database Optimization completed successfully!');
  } catch (error) {
    console.error('❌ Error during database optimization:', error);
  } finally {
    await pool.end();
  }
}

optimizeDb();
