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
    tracking_domain VARCHAR(255),
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
    capi_test_event_code VARCHAR(100),
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
    unique_link_clicks INTEGER,
    inline_link_clicks INTEGER,
    outbound_clicks INTEGER,
    video_3s_views INTEGER,
    landing_page_views INTEGER,
    reach INTEGER,
    frequency NUMERIC,
    cpc NUMERIC,
    ctr NUMERIC,
    unique_ctr NUMERIC,
    cpm NUMERIC,
    leads INTEGER,
    contacts INTEGER,
    purchases INTEGER,
    adds_to_cart INTEGER,
    initiates_checkout INTEGER,
    cost_per_lead NUMERIC,
    cost_per_purchase NUMERIC,
    objective VARCHAR(100),
    results INTEGER,
    result_rate NUMERIC,
    custom_event_name VARCHAR(120),
    custom_event_count INTEGER,
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

  CREATE TABLE IF NOT EXISTS capi_outbox (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS site_identify_mappings (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
    mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS saved_utm_links (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    url_base TEXT,
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    click_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS site_url_rules (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    rule_type VARCHAR(50) NOT NULL,
    match_value TEXT NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL DEFAULT 'custom',
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS checkout_simulators (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
    checkout_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS site_forms (
    id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS custom_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    site_key VARCHAR(100),
    name VARCHAR(150) NOT NULL,
    secret_key VARCHAR(100) NOT NULL UNIQUE,
    last_payload JSONB,
    mapping_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id);
  CREATE INDEX IF NOT EXISTS idx_web_events_time ON web_events(event_time);
  CREATE INDEX IF NOT EXISTS idx_web_events_name ON web_events(event_name);
  CREATE INDEX IF NOT EXISTS idx_purchases_site_time ON purchases(site_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id);
`;

export const ensureSchema = async (pool: Pool) => {
  await pool.query(schemaSql);

  try {
    await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS tracking_domain VARCHAR(255)');
    await pool.query('ALTER TABLE custom_webhooks ADD COLUMN IF NOT EXISTS site_key VARCHAR(100)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS capi_test_event_code VARCHAR(100)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_status VARCHAR(20)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_error TEXT');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS objective VARCHAR(100)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS results INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS result_rate NUMERIC');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_response JSONB');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_attempt_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_name VARCHAR(120)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_id VARCHAR(120)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_source_url TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_id VARCHAR(50)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_token_enc TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_token_expires_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_ga ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS openai_model VARCHAR(50)');

    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS unique_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS link_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS unique_link_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS inline_link_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS outbound_clicks INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS video_3s_views INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS landing_page_views INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS reach INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS frequency NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS unique_ctr NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cpm NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS leads INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS contacts INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS purchases INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS adds_to_cart INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS initiates_checkout INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cost_per_lead NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS cost_per_purchase NUMERIC');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS custom_event_name VARCHAR(120)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS custom_event_count INTEGER');

    // Add missing FK constraints for orphaned data prevention
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_web_events_site_key') THEN
            ALTER TABLE web_events ADD CONSTRAINT fk_web_events_site_key FOREIGN KEY (site_key) REFERENCES sites(site_key) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchases_site_key') THEN
            ALTER TABLE purchases ADD CONSTRAINT fk_purchases_site_key FOREIGN KEY (site_key) REFERENCES sites(site_key) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_capi_outbox_site_key') THEN
            ALTER TABLE capi_outbox ADD CONSTRAINT fk_capi_outbox_site_key FOREIGN KEY (site_key) REFERENCES sites(site_key) ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    } catch (fkErr) {
      console.warn('Foreign key constraints update skipped:', fkErr);
    }

    // Create custom webhooks table dynamically if it doesn't exist (for existing users)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_webhooks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        secret_key VARCHAR(100) NOT NULL UNIQUE,
        last_payload JSONB,
        mapping_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migração para flexibilizar a constraint UNIQUE de meta_insights_daily
    try {
      // 1. Remover NOT NULL da coluna ad_id
      await pool.query('ALTER TABLE meta_insights_daily ALTER COLUMN ad_id DROP NOT NULL');

      // 2. Remover constraints antigas se existirem
      await pool.query('ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS unique_meta_insights_daily');
      await pool.query('ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS meta_insights_daily_site_id_ad_id_date_start_key');

      // 3. Criar índices parciais únicos para cada nível (Ad, AdSet, Campaign)
      // Nível Anúncio
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_ad 
        ON meta_insights_daily (site_id, ad_id, date_start) 
        WHERE ad_id IS NOT NULL
      `);

      // Nível Conjunto de Anúncios (ad_id NULL, adset_id NOT NULL)
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_adset 
        ON meta_insights_daily (site_id, adset_id, date_start) 
        WHERE adset_id IS NOT NULL AND ad_id IS NULL
      `);

      // Nível Campanha (adset_id NULL, campaign_id NOT NULL)
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_campaign 
        ON meta_insights_daily (site_id, campaign_id, date_start) 
        WHERE campaign_id IS NOT NULL AND adset_id IS NULL
      `);
    } catch (migErr) {
      console.warn('Migration for flexible meta insights skipped/failed:', migErr);
    }
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
