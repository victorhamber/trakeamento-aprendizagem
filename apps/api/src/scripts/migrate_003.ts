import { pool } from '../db/pool';

const runMigration = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_reports (
        id SERIAL PRIMARY KEY,
        site_key VARCHAR(50) NOT NULL,
        analysis_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Migration 003_reports run successfully');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

runMigration();
