import { pool } from '../db/pool';

async function cleanup() {
    console.log('--- Starting Data Retention Cleanup ---');

    try {
        // Apaga registros brutos mais velhos que 30 dias na web_events
        // Exceto se eles forem compras, ou podemos confiar que compras estão na tabela purchases
        const res = await pool.query(`
      DELETE FROM web_events 
      WHERE created_at < NOW() - INTERVAL '30 days'
    `);

        console.log(`✅ Cleanup Complete. Deleted ${res.rowCount} old raw events from web_events.`);
    } catch (err) {
        console.error('❌ Error during cleanup:', err);
    } finally {
        process.exit(0);
    }
}

cleanup();
