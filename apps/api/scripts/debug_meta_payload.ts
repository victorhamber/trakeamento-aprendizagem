import { pool } from '../src/db/pool';

async function run() {
  try {
    const campaignIds = ['120237531297520187', '120237317932940187'];
    
    const res = await pool.query(`
      SELECT campaign_name, campaign_id, raw_payload 
      FROM meta_insights_daily 
      WHERE campaign_id = ANY($1)
      ORDER BY date_start DESC
      LIMIT 2
    `, [campaignIds]);

    for (const row of res.rows) {
      console.log('------------------------------------------------');
      console.log(`Campanha: ${row.campaign_name} (${row.campaign_id})`);
      
      let payload = row.raw_payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          console.log('Erro ao parsear JSON');
        }
      }

      console.log('Objetivo (API):', payload.objective);
      console.log('Resultados (API):', payload.results);
      console.log('Ações (Actions):');
      if (Array.isArray(payload.actions)) {
        payload.actions.forEach((a: any) => {
          console.log(`  - ${a.action_type}: ${a.value}`);
        });
      } else {
        console.log('  (Nenhuma ação encontrada ou formato inválido)');
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
