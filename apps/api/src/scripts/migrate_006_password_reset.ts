import { pool } from '../db/pool';

const migrate = async () => {
  try {
    console.log('Running migration 006: Create password_resets table');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(190) NOT NULL,
        token VARCHAR(100) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
      CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
    `);

    console.log('Migration 006 completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration 006 failed:', err);
    process.exit(1);
  }
};

migrate();
