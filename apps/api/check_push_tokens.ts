import { pool } from './src/db/pool';

async function main() {
  try {
    console.log('Querying push_tokens...');
    const result = await pool.query('SELECT * FROM push_tokens LIMIT 10;');
    console.log(`Found ${result.rowCount} tokens:\n`, result.rows);
  } catch (err) {
    console.error('Error fetching push tokens:', err);
  } finally {
    await pool.end();
  }
}

main();
