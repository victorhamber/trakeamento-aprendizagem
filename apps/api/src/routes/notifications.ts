import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// Middleware: require auth
const requireAuth = (req: any, res: any, next: any) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    next();
};

// GET /notifications — list notifications for the current account
router.get('/', requireAuth, async (req, res) => {
    const auth = req.auth!;

    const result = await pool.query(
        `SELECT * FROM notifications 
     WHERE account_id = $1 OR account_id IS NULL
     ORDER BY created_at DESC
     LIMIT 50`,
        [auth.accountId]
    );

    return res.json({ notifications: result.rows });
});

// PUT /:id/read — mark notification as read
router.put('/:id/read', requireAuth, async (req, res) => {
    const auth = req.auth!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notification ID' });

    await pool.query(
        `UPDATE notifications SET is_read = true WHERE id = $1 AND (account_id = $2 OR account_id IS NULL)`,
        [id, auth.accountId]
    );

    return res.json({ ok: true });
});

// POST / — create a notification (admin/server use)
router.post('/', requireAuth, async (req, res) => {
    const { title, message, account_id } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message are required' });

    const result = await pool.query(
        `INSERT INTO notifications (account_id, title, message) VALUES ($1, $2, $3) RETURNING *`,
        [account_id || null, title, message]
    );

    return res.json({ notification: result.rows[0] });
});

export default router;
