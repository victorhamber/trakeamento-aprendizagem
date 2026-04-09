import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { encryptString, decryptString } from '../lib/crypto';
import { capiService, CapiService } from '../services/capi';
import { getClientIp } from '../lib/ip';

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

/** Meta Purchase exige currency + value (Pixel / CAPI). */
const BUTTON_RULE_HREF_MAX = 500;
const BUTTON_RULE_CLASS_MAX = 200;
const BUTTON_RULE_CSS_MAX = 400;

function sanitizeButtonMatchParameters(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);
  if (typeof out.match_href_contains === 'string') {
    const t = out.match_href_contains.trim();
    out.match_href_contains = t ? clip(t, BUTTON_RULE_HREF_MAX) : undefined;
  }
  if (typeof out.match_class_contains === 'string') {
    const t = out.match_class_contains.trim();
    out.match_class_contains = t ? clip(t, BUTTON_RULE_CLASS_MAX) : undefined;
  }
  if (typeof out.match_css === 'string') {
    const t = out.match_css.trim();
    out.match_css = t ? clip(t, BUTTON_RULE_CSS_MAX) : undefined;
  }
  if (out.match_href_contains === undefined) delete out.match_href_contains;
  if (out.match_class_contains === undefined) delete out.match_class_contains;
  if (out.match_css === undefined) delete out.match_css;
  return out;
}

function buttonRuleHasMatch(match_text: unknown, parameters: unknown): boolean {
  const textOk = typeof match_text === 'string' && match_text.trim().length > 0;
  const p =
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : {};
  const hrefOk =
    typeof p.match_href_contains === 'string' && p.match_href_contains.trim().length > 0;
  const classOk =
    typeof p.match_class_contains === 'string' && p.match_class_contains.trim().length > 0;
  const cssOk = typeof p.match_css === 'string' && p.match_css.trim().length > 0;
  return textOk || hrefOk || classOk || cssOk;
}

function normalizeEventRuleParameters(
  eventName: string,
  parameters: unknown
): { ok: true; parameters: Record<string, unknown> } | { ok: false; error: string } {
  const base =
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? sanitizeButtonMatchParameters({ ...(parameters as Record<string, unknown>) })
      : {};

  if (eventName !== 'Purchase') {
    return { ok: true, parameters: base };
  }

  const rawVal = base.value;
  const num =
    typeof rawVal === 'number'
      ? rawVal
      : typeof rawVal === 'string'
        ? parseFloat(rawVal.trim())
        : NaN;
  if (!Number.isFinite(num) || num < 0) {
    return {
      ok: false,
      error:
        'Para o evento Purchase é obrigatório informar value (número maior ou igual a 0) e currency (ex.: BRL, USD).',
    };
  }

  const cur = typeof base.currency === 'string' ? base.currency.trim() : '';
  if (!/^[A-Za-z]{3}$/.test(cur)) {
    return {
      ok: false,
      error:
        'Para Purchase, currency deve ser um código ISO 4217 de 3 letras (ex.: BRL, USD).',
    };
  }

  base.value = num;
  base.currency = cur.toUpperCase();
  return { ok: true, parameters: base };
}

const buildFbp = () => `fb.1.${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(8).toString('hex')}`;
const buildFbcFromFbclid = (fbclid: string) => `fb.1.${Date.now()}.${fbclid}`;
const buildTrkToken = (externalId: string, fbc?: string | null, fbp?: string | null) =>
  `trk_${Buffer.from(`${externalId}|${fbc || ''}|${fbp || ''}`).toString('base64')}`;

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

  const accountRes = await pool.query(`
    SELECT a.bonus_site_limit, COALESCE(p.max_sites, 1) as plan_max_sites
    FROM accounts a
    LEFT JOIN plans p ON a.active_plan_id = p.id
    WHERE a.id = $1
  `, [auth.accountId]);

  const maxSites = (accountRes.rows[0]?.plan_max_sites || 1) + (accountRes.rows[0]?.bonus_site_limit || 0);

  return res.json({ sites: result.rows, max_sites: maxSites });
});

