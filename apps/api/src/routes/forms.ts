import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { capiService, CapiService } from '../services/capi';

const router = Router();

// Helper to extract first and last name from full name
function splitName(fullName: string): { fn?: string; ln?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { fn: parts[0] };
  return {
    fn: parts[0],
    ln: parts.slice(1).join(' ')
  };
}

// List Forms
router.get('/sites/:siteId/forms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query('SELECT * FROM site_forms WHERE site_id = $1 ORDER BY created_at DESC', [siteId]);
  return res.json({ forms: result.rows });
});

// Create Form
router.post('/sites/:siteId/forms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, config } = req.body;
  if (!name || !config) return res.status(400).json({ error: 'Name and config are required' });

  const result = await pool.query(
    'INSERT INTO site_forms (site_id, name, config) VALUES ($1, $2, $3) RETURNING *',
    [siteId, name, config]
  );
  return res.json({ form: result.rows[0] });
});

// Update Form
router.put('/sites/:siteId/forms/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, config } = req.body;
  const result = await pool.query(
    'UPDATE site_forms SET name = $1, config = $2, updated_at = NOW() WHERE id = $3 AND site_id = $4 RETURNING *',
    [name, config, id, siteId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Form not found' });
  return res.json({ form: result.rows[0] });
});

// Delete Form
router.delete('/sites/:siteId/forms/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  await pool.query('DELETE FROM site_forms WHERE id = $1 AND site_id = $2', [id, siteId]);
  return res.json({ success: true });
});

// Public Submit Endpoint
router.post('/public/forms/:publicId/submit', async (req, res) => {
  const publicId = req.params.publicId;
  if (!publicId) return res.status(400).json({ error: 'Missing form ID' });

  try {
    const formRes = await pool.query('SELECT * FROM site_forms WHERE public_id = $1', [publicId]);
    if (!formRes.rowCount) return res.status(404).json({ error: 'Form not found' });
    const form = formRes.rows[0];
    const config = form.config || {};

    // ── CAPI INTEGRATION ──
    const siteId = form.site_id;
    const siteRes = await pool.query('SELECT site_key FROM sites WHERE id = $1', [siteId]);
    if (siteRes.rowCount) {
      const siteKey = siteRes.rows[0].site_key;
      const body = req.body || {};

      // Normalize keys to lowercase + stripped
      const data: Record<string, string> = {};
      Object.keys(body).forEach(k => {
        data[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(body[k]);
      });

      // Extract User Data
      const email = data['email'] || data['mail'] || data['e_mail'];
      const phone = data['phone'] || data['tel'] || data['telefone'] || data['celular'] || data['whatsapp'];

      let fn = data['fn'] || data['firstname'] || data['first_name'] || data['primeironome'] || data['primeiro_nome'];
      let ln = data['ln'] || data['lastname'] || data['last_name'] || data['sobrenome'] || data['ultimo_nome'];
      const name = data['name'] || data['nome'] || data['fullname'] || data['full_name'] || data['nomecompleto'];

      if (!fn && !ln && name) {
        const parts = splitName(name);
        if (parts.fn) fn = parts.fn;
        if (parts.ln) ln = parts.ln;
      }

      const userData: any = {
        client_ip_address: req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0],
        client_user_agent: req.headers['user-agent'] || undefined,
      };

      if (email) userData.em = CapiService.hash(email);
      if (phone) userData.ph = CapiService.hash(phone.replace(/\D/g, ''));
      if (fn) userData.fn = CapiService.hash(fn);
      if (ln) userData.ln = CapiService.hash(ln);

      // Determine Event Name from Config
      let eventName = 'Lead';
      if (form.config?.event_type) {
        if (form.config.event_type === 'Custom') {
          eventName = form.config.custom_event_name || 'Lead';
        } else {
          eventName = form.config.event_type;
        }
      }

      // Send Event (async)
      capiService.sendEventDetailed(siteKey, {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: body.event_id || `${eventName.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        event_source_url: req.headers.referer || `https://form-submit.trakeamento.com/${publicId}`,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          form_name: form.name,
          form_id: publicId,
          ...(({ event_id, ...rest }) => rest)(body)
        }
      }).catch(err => console.error(`CAPI failed for form ${publicId}:`, err));
    }

    // Trigger Webhook if configured
    if (config.webhook_url) {
      fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: form.public_id,
          form_name: form.name,
          submitted_at: new Date().toISOString(),
          data: req.body
        })
      }).catch(err => console.error(`Webhook failed for form ${publicId}:`, err));
    }

    return res.json({
      success: true,
      action: config.post_submit_action || 'message',
      message: config.post_submit_message || 'Obrigado! Dados recebidos.',
      redirect_url: config.post_submit_redirect_url || ''
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export const formsRouter = router;
