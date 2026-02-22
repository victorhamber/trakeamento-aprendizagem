import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

const normalizeHost = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  try {
    const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    const host = parsed.hostname.replace(/\.$/, '');
    if (!host.includes('.')) return null;
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
};

const hostFromEnv = (value?: string): string | null => {
  if (!value) return null;
  const normalized = normalizeHost(value);
  if (normalized) return normalized;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

router.get('/allow-domain', async (req, res) => {
  const host = normalizeHost(req.query.domain);
  if (!host) return res.status(400).json({ allow: false });

  const expectedToken = process.env.CADDY_ASK_TOKEN;
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (expectedToken && token !== expectedToken) {
    return res.status(403).json({ allow: false });
  }

  const envHosts = [
    hostFromEnv(process.env.PUBLIC_API_BASE_URL),
    hostFromEnv(process.env.PUBLIC_DASHBOARD_BASE_URL),
  ].filter(Boolean) as string[];

  if (envHosts.includes(host)) {
    return res.json({ allow: true });
  }

  const result = await pool.query(
    `SELECT 1
     FROM sites
     WHERE tracking_domain IS NOT NULL
       AND regexp_replace(regexp_replace(lower(tracking_domain), '^https?://', ''), '/$', '') = $1
     LIMIT 1`,
    [host]
  );

  if (result.rowCount) return res.json({ allow: true });
  return res.status(403).json({ allow: false });
});

export default router;