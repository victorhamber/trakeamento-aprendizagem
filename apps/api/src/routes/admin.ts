import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Endpoint para migrar/popular last_traffic_source de web_events antigos para site_visitors
router.post('/migrate-sources', requireAuth, async (req, res) => {
  const auth = req.auth!;
  // TODO: Adicionar checagem de superadmin se necessário
  
  try {
    console.log('[Admin] Starting traffic source migration...');
    
    // Query otimizada para pegar a primeira fonte de tráfego válida de cada visitante
    // e atualizar a tabela site_visitors se o campo estiver vazio
    const query = `
      WITH first_sources AS (
        SELECT DISTINCT ON (user_data->>'external_id', site_key)
          user_data->>'external_id' as eid,
          site_key as sk,
          COALESCE(
            NULLIF(custom_data->>'traffic_source', ''),
            NULLIF(custom_data->>'utm_source', ''),
            NULLIF(event_source_url, '')
          ) as source
        FROM web_events
        WHERE 
          user_data->>'external_id' IS NOT NULL
          AND (
            (custom_data->>'traffic_source' IS NOT NULL AND custom_data->>'traffic_source' != '')
            OR (custom_data->>'utm_source' IS NOT NULL AND custom_data->>'utm_source' != '')
            OR (event_source_url IS NOT NULL AND event_source_url != '')
          )
        ORDER BY user_data->>'external_id', site_key, event_time ASC
      )
      UPDATE site_visitors sv
      SET last_traffic_source = fs.source
      FROM first_sources fs
      WHERE sv.external_id = fs.eid 
        AND sv.site_key = fs.sk
        AND (sv.last_traffic_source IS NULL OR sv.last_traffic_source = '');
    `;

    const result = await pool.query(query);
    console.log(`[Admin] Migration finished. Updated ${result.rowCount} rows.`);
    
    res.json({ 
      success: true, 
      message: 'Migration completed successfully',
      migrated_count: result.rowCount 
    });
  } catch (e: any) {
    console.error('[Admin] Migration failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
