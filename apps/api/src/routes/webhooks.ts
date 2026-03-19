import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { capiService, CapiService } from '../services/capi';
import { EnrichmentService } from '../services/enrichment';
import { decryptString } from '../lib/crypto';
import { notifyAccountNewSale } from '../services/expo-push';


const router = Router();

const normalizeStatus = (rawStatus: unknown) => {
  const s = String(rawStatus || '').toLowerCase().trim();

  // Status que indicam compra aprovada/confirmada
  const approvedStatuses = [
    'approved', 'completed', 'complete', 'paid', 'active',
    'approved_by_acquirer', 'purchase_complete', 'confirmed',
    'waiting_payment', // Hotmart gera boleto — conta como lead qualificado
  ];

  // Status que indicam reembolso/cancelamento — NÃO gerar Purchase CAPI
  const refundStatuses = [
    'refunded', 'refund', 'cancelled', 'canceled', 'dispute',
    'chargeback', 'chargedback', 'expired', 'blocked',
    'purchase_refunded', 'purchase_chargeback', 'purchase_canceled',
    'purchase_expired', 'purchase_protest', 'purchase_delayed',
  ];

  if (refundStatuses.includes(s)) {
    return { finalStatus: s, isApproved: false };
  }

  if (approvedStatuses.includes(s)) {
    return { finalStatus: 'approved', isApproved: true };
  }

  // Status desconhecido — loga para debug mas trata como aprovado
  // para não perder conversões legítimas de plataformas com status custom
  console.warn(`[Webhook] Unknown status "${s}" — treating as approved. Review if this is correct.`);
  return { finalStatus: 'approved', isApproved: true };
};

