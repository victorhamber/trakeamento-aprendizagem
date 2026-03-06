import { pool } from './db/pool';

async function main() {
    const accountId = 1; // Assuming demo or first account ID

    try {
        console.log(`Testing notifications fetch for account_id=${accountId}...`);

        // Create tracking table if we missed it in central schema
        await pool.query(`
        CREATE TABLE IF NOT EXISTS global_notification_reads (
            account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
            global_notification_id INTEGER REFERENCES global_notifications(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (account_id, global_notification_id)
        )
    `);
        console.log("Tracking table ensured.");

        // Fetch account-specific notifications
        const result = await pool.query(
            `SELECT id::text, title, message, is_read, created_at, 'personal' as type 
         FROM notifications 
         WHERE account_id = $1 OR account_id IS NULL
         ORDER BY created_at DESC
         LIMIT 30`,
            [accountId]
        );
        console.log(`Found ${result.rows.length} personal notifications.`);

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
            [accountId]
        );
        console.log(`Found ${globalResult.rows.length} global broadcasts.`);
        console.log("Global broadcasts sample:", globalResult.rows.slice(0, 2));

        const allNotifications = [...globalResult.rows, ...result.rows];
        allNotifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        console.log(`Total sorted: ${allNotifications.length}`);

    } catch (e) {
        console.error("Query Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
