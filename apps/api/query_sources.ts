import { pool } from './src/db/pool';

async function run() {
    try {
        const res = await pool.query(`
      SELECT event_name, event_time, event_id, 
             user_data->>'client_ip_address' as ip, 
             custom_data->>'page_path' as path
      FROM web_events 
      ORDER BY created_at DESC 
      LIMIT 20
    `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