// â”€â”€â”€ Core Ingestion Engine for all Webhooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function processPurchaseWebhook({
  siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
  fbp, fbc, externalId, clientIp, clientUa, value, currency, status, orderId, platform, contentName,
  purchaseTimestamp,
}: any) {
  const { finalStatus, isApproved } = normalizeStatus(status);
  console.log(`[Webhook] processPurchaseWebhook called: value=${value} currency=${currency} status=${finalStatus} orderId=${orderId} platform=${platform} siteKey=${siteKey}`);

  const siteRow = await pool.query(`
    SELECT sites.id, sites.account_id, m.capi_token_enc, m.pixel_id, m.capi_test_event_code, m.enabled
    FROM sites
    LEFT JOIN integrations_meta m ON m.site_id = sites.id
    WHERE sites.site_key = $1
  `, [siteKey]);

  if (!siteRow.rowCount) return { success: false, status: 404, error: 'Site not found' };
  const { id: siteId, account_id: siteAccountId, capi_token_enc, pixel_id, capi_test_event_code, enabled: metaEnabled } = siteRow.rows[0];

  const dbEmailHash = email ? CapiService.hash(email) : null;

  // Extract tracking token from payload if present (works for both approved and non-approved)
  let trkEid = '';
  let trkFbc = '';
  let trkFbp = '';
  const sckRaw = payload.sck || payload.src || '';
  if (typeof sckRaw === 'string' && sckRaw.includes('trk_')) {
    try {
      const parts = sckRaw.split('-');
      const trkPart = parts.find((p: string) => p.startsWith('trk_')) || (sckRaw.startsWith('trk_') ? sckRaw : undefined);
      if (trkPart) {
        const b64 = trkPart.substring(4);
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        const ids = decoded.split('|');
        if (ids[0]) trkEid = ids[0];
        if (ids[1]) trkFbc = ids[1];
        if (ids[2]) trkFbp = ids[2];
      }
    } catch (e) {
      console.error('[Webhook] Failed to decode trk_ parameter:', e);
    }
  }

  const finalExternalId = trkEid || externalId;
  const finalFbc = trkFbc || fbc;
  const finalFbp = trkFbp || fbp;

  // [NEW] Enrichment Step: Try to find missing data in DB
  let enriched: any = {};
  // Verifica se faltam dados CRÍTICOS para qualidade do evento (IP, UA, FBC, FBP)
  if (!finalFbp || !finalFbc || !clientIp || !clientUa || !payload.utm_source) {
    console.log(`[Webhook] Missing critical data (fbp=${finalFbp}, ip=${clientIp}, ua=${clientUa}). Attempting enrichment for ${email || phone}...`);
    enriched = await EnrichmentService.findVisitorData(siteKey, email, phone);

    if (enriched) {
      console.log(`[Webhook] Enrichment success: found fbp=${enriched.fbp}, ip=${enriched.clientIp}, ua=${enriched.clientUa}`);
    } else {
      console.log(`[Webhook] Enrichment failed: user not found in history.`);
    }
  }

  // Merge enriched data (prioritize payload/tracking, fallback to DB)
  const mergedFbp = finalFbp || enriched?.fbp;
  const mergedFbc = finalFbc || enriched?.fbc;
  const mergedExternalId = finalExternalId || enriched?.externalId;
  const mergedIp = clientIp || enriched?.clientIp;
  const mergedUa = clientUa || enriched?.clientUa;

  // UTMs priority: Payload > Enriched
  const utmSource = payload.utm_source || payload.trackingParameters?.utm_source || payload.tracking_parameters?.utm_source || (payload.sck && !String(payload.sck).startsWith('trk_') ? payload.sck : undefined) || (payload.src && !String(payload.src).startsWith('trk_') ? payload.src : undefined) || enriched?.utmSource || undefined;
  const utmMedium = payload.utm_medium || payload.trackingParameters?.utm_medium || payload.tracking_parameters?.utm_medium || enriched?.utmMedium || undefined;
  const utmCampaign = payload.utm_campaign || payload.trackingParameters?.utm_campaign || payload.tracking_parameters?.utm_campaign || enriched?.utmCampaign || undefined;
  const utmTerm = payload.utm_term || payload.trackingParameters?.utm_term || payload.tracking_parameters?.utm_term || enriched?.utmTerm || undefined;
  const utmContent = payload.utm_content || payload.trackingParameters?.utm_content || payload.tracking_parameters?.utm_content || enriched?.utmContent || undefined;

  // Enrich payload for UI visibility (so user sees what we extracted)
  if (mergedFbp) payload._extracted_fbp = mergedFbp;
  if (mergedFbc) payload._extracted_fbc = mergedFbc;
  if (mergedExternalId) payload._extracted_external_id = mergedExternalId;
  if (sckRaw) payload._source_token = sckRaw;
  if (enriched) payload._enrichment_source = 'db_history';

  // Use native purchase timestamp when available, fallback to now
  const eventTimeSec = purchaseTimestamp
    ? Math.floor(new Date(purchaseTimestamp).getTime() / 1000) || Math.floor(Date.now() / 1000)
    : Math.floor(Date.now() / 1000);

  const capiPayload: any = {
    event_name: 'Purchase',
    event_time: eventTimeSec,
    event_id: `purchase_${orderId}`,
    event_source_url: payload.checkout_url || '',
    user_data: {
      client_ip_address: mergedIp,
      client_user_agent: mergedUa,
      em: email ? CapiService.hash(email) : undefined,
      ph: phone ? CapiService.hash((() => {
        let p = phone.replace(/[^0-9]/g, '');
        if (p && p.length <= 11 && (!country || country.toUpperCase() === 'BR' || country.toUpperCase() === 'BRASIL')) {
          p = '55' + p;
        }
        return p;
      })()) : undefined,
      fn: firstName ? CapiService.hash(firstName.toLowerCase()) : undefined,
      ln: lastName ? CapiService.hash(lastName.toLowerCase()) : undefined,
      ct: city ? CapiService.hash(city.toLowerCase()) : undefined,
      st: state ? CapiService.hash(state.toLowerCase()) : undefined,
      zp: zip ? CapiService.hash(zip.replace(/\s+/g, '').toLowerCase()) : undefined,
      country: country ? CapiService.hash(country.toLowerCase()) : undefined,
      db: dob ? CapiService.hash(dob.replace(/[^0-9]/g, '')) : undefined,
      fbp: mergedFbp,
      fbc: mergedFbc,
      external_id: (() => {
        const ids = [];
        if (mergedExternalId) ids.push(CapiService.hash(String(mergedExternalId)));
        if (externalId && String(externalId) !== String(mergedExternalId)) ids.push(CapiService.hash(String(externalId)));
        return ids.length > 0 ? ids : undefined;
      })(),
    },
    action_source: 'website',
    custom_data: {
      currency: currency,
      value: value,
      content_name: contentName || undefined,
      content_type: 'product',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_term: utmTerm,
      utm_content: utmContent,
    }
  };

  if (capi_test_event_code) {
    capiPayload.test_event_code = capi_test_event_code;
  }

  // Inject Debug Info into Payload (saved to DB for UI inspection)
  payload._capi_debug = capiPayload;

  // Enrichment audit trail for debugging match quality
  payload._match_quality = {
    has_email: !!email,
    has_phone: !!phone,
    has_fbp: !!mergedFbp,
    has_fbc: !!mergedFbc,
    has_external_id: !!mergedExternalId,
    has_ip: !!mergedIp,
    has_ua: !!mergedUa,
    has_utms: !!utmSource,
    enrichment_used: !!enriched?.fbp || !!enriched?.clientIp,
    fbp_source: finalFbp ? 'webhook' : enriched?.fbp ? 'db_enrichment' : 'none',
    fbc_source: finalFbc ? 'webhook' : enriched?.fbc ? 'db_enrichment' : 'none',
    ip_source: clientIp ? 'webhook' : enriched?.clientIp ? 'db_enrichment' : 'none',
    event_time_source: purchaseTimestamp ? 'platform_native' : 'server_now',
  };

  // Update site_visitors with buyer data (so future lookups can find this person)
  if (dbEmailHash || mergedFbp) {
    const visitorExtId = mergedExternalId ? CapiService.hash(String(mergedExternalId)) : (dbEmailHash || `buyer_${orderId}`);
    const phoneHash = phone ? CapiService.hash((() => {
      let p = phone.replace(/[^0-9]/g, '');
      if (p.length <= 11) p = '55' + p;
      return p;
    })()) : null;

    pool.query(`
      INSERT INTO site_visitors (
        site_key, external_id, fbc, fbp, email_hash, phone_hash,
        first_name_hash, last_name_hash, last_traffic_source,
        total_events, last_event_name, last_ip, last_user_agent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'Purchase',$10,$11)
      ON CONFLICT (site_key, external_id) DO UPDATE SET
        fbc = COALESCE(EXCLUDED.fbc, site_visitors.fbc),
        fbp = COALESCE(EXCLUDED.fbp, site_visitors.fbp),
        email_hash = COALESCE(EXCLUDED.email_hash, site_visitors.email_hash),
        phone_hash = COALESCE(EXCLUDED.phone_hash, site_visitors.phone_hash),
        first_name_hash = COALESCE(EXCLUDED.first_name_hash, site_visitors.first_name_hash),
        last_name_hash = COALESCE(EXCLUDED.last_name_hash, site_visitors.last_name_hash),
        last_traffic_source = COALESCE(EXCLUDED.last_traffic_source, site_visitors.last_traffic_source),
        last_event_name = 'Purchase',
        last_ip = COALESCE(EXCLUDED.last_ip, site_visitors.last_ip),
        last_user_agent = COALESCE(EXCLUDED.last_user_agent, site_visitors.last_user_agent),
        total_events = site_visitors.total_events + 1,
        last_seen_at = NOW()
    `, [
      siteKey, visitorExtId, mergedFbc, mergedFbp, dbEmailHash, phoneHash,
      firstName ? CapiService.hash(firstName.toLowerCase()) : null,
      lastName ? CapiService.hash(lastName.toLowerCase()) : null,
      utmSource ? `utm_source=${utmSource}${utmMedium ? '&utm_medium=' + utmMedium : ''}${utmCampaign ? '&utm_campaign=' + utmCampaign : ''}` : null,
      mergedIp, mergedUa,
    ]).catch(err => console.error('[Webhook] site_visitors UPSERT error:', err));
  }

  if (isApproved) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO purchases (site_key, order_id, platform, amount, currency, status, buyer_email_hash, fbp, fbc, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (site_key, order_id) DO UPDATE SET
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           raw_payload = EXCLUDED.raw_payload,
           fbp = EXCLUDED.fbp,
           fbc = EXCLUDED.fbc`,
        [siteKey, orderId, platform, value, currency, finalStatus, dbEmailHash, mergedFbp, mergedFbc, JSON.stringify(payload)]
      );

      // Salvar no outbox dentro da transação (será removido se CAPI direto funcionar)
      let outboxId: number | null = null;
      if (metaEnabled && pixel_id && capi_token_enc) {
        const outboxRes = await client.query(
          `INSERT INTO capi_outbox (site_key, payload) VALUES ($1, $2) RETURNING id`,
          [siteKey, JSON.stringify(capiPayload)]
        );
        outboxId = outboxRes.rows[0]?.id ?? null;
      }

      await client.query('COMMIT');

      // Após COMMIT, tentar enviar direto ao CAPI (e remover do outbox se sucesso)
      if (outboxId !== null) {
        const result = await capiService.sendEventDetailed(siteKey, capiPayload);
        if (result.ok) {
          console.log(`[Webhook] Purchase CAPI sent directly for order ${orderId}`);
          await pool.query('DELETE FROM capi_outbox WHERE id = $1', [outboxId]);
        } else {
          console.warn(`[Webhook] Direct CAPI send failed, kept in outbox (id=${outboxId}): ${result.error}`);
        }
      }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { });
      console.error('[Webhook] DB Error:', e);
      return { success: false, status: 500, error: 'DB insert failed' };
    } finally {
      client.release();
    }

    // Push notification to mobile app (fire-and-forget)
    if (siteAccountId != null) {
      pool
        .query('SELECT push_token FROM push_tokens WHERE account_id = $1', [siteAccountId])
        .then((rows) => {
          if (rows.rowCount && rows.rows.length > 0) {
            return notifyAccountNewSale(rows.rows, {
              amount: value != null ? Number(value) : undefined,
              currency: currency || undefined,
              orderId,
              platform: platform || undefined,
            });
          }
        })
        .catch((err) => console.warn('[Webhook] Push notify error:', err));
    }
  } else {
    try {
      await pool.query(
        `INSERT INTO purchases (site_key, order_id, platform, amount, currency, status, buyer_email_hash, fbp, fbc, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (site_key, order_id) DO UPDATE SET
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           raw_payload = EXCLUDED.raw_payload,
           fbp = EXCLUDED.fbp,
           fbc = EXCLUDED.fbc`,
        [siteKey, orderId, platform, value, currency, finalStatus, dbEmailHash, mergedFbp, mergedFbc, JSON.stringify(payload)]
      );
    } catch (e) {
      console.error('[Webhook] Refund DB DB Error:', e);
      return { success: false, status: 500, error: 'DB insert failed' };
    }
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

  // AutenticaÃ§Ã£o Simplificada (Token na URL) - Para plataformas como Hotmart/Kiwify
  const token = req.query.token as string | undefined;
  if (token) {
    const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
    if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });

    const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
    if (token !== secret) return res.status(401).json({ error: 'Invalid webhook token' });

    // Se o token for vÃ¡lido, prossegue sem checar assinatura/timestamp
  } else {
    // AutenticaÃ§Ã£o HMAC (PadrÃ£o seguro)
    if (!signature || !timestamp) return res.status(401).json({ error: 'Missing webhook signature' });
    const toleranceSeconds = Number(process.env.WEBHOOK_TOLERANCE_SECONDS || 300);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return res.status(401).json({ error: 'Invalid webhook timestamp' });
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > toleranceSeconds) return res.status(401).json({ error: 'Webhook timestamp out of tolerance' });

    const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
    if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });
    const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString()}`)
      .digest('hex');
    if (expected !== signature) return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload structure' });
  }

  // ExtraÃ§Ã£o de dados (fbp/fbc vindos da URL do checkout)
  const fbp = payload.fbp || payload.custom_args?.fbp;
  const fbc = payload.fbc || payload.custom_args?.fbc;

  // Multi-platform Parsers (Hotmart, Kiwify, Eduzz, Generic)
  let platform = 'generic';
  let email, firstName, lastName, phone, value, currency, status, orderId, city, state, zip, country, dob, contentName;
  let purchaseTimestamp: string | undefined;

  if (payload.hottok || payload.product?.id || payload.buyer?.email) {
    platform = 'hotmart';
    email = payload.buyer?.email || payload.email;
    firstName = payload.buyer?.name?.split(' ')[0] || payload.first_name;
    lastName = payload.buyer?.name?.split(' ').slice(1).join(' ') || payload.last_name;
    phone = payload.buyer?.phone || payload.buyer?.checkout_phone || payload.phone;
    const hotmartCommissionValue =
      payload.data?.commissions?.[1]?.value ??
      payload.commissions?.[1]?.value;
    value = hotmartCommissionValue ?? payload.purchase?.full_price?.value ?? payload.amount ?? 0;
    currency = payload.purchase?.full_price?.currency_value || payload.currency || 'BRL';
    status = payload.purchase?.status || payload.status;
    orderId = payload.purchase?.transaction || payload.transaction || payload.id;
    city = payload.buyer?.address?.city;
    state = payload.buyer?.address?.state;
    zip = payload.buyer?.address?.zipCode || payload.buyer?.address?.zip_code;
    country = payload.buyer?.address?.country || payload.buyer?.address?.country_iso;
    contentName = payload.product?.name;
    purchaseTimestamp = payload.purchase?.approved_date || payload.purchase?.order_date || payload.creation_date;
  } else if (payload.webhook_event_type || payload.Customer) {
    platform = 'kiwify';
    email = payload.Customer?.email || payload.email;
    firstName = payload.Customer?.first_name || payload.first_name;
    lastName = payload.Customer?.last_name || payload.last_name;
    phone = payload.Customer?.mobile || payload.Customer?.phone || payload.phone;
    value = payload.order?.payment?.total || payload.amount || 0;
    // Kiwify total might be in cents
    if (value > 1000 && payload.order?.payment?.total) value = value / 100;
    currency = payload.order?.payment?.currency || payload.currency || 'BRL';
    status = payload.order?.status || payload.status;
    orderId = payload.order?.order_id || payload.order_id || payload.id;
    city = payload.Customer?.city;
    state = payload.Customer?.state;
    zip = payload.Customer?.zipcode;
    country = 'BR'; // Kiwify is mainly BR
    contentName = payload.Product?.name || payload.product_name;
    purchaseTimestamp = payload.order?.created_at || payload.created_at;
  } else if (payload.transacao_id || payload.cus_email || payload.eduzz_id) {
    platform = 'eduzz';
    email = payload.cus_email || payload.email;
    firstName = payload.cus_name?.split(' ')[0] || payload.first_name;
    lastName = payload.cus_name?.split(' ').slice(1).join(' ') || payload.last_name;
    phone = payload.cus_cel || payload.phone;
    value = payload.transacao_valor || payload.amount || 0;
    currency = payload.transacao_moeda || payload.currency || 'BRL';
    status = payload.transacao_status_id || payload.status;
    orderId = payload.transacao_id || payload.id;
    city = payload.cus_cidade;
    state = payload.cus_estado;
    zip = payload.cus_cep;
    country = 'BR';
    contentName = payload.tit_nome || payload.product_name;
    purchaseTimestamp = payload.transacao_data_criacao;
  } else {
    // Generic
    const pickStr = (keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = payload[k] || payload.custom_args?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return undefined;
    };
    email = payload.email || payload.buyer_email;
    firstName = pickStr(['first_name', 'firstname', 'nome', 'buyer_name', 'name']);
    lastName = pickStr(['last_name', 'lastname', 'sobrenome']); // se 'name' tiver tudo, o CAPI hash lida com isso se fn/ln forem separados depois

    // Fix: Se fn tem espaço e ln está vazio, separa automaticamente (padrão CAPI)
    // Ex: "João Silva" -> fn="joão", ln="silva"
    // Ex: "teste27" -> fn="teste27", ln=undefined (correto)
    if (firstName && !lastName && firstName.trim().includes(' ')) {
      const parts = firstName.trim().split(/\s+/);
      if (parts.length >= 2) {
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      }
    }

    phone = pickStr(['phone', 'buyer_phone', 'telefone', 'cel']);
    city = pickStr(['city', 'cidade', 'buyer_city']);
    state = pickStr(['state', 'estado', 'buyer_state', 'uf']);
    zip = pickStr(['zip', 'cep', 'zipcode', 'postal_code', 'zip_code']);
    country = pickStr(['country', 'pais', 'country_code']);
    dob = pickStr(['dob', 'birth_date', 'birthday', 'data_nascimento']);
    value = payload.amount || payload.value || payload.price || payload.full_price || 0;
    currency = payload.currency || 'BRL';
    status = payload.status;
    orderId = payload.id || payload.order_id || payload.transaction_id || payload.transaction || `webhook_${Date.now()}`;
    contentName = pickStr(['product_name', 'product', 'nome_produto', 'item_name', 'content_name']);
    purchaseTimestamp = pickStr(['created_at', 'purchase_date', 'date', 'timestamp']);
  }

  const { finalStatus } = normalizeStatus(status);

  const result = await processPurchaseWebhook({
    siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
    fbp, fbc, externalId: payload.user_id || payload.buyer?.id || payload.Customer?.id,
    clientIp: payload.client_ip_address || payload.ip || undefined,
    clientUa: payload.client_user_agent || payload.user_agent || undefined,
    value, currency, status: finalStatus, orderId, platform, contentName,
    purchaseTimestamp,
  });

  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

// â”€â”€â”€ Native Hotmart Webhook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/hotmart', async (req, res) => {
  const siteKey = req.query.key as string;
  const token = req.query.token as string;
  if (!siteKey || !token) return res.status(400).json({ error: 'Missing key or token' });

  const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
  if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });

  const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
  if (token !== secret) return res.status(401).json({ error: 'Invalid webhook token' });

  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  console.log(`[Hotmart] RAW PAYLOAD KEYS: ${JSON.stringify(Object.keys(payload))}`);
  console.log(`[Hotmart] payload.data type: ${typeof payload.data}, keys: ${payload.data ? JSON.stringify(Object.keys(payload.data)) : 'N/A'}`);
  console.log(`[Hotmart] payload.data?.purchase: ${JSON.stringify(payload.data?.purchase)?.slice(0, 300)}`);

  // Hotmart v2 nests everything under payload.data; v1 uses payload directly
  const d = payload.data || payload;

  const fbp = d.fbp || d.custom_args?.fbp || payload.fbp;
  const fbc = d.fbc || d.custom_args?.fbc || payload.fbc;
  const platform = 'hotmart';

  const buyer = d.buyer || payload.buyer || {};
  const purchase = d.purchase || payload.purchase || {};

  // Extract Origin data from Hotmart (where UTMs and tracking tokens usually live)
  const trackingObj = d.tracking || payload.tracking || {};
  const origin = purchase.origin || trackingObj || {};

  if (origin.sck || trackingObj.source) payload.sck = origin.sck || trackingObj.source;
  if (origin.src) payload.src = origin.src;
  if (origin.xcod) payload.xcod = origin.xcod;
  if (d.sck && !payload.sck) payload.sck = d.sck; // Some versions put it at the root

  // Extract UTMs if present in origin (Hotmart sometimes sends them here)
  if (origin.utm_source || trackingObj.utm_source) payload.utm_source = origin.utm_source || trackingObj.utm_source;
  if (origin.utm_medium || trackingObj.utm_medium) payload.utm_medium = origin.utm_medium || trackingObj.utm_medium;
  if (origin.utm_campaign || trackingObj.utm_campaign) payload.utm_campaign = origin.utm_campaign || trackingObj.utm_campaign;
  if (origin.utm_content || trackingObj.utm_content) payload.utm_content = origin.utm_content || trackingObj.utm_content;
  if (origin.utm_term || trackingObj.utm_term) payload.utm_term = origin.utm_term || trackingObj.utm_term;

  const email = buyer.email || payload.email;
  const firstName = buyer.first_name || buyer.name?.split(' ')[0] || payload.first_name;
  const lastName = buyer.last_name || buyer.name?.split(' ').slice(1).join(' ') || payload.last_name;
  const phone = buyer.checkout_phone || buyer.phone || payload.phone;

  const hotmartCommissionValue =
    d.commissions?.[1]?.value ??
    payload.data?.commissions?.[1]?.value;

  const rawValue =
    hotmartCommissionValue ??
    purchase.full_price?.value ??
    purchase.price?.value ??
    purchase.amount ??
    purchase.total ??
    d.amount ?? d.price ?? d.value ?? d.full_price ?? 0;
  const value = parseFloat(String(rawValue)) || 0;
  const currency = purchase.full_price?.currency_value || purchase.price?.currency_value || d.currency || 'BRL';
  console.log(`[Hotmart] orderId=${purchase.transaction} status=${purchase.status} rawValue=${rawValue} parsedValue=${value} currency=${currency}`);

  let rawStatus = purchase.status || d.status || payload.event;
  let status = rawStatus; // Pass raw status to main handler for normalization

  const orderId = purchase.transaction || d.transaction || d.transaction_id || payload.id || `webhook_${Date.now()}`;
  const buyerAddr = buyer.address || d.address || {};
  const city = buyerAddr.city || d.city;
  const state = buyerAddr.state || d.state;
  const zip = buyerAddr.zipcode || buyerAddr.zip_code || d.zip_code;
  const country = buyerAddr.country_iso || buyerAddr.country || d.country || 'BR';
  const dob = undefined;

  const result = await processPurchaseWebhook({
    siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
    fbp, fbc, externalId: d.user_id || buyer.document || buyer.id,
    clientIp: d.client_ip_address || payload.ip || undefined,
    clientUa: d.client_user_agent || payload.user_agent || undefined,
    value, currency, status, orderId, platform,
    contentName: d.product?.name || payload.product?.name,
    purchaseTimestamp: purchase.approved_date || purchase.order_date || d.creation_date,
  });

  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

