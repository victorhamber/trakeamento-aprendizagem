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
      UPDATE site_visitors sv
      SET last_traffic_source = src.source
      FROM LATERAL (
        SELECT
          COALESCE(
            NULLIF(e.custom_data->>'traffic_source', ''),
            NULLIF(e.custom_data->>'utm_source', ''),
            NULLIF(e.event_source_url, '')
          ) as source
        FROM web_events e
        WHERE e.site_key = sv.site_key
          AND (
            (sv.external_id IS NOT NULL AND e.user_data->>'external_id' = sv.external_id)
            OR (sv.email_hash IS NOT NULL AND e.user_data->>'em' = sv.email_hash)
            OR (sv.phone_hash IS NOT NULL AND e.user_data->>'ph' = sv.phone_hash)
          )
          AND (
            NULLIF(e.custom_data->>'traffic_source', '') IS NOT NULL
            OR NULLIF(e.custom_data->>'utm_source', '') IS NOT NULL
            OR NULLIF(e.event_source_url, '') IS NOT NULL
          )
        ORDER BY e.event_time ASC
        LIMIT 1
      ) src
      WHERE (sv.last_traffic_source IS NULL OR sv.last_traffic_source = '')
        AND src.source IS NOT NULL;
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
