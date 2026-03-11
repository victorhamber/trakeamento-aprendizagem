const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgres://postgres:656a8d28f8c18bf88345@127.0.0.1:5432/meta-ads?sslmode=disable'
});

async function run() {
    try {
        const res = await pool.query(`
      SELECT event_name, telemetry 
      FROM web_events 
      WHERE telemetry IS NOT NULL 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
        console.log('Recent Web Events Telemetry:');
        res.rows.forEach(r => console.log(r.event_name, r.telemetry));
    } catch (err) {
        console.error('DB Error:', err.message);
    } finally {
        await pool.end();
    }
}

run();
