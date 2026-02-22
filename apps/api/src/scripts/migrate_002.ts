import { pool } from '../db/pool';

const runMigration = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_insights_daily (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        ad_id VARCHAR(50) NOT NULL,
        ad_name VARCHAR(255),
        adset_id VARCHAR(50),
        adset_name VARCHAR(255),
        campaign_id VARCHAR(50),
        campaign_name VARCHAR(255),
        spend NUMERIC,
        impressions INTEGER,
        clicks INTEGER,
        cpc NUMERIC,
        ctr NUMERIC,
        date_start DATE NOT NULL,
        date_stop DATE,
        raw_payload JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(site_id, ad_id, date_start)
      );
    `);
    console.log('Migration 002_insights run successfully');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

runMigration();
