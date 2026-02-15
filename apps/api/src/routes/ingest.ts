import { Router } from 'express';
import { pool } from '../db/pool';
import { capiService, CapiService } from '../services/capi';

const router = Router();

router.post('/events', async (req, res) => {
  const siteKey = req.query.key || req.headers['x-site-key'];
  const event = req.body;

  if (!siteKey || !event.event_name) {
    return res.status(400).json({ error: 'Missing site key or event data' });
  }

  try {
    // 1. Persistir o evento raw no Postgres
    const query = `
      INSERT INTO web_events (
        site_key, event_id, event_name, event_time, 
        event_source_url, user_data, custom_data, telemetry, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (site_key, event_id) DO NOTHING
      RETURNING id
    `;

    const values = [
      siteKey,
      event.event_id,
      event.event_name,
      new Date(event.event_time * 1000), 
      event.event_source_url,
      event.user_data,
      event.custom_data,
      event.telemetry,
      event
    ];

    const result = await pool.query(query, values);

    // 2. Envio CAPI (Assíncrono na prática, aqui direto para MVP)
    if ((result.rowCount || 0) > 0) {
      // Prepara payload CAPI
      const capiPayload = {
        event_name: event.event_name,
        event_time: event.event_time,
        event_id: event.event_id,
        event_source_url: event.event_source_url,
        user_data: {
          client_ip_address: req.ip || event.user_data.client_ip_address,
          client_user_agent: req.headers['user-agent'] || event.user_data.client_user_agent,
          em: event.user_data.em,
          ph: event.user_data.ph,
          fn: event.user_data.fn,
          ln: event.user_data.ln,
          ct: event.user_data.ct,
          st: event.user_data.st,
          zp: event.user_data.zp,
          db: event.user_data.db,
          fbp: event.user_data.fbp,
          fbc: event.user_data.fbc,
          external_id: event.user_data.external_id ? CapiService.hash(event.user_data.external_id) : undefined
        },
        custom_data: {
           ...event.custom_data,
           content_name: event.custom_data?.page_title,
           content_type: event.custom_data?.content_type || 'product'
        }
      };

      // Não aguarda o envio para não bloquear a resposta do ingest (fire and forget)
      capiService.sendEvent(String(siteKey), capiPayload).catch(err => console.error("Async CAPI error", err));
    }

    res.status(202).json({ status: 'received' });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
