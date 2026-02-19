import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

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

    // Trigger Webhook if configured
    if (config.webhook_url) {
      try {
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
      } catch (err) {
        console.error(`Webhook setup failed for form ${publicId}:`, err);
      }
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
