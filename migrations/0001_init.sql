CREATE TABLE IF NOT EXISTS web_events (
  id BIGSERIAL PRIMARY KEY,
  site_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_time BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  event_source_url TEXT,
  event_url TEXT,
  page_title TEXT,
  load_time_ms INTEGER,
  fbp TEXT,
  fbc TEXT,
  external_id_hash TEXT,
  client_ip_address TEXT,
  client_user_agent TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_key, event_id)
);

CREATE INDEX IF NOT EXISTS web_events_site_time_idx ON web_events (site_key, event_time);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  site_key TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_time BIGINT NOT NULL,
  event_id TEXT,
  value NUMERIC(18,2),
  currency TEXT,
  buyer_external_id_hash TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_key, order_id)
);

CREATE INDEX IF NOT EXISTS purchases_site_time_idx ON purchases (site_key, event_time);

CREATE TABLE IF NOT EXISTS meta_outbox (
  id BIGSERIAL PRIMARY KEY,
  site_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_time BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_key, event_id)
);

CREATE INDEX IF NOT EXISTS meta_outbox_status_idx ON meta_outbox (status, created_at);
