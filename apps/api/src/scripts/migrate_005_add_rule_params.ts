
import { pool } from '../db/pool';

const run = async () => {
  console.log('Migrating: Adding parameters to site_url_rules...');
  
  try {
    await pool.query(`
      ALTER TABLE site_url_rules 
      ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '{}'::jsonb
    `);
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

run();
