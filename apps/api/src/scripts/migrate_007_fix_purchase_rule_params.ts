/**
 * Preenche parameters.value e parameters.currency em site_url_rules com event_name = Purchase
 * quando faltam ou são inválidos (Pixel/CAPI). Preserva value ou currency já válidos.
 * Padrões: value = 0, currency = BRL.
 */
import { pool } from '../db/pool';

function parsePurchaseParams(parameters: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
} {
  const base =
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? { ...(parameters as Record<string, unknown>) }
      : {};

  const rawVal = base.value;
  const num =
    typeof rawVal === 'number'
      ? rawVal
      : typeof rawVal === 'string'
        ? parseFloat(String(rawVal).trim())
        : NaN;
  const valueOk = Number.isFinite(num) && num >= 0;

  const cur = typeof base.currency === 'string' ? base.currency.trim() : '';
  const curOk = /^[A-Za-z]{3}$/.test(cur);

  const next: Record<string, unknown> = { ...base };
  if (valueOk) next.value = num;
  else next.value = 0;

  if (curOk) next.currency = cur.toUpperCase();
  else next.currency = 'BRL';

  const stable = (o: Record<string, unknown>) =>
    JSON.stringify(o, Object.keys(o).sort());

  const prev =
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : {};

  const changed = stable(next) !== stable({ ...prev });

  return { next, changed };
}

const run = async () => {
  console.log('Migrating: corrigindo parameters de regras Purchase em site_url_rules...');

  try {
    const { rows } = await pool.query<{
      id: number;
      site_id: number;
      parameters: Record<string, unknown> | null;
    }>(
      `SELECT id, site_id, parameters FROM site_url_rules WHERE event_name = 'Purchase'`
    );

    let updated = 0;
    for (const row of rows) {
      const { next, changed } = parsePurchaseParams(row.parameters);
      if (!changed) continue;

      await pool.query(`UPDATE site_url_rules SET parameters = $1::jsonb WHERE id = $2`, [
        JSON.stringify(next),
        row.id,
      ]);
      updated++;
      console.log(`  id=${row.id} site_id=${row.site_id} -> value=${next.value} currency=${next.currency}`);
    }

    console.log(`Concluído. ${rows.length} regra(s) Purchase analisada(s), ${updated} atualizada(s).`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  }
};

run();
