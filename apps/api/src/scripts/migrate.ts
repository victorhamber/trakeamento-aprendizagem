import { pool } from '../db/pool';

const createTables = async () => {
  try {
    await pool.query(`
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

      CREATE INDEX IF NOT EXISTS idx_web_events_time ON web_events(event_time);
      CREATE INDEX IF NOT EXISTS idx_web_events_name ON web_events(event_name);
      CREATE INDEX IF NOT EXISTS idx_purchases_site_time ON purchases(site_key, created_at);
    `);
    console.log('Migrations run successfully');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

createTables();
