import { pool } from '../db/pool';

export type OwnedSite = {
  id: number;
  siteKey: string;
  accountId: number;
};

function mapOwnedSite(row: Record<string, unknown> | undefined): OwnedSite | null {
  if (!row) return null;
  const id = Number(row.id);
  const accountId = Number(row.account_id);
  const siteKey = typeof row.site_key === 'string' ? row.site_key : '';
  if (!Number.isFinite(id) || !Number.isFinite(accountId) || !siteKey) return null;
  return { id, siteKey, accountId };
}

export async function findOwnedSiteByKey(accountId: number, siteKey: string): Promise<OwnedSite | null> {
  const result = await pool.query(
    'SELECT id, site_key, account_id FROM sites WHERE site_key = $1 AND account_id = $2 LIMIT 1',
    [siteKey, accountId]
  );
  return mapOwnedSite(result.rows[0]);
}

export async function findOwnedSiteById(accountId: number, siteId: number): Promise<OwnedSite | null> {
  const result = await pool.query(
    'SELECT id, site_key, account_id FROM sites WHERE id = $1 AND account_id = $2 LIMIT 1',
    [siteId, accountId]
  );
  return mapOwnedSite(result.rows[0]);
}
