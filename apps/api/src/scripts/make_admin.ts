import { pool } from '../db/pool';

const makeAdmin = async () => {
    const email = process.argv[2];
    if (!email) {
        console.error('Por favor, forneca um email. Exemplo: npm run make:admin seu@email.com');
        process.exit(1);
    }

    console.log(`Buscando usuario com email: ${email}`);

    try {
        const res = await pool.query('UPDATE users SET is_super_admin = true WHERE email = $1 RETURNING id, email', [email]);
        if (res.rowCount === 0) {
            console.log('Nenhum usuario encontrado com esse email.');
        } else {
            console.log(`✅ Usuario ${res.rows[0].email} agora e SUPER ADMIN!`);
        }
    } catch (err) {
        console.error('Erro ao promover usuario:', err);
    } finally {
        process.exit(0);
    }
};

makeAdmin();
