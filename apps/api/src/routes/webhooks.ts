import geoip from 'geoip-lite';
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { capiService, CapiService } from '../services/capi';
import { EnrichmentService } from '../services/enrichment';
import { decryptString } from '../lib/crypto';
import { notifyAccountNewSale } from '../services/expo-push';
import { notifyAccountWebPushSale } from '../services/web-push-notify';
import { DDI_LIST } from '../lib/ddi';

const router = Router();

const normalizeStatus = (rawStatus: unknown) => {
  const s = String(rawStatus || '').toLowerCase().trim();

  // Status que indicam compra aprovada/confirmada (Somam no Dashboard)
  const approvedStatuses = [
    'approved', 'completed', 'complete', 'paid', 'active',
    'approved_by_acquirer', 'purchase_complete', 'confirmed',
  ];

  // Status de Boleto/PIX Aguardando (NÃO somam no Dashboard, mas enviam CAPI)
  const pendingStatuses = [
    'waiting_payment', 'pending', 'pending_payment'
  ];

  // Status que indicam reembolso/cancelamento — NÃO gerar Purchase CAPI
  const refundStatuses = [
    'refunded', 'refund', 'cancelled', 'canceled', 'dispute',
    'chargeback', 'chargedback', 'expired', 'blocked',
    'purchase_refunded', 'purchase_chargeback', 'purchase_canceled',
    'purchase_expired', 'purchase_protest', 'purchase_delayed',
  ];

  if (refundStatuses.includes(s)) {
    return { finalStatus: s, isApproved: false, sendToCapi: false };
  }

  if (pendingStatuses.includes(s)) {
    return { finalStatus: 'pending_payment', isApproved: false, sendToCapi: true };
  }

  if (approvedStatuses.includes(s)) {
    return { finalStatus: 'approved', isApproved: true, sendToCapi: true };
  }

  // Status desconhecido — trata como pendente por segurança para não inflar dashboard
  console.warn(`[Webhook] Unknown status "${s}" — treating as pending_payment.`);
  return { finalStatus: 'pending_payment', isApproved: false, sendToCapi: true };
};

