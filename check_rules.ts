import { pool } from './apps/api/src/db/pool';
pool.query("SELECT r.type, r.event_name, r.conditions, s.domain FROM event_rules r JOIN sites s ON r.site_id = s.id WHERE r.event_name = 'Cadastro_Grupo'").then(res => { console.log(JSON.stringify(res.rows, null, 2)); process.exit(0); });
