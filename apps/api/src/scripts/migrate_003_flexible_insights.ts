import { pool } from '../db/pool';

const runMigration = async () => {
  try {
    // 1. Remove NOT NULL from ad_id to support Campaign/AdSet level insights
    await pool.query(`ALTER TABLE meta_insights_daily ALTER COLUMN ad_id DROP NOT NULL;`);
    
    // 2. Drop the old strict unique constraint
    await pool.query(`ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS unique_meta_insights_daily;`);
    await pool.query(`ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS meta_insights_daily_site_id_ad_id_date_start_key;`);
    
    // 3. Create a new partial unique index for Ad level (where ad_id is present)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_ad 
      ON meta_insights_daily (site_id, ad_id, date_start) 
      WHERE ad_id IS NOT NULL;
    `);

    // 4. Create a new partial unique index for AdSet level (where adset_id is present but ad_id is null)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_adset 
      ON meta_insights_daily (site_id, adset_id, date_start) 
      WHERE adset_id IS NOT NULL AND ad_id IS NULL;
    `);

    // 5. Create a new partial unique index for Campaign level (where campaign_id is present but adset_id is null)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_campaign 
      ON meta_insights_daily (site_id, campaign_id, date_start) 
      WHERE campaign_id IS NOT NULL AND adset_id IS NULL;
    `);

    console.log('Migration 003_flexible_insights run successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

runMigration();
