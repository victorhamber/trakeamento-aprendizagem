import geoip from 'geoip-lite';
import bodyParser from 'body-parser';
import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { preserveMetaClickIds } from '../lib/meta-attribution';
import { capiService, CapiService } from '../services/capi';
import { EnrichmentService } from '../services/enrichment';
import { decryptString } from '../lib/crypto';
import { notifyAccountNewSale } from '../services/expo-push';
import { notifyAccountWebPushSale } from '../services/web-push-notify';
import type { SaleNotifyKind } from '../services/sale-notification';
import { DDI_LIST } from '../lib/ddi';
import { buildVisitorTrafficSourceString } from '../lib/visitorTrafficSource';
import { createLogger } from '../lib/logger';

const log = createLogger('Webhook');
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
  const d = (payload.data as Record<string, unknown>) || payload;
  const purchase = (d.purchase as Record<string, unknown>) || (payload.purchase as Record<string, unknown>) || {};
  const tp =
    (payload.trackingParameters as Record<string, unknown>) ||
    (payload.tracking_parameters as Record<string, unknown>) ||
    {};
  const cd = (payload.custom_data as Record<string, unknown>) || (payload.custom_args as Record<string, unknown>) || {};
  const trackingObj =
    (d.tracking as Record<string, unknown>) ||
    (payload.tracking as Record<string, unknown>) ||
    (purchase.tracking as Record<string, unknown>) ||
    {};

  const candidates: unknown[] = [
    // raiz
    payload.page_url,
    payload.pageUrl,
    payload.url,
    payload.event_source_url,
    payload.eventSourceUrl,
    payload.referrer,
    payload.referrer_url,
    payload.document_referrer,

    // data.*
    (d as any).page_url,
    (d as any).pageUrl,
    (d as any).url,
    (d as any).event_source_url,
    (d as any).eventSourceUrl,
    (d as any).referrer,
    (d as any).referrer_url,
    (d as any).document_referrer,

    // purchase.*
    (purchase as any).page_url,
    (purchase as any).pageUrl,
    (purchase as any).url,
    (purchase as any).event_source_url,
    (purchase as any).eventSourceUrl,
    (purchase as any).referrer,
    (purchase as any).referrer_url,
    (purchase as any).document_referrer,

    // tracking params / custom
    (tp as any).page_url,
    (tp as any).pageUrl,
    (tp as any).url,
    (tp as any).referrer_url,
    (cd as any).page_url,
    (cd as any).pageUrl,
    (cd as any).url,
    (cd as any).referrer_url,
    (trackingObj as any).page_url,
    (trackingObj as any).pageUrl,
    (trackingObj as any).url,
    (trackingObj as any).referrer_url,
  ];

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (t.startsWith('http://') || t.startsWith('https://')) return t;
  }

  const rawHost = (siteTrackingDomain || siteDomain || '').trim();
  if (!rawHost) return '';
  const hostOnly = rawHost.replace(/^https?:\/\//i, '').split('/')[0]?.trim();
  if (!hostOnly) return '';
  return `https://${hostOnly}`;
}

/**
 * `referrer_url` no nível do evento CAPI (parâmetro server event).
 * Varre formatos comuns de checkout (raiz, data.purchase, tracking, custom_data).
 */
function extractPurchaseReferrerUrl(payload: Record<string, unknown>): string | undefined {
  const d = (payload.data as Record<string, unknown>) || payload;
  const purchase = (d.purchase as Record<string, unknown>) || (payload.purchase as Record<string, unknown>) || {};
  const tp =
    (payload.trackingParameters as Record<string, unknown>) ||
    (payload.tracking_parameters as Record<string, unknown>) ||
    {};
  const cd = (payload.custom_data as Record<string, unknown>) || (payload.custom_args as Record<string, unknown>) || {};
  const trackingObj =
    (d.tracking as Record<string, unknown>) ||
    (payload.tracking as Record<string, unknown>) ||
    (purchase.tracking as Record<string, unknown>) ||
    {};

  const candidates: unknown[] = [
    payload.referrer,
    payload.referrer_url,
    payload.document_referrer,
    d.referrer,
    d.referrer_url,
    d.document_referrer,
    purchase.referrer,
    purchase.referrer_url,
    purchase.document_referrer,
    tp.referrer,
    tp.referrer_url,
    cd.referrer,
    cd.referrer_url,
    cd.document_referrer,
    trackingObj.referrer,
    trackingObj.referrer_url,
  ];

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (CapiService.isValidHttpEventSourceUrl(t)) return t;
  }
  return undefined;
}

function coerceWebhookStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function normalizeCurrencyCode(raw: unknown): string {
  const code = coerceWebhookStr(raw).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function extractCurrencyFromPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload;
  const d = recordOf(p.data);
  const purchase = recordOf(d.purchase ?? p.purchase);
  const order = recordOf(p.order);
  const payment = recordOf(order.payment ?? purchase.payment ?? d.payment);
  const price = recordOf(purchase.price);
  const fullPrice = recordOf(purchase.full_price);
  const offer = recordOf(purchase.offer ?? d.offer);
  const customData = recordOf(p.custom_data ?? p.custom_args);
  const tracking = recordOf(d.tracking ?? p.tracking);

  const candidates: unknown[] = [
    p.currency,
    (p as { currency_code?: unknown }).currency_code,
    (p as { currencyCode?: unknown }).currencyCode,
    d.currency,
    (d as { currency_code?: unknown }).currency_code,
    purchase.currency,
    (purchase as { currency_code?: unknown }).currency_code,
    payment.currency,
    (payment as { currency_code?: unknown }).currency_code,
    order.currency,
    (order as { currency_code?: unknown }).currency_code,
    price.currency,
    (price as { currency_value?: unknown }).currency_value,
    fullPrice.currency,
    (fullPrice as { currency_value?: unknown }).currency_value,
    offer.currency,
    (offer as { currency_code?: unknown }).currency_code,
    customData.currency,
    tracking.currency,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCurrencyCode(candidate);
    if (normalized) return normalized;
  }

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

  // Recorrências/assinaturas: algumas notificações podem gerar transações distintas para a mesma recorrência.
  // Para evitar duplicar “2 compras” na mesma parcela/recorrência, usamos um id estável por subscriber + recurrence.
  // (Mantém merge via UNIQUE(site_key, order_id).)
  try {
    const sub0 = recordOf((d as any).subscription);
    const sub1 = recordOf((dataRoot as any).subscription);
    const sub = Object.keys(sub0).length ? sub0 : sub1;
    const subscriber = recordOf((sub as any).subscriber);
    const subCode = coerceWebhookStr((subscriber as any).code);
    const rec =
      (typeof (purchase as any).recurrence_number === 'number' && Number.isFinite((purchase as any).recurrence_number))
        ? String((purchase as any).recurrence_number)
        : coerceWebhookStr((purchase as any).recurrence_number) ||
          (typeof (purchase as any).recurrency_number === 'number' && Number.isFinite((purchase as any).recurrency_number))
            ? String((purchase as any).recurrency_number)
            : coerceWebhookStr((purchase as any).recurrency_number);
    if (subCode && rec) {
      return `sub_${subCode}_r${rec}`.slice(0, 100);
    }
  } catch {
    // ignore
  }

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

/** Valor/moeda “raiz” do checkout Hotmart (comissão produtor/afiliado quando existir). */
function resolveHotmartMoneyFromCommissionsOrPurchase(
  purchase: Record<string, unknown>,
  d: Record<string, unknown>,
  commissions: unknown[]
): { value: number; currency: string } {
  const pr = recordOf(purchase);
  const fp = recordOf(pr.full_price as unknown);
  const pp = recordOf(pr.price as unknown);
  // Hotmart:
  // - `purchase.price.value` é o valor bruto cobrado/pago.
  // - `commissions` contém o líquido (ex.: PRODUCER) já descontando taxas Hotmart.
  // Para métricas financeiras reais do produtor, priorizamos a comissão PRODUCER quando existir.
  let rawValue: unknown =
    pp.value ?? fp.value ?? pr.amount ?? pr.total ?? (d as { amount?: unknown }).amount ?? 0;
  let currency =
    coerceWebhookStr(fp.currency_value) ||
    coerceWebhookStr(pp.currency_value) ||
    coerceWebhookStr((d as { currency?: unknown }).currency) ||
    'BRL';

  // Usa comissão do PRODUTOR como "receita líquida" (soma caso venha quebrada em múltiplas linhas).
  if (Array.isArray(commissions) && commissions.length > 0) {
    let sum = 0;
    let any = false;
    let cur = '';
    for (const c of commissions as any[]) {
      if (!c || c.source !== 'PRODUCER') continue;
      const v = parseFloat(String(c.value ?? ''));
      if (!Number.isFinite(v)) continue;
      sum += v;
      any = true;
      if (!cur && c.currency_value) cur = String(c.currency_value);
    }
    if (any) {
      rawValue = sum;
      if (cur) currency = cur;
    }
  }

  return { value: parseFloat(String(rawValue)) || 0, currency };
}

type HotmartCheckoutLine = {
  orderId: string;
  value: number;
  currency: string;
  contentName: string;
  /** Rótulo curto para push / Meta (ex.: Order bump). */
  saleLineLabel?: string;
};

function dedupeHotmartLinesByOrderId(lines: HotmartCheckoutLine[]): HotmartCheckoutLine[] {
  const seen = new Set<string>();
  const out: HotmartCheckoutLine[] = [];
  for (const l of lines) {
    if (seen.has(l.orderId)) {
      console.warn('[Hotmart] Linha com order_id duplicado ignorada:', l.orderId);
      continue;
    }
    seen.add(l.orderId);
    out.push(l);
  }
  return out;
}

/**
 * Expande um POST Hotmart em uma ou mais linhas (produto principal, order bump, upsell).
 * - `purchase.items[]`: uma linha por item quando a Hotmart envia o carrinho no mesmo payload.
 * - Transação filha com `order_bump.parent_purchase_transaction` igual a `transaction`: evita colisão em UNIQUE(site_key, order_id).
 */
function buildHotmartCheckoutLines(
  payload: Record<string, unknown>,
  d: Record<string, unknown>,
  purchase: Record<string, unknown>,
  commissions: unknown[],
  rootProductName: string
): HotmartCheckoutLine[] {
  const mainTx = resolveHotmartOrderId(payload, d, purchase);
  const rootMoney = resolveHotmartMoneyFromCommissionsOrPurchase(purchase, d, commissions);
  const ob = recordOf(purchase.order_bump as unknown);
  const parentPurchaseTx = coerceWebhookStr(ob.parent_purchase_transaction);
  const rootProd = recordOf(d.product as unknown);
  const rootPid = rootProd.id;

  const itemsRaw = purchase.items ?? d.items;
  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const lines: HotmartCheckoutLine[] = [];
    for (let i = 0; i < itemsRaw.length; i++) {
      const it = recordOf(itemsRaw[i]);
      const prod = recordOf(it.product as unknown);
      const priceB = recordOf((it.price || it.full_price) as unknown);
      let v = parseFloat(String(priceB.value ?? it.value ?? 0)) || 0;
      let cur =
        coerceWebhookStr(priceB.currency_value) ||
        coerceWebhookStr(it.currency_value as string) ||
        rootMoney.currency;
      const pid = prod.id ?? it.product_id;
      let oid =
        coerceWebhookStr(it.transaction) ||
        coerceWebhookStr((it as { purchase_transaction?: unknown }).purchase_transaction);
      if (!oid) {
        oid = pid != null ? `${mainTx}:p${pid}` : `${mainTx}:line${i}`;
      }
      if (v <= 0 && itemsRaw.length === 1) {
        v = rootMoney.value;
        cur = rootMoney.currency;
      } else if (v <= 0 && rootMoney.value > 0) {
        v = rootMoney.value / itemsRaw.length;
        cur = rootMoney.currency;
      }
      const name =
        coerceWebhookStr(prod.name) ||
        coerceWebhookStr(it.name) ||
        rootProductName ||
        'Produto';
      let saleLineLabel: string | undefined;
      if (it.is_order_bump === true || recordOf(it.order_bump as unknown).is_order_bump === true) {
        saleLineLabel = 'Order bump';
      } else if (String(it.type || it.offer_type || '')
        .toUpperCase()
        .includes('UPSELL')) {
        saleLineLabel = 'Upsell';
      } else if (i > 0) {
        saleLineLabel = 'Item adicional';
      }
      lines.push({
        orderId: oid.slice(0, 100),
        value: v,
        currency: cur || 'BRL',
        contentName: name,
        saleLineLabel,
      });
    }
    return dedupeHotmartLinesByOrderId(lines);
  }

  let orderId = mainTx;
  const childTx = coerceWebhookStr(purchase.transaction);
  if (parentPurchaseTx) {
    const tx = childTx || mainTx;
    if (tx === parentPurchaseTx) {
      orderId =
        rootPid != null
          ? `${parentPurchaseTx}:p${rootPid}`.slice(0, 100)
          : `${parentPurchaseTx}:addon`.slice(0, 100);
    } else {
      orderId = tx.slice(0, 100);
    }
  }

  const saleLineLabel = parentPurchaseTx ? 'Order bump / Upsell' : undefined;
  const contentName =
    rootProductName ||
    coerceWebhookStr(rootProd.name) ||
    coerceWebhookStr((purchase as { product?: { name?: string } }).product?.name) ||
    'Produto';

  return [
    {
      orderId,
      value: rootMoney.value,
      currency: rootMoney.currency,
      contentName,
      saleLineLabel,
    },
  ];
}

