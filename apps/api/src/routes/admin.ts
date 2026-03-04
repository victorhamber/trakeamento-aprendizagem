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

// === Accounts Management ===

// GET /admin/accounts - List all SaaS clients and their usage
router.get('/accounts', async (req, res) => {
    try {
        const query = `
      SELECT 
        a.id, a.name, a.is_active, a.expires_at, a.bonus_site_limit, a.created_at,
        u.email,
        p.name as plan_name, p.max_sites as base_max_sites,
        (SELECT COUNT(*) FROM sites s WHERE s.account_id = a.id) as sites_count
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
        const { rows } = await pool.query('SELECT * FROM plans ORDER BY price ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list plans' });
    }
});

// POST /admin/plans - Create a new Plan or Add-on
router.post('/plans', async (req, res) => {
    const { name, type, price, billing_cycle, max_sites, max_events } = req.body;
    try {
        const { rows } = await pool.query(`
      INSERT INTO plans (name, type, price, billing_cycle, max_sites, max_events)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, type || 'SUBSCRIPTION', price, billing_cycle || 'MONTHLY', max_sites || 1, max_events || 10000]);
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Create Plan Error:', error);
        res.status(500).json({ error: 'Failed to create plan' });
    }
});

// === Global Notifications Management ===

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

export default router;
