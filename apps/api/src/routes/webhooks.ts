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
import type { SaleNotifyKind } from '../services/sale-notification';
import { DDI_LIST } from '../lib/ddi';

const router = Router();

function decodeTrkToken(token: string) {
  if (!token || !token.startsWith('trk_')) return null;
  try {
    let b64 = token.substring(4).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    const parts = decoded.split('|');
    return {
      externalId: parts[0] || null,
      fbc: parts[1] || null,
      fbp: parts[2] || null,
    };
  } catch (e) {
    return null;
  }
}

/** Campos onde plataformas costumam embutir o token `trk_` (incl. utm_source — ver CAPI debug). */
function collectTrkSearchHaystack(payload: Record<string, unknown>): string {
  const d = (payload.data as Record<string, unknown>) || payload;
  const purchase = (d.purchase as Record<string, unknown>) || (payload.purchase as Record<string, unknown>) || {};
  const tp = (payload.trackingParameters as Record<string, unknown>) || (payload.tracking_parameters as Record<string, unknown>) || {};
  const cd = (payload.custom_data as Record<string, unknown>) || (payload.custom_args as Record<string, unknown>) || {};
  const trackingObj = (d.tracking as Record<string, unknown>) || (payload.tracking as Record<string, unknown>) || (purchase.tracking as Record<string, unknown>) || {};

  const parts: unknown[] = [
    payload.sck,
    payload.src,
    payload.utm_source,
    tp.utm_source,
    tp.sck,
    tp.src,
    cd.utm_source,
    cd.sck,
    cd.src,
    cd.fbc,
    cd.fbp,
    trackingObj.utm_source,
    trackingObj.sck,
    trackingObj.src,
    trackingObj.fbc,
    trackingObj.fbp,
    purchase.sck,
    purchase.src,
    purchase.utm_source,
    (d as any).fbc,
    (d as any).fbp,
  ];
  return parts.filter((x) => x != null && String(x).trim() !== '').map(String).join('\n');
}