// ─── Retry com exponential backoff (mesma lógica do ingest) ──────────────────

async function sendCapiWithRetry(
  siteKey: string,
  payload: Parameters<typeof capiService.sendEvent>[1],
  maxAttempts = 3
): Promise<void> {
  let lastErrorStr = 'Unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await capiService.sendEvent(siteKey, payload);

      if (res && typeof res === 'object' && ('ok' in res) && !res.ok) {
        lastErrorStr = res.error || 'API Error';
        throw new Error(lastErrorStr);
      }

      return;
    } catch (err: any) {
      if (attempt === maxAttempts) {
        console.error(`[Webhook CAPI] Final failure after ${maxAttempts} attempts for site=${siteKey}:`, err.message || err);
        await capiService.saveToOutbox(siteKey, payload, err.message || String(err));
        return;
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 10_000);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ─── Core Ingestion Engine for all Webhooks ──────────────────────────────────
async function processPurchaseWebhook({
  siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
  fbp, fbc, externalId, clientIp, clientUa, value, currency, status, orderId, platform, contentName,
  purchaseTimestamp,
  /** Valor mapeado (webhook custom) ou vazio para inferir do payload */
  paymentMethodRaw,
  /** Ex.: "Order bump" — prefixa Meta + notificações */
  saleLineLabel,
  /** ID do produto na plataforma (Hotmart product_id, Kiwify product_id, etc.) — enriquece content_ids no CAPI. */
  contentId,
}: any) {
  const { finalStatus, sendToCapi } = normalizeStatus(status);
  const resolvedCurrency = normalizeCurrencyCode(currency) || extractCurrencyFromPayload(payload as Record<string, unknown>) || 'BRL';
  
  let platformDate = purchaseTimestamp ? new Date(purchaseTimestamp) : null;
  const nowMs = Date.now();
  if (platformDate) {
    const pTime = platformDate.getTime();
    if (Number.isNaN(pTime) || pTime > nowMs || nowMs - pTime > 6 * 24 * 60 * 60 * 1000) {
      platformDate = new Date(nowMs);
    }
  } else {
    platformDate = new Date(nowMs);
  }

  console.log(`[Webhook] processPurchaseWebhook called: value=${value} currency=${resolvedCurrency} status=${finalStatus} orderId=${orderId} platform=${platform} siteKey=${siteKey}`);

  const displayContentName =
    saleLineLabel && contentName
      ? `${saleLineLabel}: ${contentName}`
      : saleLineLabel && !contentName
        ? String(saleLineLabel)
        : contentName;

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

  const canonicalEid = (val: unknown): string | null => {
    if (val == null) return null;
    const s = String(val).trim();
    if (!s) return null;
    // External ID canônico do Trajettu sempre começa com eid_
    if (s.startsWith('eid_')) return s;
    return null;
  };


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
  const mergedFbcSafe = preserveMetaClickIds(mergedFbc);
  const mergedFbpSafe = preserveMetaClickIds(mergedFbp);
  const mergedIp = clientIp || enriched?.clientIp;
  const mergedUa = clientUa || enriched?.clientUa;
  // Prioridade para "external_id" no CAPI: eid_ canônico do tracker > eid_ do enrichment > hash estável de PII.
  // (Meta recomenda external_id estável; quando existir email/phone, preferimos a âncora por PII.)
  const phoneDigitsForHash = phone ? String(phone).replace(/[^0-9]/g, '') : '';
  const piiExternalId = (email ? CapiService.hash(String(email).toLowerCase().trim()) : '') || (phoneDigitsForHash ? CapiService.hash(phoneDigitsForHash) : '');
  const mergedExternalId =
    canonicalEid(finalExternalId) ||
    canonicalEid(enriched?.externalId) ||
    (piiExternalId ? piiExternalId : undefined);


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

  /** Hotmart costuma enviar 2+ POSTs PURCHASE_APPROVED com `id` diferentes e o mesmo `transaction` — evita 2× CAPI e 2× notificação. */
  let skipHotmartDuplicateSideEffects = false;
  if (platform === 'hotmart' && orderId) {
    const prevRow = await pool.query(
      `SELECT amount, currency, status, updated_at, raw_payload
       FROM purchases WHERE site_key = $1 AND order_id = $2`,
      [siteKey, orderId]
    );
    if (prevRow.rowCount && prevRow.rows[0]) {
      const ex = prevRow.rows[0];
      const sameMoney =
        Math.abs(Number(ex.amount) - Number(value)) < 0.0001 &&
        String(ex.currency || '').toUpperCase() === resolvedCurrency;
      const sameStatus =
        String(ex.status || '').toLowerCase().trim() === String(finalStatus || '').toLowerCase().trim();
      const ageMs = Date.now() - new Date(ex.updated_at as string).getTime();
      const fresh = ageMs >= 0 && ageMs < 5 * 60 * 1000;
      const newEventId = coerceWebhookStr(purchasePayload.id);
      const prevPayload = ex.raw_payload as Record<string, unknown> | null | undefined;
      const prevEventId =
        prevPayload && typeof prevPayload === 'object' ? coerceWebhookStr(prevPayload.id) : '';
      if (sameMoney && sameStatus && fresh && newEventId && prevEventId) {
        skipHotmartDuplicateSideEffects = true;
        console.log(
          `[Hotmart] Reenvio do mesmo pedido (order=${orderId}, webhook id ${newEventId}${
            newEventId !== prevEventId ? ` ≠ ${prevEventId}` : ' repetido'
          }) — sem novo CAPI nem push`
        );
      }
    }
  }

  const purchaseEventSourceUrl = resolvePurchaseEventSourceUrl(
    purchasePayload,
    siteDomain,
    siteTrackingDomain
  );

  const rawReferrerUrl = extractPurchaseReferrerUrl(purchasePayload);
  const capiReferrerUrl =
    rawReferrerUrl &&
    rawReferrerUrl !== purchaseEventSourceUrl &&
    CapiService.isValidHttpEventSourceUrl(rawReferrerUrl)
      ? rawReferrerUrl
      : undefined;

  const effectiveEventSourceUrl = (() => {
    let esu = String(purchaseEventSourceUrl || '').trim();

    if (!esu) {
      const envFallback = (process.env.CAPI_FALLBACK_EVENT_SOURCE_URL || '').trim();
      if (envFallback.startsWith('http')) esu = envFallback;
    }

    if (!esu) return '';
    if (!capiReferrerUrl) return esu;
    try {
      const a = new URL(esu);
      const b = new URL(capiReferrerUrl);
      const esuLooksLikeDomainOnly = (a.pathname === '/' || a.pathname === '') && !a.search && !a.hash;
      const sameHost = a.host === b.host;
      return esuLooksLikeDomainOnly && sameHost ? capiReferrerUrl : esu;
    } catch {
      return esu;
    }
  })();

  const isPending = finalStatus === 'pending_payment';
  const capiEventName = isPending ? 'InitiateCheckout' : 'Purchase';
  const capiEventId = isPending ? `checkout_pending_${orderId}` : `purchase_${orderId}`;

  const capiPayload: any = {
    event_name: capiEventName,
    event_time: Math.floor((platformDate?.getTime() || Date.now()) / 1000),
    event_id: capiEventId,
    event_source_url: effectiveEventSourceUrl || undefined,
    ...(capiReferrerUrl ? { referrer_url: capiReferrerUrl } : {}),
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
      fbc: mergedFbcSafe,
      fbp: mergedFbpSafe,
      external_id: mergedExternalId ? String(mergedExternalId) : undefined,
    },
    custom_data: {
      value: Number(value) || 0,
      currency: resolvedCurrency,
      content_name: displayContentName || undefined,
      content_type: 'product',
      content_ids: contentId ? [String(contentId)] : undefined,
      num_items: 1,
      utm_source: utmSource || undefined,
      utm_medium: utmMedium || undefined,
      utm_campaign: utmCampaign || undefined,
      utm_content: utmContent || undefined,
      utm_term: utmTerm || undefined,
    },
  };

  if (capi_test_event_code) capiPayload.test_event_code = capi_test_event_code;

  // 3. Database Persistence
  // "external_id canônico" para perfil (site_visitors): quando houver PII, usamos hash estável (email > phone)
  // para unificar o mesmo usuário mesmo trocando de aparelho/navegador.
  const dbEmailHash = email ? CapiService.hash(String(email).toLowerCase().trim()) : null;
  const dbPhoneHashBase = phoneDigitsForHash ? CapiService.hash(phoneDigitsForHash) : null;
  const visitorExtId = (dbEmailHash || dbPhoneHashBase || mergedExternalId || `anon_purchase_${orderId}`) as string;
  let recoveredGroupTag: string | null = null;
  try {
    const dbPhoneHash = dbPhoneHashBase;
    const lookupRes = await pool.query(
      `
        SELECT last_group_tag
        FROM site_visitors
        WHERE site_key = $1
          AND (
            (external_id = $2::text)
            OR ($3::text IS NOT NULL AND email_hash = $3::text)
            OR ($4::text IS NOT NULL AND phone_hash = $4::text)
          )
        ORDER BY last_seen_at DESC
        LIMIT 1
      `,
      [siteKey, visitorExtId, dbEmailHash, dbPhoneHash]
    );
    if (lookupRes.rowCount && lookupRes.rows[0]?.last_group_tag) {
      recoveredGroupTag = String(lookupRes.rows[0].last_group_tag || '').trim().slice(0, 160) || null;
    }
  } catch (e) {
    // Non-blocking: don't break webhook processing if visitor lookup fails.
  }

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

  const purchaseCustomDataForDb = (() => {
    const base = (capiPayload.custom_data && typeof capiPayload.custom_data === 'object')
      ? (capiPayload.custom_data as Record<string, unknown>)
      : {};
    if (!recoveredGroupTag) return base;
    return { ...base, group_tag: recoveredGroupTag };
  })();

  const visitorTrafficStr = buildVisitorTrafficSourceString(
    {
      utm_source: utmSource ? String(utmSource) : undefined,
      utm_medium: utmMedium ? String(utmMedium) : undefined,
      utm_campaign: utmCampaign ? String(utmCampaign) : undefined,
      utm_content: utmContent ? String(utmContent) : undefined,
      utm_term: utmTerm ? String(utmTerm) : undefined,
    } as Record<string, unknown>,
    effectiveEventSourceUrl || undefined
  );

  if (!skipHotmartDuplicateSideEffects && (visitorExtId || dbEmailHash || dbPhoneHashBase || mergedFbpSafe || mergedFbcSafe)) {
    pool.query(`
      INSERT INTO site_visitors (
        site_key, external_id, fbc, fbp, email_hash, phone_hash,
        total_events, last_event_name, last_ip, last_user_agent, city, state, last_traffic_source, first_traffic_source
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $12, $7, $8, $9, $10, $11, $11)
      ON CONFLICT (site_key, external_id) DO UPDATE SET
        fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
        fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
        email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
        phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
        last_event_name = EXCLUDED.last_event_name,
        last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
        last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
        city = COALESCE(EXCLUDED.city, site_visitors.city),
        state = COALESCE(EXCLUDED.state, site_visitors.state),
        first_traffic_source = COALESCE(site_visitors.first_traffic_source, EXCLUDED.first_traffic_source),
        last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
        total_events = site_visitors.total_events + 1,
        last_seen_at = NOW()
    `, [siteKey, visitorExtId, mergedFbcSafe, mergedFbpSafe, dbEmailHash, dbPhoneHashBase, mergedIp, mergedUa, finalCity, finalState, visitorTrafficStr, capiEventName])
    .catch(err => console.error('[Webhook] Visitor UPSERT error:', err));
  }

  // Hotmart (assinaturas): builds antigos podem ter salvo `order_id = transaction` (ex.: HP...).
  // A lógica atual usa `sub_<subscriber>_r<rec>` para a mesma recorrência, então precisamos "migrar" a linha antiga
  // para o id estável, evitando duplicar a compra e dobrar a receita no dashboard.
  if (platform === 'hotmart' && typeof orderId === 'string' && orderId.startsWith('sub_')) {
    const p0 = (payload && typeof payload === 'object') ? (payload as any) : null;
    const legacyTx =
      coerceWebhookStr(p0?.data?.purchase?.transaction) ||
      coerceWebhookStr(p0?.data?.purchase?.transaction_id) ||
      coerceWebhookStr(p0?.data?.transaction) ||
      coerceWebhookStr(p0?.data?.transaction_id);
    if (legacyTx && legacyTx !== orderId) {
      try {
        await pool.query(
          `
            UPDATE purchases p
            SET order_id = $3, updated_at = NOW()
            WHERE p.site_key = $1
              AND p.order_id = $2
              AND NOT EXISTS (
                SELECT 1 FROM purchases x WHERE x.site_key = $1 AND x.order_id = $3
              )
          `,
          [siteKey, legacyTx.slice(0, 100), orderId.slice(0, 100)]
        );
      } catch (err) {
        console.warn('[Hotmart] Falha ao migrar order_id legacy -> estável:', err);
      }
    }
  }

  await pool.query(`
    INSERT INTO purchases (
      site_key, order_id, platform, amount, currency, status, 
      customer_email, customer_phone, customer_name,
      fbc, fbp, external_id, utm_source, utm_medium, utm_campaign,
      platform_date, user_data, custom_data, raw_payload, buyer_email_hash
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
    ON CONFLICT (site_key, order_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      platform_date = EXCLUDED.platform_date,
      fbc = COALESCE(NULLIF(BTRIM(EXCLUDED.fbc), ''), purchases.fbc),
      fbp = COALESCE(NULLIF(BTRIM(EXCLUDED.fbp), ''), purchases.fbp),
      external_id = CASE
        WHEN NULLIF(BTRIM(EXCLUDED.external_id::text), '') IS NOT NULL THEN EXCLUDED.external_id
        ELSE purchases.external_id
      END,
      utm_source = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_source), ''), purchases.utm_source),
      utm_medium = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_medium), ''), purchases.utm_medium),
      utm_campaign = COALESCE(NULLIF(BTRIM(EXCLUDED.utm_campaign), ''), purchases.utm_campaign),
      customer_email = COALESCE(NULLIF(TRIM(EXCLUDED.customer_email), ''), purchases.customer_email),
      customer_phone = COALESCE(NULLIF(TRIM(EXCLUDED.customer_phone), ''), purchases.customer_phone),
      customer_name = COALESCE(NULLIF(TRIM(EXCLUDED.customer_name), ''), purchases.customer_name),
      user_data = purchases.user_data || EXCLUDED.user_data,
      custom_data = purchases.custom_data || EXCLUDED.custom_data,
      raw_payload = EXCLUDED.raw_payload,
      buyer_email_hash = COALESCE(EXCLUDED.buyer_email_hash, purchases.buyer_email_hash),
      updated_at = NOW()
  `, [
    siteKey, orderId, platform, value, resolvedCurrency, finalStatus,
    email, phone, `${firstName || ''} ${lastName || ''}`.trim(),
    mergedFbcSafe, mergedFbpSafe, visitorExtId, utmSource, utmMedium, utmCampaign,
    platformDate, JSON.stringify(capiPayload.user_data), JSON.stringify(purchaseCustomDataForDb),
    JSON.stringify(rawPayloadForDb),
    dbEmailHash
  ]);

  // 4. Dispatch — with cross-site pixel dedup and health check
  if (sendToCapi && metaEnabled && pixel_id && capiToken && !skipHotmartDuplicateSideEffects) {
    // Health check: verifica se CAPI está saudável antes de enviar
    const capiHealthy = await capiService.isCapiHealthy(siteKey);
    if (!capiHealthy) {
      log.warn('CAPI not healthy, skipping immediate send (will retry via outbox)', {
        site_key: siteKey,
        order_id: orderId,
      });
      // Salva no outbox para retry posterior
      await capiService.saveToOutbox(siteKey, capiPayload, 'CAPI not healthy at webhook time');
    } else {
      // Dedup: verifica se outro site com o MESMO pixel já enviou este pedido com dados mais ricos
      let shouldSendCapi = true;
      try {
        const dupCheck = await pool.query(`
          SELECT p.fbc, p.fbp, p.site_key,
                 (p.user_data->>'client_ip_address') as has_ip
          FROM purchases p
          JOIN sites s ON s.site_key = p.site_key
          JOIN integrations_meta m ON m.site_id = s.id
          WHERE p.order_id = $1
            AND p.site_key != $2
            AND m.pixel_id = $3
          LIMIT 1
        `, [orderId, siteKey, pixel_id]);

        if (dupCheck.rowCount && dupCheck.rowCount > 0) {
          const sibling = dupCheck.rows[0];
          const siblingHasRichData = !!(sibling.fbc && sibling.fbp && sibling.has_ip);
          const currentHasRichData = !!(mergedFbcSafe && mergedFbpSafe && mergedIp);

          if (siblingHasRichData && !currentHasRichData) {
            log.info('CAPI dedup: skipping weaker Purchase', {
              order_id: orderId,
              site_key: siteKey,
              sibling_site: sibling.site_key,
            });
            shouldSendCapi = false;
          } else if (!siblingHasRichData && currentHasRichData) {
            log.info('CAPI dedup: sending richer Purchase', {
              order_id: orderId,
              site_key: siteKey,
            });
          } else {
            log.info('CAPI dedup: skipping duplicate Purchase', {
              order_id: orderId,
              site_key: siteKey,
              sibling_site: sibling.site_key,
            });
            shouldSendCapi = false;
          }
        }
      } catch (err) {
        log.error('CAPI dedup check error (proceeding with send)', { error: String(err) });
      }

      if (shouldSendCapi) {
        if (isPending) {
          log.info('Pending payment → sending as InitiateCheckout', { order_id: orderId });
        }
        sendCapiWithRetry(siteKey, capiPayload).catch(err => log.error('CAPI send error', { order_id: orderId, error: String(err) }));
      }
    }
  }

  if (sendToCapi && siteAccountId && !skipHotmartDuplicateSideEffects) {
    const pendingPaymentKind = resolvePendingPaymentKind(finalStatus, paymentMethodRaw, payload);
    const notifyKind: SaleNotifyKind =
      finalStatus === 'pending_payment' ? 'pending_payment' : 'sale';
    const notifyOpts = {
      amount: value,
      currency: resolvedCurrency,
      orderId,
      platform,
      productName: displayContentName,
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

  if (payload.hottok || payload.data?.hottok || payload.buyer?.email || payload.data?.buyer?.email) {
    const d = payload.data || payload;
    const buyer = d.buyer || payload.buyer || {};
    const purchase = d.purchase || payload.purchase || {};
    const commissions = d.commissions || (payload as { data?: { commissions?: unknown } }).data?.commissions || [];
    const purchaseStatus = purchase.status || d.status;
    const status = resolveHotmartStatusFromEvent(payload.event, purchaseStatus, d, payload);
    const trackingObj = recordOf(d.tracking || payload.tracking || {});
    const origin = recordOf(purchase.origin || trackingObj || {});
    const hmTrack = extractHotmartBrowserAndUtm(
      payload,
      recordOf(d),
      recordOf(purchase),
      recordOf(buyer),
      trackingObj,
      origin
    );
    const payloadForProcess =
      payload && typeof payload === 'object'
        ? ({ ...payload } as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    if (hmTrack.utm_source) payloadForProcess.utm_source = hmTrack.utm_source;
    if (hmTrack.utm_medium) payloadForProcess.utm_medium = hmTrack.utm_medium;
    if (hmTrack.utm_campaign) payloadForProcess.utm_campaign = hmTrack.utm_campaign;
    if (hmTrack.utm_content) payloadForProcess.utm_content = hmTrack.utm_content;
    if (hmTrack.utm_term) payloadForProcess.utm_term = hmTrack.utm_term;

    const rootProductName = String(
      (d.product as { name?: string } | undefined)?.name || (payload as { product?: { name?: string } }).product?.name || ''
    );
    const lines = buildHotmartCheckoutLines(payload, d, purchase, commissions, rootProductName);
    const purchaseTimestamp = resolveHotmartPurchaseTimestamp(payload, d, purchase);
    const buyerAddr = buyer.address || d.address || {};

    const email = buyer.email || payload.email;
    const firstName = buyer.first_name || buyer.name?.split(' ')[0];
    const lastName = buyer.last_name || buyer.name?.split(' ').slice(1).join(' ');
    const phone = buyer.checkout_phone || buyer.phone;

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
        `[Hotmart] Usando evento ${evLog} como aprovado (purchase.status ainda pendente) orders=${lines
          .map((l) => l.orderId)
          .join(',')}`
      );
    }

    for (const line of lines) {
      const result = await processPurchaseWebhook({
        siteKey,
        payload: payloadForProcess,
        email,
        phone,
        firstName,
        lastName,
        city: buyerAddr.city as string | undefined,
        state: buyerAddr.state as string | undefined,
        zip: buyerAddr.zipCode as string | undefined,
        country: (buyerAddr.country_iso || buyerAddr.country || 'BR') as string,
        fbp: hmTrack.fbp || fbp,
        fbc: hmTrack.fbc || fbc,
        externalId: (d as { user_id?: unknown }).user_id || buyer.document || buyer.id,
        clientIp: hmTrack.clientIp || undefined,
        clientUa: hmTrack.clientUa || undefined,
        value: line.value,
        currency: line.currency,
        status,
        orderId: line.orderId,
        platform: 'hotmart',
        contentName: line.contentName,
        saleLineLabel: line.saleLineLabel,
        purchaseTimestamp,
        paymentMethodRaw: extractPaymentMethodRaw(payload),
        contentId: (d.product as any)?.id || (d.product as any)?.offer_code,
      });
      if (!result.success) return res.status(result.status || 500).json({ error: result.error });
    }
    return res.json({ received: true, hotmart_lines: lines.length });
  }

  let platform = 'generic',
    email,
    firstName,
    lastName,
    phone,
    value,
    currency,
    status,
    orderId,
    city,
    state,
    zip,
    country,
    dob,
    contentName,
    purchaseTimestamp;

  if (payload.webhook_event_type || payload.Customer) {
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
    contentId: payload.product_id || payload.product?.id,
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

  const commissions = d.commissions || (payload as { data?: { commissions?: unknown } }).data?.commissions || [];
  const purchaseStatus = purchase.status || d.status;
  const status = resolveHotmartStatusFromEvent(payload.event, purchaseStatus, d, payload);
  const rootProductName = String(
    (d.product as { name?: string } | undefined)?.name || (payload as { product?: { name?: string } }).product?.name || ''
  );
  const lines = buildHotmartCheckoutLines(payload, d, purchase, commissions, rootProductName);
  const purchaseTimestamp = resolveHotmartPurchaseTimestamp(payload, d, purchase);

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
      `[Hotmart] Usando evento ${evLog} como aprovado (purchase.status ainda pendente) orders=${lines
        .map((l) => l.orderId)
        .join(',')}`
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

  for (const line of lines) {
    const result = await processPurchaseWebhook({
      siteKey,
      payload: payloadForProcess,
      email,
      phone,
      firstName,
      lastName,
      city: buyerAddr.city as string | undefined,
      state: buyerAddr.state as string | undefined,
      zip: (buyerAddr.zipcode ?? buyerAddr.zipCode) as string | undefined,
      country: (buyerAddr.country_iso || buyerAddr.country || 'BR') as string,
      fbp: hmTrack.fbp || undefined,
      fbc: hmTrack.fbc || undefined,
      externalId: (d as { user_id?: unknown }).user_id || buyer.document || buyer.id,
      clientIp: hmTrack.clientIp || undefined,
      clientUa: hmTrack.clientUa || undefined,
      value: line.value,
      currency: line.currency,
      status,
      orderId: line.orderId,
      platform: 'hotmart',
      contentName: line.contentName,
      saleLineLabel: line.saleLineLabel,
      purchaseTimestamp,
      paymentMethodRaw: extractPaymentMethodRaw(payload),
      contentId: (d.product as any)?.id || (d.product as any)?.offer_code,
    });

    if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  }

  return res.json({ received: true, hotmart_lines: lines.length });
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
    contentId: payload.Product?.id || payload.product_id,
  });
  return res.json({ received: true });
});

