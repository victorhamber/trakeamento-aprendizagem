import { pool } from './src/db/pool';
import { createHash } from 'crypto';

async function run() {
    try {
        const siteKey = 'test_key_temp';
        const eventId = 'test_event_' + Date.now();
        const email = 'test@example.com';
        const hashedEmail = createHash('sha256').update(email).digest('hex');

        const userData = { em: hashedEmail, fn: 'test' };

        await pool.query(
            `INSERT INTO web_events (site_key, event_id, event_name, event_time, user_data)
      VALUES ($1, $2, $3, $4, $5)`,
            [siteKey, eventId, 'PageView', new Date(), userData]
        );

        const res = await pool.query(
            `SELECT user_data FROM web_events WHERE event_id = $1`,
            [eventId]
        );

        console.log('Inserted and fetched user_data:');
        console.log(JSON.stringify(res.rows[0], null, 2));

        await pool.query(`DELETE FROM web_events WHERE event_id = $1`, [eventId]);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