/** URL válida para CAPI (website): prioriza page_url/referrer do checkout; fallback no domínio do site. */
function resolvePurchaseEventSourceUrl(
  payload: Record<string, unknown>,
  siteDomain: string | null | undefined,
  siteTrackingDomain: string | null | undefined
): string {
  for (const key of ['page_url', 'referrer'] as const) {
    const c = payload[key];
    if (typeof c === 'string') {
      const t = c.trim();
      if (t.startsWith('http://') || t.startsWith('https://')) return t;
    }
  }
  const rawHost = (siteTrackingDomain || siteDomain || '').trim();
  if (!rawHost) return '';
  const hostOnly = rawHost.replace(/^https?:\/\//i, '').split('/')[0]?.trim();
  if (!hostOnly) return '';
  return `https://${hostOnly}`;
}

function coerceWebhookStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Lê método de pagamento em payloads Hotmart, Kiwify e formatos genéricos. */
function extractPaymentMethodRaw(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload;
  const d = (p.data as Record<string, unknown>) || p;
  const purchase = (d.purchase as Record<string, unknown>) || (p.purchase as Record<string, unknown>) || {};
  const offer = (purchase.offer as Record<string, unknown>) || (d.offer as Record<string, unknown>) || {};
  const payment = (purchase.payment as Record<string, unknown>) || (offer.payment as Record<string, unknown>) || (d.payment as Record<string, unknown>) || {};
  const order = (p.order as Record<string, unknown>) || {};
  const orderPay = (order.payment as Record<string, unknown>) || {};

  return (
    coerceWebhookStr(payment.type) ||
    coerceWebhookStr(payment.method) ||
    coerceWebhookStr(payment.payment_type) ||
    coerceWebhookStr(payment.paymentType) ||
    coerceWebhookStr(purchase.payment_type) ||
    coerceWebhookStr(purchase.paymentType) ||
    coerceWebhookStr(offer.payment_type) ||
    coerceWebhookStr(offer.paymentType) ||
    coerceWebhookStr(p.payment_method) ||
    coerceWebhookStr(p.paymentMethod) ||
    coerceWebhookStr(p.payment_type) ||
    coerceWebhookStr(orderPay.method) ||
    coerceWebhookStr(orderPay.type) ||
    coerceWebhookStr(orderPay.payment_method) ||
    coerceWebhookStr(orderPay.gateway) ||
    coerceWebhookStr((p.Customer as Record<string, unknown>)?.payment_method) ||
    coerceWebhookStr((p.customer as Record<string, unknown>)?.payment_method)
  );
}

/** Classifica texto vindo da plataforma (ex.: Hotmart BILLET / PIX). */
function classifyPendingPaymentMethod(raw: string): 'pix' | 'boleto' | null {
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  if (s.includes('billet') || s.includes('boleto') || s.includes('bank_slip') || s.includes('bankslip')) return 'boleto';
  if (s.includes('slip') && !s.includes('pay')) return 'boleto';
  if (s === 'ticket' || (s.includes('ticket') && !s.includes('ticketmaster'))) return 'boleto';
  if (s.includes('financed') && s.includes('billet')) return 'boleto';
  if (s === 'pix' || s.startsWith('pix_') || s.endsWith('_pix') || s.includes('_pix_')) return 'pix';
  if (s.includes('pix') && !s.includes('boleto')) return 'pix';
  return null;
}

function resolvePendingPaymentKind(
  finalStatus: string,
  paymentMethodRaw: string | null | undefined,
  payload: unknown
): 'pix' | 'boleto' | null {
  if (finalStatus !== 'pending_payment') return null;
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const raw = coerceWebhookStr(paymentMethodRaw) || extractPaymentMethodRaw(p);
  return classifyPendingPaymentMethod(raw);
}

const normalizeStatus = (rawStatus: unknown) => {
  const s = String(rawStatus || '').toLowerCase().trim();

  // Status que indicam compra aprovada/confirmada (Somam no Dashboard)
  const approvedStatuses = [
    'approved', 'completed', 'complete', 'paid', 'active',
    'approved_by_acquirer', 'purchase_complete', 'confirmed',
  ];

  // Status de Boleto/PIX Aguardando (NÃO somam no Dashboard, mas enviam CAPI)
  const pendingStatuses = [
    'waiting_payment', 'pending', 'pending_payment',
    // Hotmart: boleto gerado / aguardando pagamento
    'billet_printed', 'purchase_billet_printed'
  ];

  // Status que indicam reembolso/cancelamento — NÃO gerar Purchase CAPI
  const refundStatuses = [
    'refunded', 'refund', 'cancelled', 'canceled', 'dispute',
    'chargeback', 'chargedback', 'expired', 'blocked',
    'purchase_refunded', 'purchase_refund', 'purchase_chargeback', 'purchase_canceled', 'purchase_cancelled',
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

/** Hotmart: `purchase.status` pode continuar pendente no 2º POST enquanto `event` já indica compra concluída. */
function resolveHotmartStatusFromEvent(
  eventRaw: unknown,
  purchaseStatus: unknown,
  d: Record<string, unknown>,
  payload: Record<string, unknown>
): string {
  const ev = String(eventRaw || d.event || payload.event || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .trim();

  const completionEvents = new Set([
    'PURCHASE_COMPLETE',
    'PURCHASE_APPROVED',
    'SUBSCRIPTION_PURCHASE_COMPLETE',
    'SUBSCRIPTION_PURCHASE_APPROVED',
  ]);

  if (completionEvents.has(ev)) {
    return 'purchase_complete';
  }

  const refundOrCancelEvents = new Set([
    'PURCHASE_REFUNDED',
    'PURCHASE_REFUND',
    'PURCHASE_CANCELED',
    'PURCHASE_CANCELLED',
    'PURCHASE_CHARGEBACK',
    'PURCHASE_EXPIRED',
    'PURCHASE_DELAYED',
    'PURCHASE_PROTEST',
  ]);

  if (refundOrCancelEvents.has(ev)) {
    return ev.toLowerCase();
  }

  return String(purchaseStatus || eventRaw || d.status || payload.event || '');
}

function recordOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Primeiro valor textual não vazio (Hotmart espalha fbp/fbc/UTM em vários nós). */
function firstNonEmptyStr(...vals: unknown[]): string {
  for (const v of vals) {
    const s = coerceWebhookStr(v);
    if (s) return s;
  }
  return '';
}

function extractHotmartBrowserAndUtm(
  payload: Record<string, unknown>,
  d: Record<string, unknown>,
  purchase: Record<string, unknown>,
  buyer: Record<string, unknown>,
  trackingObj: Record<string, unknown>,
  origin: Record<string, unknown>
) {
  const customArgs = recordOf(d.custom_args ?? purchase.custom_args ?? payload.custom_args);
  const checkout = recordOf(d.checkout ?? purchase.checkout);
  const purchaseTracking = recordOf(purchase.tracking);
  const dataTracking = recordOf(d.tracking);

  const tp = (k: string) =>
    firstNonEmptyStr(
      (payload.trackingParameters as Record<string, unknown>)?.[k],
      (payload.tracking_parameters as Record<string, unknown>)?.[k],
      trackingObj[k],
      origin[k],
      d[k],
      purchase[k]
    );

  const fbp = firstNonEmptyStr(
    d.fbp,
    payload.fbp,
    customArgs.fbp,
    trackingObj.fbp,
    origin.fbp,
    checkout.fbp,
    purchaseTracking.fbp,
    dataTracking.fbp,
    (d as { fbp_cookie?: unknown }).fbp_cookie
  );

  const fbc = firstNonEmptyStr(
    d.fbc,
    payload.fbc,
    customArgs.fbc,
    trackingObj.fbc,
    origin.fbc,
    checkout.fbc,
    purchaseTracking.fbc,
    dataTracking.fbc,
    (d as { fbc_cookie?: unknown }).fbc_cookie
  );

  const clientIp = firstNonEmptyStr(
    d.client_ip_address,
    (payload as { ip?: unknown }).ip,
    (payload as { client_ip?: unknown }).client_ip,
    buyer.client_ip_address,
    (buyer as { ip?: unknown }).ip,
    checkout.client_ip_address,
    purchase.client_ip_address,
    (purchase as { buyer_ip?: unknown }).buyer_ip
  );

  const clientUa = firstNonEmptyStr(
    d.client_user_agent,
    (payload as { user_agent?: unknown }).user_agent,
    (payload as { client_user_agent?: unknown }).client_user_agent,
    buyer.client_user_agent,
    checkout.client_user_agent,
    purchase.client_user_agent
  );

  const utm_source = firstNonEmptyStr(
    tp('utm_source'),
    origin.sck,
    origin.src,
    origin.utm_source,
    purchase.sck,
    purchase.src,
    customArgs.utm_source
  );

  const utm_medium = firstNonEmptyStr(
    tp('utm_medium'),
    origin.utm_medium,
    purchase.utm_medium,
    customArgs.utm_medium
  );

  const utm_campaign = firstNonEmptyStr(
    tp('utm_campaign'),
    origin.utm_campaign,
    purchase.utm_campaign,
    customArgs.utm_campaign
  );

  const utm_content = firstNonEmptyStr(
    tp('utm_content'),
    origin.utm_content,
    purchase.utm_content,
    customArgs.utm_content
  );

  const utm_term = firstNonEmptyStr(
    tp('utm_term'),
    origin.utm_term,
    purchase.utm_term,
    customArgs.utm_term
  );

  return { fbp, fbc, clientIp, clientUa, utm_source, utm_medium, utm_campaign, utm_content, utm_term };
}

/**
 * Mesmo pedido na Hotmart; campos variam entre eventos (boleto vs compra aprovada).
 * Sem um id estável, cada POST viraria linha nova ou não faria merge no ON CONFLICT.
 */
function resolveHotmartOrderId(
  payload: Record<string, unknown>,
  d: Record<string, unknown>,
  purchase: Record<string, unknown>
): string {
  const orderBlock = recordOf(purchase.order);
  const subs = recordOf(purchase.subscription);
  const dataRoot = recordOf(payload.data);
  const dOrder = recordOf(d.order);

  const candidates: unknown[] = [
    purchase.transaction,
    purchase.transaction_id,
    purchase.order_id,
    purchase.orderId,
    purchase.id,
    orderBlock.transaction,
    orderBlock.transaction_id,
    orderBlock.id,
    orderBlock.order_id,
    orderBlock.orderId,
    subs.transaction,
    subs.id,
    d.transaction,
    (d as { transaction_id?: unknown }).transaction_id,
    d.order_id,
    dOrder.transaction,
    dOrder.transaction_id,
    dOrder.id,
    dOrder.order_id,
    dataRoot.transaction,
    dataRoot.order_id,
  ];

  for (const c of candidates) {
    const s = coerceWebhookStr(c);
    if (s) return s;
  }

  const rootId = coerceWebhookStr(payload.id);
  if (rootId) return rootId;

  const fallback = `hot_${Date.now()}`;
  console.warn(
    '[Hotmart] Nenhum order_id estável no payload; usando id efêmero (não mescla com webhook anterior). Event:',
    String(payload.event || '').slice(0, 80)
  );
  return fallback;
}

function resolveHotmartPurchaseTimestamp(
  payload: Record<string, unknown>,
  d: Record<string, unknown>,
  purchase: Record<string, unknown>
): string | number | undefined {
  const candidates: unknown[] = [
    purchase.approved_date,
    (purchase as { approval_date?: unknown }).approval_date,
    purchase.creation_date,
    purchase.date,
    d.creation_date,
    d.date,
    payload.creation_date,
    payload.date,
  ];

  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

// ─── Core Ingestion Engine for all Webhooks ──────────────────────────────────
async function processPurchaseWebhook({
  siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
  fbp, fbc, externalId, clientIp, clientUa, value, currency, status, orderId, platform, contentName,
  purchaseTimestamp,
  /** Valor mapeado (webhook custom) ou vazio para inferir do payload */
  paymentMethodRaw,
}: any) {
  const { finalStatus, sendToCapi } = normalizeStatus(status);
  const platformDate = purchaseTimestamp ? new Date(purchaseTimestamp) : null;

  console.log(`[Webhook] processPurchaseWebhook called: value=${value} currency=${currency} status=${finalStatus} orderId=${orderId} platform=${platform} siteKey=${siteKey}`);

  // Fetch site settings (Pixel, Token)
  const siteRes = await pool.query(
    `SELECT sites.id, sites.account_id,
            NULLIF(TRIM(sites.domain), '') AS site_domain,
            NULLIF(TRIM(sites.tracking_domain), '') AS site_tracking_domain,
            m.capi_token_enc, m.pixel_id, m.capi_test_event_code, m.enabled as meta_enabled
     FROM sites 
     LEFT JOIN integrations_meta m ON m.site_id = sites.id
     WHERE sites.site_key = $1`,
    [siteKey]
  );

  if (!siteRes.rowCount) {
    console.error(`[Webhook] Site not found for key: ${siteKey}`);
    return { success: false, status: 404, error: 'Site not found' };
  }

  const {
    account_id: siteAccountId,
    pixel_id,
    capi_token_enc,
    capi_test_event_code,
    meta_enabled: metaEnabled,
    site_domain: siteDomain,
    site_tracking_domain: siteTrackingDomain,
  } = siteRes.rows[0];
  const capiToken = capi_token_enc ? decryptString(capi_token_enc) : null;

  // 1. Attribute Recovery: trk_ em sck, src, utm_source, custom_data, etc. (base64url)
  const trkHaystack = collectTrkSearchHaystack(payload);
  const sckRaw = trkHaystack.split('\n')[0] || '';
  let trkData = null;
  if (trkHaystack.includes('trk_')) {
    const match = trkHaystack.match(/trk_[A-Za-z0-9+/=_-]+/);
    if (match) trkData = decodeTrkToken(match[0]);
  }

  const finalFbc = fbc || trkData?.fbc;
  const finalFbp = fbp || trkData?.fbp;
  const finalExternalId =
    (trkData?.externalId != null && String(trkData.externalId).trim() !== ''
      ? String(trkData.externalId).trim()
      : null) || externalId;


  // 2. Enrichment: Missing attribution data or geolocation
  let enriched = null;
  if (!finalFbp || !finalFbc || !clientIp || !clientUa || (!city && !state)) {
    enriched = await EnrichmentService.findVisitorData(siteKey, email, phone, finalExternalId, { ip: clientIp, country });
    if (enriched) {
      console.log(`[Webhook] Enrichment success: found fbp=${!!enriched.fbp}, fbc=${!!enriched.fbc}, ip=${!!enriched.clientIp}, city=${!!enriched.city}`);
    }
  }

  const mergedFbp = finalFbp || enriched?.fbp;
  const mergedFbc = finalFbc || enriched?.fbc;
  const mergedIp = clientIp || enriched?.clientIp;
  const mergedUa = clientUa || enriched?.clientUa;
  const mergedExternalId = finalExternalId || enriched?.externalId || (email ? CapiService.hash(email) : undefined);


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

  // UTMs priority (Strip trk_ token from UTM source if present)
  let baseUtmSource = payload.utm_source || payload.trackingParameters?.utm_source || payload.tracking_parameters?.utm_source || (payload.sck && !String(payload.sck).startsWith('trk_') ? payload.sck : undefined) || (payload.src && !String(payload.src).startsWith('trk_') ? payload.src : undefined) || undefined;
  
  // Se o utm_source vindo do payload for um token trk_, ignoramos ele para usar o do banco
  if (baseUtmSource && typeof baseUtmSource === 'string' && baseUtmSource.startsWith('trk_')) {
    baseUtmSource = undefined;
  }

  if (baseUtmSource && typeof baseUtmSource === 'string' && baseUtmSource.includes('-trk_')) {
    baseUtmSource = baseUtmSource.split('-trk_')[0];
  }

  const utmSource = baseUtmSource || enriched?.utmSource || undefined;
  const utmMedium = payload.utm_medium || payload.trackingParameters?.utm_medium || payload.tracking_parameters?.utm_medium || enriched?.utmMedium || undefined;
  const utmCampaign = payload.utm_campaign || payload.trackingParameters?.utm_campaign || payload.tracking_parameters?.utm_campaign || enriched?.utmCampaign || undefined;
  const utmContent =
    payload.utm_content ||
    payload.trackingParameters?.utm_content ||
    payload.tracking_parameters?.utm_content ||
    enriched?.utmContent ||
    undefined;
  const utmTerm =
    payload.utm_term ||
    payload.trackingParameters?.utm_term ||
    payload.tracking_parameters?.utm_term ||
    enriched?.utmTerm ||
    undefined;

  // 2. CAPI Payload
  const purchasePayload = payload as Record<string, unknown>;
  const purchaseEventSourceUrl = resolvePurchaseEventSourceUrl(
    purchasePayload,
    siteDomain,
    siteTrackingDomain
  );

  const capiPayload: any = {
    event_name: 'Purchase',
    event_time: Math.floor((platformDate?.getTime() || Date.now()) / 1000),
    event_id: `purchase_${orderId}`,
    event_source_url: purchaseEventSourceUrl || undefined,
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
      external_id: mergedExternalId ? CapiService.hash(String(mergedExternalId)) : undefined,
    },
    custom_data: {
      value: Number(value) || 0,
      currency: (currency || 'BRL').toUpperCase(),
      content_name: contentName || undefined,
      content_type: 'product',
      utm_source: utmSource || undefined,
      utm_medium: utmMedium || undefined,
      utm_campaign: utmCampaign || undefined,
      utm_content: utmContent || undefined,
      utm_term: utmTerm || undefined,
    },
  };

  if (capi_test_event_code) capiPayload.test_event_code = capi_test_event_code;

  // 3. Database Persistence
  const dbEmailHash = email ? CapiService.hash(email.toLowerCase()) : null;
  const visitorExtId = mergedExternalId || dbEmailHash || `buyer_${orderId}`;

  let rawPayloadForDb: Record<string, unknown> = {};
  try {
    rawPayloadForDb =
      payload && typeof payload === 'object'
        ? (JSON.parse(JSON.stringify(payload)) as Record<string, unknown>)
        : {};
  } catch {
    rawPayloadForDb = { _ingest_note: 'payload could not be serialized for storage' };
  }
  rawPayloadForDb._capi_debug = capiPayload;

  if (dbEmailHash || mergedFbp || mergedExternalId) {
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
        last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
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
      platform_date, user_data, custom_data, raw_payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
    ON CONFLICT (site_key, order_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      platform_date = EXCLUDED.platform_date,
      fbc = COALESCE(NULLIF(BTRIM(EXCLUDED.fbc), ''), purchases.fbc),
      fbp = COALESCE(NULLIF(BTRIM(EXCLUDED.fbp), ''), purchases.fbp),
      external_id = COALESCE(NULLIF(BTRIM(EXCLUDED.external_id::text), ''), purchases.external_id),
      utm_source = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_source), ''), purchases.utm_source),
      utm_medium = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_medium), ''), purchases.utm_medium),
      utm_campaign = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_campaign), ''), purchases.utm_campaign),
      customer_email = COALESCE(NULLIF(TRIM(EXCLUDED.customer_email), ''), purchases.customer_email),
      customer_phone = COALESCE(NULLIF(TRIM(EXCLUDED.customer_phone), ''), purchases.customer_phone),
      customer_name = COALESCE(NULLIF(TRIM(EXCLUDED.customer_name), ''), purchases.customer_name),
      user_data = purchases.user_data || EXCLUDED.user_data,
      custom_data = purchases.custom_data || EXCLUDED.custom_data,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
  `, [
    siteKey, orderId, platform, value, currency, finalStatus,
    email, phone, `${firstName || ''} ${lastName || ''}`.trim(),
    mergedFbc, mergedFbp, mergedExternalId, utmSource, utmMedium, utmCampaign,
    platformDate, JSON.stringify(capiPayload.user_data), JSON.stringify(capiPayload.custom_data),
    JSON.stringify(rawPayloadForDb),
  ]);

  // 4. Dispatch
  if (sendToCapi && metaEnabled && pixel_id && capiToken) {
    capiService.sendEvent(siteKey, capiPayload).catch(err => console.error(`[Webhook] CAPI error for ${orderId}:`, err));
  }

  if (sendToCapi && siteAccountId) {
    const pendingPaymentKind = resolvePendingPaymentKind(finalStatus, paymentMethodRaw, payload);
    const notifyKind: SaleNotifyKind =
      finalStatus === 'pending_payment' ? 'pending_payment' : 'sale';
    const notifyOpts = {
      amount: value,
      currency,
      orderId,
      platform,
      productName: contentName,
      notifyKind,
      pendingPaymentKind,
    };

    pool.query('SELECT push_token, platform FROM push_tokens WHERE account_id = $1', [siteAccountId])
      .then(res => {
        if (res.rows.length > 0) notifyAccountNewSale(res.rows, notifyOpts);
      }).catch(() => {});

    notifyAccountWebPushSale(siteAccountId, notifyOpts).catch(() => {});
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

  const result = await processPurchaseWebhook({
    siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob, fbp, fbc,
    value, currency, status, orderId, platform, contentName, purchaseTimestamp,
    paymentMethodRaw: extractPaymentMethodRaw(payload),
  });
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
  const trackingObj = recordOf(d.tracking || payload.tracking || {});
  const origin = recordOf(purchase.origin || trackingObj || {});

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
  const purchaseStatus = purchase.status || d.status;
  const status = resolveHotmartStatusFromEvent(payload.event, purchaseStatus, d, payload);
  const orderId = resolveHotmartOrderId(payload, d, purchase);
  const evLog = String(payload.event || d.event || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (
    ['PURCHASE_COMPLETE', 'PURCHASE_APPROVED', 'SUBSCRIPTION_PURCHASE_COMPLETE'].includes(evLog) &&
    String(purchaseStatus || '')
      .toLowerCase()
      .includes('pending')
  ) {
    console.log(
      `[Hotmart] Usando evento ${evLog} como aprovado (purchase.status ainda pendente) order=${orderId}`
    );
  }
  const buyerAddr = buyer.address || d.address || {};

  const hmTrack = extractHotmartBrowserAndUtm(payload, recordOf(d), recordOf(purchase), recordOf(buyer), trackingObj, origin);
  const payloadForProcess =
    payload && typeof payload === 'object'
      ? ({ ...payload } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (hmTrack.utm_source) payloadForProcess.utm_source = hmTrack.utm_source;
  if (hmTrack.utm_medium) payloadForProcess.utm_medium = hmTrack.utm_medium;
  if (hmTrack.utm_campaign) payloadForProcess.utm_campaign = hmTrack.utm_campaign;
  if (hmTrack.utm_content) payloadForProcess.utm_content = hmTrack.utm_content;
  if (hmTrack.utm_term) payloadForProcess.utm_term = hmTrack.utm_term;

  const result = await processPurchaseWebhook({
    siteKey, payload: payloadForProcess, email, phone, firstName, lastName, city: buyerAddr.city, state: buyerAddr.state, zip: buyerAddr.zipcode, country: buyerAddr.country_iso || buyerAddr.country || 'BR',
    fbp: hmTrack.fbp || undefined,
    fbc: hmTrack.fbc || undefined,
    externalId: d.user_id || buyer.document || buyer.id,
    clientIp: hmTrack.clientIp || undefined,
    clientUa: hmTrack.clientUa || undefined,
    value, currency, status, orderId, platform: 'hotmart',
    contentName: d.product?.name || payload.product?.name,
    purchaseTimestamp: resolveHotmartPurchaseTimestamp(payload, d, purchase),
    paymentMethodRaw: extractPaymentMethodRaw(payload),
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
    contentName: payload.Product?.name || payload.product_name, purchaseTimestamp: payload.order?.created_at || payload.created_at,
    paymentMethodRaw: extractPaymentMethodRaw(payload),
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

  const mappedMethod = getNested(payload, config.payment_method);
  const result = await processPurchaseWebhook({
    siteKey: hook.site_key, payload, email: getNested(payload, config.email), phone: getNested(payload, config.phone),
    firstName: getNested(payload, config.first_name), lastName: getNested(payload, config.last_name),
    city: getNested(payload, config.city), state: getNested(payload, config.state),
    value: getNested(payload, config.amount) || 0, currency: getNested(payload, config.currency) || 'BRL',
    status: getNested(payload, config.status), orderId: getNested(payload, config.order_id) || `c_${Date.now()}`, platform: 'custom',
    paymentMethodRaw: mappedMethod != null && mappedMethod !== '' ? String(mappedMethod) : undefined,
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
