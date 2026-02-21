import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { capiService, CapiService } from '../services/capi';
import { decryptString } from '../lib/crypto';

const router = Router();

router.post('/purchase', async (req, res) => {
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
  const rawBody = req.body;
  const siteKey = (req.headers['x-site-key'] as string) || (req.query.key as string);
  if (!siteKey) return res.status(400).json({ error: 'Missing site key' });

  // Autenticação Simplificada (Token na URL) - Para plataformas como Hotmart/Kiwify
  const token = req.query.token as string | undefined;
  if (token) {
    const secretRow = await pool.query('SELECT webhook_secret_enc FROM sites WHERE site_key = $1', [siteKey]);
    if (!secretRow.rowCount) return res.status(404).json({ error: 'Site not found' });

    const secret = decryptString(secretRow.rows[0].webhook_secret_enc as string);
    if (token !== secret) return res.status(401).json({ error: 'Invalid webhook token' });

    // Se o token for válido, prossegue sem checar assinatura/timestamp
  } else {
    // Autenticação HMAC (Padrão seguro)
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

  const payload = JSON.parse(rawBody.toString());

  // Extração de dados (fbp/fbc vindos da URL do checkout)
  const fbp = payload.fbp || payload.custom_args?.fbp;
  const fbc = payload.fbc || payload.custom_args?.fbc;

  // Multi-platform Parsers (Hotmart, Kiwify, Eduzz, Generic)
  let platform = 'generic';
  let email, firstName, lastName, phone, value, currency, status, orderId, city, state, zip, country, dob;

  if (payload.hottok || payload.product?.id || payload.buyer?.email) {
    platform = 'hotmart';
    email = payload.buyer?.email || payload.email;
    firstName = payload.buyer?.name?.split(' ')[0] || payload.first_name;
    lastName = payload.buyer?.name?.split(' ').slice(1).join(' ') || payload.last_name;
    phone = payload.buyer?.phone || payload.buyer?.checkout_phone || payload.phone;
    value = payload.purchase?.full_price?.value || payload.amount || 0;
    currency = payload.purchase?.full_price?.currency_value || payload.currency || 'BRL';
    status = payload.purchase?.status || payload.status;
    orderId = payload.purchase?.transaction || payload.transaction || payload.id;
    city = payload.buyer?.address?.city;
    state = payload.buyer?.address?.state;
    zip = payload.buyer?.address?.zipCode || payload.buyer?.address?.zip_code;
    country = payload.buyer?.address?.country || payload.buyer?.address?.country_iso;
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
    firstName = pickStr(['first_name', 'firstname', 'nome', 'buyer_name']);
    lastName = pickStr(['last_name', 'lastname', 'sobrenome']);
    phone = pickStr(['phone', 'buyer_phone', 'telefone', 'cel']);
    city = pickStr(['city', 'cidade', 'buyer_city']);
    state = pickStr(['state', 'estado', 'buyer_state', 'uf']);
    zip = pickStr(['zip', 'cep', 'zipcode', 'postal_code']);
    country = pickStr(['country', 'pais', 'country_code']);
    dob = pickStr(['dob', 'birth_date', 'birthday', 'data_nascimento']);
    value = payload.amount || payload.value || 0;
    currency = payload.currency || 'BRL';
    status = payload.status;
    orderId = payload.id || payload.order_id || payload.transaction_id || `webhook_${Date.now()}`;
  }

  // Normalizing status
  let isApproved = false;
  if (['APPROVED', 'COMPLETED', 'paid', 'PAID', 3, '3', 'approved'].includes(status)) {
    isApproved = true;
    status = 'approved';
  } else if (['REFUNDED', 'refunded', 'CHARGEBACK', 4, '4'].includes(status)) {
    status = 'refunded';
  } else {
    status = 'pending';
  }

  try {
    // Gravar compra
    await pool.query(`
      INSERT INTO purchases (
        site_key, order_id, platform, amount, currency, status, 
        buyer_email_hash, fbp, fbc, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (site_key, order_id) DO UPDATE SET status = EXCLUDED.status
    `, [
      siteKey,
      String(orderId),
      platform,
      value,
      currency,
      status,
      email ? CapiService.hash(email) : null,
      fbp,
      fbc,
      payload
    ]);

    // Disparar CAPI Purchase
    if (isApproved) {
      const externalId = payload.user_id || payload.buyer?.id || payload.Customer?.id;

      // ─── Extração do URL Decorator (sck/src) ──────────────────────────────
      // O SDK injeta sck="trk_Base64(eid|fbc|fbp)" nos links de checkout.
      // Aqui decodificamos para garantir a atribuição perfeita no CAPI.
      let trkEid = '';
      let trkFbc = '';
      let trkFbp = '';
      const sckRaw = payload.sck || payload.src || '';

      if (typeof sckRaw === 'string' && sckRaw.includes('trk_')) {
        try {
          // Pode vir junto com outras tags, ex: "sck=afiliado123-trk_YmFzZTY0"
          const parts = sckRaw.split('-');
          const trkPart = parts.find(p => p.startsWith('trk_'));
          if (trkPart) {
            const b64 = trkPart.substring(4); // remove 'trk_'
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

      const clientIp = payload.client_ip_address || payload.ip || req.ip || '0.0.0.0';
      const clientUa = payload.client_user_agent || payload.user_agent || 'Webhook/1.0';

      const finalExternalId = trkEid || externalId;
      const finalFbc = trkFbc || fbc;
      const finalFbp = trkFbp || fbp;

      const capiPayload = {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `purchase_${orderId}`,
        event_source_url: payload.checkout_url || '',
        user_data: {
          client_ip_address: clientIp,
          client_user_agent: clientUa,
          em: email ? CapiService.hash(email) : undefined,
          ph: phone ? CapiService.hash(phone.replace(/[^0-9]/g, '')) : undefined,
          fn: firstName ? CapiService.hash(firstName.toLowerCase()) : undefined,
          ln: lastName ? CapiService.hash(lastName.toLowerCase()) : undefined,
          ct: city ? CapiService.hash(city.toLowerCase()) : undefined,
          st: state ? CapiService.hash(state.toLowerCase()) : undefined,
          zp: zip ? CapiService.hash(zip.replace(/\s+/g, '').toLowerCase()) : undefined,
          country: country ? CapiService.hash(country.toLowerCase()) : undefined,
          db: dob ? CapiService.hash(dob.replace(/[^0-9]/g, '')) : undefined,
          fbp: finalFbp,
          fbc: finalFbc,
          external_id: finalExternalId ? CapiService.hash(String(finalExternalId)) : undefined,
        },
        custom_data: {
          currency: currency,
          value: value,
          content_type: 'product',
          ...(payload.product_id || payload.product?.id ? { content_ids: [String(payload.product_id || payload.product?.id)] } : {}),
          order_id: String(orderId),
          // ── Extracao de UTMs do webhook (ex: Hotmart, Kiwify) ──
          utm_source: payload.utm_source || payload.trackingParameters?.utm_source || payload.tracking_parameters?.utm_source || payload.sck || payload.src || undefined,
          utm_medium: payload.utm_medium || payload.trackingParameters?.utm_medium || payload.tracking_parameters?.utm_medium || undefined,
          utm_campaign: payload.utm_campaign || payload.trackingParameters?.utm_campaign || payload.tracking_parameters?.utm_campaign || undefined,
          utm_term: payload.utm_term || payload.trackingParameters?.utm_term || payload.tracking_parameters?.utm_term || undefined,
          utm_content: payload.utm_content || payload.trackingParameters?.utm_content || payload.tracking_parameters?.utm_content || undefined,
        },
      };

      capiService.sendEvent(siteKey, capiPayload).catch(console.error);
      console.log(`[CAPI] Purchase event sent for ${platform}:`, capiPayload.event_id);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing webhook');
  }
});

export default router;
