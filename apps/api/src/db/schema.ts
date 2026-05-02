import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const schemaSql = `
  CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) DEFAULT 'SUBSCRIPTION',
    price NUMERIC NOT NULL,
    billing_cycle VARCHAR(20) DEFAULT 'MONTHLY',
    max_sites INTEGER DEFAULT 1,
    max_events INTEGER DEFAULT 10000,
    offer_codes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    active_plan_id INTEGER REFERENCES plans(id),
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    bonus_site_limit INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_super_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    provider_subscription_id VARCHAR(100),
    current_period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    token VARCHAR(100) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
  CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);

  CREATE TABLE IF NOT EXISTS global_notifications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    image_link TEXT,
    action_text VARCHAR(100),
    action_url TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS global_notification_reads (
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    global_notification_id INTEGER REFERENCES global_notifications(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (account_id, global_notification_id)
  );

  CREATE TABLE IF NOT EXISTS account_settings (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    openai_api_key_enc TEXT,
    openai_model VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS email_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    provider VARCHAR(50) NOT NULL DEFAULT 'RESEND',
    api_key TEXT,
    from_email VARCHAR(190),
    from_name VARCHAR(190),
    welcome_subject VARCHAR(190),
    welcome_html TEXT,
    reset_subject VARCHAR(190),
    reset_html TEXT,
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

  CREATE TABLE IF NOT EXISTS site_injected_snippets (
    id SERIAL PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(140) NOT NULL,
    position VARCHAR(10) NOT NULL, -- head | body
    html TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_site_injected_snippets_site ON site_injected_snippets(site_id, sort_order, id);

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
    site_key VARCHAR(100) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    event_name VARCHAR(50) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    event_source_url TEXT,
    user_data JSONB,
    custom_data JSONB,
    telemetry JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_key, event_id)
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NOT NULL,
    platform VARCHAR(50),
    amount NUMERIC,
    currency VARCHAR(3),
    status VARCHAR(20),
    buyer_email_hash VARCHAR(64),
    fbp TEXT,
    fbc TEXT,
    raw_payload JSONB,
    platform_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
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
    optimization_goal VARCHAR(120),
    optimized_event_name VARCHAR(120),
    quality_ranking VARCHAR(60),
    engagement_rate_ranking VARCHAR(60),
    conversion_rate_ranking VARCHAR(60),
    date_start DATE NOT NULL,
    date_stop DATE,
    raw_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_id, ad_id, date_start)
  );

  CREATE TABLE IF NOT EXISTS recommendation_reports (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(100) NOT NULL,
    analysis_text TEXT,
    campaign_id VARCHAR(50),
    date_preset VARCHAR(50),
    _ck_campaign VARCHAR(50) NOT NULL DEFAULT '',
    _ck_preset VARCHAR(50) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_key, _ck_campaign, _ck_preset)
  );

  CREATE TABLE IF NOT EXISTS capi_outbox (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS capi_outbox_dead_letter (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    original_created_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_capi_dead_letter_site ON capi_outbox_dead_letter(site_key);
  CREATE INDEX IF NOT EXISTS idx_capi_dead_letter_created ON capi_outbox_dead_letter(created_at);

  CREATE TABLE IF NOT EXISTS mentor_chat_history (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    site_key VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_mentor_chat_account_site ON mentor_chat_history(account_id, site_key, created_at DESC);

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
    match_text TEXT,
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

  CREATE TABLE IF NOT EXISTS push_tokens (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    push_token VARCHAR(512) NOT NULL,
    platform VARCHAR(20) DEFAULT 'expo',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_id, push_token)
  );
  CREATE INDEX IF NOT EXISTS idx_push_tokens_account ON push_tokens(account_id);

  CREATE TABLE IF NOT EXISTS site_visitors (
    id SERIAL PRIMARY KEY,
    site_key VARCHAR(100) NOT NULL REFERENCES sites(site_key) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    fbc TEXT,
    fbp TEXT,
    email_hash VARCHAR(64),
    phone_hash VARCHAR(64),
    first_name_hash VARCHAR(64),
    last_name_hash VARCHAR(64),
    last_traffic_source TEXT,
    first_traffic_source TEXT,
    total_events INTEGER DEFAULT 1,
    last_event_name VARCHAR(100),
  last_ip VARCHAR(45),
  last_user_agent TEXT,
  city VARCHAR(255),
  state VARCHAR(255),
  country VARCHAR(255),
  first_group_tag TEXT,
  last_group_tag TEXT,
  last_group_tag_at TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_key, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id);
  CREATE INDEX IF NOT EXISTS idx_web_events_time ON web_events(event_time);
  CREATE INDEX IF NOT EXISTS idx_web_events_name ON web_events(event_name);
  CREATE INDEX IF NOT EXISTS idx_purchases_site_time ON purchases(site_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id);
  CREATE INDEX IF NOT EXISTS idx_site_visitors_last_seen ON site_visitors(site_key, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_capi_outbox_queue ON capi_outbox (next_attempt_at, attempts) WHERE attempts < 5;
  CREATE INDEX IF NOT EXISTS idx_capi_outbox_site_key ON capi_outbox(site_key);

  -- Composite indexes for dashboard/stats period queries (site_key + time range scanning)
  CREATE INDEX IF NOT EXISTS idx_web_events_site_key_time ON web_events(site_key, event_time);
  CREATE INDEX IF NOT EXISTS idx_web_events_site_key_name_time ON web_events(site_key, event_name, event_time);

  -- Composite index for purchase queries filtered by status and time
  CREATE INDEX IF NOT EXISTS idx_purchases_site_status_time ON purchases(site_key, status, created_at);

  -- Partial indexes for visitor attribution lookups (LATERAL JOINs in best-times)
  CREATE INDEX IF NOT EXISTS idx_site_visitors_email ON site_visitors(site_key, email_hash) WHERE email_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_site_visitors_fbp ON site_visitors(site_key, fbp) WHERE fbp IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_site_visitors_fbc ON site_visitors(site_key, fbc) WHERE fbc IS NOT NULL;

  -- Index for recommendation_reports lookups by site and creation date
  CREATE INDEX IF NOT EXISTS idx_recommendation_reports_site_time ON recommendation_reports(site_key, created_at);
`;

