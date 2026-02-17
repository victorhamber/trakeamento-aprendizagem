import { pool } from '../db/pool';
import { ensureSchema } from '../db/schema';

const run = async () => {
  try {
    await ensureSchema(pool);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();

