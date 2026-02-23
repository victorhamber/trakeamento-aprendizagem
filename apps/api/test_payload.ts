import { pool } from './src/db/pool';

async function run() {
    const res = await pool.query("SELECT raw_payload FROM purchases WHERE platform = 'hotmart' ORDER BY created_at DESC LIMIT 1");
    console.log(JSON.stringify(res.rows[0], null, 2));
    process.exit(0);
}
run();
