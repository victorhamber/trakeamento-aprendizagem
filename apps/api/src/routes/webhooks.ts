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
  const email = payload.email || payload.buyer_email;

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
      payload.id,
      'generic',
      payload.amount,
      'BRL',
      payload.status,
      email ? CapiService.hash(email) : null,
      fbp,
      fbc,
      payload
    ]);

    // Disparar CAPI Purchase
    if (payload.status === 'approved' || payload.status === 'paid') {
      // Extrair e hashear todos os campos do buyer disponíveis
      const pickStr = (keys: string[]): string | undefined => {
        for (const k of keys) {
          const v = payload[k] || payload.custom_args?.[k];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return undefined;
      };

      const externalId = pickStr(['external_id', 'buyer_external_id', 'user_id']);
      const firstName = pickStr(['first_name', 'firstname', 'nome', 'buyer_name']);
      const lastName = pickStr(['last_name', 'lastname', 'sobrenome']);
      const city = pickStr(['city', 'cidade', 'buyer_city']);
      const state = pickStr(['state', 'estado', 'buyer_state', 'uf']);
      const zip = pickStr(['zip', 'cep', 'zipcode', 'postal_code']);
      const country = pickStr(['country', 'pais', 'country_code']);
      const dob = pickStr(['dob', 'birth_date', 'birthday', 'data_nascimento']);
      const buyerPhone = pickStr(['phone', 'buyer_phone', 'telefone', 'cel']);

      // IP e UA reais do auto-tagging (vem da URL do checkout se houver)
      const clientIp = pickStr(['client_ip_address']) || req.ip || '0.0.0.0';
      const clientUa = pickStr(['client_user_agent']) || 'Webhook/1.0';

      const capiPayload = {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `purchase_${payload.id}`,
        event_source_url: payload.checkout_url || '',
        user_data: {
          client_ip_address: clientIp,
          client_user_agent: clientUa,
          em: email ? CapiService.hash(email) : undefined,
          ph: buyerPhone ? CapiService.hash(buyerPhone.replace(/[^0-9]/g, '')) : undefined,
          fn: firstName ? CapiService.hash(firstName.toLowerCase()) : undefined,
          ln: lastName ? CapiService.hash(lastName.toLowerCase()) : undefined,
          ct: city ? CapiService.hash(city.toLowerCase()) : undefined,
          st: state ? CapiService.hash(state.toLowerCase()) : undefined,
          zp: zip ? CapiService.hash(zip.replace(/\s+/g, '').toLowerCase()) : undefined,
          country: country ? CapiService.hash(country.toLowerCase()) : undefined,
          db: dob ? CapiService.hash(dob.replace(/[^0-9]/g, '')) : undefined,
          fbp: fbp,
          fbc: fbc,
          external_id: externalId ? CapiService.hash(externalId) : undefined,
        },
        custom_data: {
          currency: payload.currency || 'BRL',
          value: payload.amount,
          content_type: 'product',
          ...(payload.product_id ? { content_ids: [payload.product_id] } : {}),
          ...(payload.order_id || payload.id ? { order_id: payload.order_id || payload.id } : {}),
        },
      };

      capiService.sendEvent(siteKey, capiPayload).catch(console.error);
      console.log('[CAPI] Purchase event sent:', capiPayload.event_id);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing webhook');
  }
});

export default router;
