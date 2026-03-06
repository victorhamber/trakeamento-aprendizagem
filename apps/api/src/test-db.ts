import { pool } from './db/pool';

async function main() {
    try {
        const { rows } = await pool.query(`
      SELECT 
        a.id, a.name, a.is_active, a.expires_at, a.bonus_site_limit, a.created_at,
        u.email,
        p.name as plan_name, p.max_sites as base_max_sites,
        (SELECT COUNT(*) FROM sites s WHERE s.account_id = a.id) as sites_count
      FROM accounts a
      LEFT JOIN users u ON u.account_id = a.id
      LEFT JOIN plans p ON a.active_plan_id = p.id
      ORDER BY a.created_at DESC
    `);

        console.log(`Found ${rows.length} accounts using the exact query from /admin/accounts`);
        if (rows.length > 0) {
            console.log("Sample:", rows[0]);
        } else {
            // Fallback checks
            const accCount = await pool.query('SELECT COUNT(*) FROM accounts');
            const userCount = await pool.query('SELECT COUNT(*) FROM users');
            console.log(`Fallback Data Check -> Accounts: ${accCount.rows[0].count}, Users: ${userCount.rows[0].count}`);
        }
    } catch (e) {
        console.error("Query Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