export const ensureSchema = async (pool: Pool) => {
  await pool.query(schemaSql);

  // ── Migration tracking: skip already-applied ALTER/CREATE migrations ────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      key VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const { rows: appliedRows } = await pool.query('SELECT key FROM _schema_migrations');
  const applied = new Set(appliedRows.map((r: { key: string }) => r.key));

  /** Run a migration only once; idempotent via _schema_migrations table. */
  async function migrate(key: string, fn: () => Promise<void>) {
    if (applied.has(key)) return;
    try {
      await fn();
      await pool.query('INSERT INTO _schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    } catch (err) {
      console.warn(`Migration '${key}' skipped:`, err);
    }
  }

  // ── One-time migrations (each key runs exactly once) ─────────────────
  await migrate('password_resets_table', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email VARCHAR(190) NOT NULL, token VARCHAR(100) NOT NULL UNIQUE, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email)');
  });

  await migrate('sites_extra_cols', async () => {
    await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS tracking_domain VARCHAR(255)');
    await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS inject_head_html TEXT');
    await pool.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS inject_body_html TEXT');
  });

  await migrate('site_injected_snippets_table', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_injected_snippets (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        name VARCHAR(140) NOT NULL,
        position VARCHAR(10) NOT NULL,
        html TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_site_injected_snippets_site ON site_injected_snippets(site_id, sort_order, id)');
  });

  await migrate('custom_webhooks_site_key', async () => {
    await pool.query('ALTER TABLE custom_webhooks ADD COLUMN IF NOT EXISTS site_key VARCHAR(100)');
  });

  await migrate('integrations_meta_extra', async () => {
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS capi_test_event_code VARCHAR(100)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_status VARCHAR(20)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_error TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_response JSONB');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_capi_attempt_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_at TIMESTAMP');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_name VARCHAR(120)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_id VARCHAR(120)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS last_ingest_event_source_url TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_id VARCHAR(50)');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_user_token_enc TEXT');
    await pool.query('ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS fb_token_expires_at TIMESTAMP');
  });

  await migrate('integrations_ga_enabled', async () => {
    await pool.query('ALTER TABLE integrations_ga ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE');
  });

  await migrate('account_settings_model', async () => {
    await pool.query('ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS openai_model VARCHAR(50)');
  });

  await migrate('site_url_rules_extra', async () => {
    await pool.query('ALTER TABLE site_url_rules ADD COLUMN IF NOT EXISTS match_text TEXT');
    await pool.query('ALTER TABLE site_url_rules ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT \'{}\'::jsonb');
  });

  await migrate('meta_insights_extra_cols', async () => {
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS objective VARCHAR(100)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS results INTEGER');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS result_rate NUMERIC');
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
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS optimization_goal VARCHAR(120)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS optimized_event_name VARCHAR(120)');
  });

  await migrate('meta_insights_rankings', async () => {
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS quality_ranking VARCHAR(60)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS engagement_rate_ranking VARCHAR(60)');
    await pool.query('ALTER TABLE meta_insights_daily ADD COLUMN IF NOT EXISTS conversion_rate_ranking VARCHAR(60)');
  });

  await migrate('recommendation_reports_upsert', async () => {
    await pool.query('ALTER TABLE recommendation_reports ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(50)');
    await pool.query('ALTER TABLE recommendation_reports ADD COLUMN IF NOT EXISTS date_preset VARCHAR(50)');
    await pool.query('ALTER TABLE recommendation_reports ADD COLUMN IF NOT EXISTS _ck_campaign VARCHAR(50) NOT NULL DEFAULT \'\'');
    await pool.query('ALTER TABLE recommendation_reports ADD COLUMN IF NOT EXISTS _ck_preset VARCHAR(50) NOT NULL DEFAULT \'\'');
    await pool.query(`
      UPDATE recommendation_reports
      SET _ck_campaign = COALESCE(campaign_id, ''), _ck_preset = COALESCE(date_preset, '')
      WHERE _ck_campaign IS DISTINCT FROM COALESCE(campaign_id, '') OR _ck_preset IS DISTINCT FROM COALESCE(date_preset, '')
    `);
    await pool.query(`
      DELETE FROM recommendation_reports a
      USING recommendation_reports b
      WHERE a.site_key = b.site_key AND a._ck_campaign = b._ck_campaign AND a._ck_preset = b._ck_preset AND a.id < b.id
    `);
    await pool.query('ALTER TABLE recommendation_reports DROP CONSTRAINT IF EXISTS recommendation_reports_site_key_ck_campaign_ck_preset_key');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_reports_unique_context ON recommendation_reports (site_key, _ck_campaign, _ck_preset)');
  });

  await migrate('web_events_drop_raw_payload', async () => {
    await pool.query('ALTER TABLE web_events DROP COLUMN IF EXISTS raw_payload');
  });

  await migrate('fbp_fbc_text_type', async () => {
    await pool.query('ALTER TABLE site_visitors ALTER COLUMN fbp TYPE TEXT');
    await pool.query('ALTER TABLE site_visitors ALTER COLUMN fbc TYPE TEXT');
    await pool.query('ALTER TABLE purchases ALTER COLUMN fbp TYPE TEXT');
    await pool.query('ALTER TABLE purchases ALTER COLUMN fbc TYPE TEXT');
  });

  await migrate('site_visitors_group_tag_cols', async () => {
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS first_group_tag TEXT');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS last_group_tag TEXT');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS last_group_tag_at TIMESTAMP');
  });

  await migrate('site_visitors_group_tags_history', async () => {
    await pool.query(`ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS group_tags_history JSONB DEFAULT '[]'::jsonb`);
    await pool.query(`
      UPDATE site_visitors
      SET group_tags_history = CASE
        WHEN first_group_tag IS NOT NULL AND BTRIM(first_group_tag) <> ''
             AND last_group_tag IS NOT NULL AND BTRIM(last_group_tag) <> ''
             AND BTRIM(first_group_tag) IS DISTINCT FROM BTRIM(last_group_tag)
          THEN jsonb_build_array(BTRIM(first_group_tag), BTRIM(last_group_tag))
        WHEN last_group_tag IS NOT NULL AND BTRIM(last_group_tag) <> ''
          THEN jsonb_build_array(BTRIM(last_group_tag))
        ELSE '[]'::jsonb
      END
      WHERE COALESCE(jsonb_array_length(group_tags_history), 0) = 0
        AND (
          (last_group_tag IS NOT NULL AND BTRIM(last_group_tag) <> '')
          OR (first_group_tag IS NOT NULL AND BTRIM(first_group_tag) <> '')
        )
    `);
  });

  await migrate('fk_cascade_events', async () => {
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
  });

  await migrate('custom_webhooks_table_v2', async () => {
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
  });

  await migrate('meta_insights_flexible_unique', async () => {
    await pool.query('ALTER TABLE meta_insights_daily ALTER COLUMN ad_id DROP NOT NULL');
    await pool.query('ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS unique_meta_insights_daily');
    await pool.query('ALTER TABLE meta_insights_daily DROP CONSTRAINT IF EXISTS meta_insights_daily_site_id_ad_id_date_start_key');
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_ad ON meta_insights_daily (site_id, ad_id, date_start) WHERE ad_id IS NOT NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_adset ON meta_insights_daily (site_id, adset_id, date_start) WHERE adset_id IS NOT NULL AND ad_id IS NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_insights_daily_campaign ON meta_insights_daily (site_id, campaign_id, date_start) WHERE campaign_id IS NOT NULL AND adset_id IS NULL`);
  });

  await migrate('v2_features', async () => {
    await pool.query('ALTER TABLE plans ADD COLUMN IF NOT EXISTS offer_codes TEXT');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS active_plan_id INTEGER REFERENCES plans(id)');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bonus_site_limit INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE global_notifications ADD COLUMN IF NOT EXISTS image_url TEXT');
    await pool.query('ALTER TABLE global_notifications ADD COLUMN IF NOT EXISTS image_link TEXT');
    await pool.query('ALTER TABLE global_notifications ADD COLUMN IF NOT EXISTS action_text VARCHAR(100)');
    await pool.query('ALTER TABLE global_notifications ADD COLUMN IF NOT EXISTS action_url TEXT');
  });

  await migrate('saas_accounts', async () => {
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS last_ip VARCHAR(45)');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS last_user_agent TEXT');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS active_plan_id INTEGER REFERENCES plans(id)');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP');
    await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bonus_site_limit INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false');
  });

  await migrate('performance_indexes', async () => {
    await pool.query('CREATE INDEX IF NOT EXISTS idx_web_events_site_key_time ON web_events(site_key, event_time)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_web_events_site_key_name_time ON web_events(site_key, event_name, event_time)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_purchases_site_status_time ON purchases(site_key, status, created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_site_visitors_email ON site_visitors(site_key, email_hash) WHERE email_hash IS NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_site_visitors_fbp ON site_visitors(site_key, fbp) WHERE fbp IS NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_site_visitors_fbc ON site_visitors(site_key, fbc) WHERE fbc IS NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_recommendation_reports_site_time ON recommendation_reports(site_key, created_at)');
  });

  await migrate('web_push_subscriptions_table', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(account_id, endpoint)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_web_push_account ON web_push_subscriptions(account_id)');
  });

  await migrate('site_key_lengths_and_purchase_cols', async () => {
    await pool.query('ALTER TABLE web_events ALTER COLUMN site_key TYPE VARCHAR(100)');
    await pool.query('ALTER TABLE purchases ALTER COLUMN site_key TYPE VARCHAR(100)');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS platform_date TIMESTAMP');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS city VARCHAR(255)');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS state VARCHAR(255)');
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS first_traffic_source TEXT');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255)');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(120)');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS customer_name TEXT');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS utm_source TEXT');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS utm_medium TEXT');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS utm_campaign TEXT');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS user_data JSONB');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS custom_data JSONB');
    await pool.query('ALTER TABLE purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP');
    await pool.query("UPDATE purchases SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL");
    await pool.query('ALTER TABLE purchases ALTER COLUMN updated_at SET DEFAULT NOW()').catch(() => {});
    await pool.query('ALTER TABLE recommendation_reports ALTER COLUMN site_key TYPE VARCHAR(100)');
    await pool.query('ALTER TABLE capi_outbox ALTER COLUMN site_key TYPE VARCHAR(100)');
    await pool.query('ALTER TABLE site_visitors ALTER COLUMN site_key TYPE VARCHAR(100)');
  });

  // site_key_lengths_and_purchase_cols já rodou em bancos antigos; por isso a coluna `country`
  // precisa de uma migração separada para garantir criação em produção.
  await migrate('site_visitors_country_col', async () => {
    await pool.query('ALTER TABLE site_visitors ADD COLUMN IF NOT EXISTS country VARCHAR(255)');
  });

  await migrate('dead_letter_table', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS capi_outbox_dead_letter (
        id SERIAL PRIMARY KEY,
        site_key VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        original_created_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_capi_dead_letter_site ON capi_outbox_dead_letter(site_key)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_capi_dead_letter_created ON capi_outbox_dead_letter(created_at)');
  });

  await migrate('mentor_chat_table', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mentor_chat_history (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        site_key VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_mentor_chat_account_site ON mentor_chat_history(account_id, site_key, created_at DESC)');
  });

  // Qualificação CRM (estilo Meta): toggle por site para enviar Purchase como qualificação máxima
  // (event_name=Lead, action_source=system_generated, custom_data.event_source=crm) automaticamente.
  // Default TRUE — ativa para clientes existentes, mas eles podem desligar pela aba Meta.
  // Aditivo: NÃO altera coluna alguma já em uso, NÃO mexe em token/Pixel/SDK.
  await migrate('integrations_meta_crm_qualify_purchases', async () => {
    await pool.query(
      'ALTER TABLE integrations_meta ADD COLUMN IF NOT EXISTS crm_qualify_purchases BOOLEAN DEFAULT TRUE'
    );
  });

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
