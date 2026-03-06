import { pool } from './db/pool';

async function expandLimits() {
    console.log('--- Altering Table Columns Limits ---');
    try {
        const res = await pool.query(`
      ALTER TABLE site_visitors 
      ALTER COLUMN external_id TYPE VARCHAR(255),
      ALTER COLUMN fbc TYPE VARCHAR(255),
      ALTER COLUMN fbp TYPE VARCHAR(255);
    `);
        console.log(`✅ Limits expanded successfully.`);
    } catch (err) {
        console.error('❌ Error expanding limits:', err);
    } finally {
        process.exit(0);
    }
}

expandLimits();
