const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

async function debug() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const res = await pool.query("SELECT order_id, status, amount, currency, created_at, platform_date FROM purchases WHERE order_id = 'HP1036576768'");
    console.log('--- RECORD DEBUG ---');
    console.log(JSON.stringify(res.rows[0], null, 2));
    
    // Test the problematic shift logic
    const testShift = await pool.query(`
      SELECT 
        created_at as raw,
        (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') as shifted,
        EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')) as shifted_hour,
        EXTRACT(HOUR FROM created_at) as raw_hour
      FROM purchases WHERE order_id = 'HP1036576768'
    `);
    console.log('--- TIMEZONE SHIFT TEST ---');
    console.log(JSON.stringify(testShift.rows[0], null, 2));
    
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

debug();