// ─── Core Ingestion Engine for all Webhooks ──────────────────────────────────
async function processPurchaseWebhook({
  siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
  fbp, fbc, externalId, clientIp, clientUa, value, currency, status, orderId, platform, contentName,
  purchaseTimestamp,
}: any) {
  const { finalStatus, sendToCapi } = normalizeStatus(status);
  const platformDate = purchaseTimestamp ? new Date(purchaseTimestamp) : null;

  console.log(`[Webhook] processPurchaseWebhook called: value=${value} currency=${currency} status=${finalStatus} orderId=${orderId} platform=${platform} siteKey=${siteKey}`);

  // Fetch site settings (Pixel, Token)
  const siteRes = await pool.query(
    `SELECT sites.id, sites.account_id, m.capi_token_enc, m.pixel_id, m.capi_test_event_code, m.enabled as meta_enabled
     FROM sites 
     LEFT JOIN integrations_meta m ON m.site_id = sites.id
     WHERE sites.site_key = $1`,
    [siteKey]
  );

  if (!siteRes.rowCount) {
    console.error(`[Webhook] Site not found for key: ${siteKey}`);
    return { success: false, status: 404, error: 'Site not found' };
  }

  const { account_id: siteAccountId, pixel_id, capi_token_enc, capi_test_event_code, meta_enabled: metaEnabled } = siteRes.rows[0];
  const capiToken = capi_token_enc ? decryptString(capi_token_enc) : null;

  // 1. Enrichment: Missing attribution data or geolocation
  let enriched = null;
  if (!fbp || !fbc || !clientIp || !clientUa || (!city && !state)) {
    enriched = await EnrichmentService.findVisitorData(siteKey, email, phone, externalId, { ip: clientIp, country });
    if (enriched) {
      console.log(`[Webhook] Enrichment success: found fbp=${!!enriched.fbp}, fbc=${!!enriched.fbc}, ip=${!!enriched.clientIp}, city=${!!enriched.city}`);
    }
  }

  const mergedFbp = fbp || enriched?.fbp;
  const mergedFbc = fbc || enriched?.fbc;
  const mergedIp = clientIp || enriched?.clientIp;
  const mergedUa = clientUa || enriched?.clientUa;
  const mergedExternalId = externalId || enriched?.externalId || (email ? CapiService.hash(email) : undefined);

  // Location recovery: Priority Webhook > Enriched (history) > GeoIP (current IP)
  let finalCity = city || enriched?.city;
  let finalState = state || enriched?.state;
  if ((!finalCity || !finalState) && mergedIp) {
    const geo = geoip.lookup(mergedIp);
    if (geo) {
      if (!finalCity) finalCity = geo.city;
      if (!finalState) finalState = geo.region;
    }
  }

  // UTMs priority
  const utmSource = payload.utm_source || payload.trackingParameters?.utm_source || payload.tracking_parameters?.utm_source || (payload.sck && !String(payload.sck).startsWith('trk_') ? payload.sck : undefined) || (payload.src && !String(payload.src).startsWith('trk_') ? payload.src : undefined) || enriched?.utmSource || undefined;
  const utmMedium = payload.utm_medium || payload.trackingParameters?.utm_medium || payload.tracking_parameters?.utm_medium || enriched?.utmMedium || undefined;
  const utmCampaign = payload.utm_campaign || payload.trackingParameters?.utm_campaign || payload.tracking_parameters?.utm_campaign || enriched?.utmCampaign || undefined;

  // 2. CAPI Payload
  const capiPayload: any = {
    event_name: 'Purchase',
    event_time: Math.floor((platformDate?.getTime() || Date.now()) / 1000),
    event_id: `purchase_${orderId}`,
    event_source_url: payload.page_url || payload.referrer || undefined,
    action_source: 'website',
    user_data: {
      client_ip_address: mergedIp,
      client_user_agent: mergedUa,
      em: email ? [CapiService.hash(email.toLowerCase())] : undefined,
      ph: phone ? [(() => {
        let p = phone.replace(/[^0-9]/g, '');
        if (p.length >= 10 && p.length <= 11) {
          let iso = (country || '').toUpperCase().trim();
          if (!iso && mergedIp) {
            const geo = geoip.lookup(mergedIp);
            if (geo?.country) iso = geo.country;
          }
          const targetCountry = iso || 'BR';
          const ddi = DDI_LIST.find(d => d.country === targetCountry)?.code;
          if (ddi && !p.startsWith(ddi)) p = ddi + p;
          else if (targetCountry === 'BR' && !p.startsWith('55')) p = '55' + p;
        }
        return CapiService.hash(p);
      })()] : undefined,
      fn: firstName ? [CapiService.hash(firstName.toLowerCase())] : undefined,
      ln: lastName ? [CapiService.hash(lastName.toLowerCase())] : undefined,
      ct: finalCity ? [CapiService.hash(finalCity.toLowerCase())] : undefined,
      st: finalState ? [CapiService.hash(finalState.toLowerCase())] : undefined,
      zp: zip ? [CapiService.hash(zip.replace(/\s+/g, '').toLowerCase())] : undefined,
      country: country ? [CapiService.hash(country.toLowerCase())] : undefined,
      fbc: mergedFbc,
      fbp: mergedFbp,
      external_id: mergedExternalId ? [CapiService.hash(String(mergedExternalId))] : undefined,
    },
    custom_data: {
      value: Number(value) || 0,
      currency: (currency || 'BRL').toUpperCase(),
      content_name: contentName || undefined,
      content_type: 'product',
      utm_source: utmSource || undefined,
      utm_medium: utmMedium || undefined,
      utm_campaign: utmCampaign || undefined,
    },
  };

  if (capi_test_event_code) capiPayload.test_event_code = capi_test_event_code;

  // 3. Database Persistence
  const dbEmailHash = email ? CapiService.hash(email.toLowerCase()) : null;
  if (dbEmailHash || mergedFbp) {
    const visitorExtId = mergedExternalId ? CapiService.hash(String(mergedExternalId)) : (dbEmailHash || `buyer_${orderId}`);
    pool.query(`
      INSERT INTO site_visitors (
        site_key, external_id, fbc, fbp, email_hash, phone_hash,
        total_events, last_event_name, last_ip, last_user_agent, city, state, last_traffic_source
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'Purchase', $7, $8, $9, $10, $11)
      ON CONFLICT (site_key, external_id) DO UPDATE SET
        fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
        fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
        email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
        last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
        city = COALESCE(EXCLUDED.city, site_visitors.city),
        state = COALESCE(EXCLUDED.state, site_visitors.state),
        last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
        total_events = site_visitors.total_events + 1,
        last_seen_at = NOW()
    `, [siteKey, visitorExtId, mergedFbc, mergedFbp, dbEmailHash, null, mergedIp, mergedUa, finalCity, finalState, utmSource])
    .catch(err => console.error('[Webhook] Visitor UPSERT error:', err));
  }

  await pool.query(`
    INSERT INTO purchases (
      site_key, order_id, platform, amount, currency, status, 
      customer_email, customer_phone, customer_name,
      fbc, fbp, external_id, utm_source, utm_medium, utm_campaign,
      platform_date, user_data, custom_data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (order_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      platform_date = EXCLUDED.platform_date
  `, [
    siteKey, orderId, platform, value, currency, finalStatus,
    email, phone, `${firstName || ''} ${lastName || ''}`.trim(),
    mergedFbc, mergedFbp, mergedExternalId, utmSource, utmMedium, utmCampaign,
    platformDate, JSON.stringify(capiPayload.user_data), JSON.stringify(capiPayload.custom_data)
  ]);

  // 4. Dispatch
  if (sendToCapi && metaEnabled && pixel_id && capiToken) {
    capiService.sendEvent(siteKey, capiPayload).catch(err => console.error(`[Webhook] CAPI error for ${orderId}:`, err));
  }

  if (sendToCapi && siteAccountId) {
    const isBoleto = finalStatus === 'pending_payment';
    const title = isBoleto ? 'Boleto/PIX Gerado' : 'Venda Aprovada! 🚀';
    const body = `${contentName || 'Produto'} - ${currency} ${value} (${platform})`;

    pool.query('SELECT push_token, platform FROM push_tokens WHERE account_id = $1', [siteAccountId])
      .then(res => {
        if (res.rows.length > 0) notifyAccountNewSale(res.rows, { amount: value, currency, orderId, platform, productName: contentName });
      }).catch(() => {});
    
    notifyAccountWebPushSale(siteAccountId, { amount: value, currency, orderId, platform, productName: contentName }).catch(() => {});
  }

  return { success: true };
}

