require('dotenv').config({ path: '../../.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

(async () => {
    try {
        const evts = await pool.query("SELECT event_name, event_time, raw_payload->>'user_data' AS udata, created_at FROM web_events ORDER BY created_at DESC LIMIT 5");
        console.log("== LATEST WEB EVENTS ==");
        console.log(JSON.stringify(evts.rows, null, 2));

        const errs = await pool.query("SELECT event_name, response_status, response_body, created_at FROM capi_outbox ORDER BY created_at DESC LIMIT 5");
        console.log("== LATEST CAPI OUTBOX ==");
        console.log(JSON.stringify(errs.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
})();
