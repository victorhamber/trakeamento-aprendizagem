import { pool } from '../src/db/pool';

async function run() {
  try {
    console.log('Adicionando colunas objective, results e result_rate na tabela meta_insights_daily...');
    
    await pool.query(`
      ALTER TABLE meta_insights_daily 
      ADD COLUMN IF NOT EXISTS objective TEXT,
      ADD COLUMN IF NOT EXISTS results INTEGER,
      ADD COLUMN IF NOT EXISTS result_rate NUMERIC(10,4);
    `);

    console.log('Colunas adicionadas com sucesso!');
  } catch (err) {
    console.error('Erro ao executar migração:', err);
  } finally {
    await pool.end();
  }
}

run();