const MAX_INJECT_HTML_CHARS = 200_000;
const MAX_INJECT_NAME_CHARS = 140;
const VALID_INJECT_POS = new Set(['head', 'body']);

router.get('/:siteId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const result = await pool.query(
    'SELECT id, name, domain, site_key, created_at, inject_head_html, inject_body_html FROM sites WHERE id = $1 AND account_id = $2',
    [siteId, auth.accountId]
  );
  if (!(result.rowCount || 0)) return res.status(404).json({ error: 'Site not found' });
  return res.json({ site: result.rows[0] });
});

router.get('/:siteId/injected-snippets', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    `SELECT id, site_id, name, position, html, enabled, sort_order, created_at, updated_at
     FROM site_injected_snippets
     WHERE site_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [siteId]
  );
  return res.json({ snippets: result.rows });
});

router.post('/:siteId/injected-snippets', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const position = typeof body.position === 'string' ? body.position.trim().toLowerCase() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const enabled = body.enabled === undefined ? true : !!body.enabled;
  const sortOrderRaw = body.sort_order;
  const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Number(sortOrderRaw) : 0;

  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  if (name.length > MAX_INJECT_NAME_CHARS) return res.status(400).json({ error: `name excede ${MAX_INJECT_NAME_CHARS} caracteres` });
  if (!VALID_INJECT_POS.has(position)) return res.status(400).json({ error: "position deve ser 'head' ou 'body'" });
  if (!html || !String(html).trim()) return res.status(400).json({ error: 'html é obrigatório' });
  if (String(html).length > MAX_INJECT_HTML_CHARS) return res.status(400).json({ error: `html excede ${MAX_INJECT_HTML_CHARS} caracteres` });

  const result = await pool.query(
    `INSERT INTO site_injected_snippets (site_id, name, position, html, enabled, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, site_id, name, position, html, enabled, sort_order, created_at, updated_at`,
    [siteId, name, position, html, enabled, sortOrder]
  );
  return res.status(201).json({ snippet: result.rows[0] });
});

router.put('/:siteId/injected-snippets/:snippetId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const snippetId = Number(req.params.snippetId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!Number.isFinite(snippetId)) return res.status(400).json({ error: 'Invalid snippetId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const current = await pool.query(
    'SELECT id, site_id, name, position, html, enabled, sort_order FROM site_injected_snippets WHERE id = $1 AND site_id = $2',
    [snippetId, siteId]
  );
  if (!current.rowCount) return res.status(404).json({ error: 'Snippet not found' });

  const body = req.body || {};
  const nextName = Object.prototype.hasOwnProperty.call(body, 'name') ? String(body.name ?? '').trim() : current.rows[0].name;
  const nextPos = Object.prototype.hasOwnProperty.call(body, 'position') ? String(body.position ?? '').trim().toLowerCase() : current.rows[0].position;
  const nextHtml = Object.prototype.hasOwnProperty.call(body, 'html') ? String(body.html ?? '') : current.rows[0].html;
  const nextEnabled = Object.prototype.hasOwnProperty.call(body, 'enabled') ? !!body.enabled : current.rows[0].enabled;
  const nextSort = Object.prototype.hasOwnProperty.call(body, 'sort_order')
    ? (Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0)
    : current.rows[0].sort_order;

  if (!nextName) return res.status(400).json({ error: 'name é obrigatório' });
  if (nextName.length > MAX_INJECT_NAME_CHARS) return res.status(400).json({ error: `name excede ${MAX_INJECT_NAME_CHARS} caracteres` });
  if (!VALID_INJECT_POS.has(nextPos)) return res.status(400).json({ error: "position deve ser 'head' ou 'body'" });
  if (!nextHtml || !String(nextHtml).trim()) return res.status(400).json({ error: 'html é obrigatório' });
  if (String(nextHtml).length > MAX_INJECT_HTML_CHARS) return res.status(400).json({ error: `html excede ${MAX_INJECT_HTML_CHARS} caracteres` });

  const result = await pool.query(
    `UPDATE site_injected_snippets
     SET name = $1, position = $2, html = $3, enabled = $4, sort_order = $5, updated_at = NOW()
     WHERE id = $6 AND site_id = $7
     RETURNING id, site_id, name, position, html, enabled, sort_order, created_at, updated_at`,
    [nextName, nextPos, nextHtml, nextEnabled, nextSort, snippetId, siteId]
  );
  return res.json({ snippet: result.rows[0] });
});

router.delete('/:siteId/injected-snippets/:snippetId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const snippetId = Number(req.params.snippetId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!Number.isFinite(snippetId)) return res.status(400).json({ error: 'Invalid snippetId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    'DELETE FROM site_injected_snippets WHERE id = $1 AND site_id = $2 RETURNING id',
    [snippetId, siteId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Snippet not found' });
  return res.json({ ok: true });
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
  const providedFbc = toNullableString(body.fbc);
  const fbclid = toNullableString(body.fbclid);
  // Não gerar FBC aleatório: sem fbclid real, melhor omitir o campo.
  const fbc = providedFbc || (fbclid ? buildFbcFromFbclid(fbclid) : null);
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
    client_ip_address: getClientIp(req),
    client_user_agent: (req.headers['user-agent'] as string) || '',
    em: email ? [CapiService.hash(email.trim().toLowerCase())] : undefined,
    ph: phone ? [CapiService.hash(phone.replace(/[^0-9]/g, ''))] : undefined,
    fn: firstName && firstName.trim() !== '' ? [CapiService.hash(firstName.trim().toLowerCase())] : undefined,
    ln: lastName && lastName.trim() !== '' ? [CapiService.hash(lastName.trim().toLowerCase())] : undefined,
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
      event_source_url, user_data, custom_data, telemetry
    ) VALUES($1, $2, $3, $4, $5, $6, $7, $8)
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
    `SELECT p.id, p.order_id, p.platform, p.amount, p.currency, p.status, p.created_at, p.updated_at, p.raw_payload,
            p.buyer_email_hash, p.customer_email, p.fbp, p.fbc
     FROM purchases p
     JOIN sites s ON s.site_key = p.site_key
     WHERE s.id = $1 AND s.account_id = $2
     ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.id DESC
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

  const accountRes = await pool.query(`
    SELECT a.bonus_site_limit, COALESCE(p.max_sites, 1) as plan_max_sites
    FROM accounts a
    LEFT JOIN plans p ON a.active_plan_id = p.id
    WHERE a.id = $1
  `, [auth.accountId]);

  const maxSites = (accountRes.rows[0]?.plan_max_sites || 1) + (accountRes.rows[0]?.bonus_site_limit || 0);

  const siteCountRes = await pool.query('SELECT COUNT(*) as count FROM sites WHERE account_id = $1', [auth.accountId]);
  const siteCount = parseInt(siteCountRes.rows[0].count, 10);

  if (siteCount >= maxSites) {
    return res.status(403).json({ error: `Você atingiu o limite de ${maxSites} sites do seu plano.` });
  }

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

  const body = req.body || {};
  const { name, domain } = body;
  const cleanedName = typeof name === 'string' ? name.trim() : null;
  const cleanedDomain = typeof domain === 'string' ? domain.trim() : null;
  const hasInjectHead = Object.prototype.hasOwnProperty.call(body, 'inject_head_html');
  const hasInjectBody = Object.prototype.hasOwnProperty.call(body, 'inject_body_html');

  if (!cleanedName && !cleanedDomain && !hasInjectHead && !hasInjectBody) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const existing = await pool.query(
    'SELECT id, name, domain, site_key, created_at, inject_head_html, inject_body_html FROM sites WHERE id = $1 AND account_id = $2',
    [siteId, auth.accountId]
  );
  if (!existing.rowCount) return res.status(404).json({ error: 'Site not found' });

  const row = existing.rows[0] as {
    name: string;
    domain: string | null;
    inject_head_html: string | null;
    inject_body_html: string | null;
  };

  const nextHead = hasInjectHead ? String(body.inject_head_html ?? '') : row.inject_head_html ?? '';
  const nextBody = hasInjectBody ? String(body.inject_body_html ?? '') : row.inject_body_html ?? '';

  if (hasInjectHead && nextHead.length > MAX_INJECT_HTML_CHARS) {
    return res.status(400).json({ error: `inject_head_html excede ${MAX_INJECT_HTML_CHARS} caracteres` });
  }
  if (hasInjectBody && nextBody.length > MAX_INJECT_HTML_CHARS) {
    return res.status(400).json({ error: `inject_body_html excede ${MAX_INJECT_HTML_CHARS} caracteres` });
  }

  const next = {
    name: cleanedName ?? row.name,
    domain: cleanedDomain !== null ? cleanedDomain : row.domain,
    inject_head_html: hasInjectHead ? nextHead : row.inject_head_html,
    inject_body_html: hasInjectBody ? nextBody : row.inject_body_html,
  };

  const result = await pool.query(
    `UPDATE sites
     SET name = $1, domain = $2, inject_head_html = $3, inject_body_html = $4
     WHERE id = $5 AND account_id = $6
     RETURNING id, name, domain, site_key, created_at, inject_head_html, inject_body_html`,
    [next.name, next.domain || null, next.inject_head_html, next.inject_body_html, siteId, auth.accountId]
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
  const loaderUrl = `${apiBaseUrl}/sdk/loader.js`;
  const siteKey = site.rows[0].site_key as string;

  const snippetPerformance = `<script defer src="${loaderUrl}?key=${encodeURIComponent(siteKey)}"></script>`;
  const snippetImmediate = `<script defer src="${sdkUrl}?key=${encodeURIComponent(siteKey)}"></script>`;

  return res.json({
    // snippet = performance (compatível com clientes que só leem `snippet`)
    snippet: snippetPerformance,
    snippet_performance: snippetPerformance,
    snippet_immediate: snippetImmediate,
    api_base_url: apiBaseUrl,
    sdk_url: sdkUrl,
    loader_url: loaderUrl,
    site_key: siteKey
  });
});

router.get('/:siteId/event-rules', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const result = await pool.query(
    'SELECT id, site_id, rule_type, match_value, match_text, event_name, event_type, parameters, created_at FROM site_url_rules WHERE site_id = $1 ORDER BY created_at DESC',
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

  const { rule_type, match_value, match_text, event_name, event_type, parameters } = req.body;
  if (!match_value || !event_name) return res.status(400).json({ error: 'Missing fields' });
  if (rule_type === 'button_click' && !buttonRuleHasMatch(match_text, parameters)) {
    return res.status(400).json({
      error:
        'Regra de botão: informe texto do botão OU destino (href contém) OU classe OU seletor CSS (estilo Meta).',
    });
  }

  const paramNorm = normalizeEventRuleParameters(event_name, parameters);
  if (!paramNorm.ok) return res.status(400).json({ error: paramNorm.error });

  const result = await pool.query(
    `INSERT INTO site_url_rules (site_id, rule_type, match_value, match_text, event_name, event_type, parameters)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      siteId,
      rule_type || 'url_contains',
      match_value,
      match_text || null,
      event_name,
      event_type || 'custom',
      paramNorm.parameters,
    ]
  );

  return res.status(201).json({ rule: result.rows[0] });
});

router.put('/:siteId/event-rules/:id', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const id = Number(req.params.id);

  const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!site.rowCount) return res.status(404).json({ error: 'Site not found' });

  const { rule_type, match_value, match_text, event_name, event_type, parameters } = req.body;
  if (!match_value || !event_name) return res.status(400).json({ error: 'Missing fields' });
  if (rule_type === 'button_click' && !buttonRuleHasMatch(match_text, parameters)) {
    return res.status(400).json({
      error:
        'Regra de botão: informe texto do botão OU destino (href contém) OU classe OU seletor CSS (estilo Meta).',
    });
  }

  const paramNorm = normalizeEventRuleParameters(event_name, parameters);
  if (!paramNorm.ok) return res.status(400).json({ error: paramNorm.error });

  const result = await pool.query(
    `UPDATE site_url_rules
     SET rule_type = $1, match_value = $2, match_text = $3, event_name = $4, event_type = $5, parameters = $6
     WHERE id = $7 AND site_id = $8
     RETURNING *`,
    [
      rule_type || 'url_contains',
      match_value,
      match_text || null,
      event_name,
      event_type || 'custom',
      paramNorm.parameters,
      id,
      siteId,
    ]
  );

  if (!result.rowCount) return res.status(404).json({ error: 'Rule not found' });

  return res.json({ rule: result.rows[0] });
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
    'SELECT id, site_id, name, url_base, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, created_at FROM saved_utm_links WHERE site_id = $1 ORDER BY created_at DESC',
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

  const result = await pool.query('SELECT id, site_id, site_key, name, secret_key, mapping_config, is_active, created_at, updated_at FROM custom_webhooks WHERE site_id = $1 ORDER BY created_at DESC', [siteId]);
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

// ─── Buyers (Compradores) ────────────────────────────────────────────────────

const APPROVED_PURCHASE_STATUSES = `('approved', 'paid', 'completed', 'active')`;

/**
 * Lista compradores (best-effort) baseado em `purchases` + `site_visitors`.
 * Observação: a identidade pode vir de email_hash, fbp/fbc ou external_id.
 */
router.get('/:siteId/buyers', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

  const siteRes = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!siteRes.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = String(siteRes.rows[0].site_key);

  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  try {
    const result = await pool.query(
      `
      WITH pf AS (
        SELECT
          p.id,
          p.site_key,
          COALESCE(p.platform_date, p.created_at) AS purchased_at,
          p.amount,
          p.currency,
          p.order_id,
          p.platform,
          p.buyer_email_hash,
          p.fbp,
          p.fbc
        FROM purchases p
        WHERE p.site_key = $1
          AND p.status IN ${APPROVED_PURCHASE_STATUSES}
      ),
      buyers AS (
        SELECT
          COALESCE(buyer_email_hash, fbp, fbc, order_id) AS buyer_key,
          MAX(purchased_at) AS last_purchase_at,
          COUNT(*)::int AS purchases_count,
          COALESCE(SUM(amount), 0)::numeric AS revenue
        FROM pf
        GROUP BY 1
      ),
      enriched AS (
        SELECT
          b.*,
          v.external_id,
          v.email_hash,
          v.fbp AS v_fbp,
          v.fbc AS v_fbc
        FROM buyers b
        LEFT JOIN site_visitors v
          ON v.site_key = $1
          AND (
            (v.email_hash IS NOT NULL AND v.email_hash = b.buyer_key)
            OR (v.fbp IS NOT NULL AND v.fbp = b.buyer_key)
            OR (v.fbc IS NOT NULL AND v.fbc = b.buyer_key)
          )
      )
      SELECT
        buyer_key,
        external_id,
        purchases_count,
        revenue,
        last_purchase_at
      FROM enriched
      ORDER BY last_purchase_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
      `,
      [siteKey, limit, offset]
    );

    return res.json({ buyers: result.rows });
  } catch (err) {
    console.error('Buyers list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Detalhe do comprador por external_id.
 * Retorna compras e comportamento pré-compra (PageView) + melhor atribuição por UTMs (quando existirem).
 */
router.get('/:siteId/buyers/:externalId', requireAuth, async (req, res) => {
  const auth = req.auth!;
  const siteId = Number(req.params.siteId);
  const externalId = String(req.params.externalId || '').trim();
  if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
  if (!externalId) return res.status(400).json({ error: 'Invalid externalId' });

  const siteRes = await pool.query('SELECT site_key FROM sites WHERE id = $1 AND account_id = $2', [siteId, auth.accountId]);
  if (!siteRes.rowCount) return res.status(404).json({ error: 'Site not found' });
  const siteKey = String(siteRes.rows[0].site_key);

  try {
    const visitorRes = await pool.query(
      `SELECT site_key, external_id, email_hash, fbp, fbc, last_seen_at, last_traffic_source
       FROM site_visitors
       WHERE site_key = $1 AND external_id = $2
       LIMIT 1`,
      [siteKey, externalId]
    );
    if (!visitorRes.rowCount) return res.status(404).json({ error: 'Buyer not found' });
    const v = visitorRes.rows[0];

    const purchasesRes = await pool.query(
      `SELECT
        id, order_id, platform, amount, currency, status,
        COALESCE(platform_date, created_at) AS purchased_at
       FROM purchases
       WHERE site_key = $1
         AND status IN ${APPROVED_PURCHASE_STATUSES}
         AND (
           ($2::text IS NOT NULL AND buyer_email_hash = $2)
           OR ($3::text IS NOT NULL AND fbp = $3)
           OR ($4::text IS NOT NULL AND fbc = $4)
         )
       ORDER BY COALESCE(platform_date, created_at) DESC
       LIMIT 50`,
      [siteKey, v.email_hash || null, v.fbp || null, v.fbc || null]
    );

    const lookbackDays = Math.min(60, Math.max(1, Number(req.query.lookback_days || 30)));
    const eventsRes = await pool.query(
      `SELECT
        event_name,
        event_time,
        event_source_url,
        custom_data
       FROM web_events
       WHERE site_key = $1
         AND user_data->>'external_id' = $2
         AND event_time >= NOW() - ($3::int || ' days')::interval
         AND event_name IN ('PageView', 'PageEngagement', 'Purchase', 'Lead', 'InitiateCheckout')
       ORDER BY event_time DESC
       LIMIT 2000`,
      [siteKey, externalId, lookbackDays]
    );

    // Pré-compra: contar PageView antes da última compra e top páginas.
    const lastPurchaseAt = purchasesRes.rows[0]?.purchased_at ? new Date(purchasesRes.rows[0].purchased_at) : null;
    const pvBefore: Record<string, number> = {};
    let pvCountBefore = 0;
    let lastTouchUtm: Record<string, string> | null = null;
    if (lastPurchaseAt) {
      for (const e of eventsRes.rows) {
        const t = new Date(e.event_time);
        if (t.getTime() >= lastPurchaseAt.getTime()) continue;
        if (e.event_name === 'PageView' && typeof e.event_source_url === 'string' && e.event_source_url) {
          pvCountBefore += 1;
          pvBefore[e.event_source_url] = (pvBefore[e.event_source_url] || 0) + 1;
          if (!lastTouchUtm && e.custom_data && typeof e.custom_data === 'object') {
            const cd = e.custom_data as any;
            const pick = (k: string) => (typeof cd[k] === 'string' ? cd[k] : '');
            const utm_source = pick('utm_source');
            const utm_medium = pick('utm_medium');
            const utm_campaign = pick('utm_campaign');
            const utm_content = pick('utm_content');
            const utm_term = pick('utm_term');
            const click_id = pick('click_id');
            if (utm_source || utm_campaign || utm_content || click_id) {
              lastTouchUtm = { utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id };
            }
          }
        }
      }
    }

    const topPages = Object.entries(pvBefore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([url, count]) => ({ url, count }));

    // Melhor esforço de atribuição (quando utm_content = ad_id e utm_campaign = campaign_name).
    let attribution: any = null;
    if (lastTouchUtm && lastTouchUtm.utm_content && /^\d+$/.test(lastTouchUtm.utm_content)) {
      try {
        const metaRes = await pool.query(
          `SELECT campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name
           FROM meta_insights_daily
           WHERE site_id = $1
             AND ad_id = $2
           ORDER BY date_start DESC
           LIMIT 1`,
          [siteId, lastTouchUtm.utm_content]
        );
        if (metaRes.rowCount) attribution = metaRes.rows[0];
      } catch {
        attribution = null;
      }
    }

    return res.json({
      buyer: {
        external_id: v.external_id,
        email_hash: v.email_hash,
        fbp: v.fbp,
        fbc: v.fbc,
        last_seen_at: v.last_seen_at,
        last_traffic_source: v.last_traffic_source,
      },
      purchases: purchasesRes.rows,
      behavior: {
        lookback_days: lookbackDays,
        pageviews_before_last_purchase: pvCountBefore,
        top_pages_before_last_purchase: topPages,
        last_touch: lastTouchUtm,
        meta_attribution: attribution,
      },
      events: eventsRes.rows,
    });
  } catch (err) {
    console.error('Buyer detail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
