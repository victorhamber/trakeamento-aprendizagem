import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString, decryptString } from '../lib/crypto';

const router = Router();

const randomKey = (bytes: number) => crypto.randomBytes(bytes).toString('base64url');
const CANON_FIELDS = ['email', 'phone', 'fn', 'ln', 'ct', 'st', 'zp', 'db'] as const;
type CanonField = (typeof CANON_FIELDS)[number];

const sanitizeMapping = (input: any) => {
  const mapping: Record<CanonField, string[]> = {
    email: [],
    phone: [],
    fn: [],
    ln: [],
    ct: [],
    st: [],
    zp: [],
    db: [],
  };

  if (!input || typeof input !== 'object') return mapping;
  for (const key of CANON_FIELDS) {
    const raw = (input as any)[key];
    const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
    const cleaned = arr
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
      .slice(0, 20);
    mapping[key] = cleaned;
  }
  return mapping;
};

router.get('/', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const result = await pool.query(
    'SELECT id, name, domain, site_key, created_at FROM sites WHERE account_id = $1 ORDER BY id DESC',
    [auth.accountId]
  );
  return res.json({ sites: result.rows });
});

router.get('/:siteId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const result = await pool.query(
    'SELECT id, name, domain, site_key, created_at FROM sites WHERE id = $1 AND account_id = $2',
    [siteId, auth.accountId]
  );
  if (!(result.rowCount || 0)) return res.status(404).json({ error: 'Site not found' });
  return res.json({ site: result.rows[0] });
});

router.get('/:siteId/secret', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const result = await pool.query(
    'SELECT webhook_secret_enc FROM sites WHERE id = $1 AND account_id = $2',
    [siteId, auth.accountId]
  );
  if (!(result.rowCount || 0)) return res.status(404).json({ error: 'Site not found' });
  
  let secret: string;
  try {
    secret = decryptString(result.rows[0].webhook_secret_enc as string);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to decrypt webhook secret. Key mismatch.' });
  }

  return res.json({ secret });
});

router.post('/', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const { name, domain } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' });

  const siteKey = `site_${randomKey(18)}`;
  const webhookSecretPlain = `whsec_${randomKey(24)}`;
  const webhookSecretEnc = encryptString(webhookSecretPlain);

  const result = await pool.query(
    `INSERT INTO sites (account_id, name, domain, site_key, webhook_secret_enc)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, domain, site_key, created_at`,
    [auth.accountId, name.trim(), typeof domain === 'string' ? domain.trim() : null, siteKey, webhookSecretEnc]
  );

  return res.status(201).json({ site: result.rows[0], webhook_secret: webhookSecretPlain });
});

router.get('/:siteId/identify-mapping', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query('SELECT mapping FROM site_identify_mappings WHERE site_id = $1', [siteId]);
  const mapping = result.rowCount ? sanitizeMapping(result.rows[0].mapping) : sanitizeMapping(null);
  return res.json({ mapping });
});

router.put('/:siteId/identify-mapping', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const mapping = sanitizeMapping(req.body?.mapping ?? req.body);
  await pool.query(
    `INSERT INTO site_identify_mappings (site_id, mapping)
     VALUES ($1, $2)
     ON CONFLICT (site_id) DO UPDATE SET mapping = $2, updated_at = NOW()`,
    [siteId, mapping]
  );

  return res.json({ ok: true, mapping });
});

router.get('/:siteId/snippet', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id, site_key, domain FROM sites WHERE id = $1 AND account_id = $2', [
    siteId,
    auth.accountId,
  ]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const apiBaseUrl = process.env.PUBLIC_API_BASE_URL || 'http://localhost:3000';
  const sdkUrl = process.env.PUBLIC_SDK_URL || `${apiBaseUrl}/sdk/tracker.js`;
  const siteKey = site.rows[0].site_key as string;

  const meta = await pool.query('SELECT enabled, pixel_id FROM integrations_meta WHERE site_id = $1', [siteId]);
  const ga = await pool.query('SELECT enabled, measurement_id FROM integrations_ga WHERE site_id = $1', [siteId]);

  const metaRow = meta.rows[0] as { enabled?: boolean | null; pixel_id?: string | null } | undefined;
  const gaRow = ga.rows[0] as { enabled?: boolean | null; measurement_id?: string | null } | undefined;

  const metaPixelId =
    metaRow && metaRow.enabled === false ? null : typeof metaRow?.pixel_id === 'string' ? metaRow.pixel_id.trim() : null;
  const gaMeasurementId =
    gaRow && gaRow.enabled === false
      ? null
      : typeof gaRow?.measurement_id === 'string'
        ? gaRow.measurement_id.trim()
        : null;

  const identify = await pool.query('SELECT mapping FROM site_identify_mappings WHERE site_id = $1', [siteId]);
  const identifyMap = identify.rowCount ? sanitizeMapping(identify.rows[0].mapping) : sanitizeMapping(null);

  const snippet = [
    `<script>window.TRACKING_CONFIG={apiUrl:${JSON.stringify(apiBaseUrl)},siteKey:${JSON.stringify(siteKey)},metaPixelId:${JSON.stringify(metaPixelId)},gaMeasurementId:${JSON.stringify(gaMeasurementId)},identifyMap:${JSON.stringify(identifyMap)}};</script>`,
    `<script async src=${JSON.stringify(sdkUrl)}></script>`,
  ].join('\n');

  return res.json({
    snippet,
    api_base_url: apiBaseUrl,
    sdk_url: sdkUrl,
    site_key: siteKey,
    meta_pixel_id: metaPixelId,
    ga_measurement_id: gaMeasurementId,
    identify_map: identifyMap,
  });
});

export default router;

