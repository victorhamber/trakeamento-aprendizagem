const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

async function debug() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const res = await pool.query("SELECT * FROM purchases WHERE order_id = 'HP1036576768'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

debug();