// â”€â”€â”€ Native Kiwify Webhook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/kiwify', async (req, res) => {
  const siteKey = req.query.key as string;
  const token = req.query.token as string;
  if (!siteKey || !token) return res.status(400).json({ error: 'Missing key or token' });

  const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
  if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });

  const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
  if (token !== secret) return res.status(401).json({ error: 'Invalid webhook token' });

  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid payload' });

  // Use tracking info if present
  const fbp = payload.tracking?.fbp || payload.fbp;
  const fbc = payload.tracking?.fbc || payload.fbc;
  const platform = 'kiwify';

  const email = payload.customer?.email;
  const nameParts = (payload.customer?.name || '').split(' ');
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');
  const phone = payload.customer?.mobile || payload.customer?.phone;

  // net_amount is 100000 -> 1000.00
  let value = payload.net_amount || payload.amount || 0;
  if (value > 0 && Number.isInteger(value)) {
    value = value / 100; // Kiwify sends cents in net_amount
  }
  const currency = payload.order?.payment?.currency || payload.currency || 'BRL';

  let status = payload.status; // Pass raw status to main handler

  const orderId = payload.id || `webhook_${Date.now()}`;
  const city = payload.customer?.address?.city;
  const state = payload.customer?.address?.state;
  const zip = payload.customer?.address?.zipcode;
  const country = payload.customer?.country || 'BR';
  const dob = undefined;

  // Add Kiwify Tracking data into payload temporarily so processPurchaseWebhook can pick it up
  if (payload.tracking) {
    if (payload.tracking.sck) payload.sck = payload.tracking.sck;
    if (payload.tracking.utm_source) payload.utm_source = payload.tracking.utm_source;
    if (payload.tracking.utm_medium) payload.utm_medium = payload.tracking.utm_medium;
    if (payload.tracking.utm_campaign) payload.utm_campaign = payload.tracking.utm_campaign;
    if (payload.tracking.utm_content) payload.utm_content = payload.tracking.utm_content;
    if (payload.tracking.utm_term) payload.utm_term = payload.tracking.utm_term;
  }

  const result = await processPurchaseWebhook({
    siteKey, payload, email, phone, firstName, lastName, city, state, zip, country, dob,
    fbp, fbc, externalId: payload.customer?.email,
    clientIp: payload.client_ip || undefined,
    clientUa: payload.client_user_agent || undefined,
    value, currency, status, orderId, platform,
    contentName: payload.Product?.name || payload.product_name,
    purchaseTimestamp: payload.order?.created_at || payload.created_at,
  });

  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

