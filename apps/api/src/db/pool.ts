import dotenv from 'dotenv';
import { newDb } from 'pg-mem';
require('dotenv').config({ path: '../../.env' });
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();

const findEnvFile = (): string | null => {
  const candidates = [
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '..', '.env'),
    path.resolve(cwd, '..', '..', '.env'),
    path.resolve(cwd, '..', '..', '..', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

if (process.env.NODE_ENV !== 'production') {
  const envPath = findEnvFile();
  if (envPath) dotenv.config({ path: envPath });
  else dotenv.config();
}

const databaseUrl = process.env.DATABASE_URL;

console.log('--- DB CONNECTION DEBUG ---');
if (databaseUrl) {
  console.log('Using REAL Database (PostgreSQL)');
  // Mask password in logs
  console.log('Connection String:', databaseUrl.replace(/:([^:@]+)@/, ':***@'));
} else {
  console.log('WARNING: DATABASE_URL not found! Using IN-MEMORY (pg-mem) database.');
  console.log('Data will be LOST on restart.');
}
console.log('---------------------------');

const poolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);

export const pool: Pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    min: Math.max(2, Math.floor(poolMax / 4)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    allowExitOnIdle: true,
  })
  : (() => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    return new adapter.Pool();
  })();
