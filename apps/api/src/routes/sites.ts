import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString, decryptString } from '../lib/crypto';

const router = Router();

const randomKey = (bytes: number) => crypto.randomBytes(bytes).toString('base64url');
const CANON_FIELDS = ['email', 'phone', 'fn', 'ln', 'ct', 'st', 'zp', 'db'] as const;
type CanonField = (typeof CANON_FIELDS)[number];

const sanitizeMapping = (input: unknown) => {
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
    const raw = (input as Record<string, unknown>)[key];
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
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt webhook secret. Key mismatch.' });
  }

  return res.json({ secret });
});

router.delete('/:siteId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  try {
    const siteCheck = await pool.query(
      'SELECT site_key FROM sites WHERE id = $1 AND account_id = $2',
      [siteId, auth.accountId]
    );

    if (!(siteCheck.rowCount || 0)) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const siteKey = siteCheck.rows[0].site_key;

    await pool.query('BEGIN');

    // Delete related tables by site_id
    await pool.query('DELETE FROM meta_insights_daily WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM integrations_meta WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM integrations_ga WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM site_identify_mappings WHERE site_id = $1', [siteId]);

    // Delete related tables by site_key
    await pool.query('DELETE FROM web_events WHERE site_key = $1', [siteKey]);
    await pool.query('DELETE FROM purchases WHERE site_key = $1', [siteKey]);
    await pool.query('DELETE FROM recommendation_reports WHERE site_key = $1', [siteKey]);

    const result = await pool.query(
      'DELETE FROM sites WHERE id = $1 AND account_id = $2 RETURNING id',
      [siteId, auth.accountId]
    );

    if (!(result.rowCount || 0)) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Site not found' });
    }

    await pool.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Delete site error:', err);
    return res.status(500).json({ error: 'Failed to delete site' });
  }
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

  const apiBaseUrl =
    process.env.PUBLIC_API_BASE_URL ||
    `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
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

  const rules = await pool.query('SELECT rule_type, match_value, event_name, event_type FROM site_url_rules WHERE site_id = $1', [siteId]);
  const eventRules = rules.rows;

  const snippet = [
    `<script>window.TRACKING_CONFIG={apiUrl:${JSON.stringify(apiBaseUrl)},siteKey:${JSON.stringify(siteKey)},metaPixelId:${JSON.stringify(metaPixelId)},gaMeasurementId:${JSON.stringify(gaMeasurementId)},eventRules:${JSON.stringify(eventRules)}};</script>`,
    `<script async src=${JSON.stringify(sdkUrl)}></script>`,
  ].join('\n');

  return res.json({
    snippet,
    api_base_url: apiBaseUrl,
    sdk_url: sdkUrl,
    site_key: siteKey,
    meta_pixel_id: metaPixelId,
    ga_measurement_id: gaMeasurementId,
    event_rules: eventRules,
  });
});

router.get('/:siteId/event-rules', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    'SELECT * FROM site_url_rules WHERE site_id = $1 ORDER BY created_at DESC',
    [siteId]
  );
  return res.json({ rules: result.rows });
});

router.post('/:siteId/event-rules', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { rule_type, match_value, event_name, event_type } = req.body;
  if (!match_value || !event_name) return res.status(400).json({ error: 'Missing fields' });

  const result = await pool.query(
    `INSERT INTO site_url_rules (site_id, rule_type, match_value, event_name, event_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [siteId, rule_type || 'url_contains', match_value, event_name, event_type || 'custom']
  );

  return res.status(201).json({ rule: result.rows[0] });
});

router.delete('/:siteId/event-rules/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  
  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  await pool.query('DELETE FROM site_url_rules WHERE id = $1 AND site_id = $2', [id, siteId]);
  return res.json({ ok: true });
});

router.get('/:siteId/utms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const siteKey = site.rows[0].site_key;

  try {
    const query = `
      SELECT
        ARRAY_AGG(DISTINCT (custom_data->>'utm_source')) FILTER (WHERE custom_data->>'utm_source' IS NOT NULL AND custom_data->>'utm_source' != '') as sources,
        ARRAY_AGG(DISTINCT (custom_data->>'utm_medium')) FILTER (WHERE custom_data->>'utm_medium' IS NOT NULL AND custom_data->>'utm_medium' != '') as mediums,
        ARRAY_AGG(DISTINCT (custom_data->>'utm_campaign')) FILTER (WHERE custom_data->>'utm_campaign' IS NOT NULL AND custom_data->>'utm_campaign' != '') as campaigns,
        ARRAY_AGG(DISTINCT (custom_data->>'utm_content')) FILTER (WHERE custom_data->>'utm_content' IS NOT NULL AND custom_data->>'utm_content' != '') as contents,
        ARRAY_AGG(DISTINCT (custom_data->>'utm_term')) FILTER (WHERE custom_data->>'utm_term' IS NOT NULL AND custom_data->>'utm_term' != '') as terms
      FROM (
        SELECT custom_data FROM web_events 
        WHERE site_key = $1 
        ORDER BY id DESC 
        LIMIT 5000
      ) sub
    `;

    const result = await pool.query(query, [siteKey]);
    const row = result.rows[0] || {};

    return res.json({
      sources: row.sources || [],
      mediums: row.mediums || [],
      campaigns: row.campaigns || [],
      contents: row.contents || [],
      terms: row.terms || []
    });
  } catch (err) {
    console.error('Error fetching UTMs:', err);
    return res.status(500).json({ error: 'Failed to fetch UTMs' });
  }
});

router.get('/:siteId/saved-utms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    'SELECT * FROM saved_utm_links WHERE site_id = $1 ORDER BY created_at DESC',
    [siteId]
  );
  return res.json({ saved_utms: result.rows });
});

router.post('/:siteId/saved-utms', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, url_base, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });

  const result = await pool.query(
    `INSERT INTO saved_utm_links 
     (site_id, name, url_base, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [siteId, name.trim(), url_base, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id]
  );

  return res.status(201).json({ saved_utm: result.rows[0] });
});

router.delete('/:siteId/saved-utms/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);
  if (!Number.isFinite(siteId) || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  await pool.query('DELETE FROM saved_utm_links WHERE id = $1 AND site_id = $2', [id, siteId]);
  return res.json({ ok: true });
});

export default router;
