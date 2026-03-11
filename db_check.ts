import { pool } from './apps/api/src/db/pool';

async function main() {
  try {
    const res = await pool.query(`
      SELECT event_name, telemetry 
      FROM web_events 
      WHERE event_name IN ('PageView', 'PageEngagement') 
      ORDER BY id DESC 
      LIMIT 10
    `);
    console.dir(res.rows, { depth: null });
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
