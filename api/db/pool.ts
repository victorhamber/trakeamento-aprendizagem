import pg from 'pg'

const { Pool } = pg

let cachedPool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (cachedPool) return cachedPool

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL')
  }

  cachedPool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10_000),
  })

  return cachedPool
}