// â”€â”€â”€ Custom Webhook (Mapped) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/custom/:id', async (req, res) => {
  const webhookId = req.params.id;
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload structure' });
  }

  if (!webhookId) return res.status(400).json({ error: 'Missing webhook ID' });

  // Pega o webhook e a site_key atrelada a ele
  console.log(`[Webhook Custom] Received POST for webhook ${webhookId}`);
  const hookRow = await pool.query(`
    SELECT c.site_id, c.is_active, c.mapping_config, s.site_key
    FROM custom_webhooks c
    JOIN sites s ON s.id = c.site_id
    WHERE c.id = $1
  `, [webhookId]);

  if (!hookRow.rowCount) return res.status(404).json({ error: 'Webhook not found' });
  const hook = hookRow.rows[0];

  // Sempre atualizar o last_payload para a UI do painel ter a versÃ£o mais recente
  console.log(`[Webhook Custom] Updating last_payload for webhook ${webhookId}`);
  await pool.query('UPDATE custom_webhooks SET last_payload = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(payload), webhookId]);

  // Se o webhook nÃ£o estiver ativo, significa que estamos apenas em "modo de captura"
  // O usuÃ¡rio disparou para pegar as chaves na UI.
  if (!hook.is_active) {
    console.log(`[Webhook Custom] Webhook ${webhookId} is inactive, saved payload for UI mapping.`);
    return res.json({ received: true, mode: 'test_capture' });
  }

  // Se estiver ativo, usamos o mapping_config para extrair as variÃ¡veis
  const config = hook.mapping_config || {};

  // FunÃ§Ã£o helper para acessar propriedades aninhadas num JSON baseado no path tipo "customer.email"
  const getNested = (obj: any, path: string) => {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  const email = getNested(payload, config.email);
  const phone = getNested(payload, config.phone);
  const firstName = getNested(payload, config.first_name);
  const lastName = getNested(payload, config.last_name);
  const orderIdRaw = getNested(payload, config.order_id);
  const orderId = orderIdRaw ? String(orderIdRaw) : `custom_${Date.now()}`;
  const value = getNested(payload, config.amount) || getNested(payload, config.value) || 0;
  const currency = getNested(payload, config.currency) || 'BRL';
  const rawStatus = getNested(payload, config.status);

  // Custom SRC ou SCK
  if (config.sck) payload.sck = getNested(payload, config.sck);
  if (config.src) payload.src = getNested(payload, config.src);

  let status = rawStatus; // Pass raw status to main handler

  const result = await processPurchaseWebhook({
    siteKey: hook.site_key, payload, email, phone, firstName, lastName,
    city: getNested(payload, config.city), state: getNested(payload, config.state),
    zip: getNested(payload, config.zip), country: getNested(payload, config.country),
    fbp: payload.fbp || payload.custom_args?.fbp, fbc: payload.fbc || payload.custom_args?.fbc,
    externalId: getNested(payload, config.external_id),
    clientIp: getNested(payload, config.client_ip) || undefined,
    clientUa: getNested(payload, config.client_ua) || undefined,
    value, currency, status, orderId, platform: 'custom',
    contentName: getNested(payload, config.content_name) || getNested(payload, config.product_name),
    purchaseTimestamp: getNested(payload, config.created_at) || getNested(payload, config.purchase_date),
  });

  if (!result.success) return res.status(result.status || 500).json({ error: result.error });
  return res.json({ received: true });
});

