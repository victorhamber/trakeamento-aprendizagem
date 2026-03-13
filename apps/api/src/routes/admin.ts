import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Middleware to ensure the user is a Super Admin
const requireSuperAdmin = async (req: any, res: any, next: any) => {
  if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { rows } = await pool.query('SELECT is_super_admin FROM users WHERE id = $1', [req.auth.userId]);
    if (rows.length === 0 || !rows[0].is_super_admin) {
      return res.status(403).json({ error: 'Forbidden: Super Admin only' });
    }
    next();
  } catch (error) {
    console.error('Super Admin Check Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.use(requireAuth);
router.use(requireSuperAdmin);

// Endpoint para migrar/popular last_traffic_source de web_events antigos para site_visitors
router.post('/migrate-sources', async (req, res) => {
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

// === Accounts Management ===

// GET /admin/accounts - List all SaaS clients and their usage
router.get('/accounts', async (req, res) => {
  try {
    const query = `
      SELECT 
        a.id, a.name, a.is_active, a.expires_at, a.bonus_site_limit, a.created_at,
        u.email,
        p.name AS plan_name, p.max_sites AS base_max_sites,
        (SELECT COUNT(*) FROM sites s WHERE s.account_id = a.id) AS sites_count,
        (SELECT COALESCE(SUM(sub.cnt), 0) FROM (
          SELECT COUNT(*) AS cnt FROM web_events we
          INNER JOIN sites s2 ON s2.site_key = we.site_key
          WHERE s2.account_id = a.id
        ) sub) AS total_events,
        (SELECT MAX(we2.event_time) FROM web_events we2
          INNER JOIN sites s3 ON s3.site_key = we2.site_key
          WHERE s3.account_id = a.id) AS last_activity
      FROM accounts a
      LEFT JOIN users u ON u.account_id = a.id
      LEFT JOIN plans p ON a.active_plan_id = p.id
      ORDER BY a.created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('List Accounts Error:', error);
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

// PUT /admin/accounts/:id - Manually update an account's limits or status
router.put('/accounts/:id', async (req, res) => {
  const accountId = req.params.id;
  const { is_active, bonus_site_limit, active_plan_id } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE accounts 
      SET is_active = COALESCE($1, is_active),
          bonus_site_limit = COALESCE($2, bonus_site_limit),
          active_plan_id = COALESCE($3, active_plan_id)
      WHERE id = $4
      RETURNING id, is_active, bonus_site_limit, active_plan_id
    `, [is_active, bonus_site_limit, active_plan_id, accountId]);

    if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Update Account Error:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// === Plans Management ===

// GET /admin/plans - List all pricing plans
router.get('/plans', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, type, price, billing_cycle, max_sites, max_events, offer_codes, created_at FROM plans ORDER BY price ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list plans' });
  }
});

// POST /admin/plans - Create a new Plan or Add-on
router.post('/plans', async (req, res) => {
  const { name, type, price, billing_cycle, max_sites, max_events, offer_codes } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO plans (name, type, price, billing_cycle, max_sites, max_events, offer_codes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name, type || 'SUBSCRIPTION', price, billing_cycle || 'MONTHLY', max_sites || 1, max_events || 10000, offer_codes || null]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Create Plan Error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// PUT /admin/plans/:id - Update an existing Plan
router.put('/plans/:id', async (req, res) => {
  const planId = req.params.id;
  const { name, type, price, billing_cycle, max_sites, max_events, offer_codes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE plans 
      SET name = COALESCE($1, name),
          type = COALESCE($2, type),
          price = COALESCE($3, price),
          billing_cycle = COALESCE($4, billing_cycle),
          max_sites = COALESCE($5, max_sites),
          max_events = COALESCE($6, max_events),
          offer_codes = $7
      WHERE id = $8
      RETURNING *
    `, [name, type, price, billing_cycle, max_sites, max_events, offer_codes || null, planId]);

    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Update Plan Error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// DELETE /admin/plans/:id - Delete a Plan
router.delete('/plans/:id', async (req, res) => {
  const planId = req.params.id;
  try {
    const { rowCount } = await pool.query('DELETE FROM plans WHERE id = $1', [planId]);

    if (rowCount === 0) return res.status(404).json({ error: 'Plan not found' });
    res.status(204).send();
  } catch (error: any) {
    console.error('Delete Plan Error:', error);
    if (error.code === '23503') { // Postgres foreign key violation code
      return res.status(400).json({ error: 'Não é possível excluir este plano pois existem contas atreladas a ele.' });
    }
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// === Global Notifications Management ===

// GET /admin/notifications - List all global notifications (history)
router.get('/notifications', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT gn.*,
        (SELECT COUNT(*) FROM global_notification_reads gnr WHERE gnr.global_notification_id = gn.id) AS read_count
      FROM global_notifications gn
      ORDER BY gn.created_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (error) {
    console.error('List Notifications Error:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

// POST /admin/notifications - Broadcast a new message to all Dashboards
router.post('/notifications', async (req, res) => {
  const { title, message, image_url, image_link, action_text, action_url, expires_at } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO global_notifications (title, message, image_url, image_link, action_text, action_url, is_active, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, true, $7)
      RETURNING *
    `, [title, message, image_url || null, image_link || null, action_text || null, action_url || null, expires_at || null]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Create Notification Error:', error);
    res.status(500).json({ error: 'Failed to create global notification' });
  }
});

// === Email Settings Management ===

// GET /admin/email-settings - Get current global email configuration (without exposing API key)
router.get('/email-settings', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        from_email,
        from_name,
        welcome_subject,
        welcome_html,
        reset_subject,
        reset_html,
        (api_key IS NOT NULL) AS has_api_key
      FROM email_settings
      WHERE id = 1
    `);

    if (!rows.length) {
      return res.json({
        from_email: null,
        from_name: null,
        welcome_subject: null,
        welcome_html: null,
        reset_subject: null,
        reset_html: null,
        has_api_key: false,
      });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error('Get Email Settings Error:', error);
    res.status(500).json({ error: 'Failed to get email settings' });
  }
});

// PUT /admin/email-settings - Upsert global email configuration (including API key)
router.put('/email-settings', async (req, res) => {
  const { api_key, from_email, from_name, welcome_subject, welcome_html, reset_subject, reset_html } = req.body || {};

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO email_settings (id, provider, api_key, from_email, from_name, welcome_subject, welcome_html, reset_subject, reset_html, created_at, updated_at)
      VALUES (1, 'RESEND', $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        api_key = COALESCE(EXCLUDED.api_key, email_settings.api_key),
        from_email = COALESCE(EXCLUDED.from_email, email_settings.from_email),
        from_name = COALESCE(EXCLUDED.from_name, email_settings.from_name),
        welcome_subject = COALESCE(EXCLUDED.welcome_subject, email_settings.welcome_subject),
        welcome_html = COALESCE(EXCLUDED.welcome_html, email_settings.welcome_html),
        reset_subject = COALESCE(EXCLUDED.reset_subject, email_settings.reset_subject),
        reset_html = COALESCE(EXCLUDED.reset_html, email_settings.reset_html),
        updated_at = NOW()
      RETURNING
        from_email,
        from_name,
        welcome_subject,
        welcome_html,
        reset_subject,
        reset_html,
        (api_key IS NOT NULL) AS has_api_key
      `,
      [api_key || null, from_email || null, from_name || null, welcome_subject || null, welcome_html || null, reset_subject || null, reset_html || null]
    );

    return res.json(rows[0]);
  } catch (error) {
    console.error('Update Email Settings Error:', error);
    res.status(500).json({ error: 'Failed to update email settings' });
  }
});

export default router;
