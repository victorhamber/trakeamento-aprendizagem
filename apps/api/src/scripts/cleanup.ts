import { pool } from '../db/pool';

async function cleanup() {
  console.log('--- Starting Data Retention Cleanup ---');

  try {
    const res = await pool.query(`
      DELETE FROM web_events
      WHERE event_time < NOW() - INTERVAL '30 days'
    `);

    console.log(`Cleanup complete. Deleted ${res.rowCount} old events from web_events.`);
  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    process.exit(0);
  }
}

cleanup();
