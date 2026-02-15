import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const schemaSql = `
  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS account_settings (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    openai_api_key_enc TEXT,
    openai_model VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    domain VARCHAR(255),
    site_key VARCHAR(80) NOT NULL UNIQUE,
    webhook_secret_enc TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS integrations_meta (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT TRUE,
    pixel_id VARCHAR(50),
    capi_token_enc TEXT,
    marketing_token_enc TEXT,
    ad_account_id VARCHAR(50),
    fb_user_id VARCHAR(50),
    fb_user_token_enc TEXT,
    fb_token_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS integrations_ga (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT TRUE,
    measurement_id VARCHAR(50),
    api_secret_enc TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS web_events (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(50) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    event_name VARCHAR(50) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    event_source_url TEXT,
    user_data JSONB,
    custom_data JSONB,
    telemetry JSONB,
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_key, event_id)
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(50) NOT NULL,
    order_id VARCHAR(100) NOT NULL,
    platform VARCHAR(50),
    amount NUMERIC,
    currency VARCHAR(3),
    status VARCHAR(20),
    buyer_email_hash VARCHAR(64),
    fbp VARCHAR(100),
    fbc VARCHAR(100),
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_key, order_id)
  );

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
    unique_clicks INTEGER,
    link_clicks INTEGER,
    inline_link_clicks INTEGER,
    outbound_clicks INTEGER,
    landing_page_views INTEGER,
    reach INTEGER,
    frequency NUMERIC,
    cpc NUMERIC,
    ctr NUMERIC,
    unique_ctr NUMERIC,
    cpm NUMERIC,
    leads INTEGER,
    purchases INTEGER,
    adds_to_cart INTEGER,
    initiates_checkout INTEGER,
    cost_per_lead NUMERIC,
    cost_per_purchase NUMERIC,
    date_start DATE NOT NULL,
    date_stop DATE,
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_id, ad_id, date_start)
  );

  CREATE TABLE IF NOT EXISTS recommendation_reports (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(50) NOT NULL,
    analysis_text TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS site_identify_mappings (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
    mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id);
  CREATE INDEX IF NOT EXISTS idx_web_events_time ON web_events(event_time);
  CREATE INDEX IF NOT EXISTS idx_web_events_name ON web_events(event_name);
  CREATE INDEX IF NOT EXISTS idx_purchases_site_time ON purchases(site_key, created_at);
`;

export const ensureSchema = async (pool: Pool) => {
  await pool.query(schemaSql);

  try {
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_id VARCHAR(50)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_token_enc TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_token_expires_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_ga ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS openai_model VARCHAR(50)');

    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS unique_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS link_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS inline_link_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS outbound_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS landing_page_views INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS reach INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS frequency NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS unique_ctr NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cpm NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS leads INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS purchases INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS adds_to_cart INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS initiates_checkout INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cost_per_lead NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cost_per_purchase NUMERIC');
  } catch (err) {
    console.warn('Schema extension skipped:', err);
  }

  if (!process.env.DATABASE_URL) {
    const existing = await pool.query('SELECT id FROM users LIMIT 1');
    if (!(existing.rowCount || 0)) {
      const account = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', ['Demo SaaS']);
      const accountId = account.rows[0].id as number;
      const hash = await bcrypt.hash('12345678', 12);
      await pool.query('INSERT INTO users (account_id, email, password_hash) VALUES ($1, $2, $3)', [
        accountId,
        'demo@example.com',
        hash,
      ]);
    }
  }
};
