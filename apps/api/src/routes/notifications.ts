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

    // Fetch account-specific notifications
    const result = await pool.query(
        `SELECT id::text, title, message, is_read, created_at, 'personal' as type 
         FROM notifications 
         WHERE account_id = $1 OR account_id IS NULL
         ORDER BY created_at DESC
         LIMIT 30`,
        [auth.accountId]
    );

    // Fetch active global broadcasts
    const globalResult = await pool.query(
        `SELECT 
            'global_' || g.id as id, 
            g.title, 
            g.message, 
            CASE WHEN r.account_id IS NOT NULL THEN true ELSE false END as is_read,
            g.created_at,
            'global' as type
         FROM global_notifications g
         LEFT JOIN global_notification_reads r ON r.global_notification_id = g.id AND r.account_id = $1
         WHERE g.is_active = true AND (g.expires_at IS NULL OR g.expires_at > NOW())
         ORDER BY g.created_at DESC
         LIMIT 20`,
        [auth.accountId]
    );

    const allNotifications = [...globalResult.rows, ...result.rows];
    allNotifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.json({ notifications: allNotifications });
});

// PUT /:id/read — mark notification as read
router.get('/:id/read', requireAuth, async (req, res) => {
    // Note: Kept as GET internally mapped to PUT based on the dashboard frontend (some frontends use GET to easily mark read on hover, but we support PUT here)
});
router.put('/:id/read', requireAuth, async (req, res) => {
    const auth = req.auth!;
    const idParam = req.params.id;

    if (idParam.startsWith('global_')) {
        const globalId = parseInt(idParam.replace('global_', ''), 10);
        await pool.query(
            `INSERT INTO global_notification_reads (account_id, global_notification_id) 
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [auth.accountId, globalId]
        );
    } else {
        const id = Number(idParam);
        if (Number.isFinite(id)) {
            await pool.query(
                `UPDATE notifications SET is_read = true WHERE id = $1 AND (account_id = $2 OR account_id IS NULL)`,
                [id, auth.accountId]
            );
        }
    }

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
