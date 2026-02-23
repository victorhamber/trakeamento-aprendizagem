import { Client } from 'pg';

async function test() {
    const client = new Client({
        connectionString: 'postgres://postgres:trakeamentotrakeamento@easypanel.forexrendimento.com:5432/trakeamento2',
        ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    console.log('connected!');

    const res = await client.query(`
    SELECT user_data, raw_payload
    FROM web_events 
    ORDER BY event_time DESC 
    LIMIT 10
  `);

    console.log(JSON.stringify(res.rows, null, 2));
    await client.end();
}

test().catch(console.error);