/** Quando não há campo textual de método, chaves como `boleto` / `pix` no JSON indicam o meio. */
function inferCustomPaymentMethodFromPayload(payload: unknown): string | undefined {
  if (payload == null || typeof payload !== 'object') return undefined;
  const scanKeys = (obj: unknown, depth: number): 'boleto' | 'pix' | null => {
    if (depth > 14 || !obj || typeof obj !== 'object') return null;
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const low = k.toLowerCase();
      if (low === 'boleto' || low.includes('billet') || low.includes('bank_slip') || low === 'bankslip') return 'boleto';
      if (low === 'pix' || low.endsWith('_pix') || low.startsWith('pix_')) return 'pix';
      const inner = scanKeys((obj as Record<string, unknown>)[k], depth + 1);
      if (inner) return inner;
    }
    return null;
  };
  const found = scanKeys(payload, 0);
  if (found === 'boleto') return 'BOLETO';
  if (found === 'pix') return 'PIX';
  return undefined;
}

function strOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/**
 * Plataformas (Monetizze, Ticto, etc.) enviam JSON direto, JSON em text/plain,
 * ou form-urlencoded com o objeto em `data` / `payload` / `body`. O body-parser
 * global só tratava JSON “puro” e podia deixar `req.body` vazio ou incompleto.
 */
