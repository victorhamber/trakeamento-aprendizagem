import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString, decryptString } from '../lib/crypto';
import { capiService, CapiService } from '../services/capi';

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

const buildFbp = () => `fb.1.${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(8).toString('hex')}`;
const buildFbc = () => `fb.1.${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(8).toString('hex')}`;
const buildTrkToken = (externalId: string, fbc: string, fbp: string) =>
  `trk_${Buffer.from(`${externalId}|${fbc}|${fbp}`).toString('base64')}`;

const toNullableString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

router.get('/:siteId/checkout-simulator', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query('SELECT checkout_url FROM checkout_simulators WHERE site_id = $1', [siteId]);
  return res.json({ checkout_url: result.rows[0]?.checkout_url || null });
});

router.put('/:siteId/checkout-simulator', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const { checkout_url } = req.body || {};
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const cleaned = toNullableString(checkout_url);
  if (cleaned) {
    try {
      new URL(cleaned);
    } catch {
      return res.status(400).json({ error: 'Invalid checkout_url' });
    }
  }

  await pool.query(
    `INSERT INTO checkout_simulators (site_id, checkout_url)
     VALUES ($1, $2)
     ON CONFLICT (site_id) DO UPDATE SET checkout_url = EXCLUDED.checkout_url, updated_at = NOW()`,
    [siteId, cleaned]
  );

  return res.json({ ok: true, checkout_url: cleaned });
});

router.post('/:siteId/checkout-simulator/generate', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const stored = await pool.query('SELECT checkout_url FROM checkout_simulators WHERE site_id = $1', [siteId]);
  const body = req.body || {};
  const checkoutUrl = toNullableString(body.checkout_url) || stored.rows[0]?.checkout_url;
  if (!checkoutUrl) return res.status(400).json({ error: 'Missing checkout_url' });

  let url: URL;
  try {
    url = new URL(checkoutUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid checkout_url' });
  }

  const externalId = toNullableString(body.external_id) || `lead_${randomKey(8)}`;
  const fbp = toNullableString(body.fbp) || buildFbp();
  const fbc = toNullableString(body.fbc) || buildFbc();
  const trkToken = buildTrkToken(externalId, fbc, fbp);

  const params: Record<string, string | null> = {
    utm_source: toNullableString(body.utm_source),
    utm_medium: toNullableString(body.utm_medium),
    utm_campaign: toNullableString(body.utm_campaign),
    utm_content: toNullableString(body.utm_content),
    utm_term: toNullableString(body.utm_term),
    fbp,
    fbc,
    sck: trkToken,
    src: trkToken,
  };

  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  return res.json({
    generated_url: url.toString(),
    fbp,
    fbc,
    external_id: externalId,
    trk: trkToken,
  });
});

router.post('/:siteId/checkout-simulator/lead', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = site.rows[0].site_key as string;

  const body = req.body || {};
  const email = toNullableString(body.email);
  const phone = toNullableString(body.phone);
  const firstName = toNullableString(body.first_name);
  const lastName = toNullableString(body.last_name);
  const fbp = toNullableString(body.fbp);
  const fbc = toNullableString(body.fbc);
  const externalId = toNullableString(body.external_id);
  const eventSourceUrl = toNullableString(body.event_source_url) || '';
  const value = toNumberOrNull(body.value);
  const currency = toNullableString(body.currency) || 'BRL';

  const eventTimeSec = Math.floor(Date.now() / 1000);
  const eventId = `lead_${eventTimeSec}_${crypto.randomBytes(3).toString('hex')}`;

  const userData = {
    client_ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '',
    client_user_agent: (req.headers['user-agent'] as string) || '',
    em: email ? CapiService.hash(email) : undefined,
    ph: phone ? CapiService.hash(phone.replace(/[^0-9]/g, '')) : undefined,
    fn: firstName ? CapiService.hash(firstName.toLowerCase()) : undefined,
    ln: lastName ? CapiService.hash(lastName.toLowerCase()) : undefined,
    fbp: fbp || undefined,
    fbc: fbc || undefined,
    external_id: externalId ? CapiService.hash(externalId) : undefined,
  };

  const customData: Record<string, unknown> = { content_type: 'product' };
  if (value !== null) customData.value = value;
  if (currency) customData.currency = currency;

  await pool.query(
    `INSERT INTO web_events(
      site_key, event_id, event_name, event_time,
      event_source_url, user_data, custom_data, telemetry, raw_payload
    ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT(site_key, event_id) DO NOTHING`,
    [
      siteKey,
      eventId,
      'Lead',
      new Date(eventTimeSec * 1000),
      eventSourceUrl,
      userData,
      customData,
      null,
      { event_name: 'Lead', event_id: eventId, event_time: eventTimeSec, event_source_url: eventSourceUrl, user_data: userData, custom_data: customData },
    ]
  );

  capiService.sendEvent(siteKey, {
    event_name: 'Lead',
    event_time: eventTimeSec,
    event_id: eventId,
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: customData,
  }).catch(() => { });

  await pool.query(
    `UPDATE integrations_meta i
     SET last_ingest_at = NOW(),
         last_ingest_event_name = $1,
         last_ingest_event_id = $2,
         last_ingest_event_source_url = $3
     FROM sites s
     WHERE s.site_key = $4 AND i.site_id = s.id`,
    ['Lead', eventId, eventSourceUrl, siteKey]
  );

  return res.json({ ok: true, event_id: eventId });
});