router.post('/purchase', async (req, res) => {
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
  const rawBody = req.body;
  if (!rawBody) return res.status(400).json({ error: 'Empty payload' });

  const siteKey = (req.headers['x-site-key'] as string) || (req.query.key as string);
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });

  const token = req.query.token as string | undefined;
  if (token) {
    const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
    if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });
    const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
    if (token !== secret) return res.status(401).json({ error: 'Invalid token' });
  } else {
    if (!signature || !timestamp) return res.status(401).json({ error: 'Missing signature' });
    const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
    if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });
    const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString()}`).digest('hex');
    if (expected !== signature) return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try { payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody; } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }

  const fbp = payload.fbp || payload.custom_args?.fbp || payload.data?.fbp;
  const fbc = payload.fbc || payload.custom_args?.fbc || payload.data?.fbc;

  let platform = 'generic', email, firstName, lastName, phone, value, currency, status, orderId, city, state, zip, country, dob, contentName, purchaseTimestamp;

  if (payload.hottok || payload.data?.hottok || payload.buyer?.email || payload.data?.buyer?.email) {
    platform = 'hotmart';
    const d = payload.data || payload;
    const buyer = d.buyer || payload.buyer || {};
    const purchase = d.purchase || payload.purchase || {};
    email = buyer.email;
    firstName = buyer.first_name || buyer.name?.split(' ')[0];
    lastName = buyer.last_name || buyer.name?.split(' ').slice(1).join(' ');
    phone = buyer.checkout_phone || buyer.phone;
    value = purchase.full_price?.value ?? purchase.price?.value ?? d.amount ?? 0;
    currency = purchase.full_price?.currency_value ?? purchase.price?.currency_value ?? d.currency ?? 'BRL';
    status = purchase.status || payload.status || payload.event;
    orderId = purchase.transaction || payload.id;
    city = buyer.address?.city;
    state = buyer.address?.state;
    zip = buyer.address?.zipCode;
    country = buyer.address?.country || buyer.checkout_country?.iso;
    contentName = (payload.product || d.product)?.name;
  } else if (payload.webhook_event_type || payload.Customer) {
    platform = 'kiwify';
    const customer = payload.Customer || payload.customer || {};
    email = customer.email;
    firstName = customer.first_name || customer.name?.split(' ')[0];
    lastName = customer.last_name || customer.name?.split(' ').slice(1).join(' ');
    phone = customer.mobile || customer.phone;
    value = payload.order?.payment?.total || payload.amount || 0;
    if (value > 1000) value = value / 100;
    currency = payload.order?.payment?.currency || payload.currency || 'BRL';
    status = payload.order?.status || payload.status;
    orderId = payload.order?.order_id || payload.order_id || payload.id;
    city = customer.city;
    state = customer.state;
    zip = customer.zipcode;
    country = customer.country;
    contentName = payload.Product?.name || payload.product_name;
    purchaseTimestamp = payload.order?.created_at || payload.created_at;
  } else {
    email = payload.email || payload.buyer_email;
    firstName = payload.first_name || payload.name?.split(' ')[0];
    lastName = payload.last_name || payload.name?.split(' ').slice(1).join(' ');
    phone = payload.phone || payload.buyer_phone;
    city = payload.city || payload.buyer_city;
    state = payload.state || payload.buyer_state;
    zip = payload.zip || payload.cep;
    country = payload.country || payload.pais;
    value = payload.amount || payload.value || payload.price || 0;
    currency = payload.currency || 'BRL';
    status = payload.status;
    orderId = payload.id || payload.order_id || `web_${Date.now()}`;
    contentName = payload.product_name || payload.product;
    purchaseTimestamp = payload.created_at || payload.date;
  }

  const result = await processPurchaseWebhook({ siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob, fbp, fbc, value, currency, status, orderId, platform, contentName, purchaseTimestamp });
  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

router.post('/hotmart', async (req, res) => {
  const siteKey = req.query.key as string;
  const token = req.query.token as string;
  if (!siteKey || !token) return res.status(400).json({ error: 'Missing key or token' });

  const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
  if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });

  const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
  if (token !== secret) return res.status(401).json({ error: 'Invalid token' });

  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid payload' });

  const d = payload.data || payload;
  const buyer = d.buyer || payload.buyer || {};
  const purchase = d.purchase || payload.purchase || {};
  const trackingObj = d.tracking || payload.tracking || {};
  const origin = purchase.origin || trackingObj || {};

  const email = buyer.email || payload.email;
  const firstName = buyer.first_name || buyer.name?.split(' ')[0];
  const lastName = buyer.last_name || buyer.name?.split(' ').slice(1).join(' ');
  const phone = buyer.checkout_phone || buyer.phone;

  const commissions = d.commissions || payload.data?.commissions || [];
  let rawValue = purchase.full_price?.value ?? purchase.price?.value ?? purchase.amount ?? purchase.total ?? d.amount ?? 0;
  let currency = purchase.full_price?.currency_value || purchase.price?.currency_value || d.currency || 'BRL';

  if (Array.isArray(commissions) && commissions.length > 0) {
    const validCommissions = commissions.filter((c: any) => c && (c.source === 'PRODUCER' || c.source === 'AFFILIATE'));
    const commission = validCommissions.length > 0 ? validCommissions[0] : commissions.filter((c: any) => c && c.source !== 'HOTMART' && c.source !== 'MARKETPLACE')[0];
    if (commission && commission.value !== undefined) {
      rawValue = commission.value;
      if (commission.currency_value) currency = commission.currency_value;
    }
  }

  const value = parseFloat(String(rawValue)) || 0;
  const status = purchase.status || d.status || payload.event;
  const orderId = purchase.transaction || d.transaction || payload.id || `hot_${Date.now()}`;
  const buyerAddr = buyer.address || d.address || {};

  const result = await processPurchaseWebhook({
    siteKey, payload, email, phone, firstName, lastName, city: buyerAddr.city, state: buyerAddr.state, zip: buyerAddr.zipcode, country: buyerAddr.country_iso || buyerAddr.country || 'BR',
    fbp: d.fbp || d.custom_args?.fbp || payload.fbp, fbc: d.fbc || d.custom_args?.fbc || payload.fbc,
    externalId: d.user_id || buyer.document || buyer.id,
    clientIp: d.client_ip_address || payload.ip || undefined,
    clientUa: d.client_user_agent || payload.user_agent || undefined,
    value, currency, status, orderId, platform: 'hotmart',
    contentName: d.product?.name || payload.product?.name,
  });

  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

router.post('/kiwify', async (req, res) => {
  const siteKey = req.query.key as string;
  const token = req.query.token as string;
  const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
  if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });
  const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
  if (token !== secret) return res.status(401).json({ error: 'Invalid token' });

  const payload = req.body;
  const customer = payload.customer || {};
  const value = (payload.net_amount || payload.amount || 0) / ( (payload.net_amount || payload.amount || 0) > 1000 ? 100 : 1);

  const result = await processPurchaseWebhook({
    siteKey, payload, email: customer.email, phone: customer.mobile || customer.phone,
    firstName: customer.name?.split(' ')[0], lastName: customer.name?.split(' ').slice(1).join(' '),
    city: customer.address?.city, state: customer.address?.state, zip: customer.address?.zipcode, country: customer.country || 'BR',
    fbp: payload.tracking?.fbp || payload.fbp, fbc: payload.tracking?.fbc || payload.fbc,
    externalId: customer.email, clientIp: payload.client_ip, clientUa: payload.client_user_agent,
    value, currency: payload.order?.payment?.currency || 'BRL', status: payload.status, orderId: payload.id, platform: 'kiwify',
    contentName: payload.Product?.name || payload.product_name, purchaseTimestamp: payload.order?.created_at || payload.created_at
  });
  return res.json({ received: true });
});

router.post('/custom/:id', async (req, res) => {
  const webhookId = req.params.id;
  const payload = req.body;
  const hookRow = await pool.query(`SELECT c.*, s.site_key FROM custom_webhooks c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`, [webhookId]);
  if (!hookRow.rowCount) return res.status(404).json({ error: 'Not found' });
  const hook = hookRow.rows[0];
  await pool.query('UPDATE custom_webhooks SET last_payload = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(payload), webhookId]);
  if (!hook.is_active) return res.json({ received: true, mode: 'test' });

  const getNested = (obj: any, path: string) => path ? path.split('.').reduce((acc, part) => acc && acc[part], obj) : undefined;
  const config = hook.mapping_config || {};

  const result = await processPurchaseWebhook({
    siteKey: hook.site_key, payload, email: getNested(payload, config.email), phone: getNested(payload, config.phone),
    firstName: getNested(payload, config.first_name), lastName: getNested(payload, config.last_name),
    city: getNested(payload, config.city), state: getNested(payload, config.state),
    value: getNested(payload, config.amount) || 0, currency: getNested(payload, config.currency) || 'BRL',
    status: getNested(payload, config.status), orderId: getNested(payload, config.order_id) || `c_${Date.now()}`, platform: 'custom'
  });
  return res.json({ received: true });
});

router.post('/admin/provision', async (req, res) => {
  const secret = req.query.secret as string;
  if (secret !== (process.env.WEBHOOK_ADMIN_SECRET || 'WEBHOOK_ADMIN_SECRET')) return res.status(401).json({ error: 'Auth failed' });
  const payload = req.body.data || req.body;
  let email = payload.buyer?.email || payload.customer?.email || payload.email || payload.cus_email;
  let status = (payload.purchase?.status || payload.status || payload.order_status || '').toUpperCase();
  let offerCode = payload.purchase?.offer?.code || payload.product_id || payload.offer_code || '';

  if (!email) return res.status(400).json({ error: 'Missing email' });
  const userRow = await pool.query('SELECT account_id FROM users WHERE email = $1', [email]);
  let accountId = userRow.rowCount ? userRow.rows[0].account_id : null;

  if (['APPROVED', 'COMPLETED', 'PAID'].includes(status)) {
    if (!accountId) {
      const resAcc = await pool.query('INSERT INTO accounts (name, is_active) VALUES ($1, true) RETURNING id', [email.split('@')[0]]);
      accountId = resAcc.rows[0].id;
      const pass = crypto.randomBytes(8).toString('hex');
      const hash = await bcrypt.hash(pass, 12);
      await pool.query('INSERT INTO users (account_id, email, password_hash) VALUES ($1, $2, $3)', [accountId, email, hash]);
    } else {
      await pool.query('UPDATE accounts SET is_active = true WHERE id = $1', [accountId]);
    }
  } else if (['CANCELED', 'REFUNDED'].includes(status) && accountId) {
    await pool.query('UPDATE accounts SET is_active = false WHERE id = $1', [accountId]);
  }
  if (accountId) await pool.query('INSERT INTO subscriptions (account_id, status, provider_subscription_id) VALUES ($1, $2, $3)', [accountId, status, payload.transaction || payload.id || 'webhook']);
  return res.json({ success: true });
});

export default router;