// ─── SaaS Webhook (Admin Provisioning from Hotmart, Kiwify, Eduzz) ──────────────────────────────────────────────────
router.post('/admin/provision', async (req, res) => {
  const secret = req.query.secret as string;
  const expectedSecret = process.env.WEBHOOK_ADMIN_SECRET || 'WEBHOOK_ADMIN_SECRET';

  if (!secret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid or missing secret' });
  }

  const payload = req.body.data || req.body;
  if (!payload) return res.status(400).json({ error: 'Empty payload' });

  // Parsing logic for Multi-platform
  let email = '';
  let status = '';
  let offerCode = '';

  // Hotmart Parsing
  if (payload.hottok || payload.buyer || payload.purchase) {
    const buyer = payload.buyer || {};
    const purchase = payload.purchase || {};
    const offer = purchase.offer || {};
    email = buyer.email;
    status = (purchase.status || '').toUpperCase();
    offerCode = offer.code || '';
  }
  // Kiwify Parsing
  else if (payload.webhook_event_type || payload.Customer) {
    const customer = payload.Customer || {};
    email = customer.email || payload.email;
    status = (payload.order_status || '').toUpperCase();
    // Kiwify might not have an "offer code" matching Hotmart, but maybe a product id or link
    offerCode = payload.Product?.id || payload.product_id || '';
  }
  // Eduzz Parsing
  else if (payload.transacao_id || payload.cus_email || payload.eduzz_id) {
    email = payload.cus_email || payload.email;
    status = (payload.transacao_statusName || payload.transacao_status || '').toUpperCase();
    offerCode = payload.product_id || payload.produto_id || payload.contrato_id || '';
  }
  // Fallback (Generic custom webhook mapping)
  else {
    email = payload.email || payload.buyer_email;
    status = (payload.status || payload.order_status || '').toUpperCase();
    offerCode = payload.offer_code || payload.plan_code || payload.product_id || '';
  }

  if (!email) return res.status(400).json({ error: 'Missing buyer email in payload' });

  console.log(`[Admin Provisioning] Received ${status} for ${email} (Offer Code: ${offerCode})`);

  try {
    // 1. Identify which plan matches this Offer Code
    let targetPlanId = null;
    let targetBonusSites = 0;

    if (offerCode) {
      // Find a plan where offer_codes contains the exact offer code (comma separated check)
      // Since it's a comma separated TEXT field, we search carefully using a regex or ILIKE %code%
      const plansRes = await pool.query(`SELECT id, type FROM plans WHERE offer_codes IS NOT NULL`);
      for (const row of plansRes.rows) {
        const codes = (row.offer_codes || '').split(',').map((c: string) => c.trim().toLowerCase());
        if (codes.includes(offerCode.trim().toLowerCase())) {
          if (row.type === 'ADDON') {
            targetBonusSites = 1; // It's an extra
          } else {
            targetPlanId = row.id;
          }
          break;
        }
      }
    }

    const isApproved = ['APPROVED', 'COMPLETED', 'PROCESSED', 'PAID'].includes(status);
    const isRevoked = ['CANCELED', 'CHARGEBACK', 'REFUNDED', 'DELAYED'].includes(status);

    // 2. Lookup existing user
    const userRow = await pool.query('SELECT account_id FROM users WHERE email = $1', [email]);
    let accountId = userRow.rowCount ? userRow.rows[0].account_id : null;

    if (isApproved) {
      if (!accountId) {
        // Create new account and user
        const accountRes = await pool.query(`
          INSERT INTO accounts (name, active_plan_id, is_active, bonus_site_limit)
          VALUES ($1, $2, true, $3)
          RETURNING id
        `, [email.split('@')[0], targetPlanId, targetBonusSites]);
        accountId = accountRes.rows[0].id;

        // Auto-generate strong secure password for the newly created user
        const randomPass = crypto.randomBytes(8).toString('hex');
        const hash = await bcrypt.hash(randomPass, 12);

        await pool.query(`
          INSERT INTO users (account_id, email, password_hash)
          VALUES ($1, $2, $3)
        `, [accountId, email, hash]);

        console.log(`[Admin Provisioning] Created new Account/User for ${email}. Plan: ${targetPlanId}`);

        // TODO: Enviar email automático de "Conta Criada" usando Resend se desejar, com a randomPass.
      } else {
        // Update existing account
        if (targetBonusSites > 0) {
          await pool.query(`
            UPDATE accounts 
            SET bonus_site_limit = bonus_site_limit + $1
            WHERE id = $2
          `, [targetBonusSites, accountId]);
          console.log(`[Admin Provisioning] Applied Add-on to ${email}.`);
        } else if (targetPlanId) {
          await pool.query(`
            UPDATE accounts 
            SET is_active = true, active_plan_id = $1
            WHERE id = $2
          `, [targetPlanId, accountId]);
          console.log(`[Admin Provisioning] Updated Base Plan for ${email}.`);
        } else {
          await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [accountId]);
          console.log(`[Admin Provisioning] Re-activated account for ${email} without changing plan.`);
        }
      }
    } else if (isRevoked) {
      if (accountId) {
        await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [accountId]);
        console.log(`[Admin Provisioning] Suspended account ${email} due to refund/chargeback.`);
      }
    } else {
      console.log(`[Admin Provisioning] Status ${status} ignored for ${email}`);
    }

    // Attempt to log the subscription interaction
    if (accountId) {
      await pool.query(`
        INSERT INTO subscriptions (account_id, plan_id, status, provider_subscription_id)
        VALUES ($1, $2, $3, $4)
      `, [accountId, targetPlanId, status, payload.transaction || payload.order_id || 'webhook']);
    }

    return res.json({ success: true, provisioned: true, email, targetPlanId, isApproved });
  } catch (error) {
    console.error('[Admin Provisioning] Error processing:', error);
    return res.status(500).json({ error: 'Internal server error processing provisioning' });
  }
});

export default router;