router.get('/:siteId/checkout-simulator/webhooks', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const limitRaw = Number(req.query.limit || 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

  const result = await pool.query(
    `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, p.status, p.created_at, p.raw_payload
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.id = $1 AND s.account_id = $2
     ORDER BY p.created_at DESC
     LIMIT $3`,
    [siteId, auth.accountId, limit]
  );

  return res.json({ logs: result.rows });
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

    // Use ON DELETE CASCADE for tables mapped by site_id.
    // For tables mapped by site_key (which might not have a foreign key to sites.id), delete them in parallel.
    await Promise.all([
      pool.query('DELETE FROM web_events WHERE site_key = $1', [siteKey]),
      pool.query('DELETE FROM purchases WHERE site_key = $1', [siteKey]),
      pool.query('DELETE FROM recommendation_reports WHERE site_key = $1', [siteKey])
    ]);

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

router.post('/:siteId/webhooks/test', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const { platform, email } = req.body;
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = site.rows[0].site_key;

  let payload: any = {};
  const orderId = `test_${crypto.randomBytes(4).toString('hex')}`;
  const testEmail = email || 'test@example.com';

  if (platform === 'hotmart') {
    payload = {
      hottok: 'test_token',
      product: { id: 12345, name: 'Test Product' },
      buyer: { email: testEmail, name: 'Test Buyer', phone: '5511999999999' },
      purchase: { transaction: orderId, status: 'APPROVED', full_price: { value: 97.00, currency_value: 'BRL' } }
    };
  } else if (platform === 'kiwify') {
    payload = {
      webhook_event_type: 'order_approved',
      order: { order_id: orderId, status: 'paid', payment: { total: 9700, currency: 'BRL' } },
      Customer: { email: testEmail, first_name: 'Test', last_name: 'Buyer', mobile: '5511999999999' }
    };
  } else if (platform === 'eduzz') {
    payload = {
      eduzz_id: 123,
      transacao_id: orderId,
      transacao_status_id: 3,
      transacao_valor: 97.00,
      transacao_moeda: 'BRL',
      cus_email: testEmail,
      cus_name: 'Test Buyer',
      cus_cel: '5511999999999'
    };
  } else {
    payload = {
      id: orderId,
      status: 'approved',
      amount: 97.00,
      currency: 'BRL',
      email: testEmail,
      first_name: 'Test',
      last_name: 'Buyer',
      phone: '5511999999999'
    };
  }

  // Enviar a requisição para o próprio servidor (simulando a chegada do webhook)
  try {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const webhookUrl = `${protocol}://${host}/webhooks/purchase?key=${siteKey}`;

    // Fire and forget
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(console.error);

    return res.json({ ok: true, message: 'Webhook event dispatched to ' + webhookUrl, payload });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dispatch webhook' });
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
    `INSERT INTO sites (account_id, name, domain, tracking_domain, site_key, webhook_secret_enc)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, domain, site_key, created_at`,
    [
      auth.accountId,
      name.trim(),
      typeof domain === 'string' ? domain.trim() : null,
      null,
      siteKey,
      webhookSecretEnc,
    ]
  );

  return res.status(201).json({ site: result.rows[0], webhook_secret: webhookSecretPlain });
});

router.put('/:siteId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const { name, domain } = req.body || {};
  const cleanedName = typeof name === 'string' ? name.trim() : null;
  const cleanedDomain = typeof domain === 'string' ? domain.trim() : null;

  if (!cleanedName && !cleanedDomain) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const existing = await pool.query(
    'SELECT id, name, domain, site_key, created_at FROM sites WHERE id = $1 AND account_id = $2',
    [siteId, auth.accountId]
  );
  if (!existing.rowCount) return res.status(404).json({ error: 'Site not found' });

  const next = {
    name: cleanedName ?? existing.rows[0].name,
    domain: cleanedDomain !== null ? cleanedDomain : existing.rows[0].domain,
  };

  const result = await pool.query(
    `UPDATE sites
     SET name = $1, domain = $2
     WHERE id = $3 AND account_id = $4
     RETURNING id, name, domain, site_key, created_at`,
    [next.name, next.domain || null, siteId, auth.accountId]
  );

  return res.json({ site: result.rows[0] });
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

// ─── Custom Webhooks ───

router.get('/:siteId/custom-webhooks', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query('SELECT * FROM custom_webhooks WHERE site_id = $1 ORDER BY created_at DESC', [siteId]);
  return res.json({ webhooks: result.rows });
});

router.post('/:siteId/custom-webhooks', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = site.rows[0].site_key;

  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });

  const secretKey = crypto.randomBytes(32).toString('hex');

  const result = await pool.query(
    'INSERT INTO custom_webhooks (site_id, site_key, name, secret_key) VALUES ($1, $2, $3, $4) RETURNING *',
    [siteId, siteKey, name, secretKey]
  );
  return res.status(201).json({ webhook: result.rows[0] });
});

router.put('/:siteId/custom-webhooks/:hookId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const hookId = req.params.hookId;
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { name, is_active, mapping_config } = req.body;

  const result = await pool.query(
    `UPDATE custom_webhooks 
     SET name = COALESCE($1, name), 
         is_active = COALESCE($2, is_active), 
         mapping_config = COALESCE($3, mapping_config),
         updated_at = NOW()
     WHERE id = $4 AND site_id = $5 
     RETURNING *`,
    [name, is_active !== undefined ? is_active : null, mapping_config ? JSON.stringify(mapping_config) : null, hookId, siteId]
  );

  if (!result.rowCount) return res.status(404).json({ error: 'Webhook not found' });
  return res.json({ webhook: result.rows[0] });
});

router.delete('/:siteId/custom-webhooks/:hookId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const hookId = req.params.hookId;
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  await pool.query('DELETE FROM custom_webhooks WHERE id = $1 AND site_id = $2', [hookId, siteId]);
  return res.json({ ok: true });
});

export default router;
