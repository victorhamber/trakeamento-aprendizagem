import 'dotenv/config';
import { pool } from './src/db/pool';

(async () => {
    try {
        const res = await pool.query('SELECT event_name, event_time, raw_payload FROM web_events ORDER BY created_at DESC LIMIT 5');
        console.log('--- RECENT WEB EVENTS ---');
        console.log(JSON.stringify(res.rows, null, 2));

        const errs = await pool.query('SELECT * FROM capi_outbox ORDER BY created_at DESC LIMIT 5');
        console.log('--- CAPI OUTBOX ---');
        console.log(JSON.stringify(errs.rows, null, 2));

        const meta = await pool.query('SELECT site_id, last_capi_status, last_capi_error, last_capi_response FROM integrations_meta LIMIT 5');
        console.log('--- META CONFIGS ---');
        console.log(JSON.stringify(meta.rows, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
