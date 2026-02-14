import dotenv from 'dotenv';
import { newDb } from 'pg-mem';
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

const envPath = findEnvFile();
if (envPath) dotenv.config({ path: envPath });
else dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

export const pool: Pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : (() => {
      const db = newDb();
      const adapter = db.adapters.createPg();
      return new adapter.Pool();
    })();
