import { pool } from '../db/pool';

const runMigration = async () => {
  try {
    await pool.query(`
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
        pixel_id VARCHAR(50),
        capi_token_enc TEXT,
        marketing_token_enc TEXT,
        ad_account_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS integrations_ga (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
        measurement_id VARCHAR(50),
        api_secret_enc TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sites_account ON sites(account_id);
    `);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

runMigration();

