import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getPool } from '../db/pool.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  const sqlPath = path.resolve(__dirname, '../../migrations/0001_init.sql')
  const sql = await fs.readFile(sqlPath, 'utf8')
  const pool = getPool()
  await pool.query(sql)
  await pool.end()
}

main().catch(async () => {
  await getPool().end().catch(() => undefined)
  process.exitCode = 1
})