export function parseCustomWebhookInbound(raw: Buffer, contentTypeHeader: string | undefined): Record<string, unknown> {
  const ct = (contentTypeHeader || '').toLowerCase().split(';')[0]?.trim() || '';
  const text = raw.toString('utf8');
  if (!text.trim()) return {};

  const tryParseObject = (s: string): Record<string, unknown> | null => {
    const t = s.trim();
    if (!t) return null;
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
      if (Array.isArray(o) && o.length === 1 && o[0] && typeof o[0] === 'object' && !Array.isArray(o[0])) {
        return o[0] as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  if (ct.includes('json') || ct === '' || ct === '*/*') {
    const parsed = tryParseObject(text);
    if (parsed) return parsed;
  }

  if (ct.includes('text/plain')) {
    const parsed = tryParseObject(text);
    if (parsed) return parsed;
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    const jsonKeys = ['data', 'payload', 'body', 'json', 'webhook', 'event', 'content', 'order', 'sale', 'transaction'];
    for (const k of jsonKeys) {
      const v = params.get(k);
      if (!v) continue;
      const parsed = tryParseObject(v);
      if (parsed) return parsed;
    }
    const flat: Record<string, unknown> = {};
    params.forEach((val, key) => {
      flat[key] = val;
    });
    return flat;
  }

  const heuristic = tryParseObject(text);
  if (heuristic) return heuristic;

  return {
    _ingest_warning: 'unrecognized_body_format',
    _content_type: contentTypeHeader || null,
    _raw_utf8_preview: text.slice(0, 12000),
  };
}

export const customWebhookRawBodyParser = bodyParser.raw({ type: '*/*', limit: '5mb' });

export function customWebhookParseBodyMiddleware(req: Request, _res: Response, next: NextFunction) {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const ct = req.headers['content-type'];
  req.body = parseCustomWebhookInbound(buf, typeof ct === 'string' ? ct : undefined);
  next();
}

/** POST /webhooks/custom/:id — registrado em main.ts antes do bodyParser.json global. */
export async function customWebhookPostHandler(req: Request, res: Response) {
  const webhookId = req.params.id;
  const payload = req.body as Record<string, unknown>;
  const hookRow = await pool.query(`SELECT c.*, s.site_key FROM custom_webhooks c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`, [webhookId]);
  if (!hookRow.rowCount) return res.status(404).json({ error: 'Not found' });
  const hook = hookRow.rows[0];
  await pool.query('UPDATE custom_webhooks SET last_payload = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(payload), webhookId]);
  if (!hook.is_active) return res.json({ received: true, mode: 'test' });

  const getNested = (obj: any, path: string) => path ? path.split('.').reduce((acc, part) => acc && acc[part], obj) : undefined;
  const config = hook.mapping_config || {};
  const defaults =
    config.defaults && typeof config.defaults === 'object' && !Array.isArray(config.defaults)
      ? (config.defaults as Record<string, unknown>)
      : {};

  const pick = (pathKey: string, defaultKey: string) => {
    const p = config[pathKey];
    if (typeof p === 'string' && p.trim()) {
      const from = strOrUndef(getNested(payload, p.trim()));
      if (from !== undefined) return from;
    }
    return strOrUndef(defaults[defaultKey]);
  };

  const email = typeof config.email === 'string' && config.email.trim() ? strOrUndef(getNested(payload, config.email.trim())) : undefined;
  const phone = pick('phone', 'phone');
  const firstName = pick('first_name', 'first_name');
  const lastName = pick('last_name', 'last_name');

  const amountPath = (config as { amount?: string; value?: string }).amount || (config as { value?: string }).value;
  const rawAmount = amountPath ? getNested(payload, amountPath) : undefined;
  const parsedValue =
    rawAmount != null && rawAmount !== '' && !Number.isNaN(Number(rawAmount)) ? Number(rawAmount) : 0;

  const currency = pick('currency', 'currency') || 'BRL';
  const status = pick('status', 'status');
  const orderFromPath =
    typeof config.order_id === 'string' && config.order_id.trim()
      ? strOrUndef(getNested(payload, config.order_id.trim()))
      : undefined;
  const orderId = orderFromPath || `c_${Date.now()}`;

  let paymentMethodRaw: string | undefined;
  if (typeof config.payment_method === 'string' && config.payment_method.trim()) {
    paymentMethodRaw = strOrUndef(getNested(payload, config.payment_method.trim()));
  }
  if (!paymentMethodRaw) paymentMethodRaw = strOrUndef(defaults.payment_method);
  if (!paymentMethodRaw) paymentMethodRaw = inferCustomPaymentMethodFromPayload(payload);

  const result = await processPurchaseWebhook({
    siteKey: hook.site_key,
    payload,
    email,
    phone,
    firstName,
    lastName,
    city: getNested(payload, config.city),
    state: getNested(payload, config.state),
    value: parsedValue,
    currency,
    status,
    orderId,
    platform: 'custom',
    paymentMethodRaw,
  });
  return res.json({ received: true });
}

router.post('/admin/provision', async (req, res) => {
  const secret = req.query.secret as string;
  if (secret !== (process.env.WEBHOOK_ADMIN_SECRET || 'WEBHOOK_ADMIN_SECRET')) return res.status(401).json({ error: 'Auth failed' });
  const payload = req.body.data || req.body;
  let email = payload.buyer?.email || payload.customer?.email || payload.email || payload.cus_email;
  let status = (payload.purchase?.status || payload.status || payload.order_status || '').toUpperCase();
  let offerCode = payload.purchase?.offer?.code || payload.product_id || payload.offer_code || '';

  if (!email) return res.status(400).json({ error: 'Missing email' });
  email = String(email).trim().toLowerCase();

  const userRow = await pool.query('SELECT account_id FROM users WHERE email = $1', [email]);
  let accountId = userRow.rowCount ? userRow.rows[0].account_id : null;

  // ── Encontrar plano pelo offer_code da Hotmart ──
  let matchedPlan: { id: number; name: string; max_sites: number; type: string } | null = null;
  if (offerCode) {
    const planRow = await pool.query(
      `SELECT id, name, type, max_sites FROM plans
       WHERE offer_codes IS NOT NULL AND offer_codes ILIKE '%' || $1 || '%'`,
      [String(offerCode).trim()]
    );
    if (planRow.rowCount) matchedPlan = planRow.rows[0] as any;
  }
  // Fallback: plano mais caro disponível
  if (!matchedPlan) {
    const fallback = await pool.query('SELECT id, name, type, max_sites FROM plans ORDER BY price DESC LIMIT 1');
    if (fallback.rowCount) matchedPlan = fallback.rows[0] as any;
  }

  log.info(`[Provision] email=${email} status=${status} offerCode=${offerCode} plan=${matchedPlan?.name || 'none'}`);

  if (['APPROVED', 'COMPLETED', 'PAID', 'PURCHASE_COMPLETE', 'PURCHASE_APPROVED'].includes(status)) {
    if (!accountId) {
      // ── Nova conta: criar account + user + enviar e-mail ──
      const resAcc = await pool.query(
        'INSERT INTO accounts (name, is_active, active_plan_id, bonus_site_limit) VALUES ($1, true, $2, $3) RETURNING id',
        [email.split('@')[0], matchedPlan?.id || null, matchedPlan?.max_sites || 1]
      );
      accountId = resAcc.rows[0].id;
      const pass = crypto.randomBytes(8).toString('hex');
      const hash = await bcrypt.hash(pass, 12);
      await pool.query('INSERT INTO users (account_id, email, password_hash) VALUES ($1, $2, $3)', [accountId, email, hash]);

      // Enviar e-mail de boas-vindas com dados de acesso usando o template configurável
      try {
        const { sendWelcomeEmail } = await import('../services/email');
        await sendWelcomeEmail(email, email.split('@')[0], pass, matchedPlan?.name);
      } catch (emailErr) {
        console.warn('[Provision] Failed to send welcome email:', emailErr);
      }
    } else {
      // ── Conta existente: reativar e atualizar plano se necessário ──
      if (matchedPlan?.type === 'SUBSCRIPTION') {
        await pool.query(
          'UPDATE accounts SET is_active = true, active_plan_id = $2, bonus_site_limit = COALESCE($3, bonus_site_limit) WHERE id = $1',
          [accountId, matchedPlan.id, matchedPlan.max_sites]
        );
      } else {
        // Se for ADDON, não sobrepõe o active_plan_id, apenas atualiza o status se estivesse bloqueado
        await pool.query('UPDATE accounts SET is_active = true WHERE id = $1', [accountId]);
      }
    }
  } else if (['CANCELED', 'CANCELLED', 'REFUNDED', 'PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'EXPIRED', 'PURCHASE_EXPIRED'].includes(status) && accountId) {
    if (matchedPlan?.type === 'ADDON') {
      // Se cancelou o "Site Extra", reduzimos o limite, mas não suspendemos a conta inteira!
      await pool.query(
        'UPDATE accounts SET bonus_site_limit = GREATEST(1, bonus_site_limit - $2) WHERE id = $1',
        [accountId, matchedPlan.max_sites]
      );
    } else {
      // Se cancelou o plano base, bloqueia a conta inteira
      await pool.query('UPDATE accounts SET is_active = false WHERE id = $1', [accountId]);
    }
  }

  // ── Registrar subscription (com plan_id para não violar NOT NULL) ──
  if (accountId && matchedPlan) {
    try {
      await pool.query(
        `INSERT INTO subscriptions (account_id, plan_id, status, provider_subscription_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [accountId, matchedPlan.id, status, payload.transaction || payload.id || `hotmart_${Date.now()}`]
      );
    } catch (subErr) {
      console.warn('[Provision] Failed to insert subscription:', subErr);
    }
  }

  return res.json({ success: true, accountId, plan: matchedPlan?.name || null });
});

export default router;

