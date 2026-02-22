import express, { type Request, type Response } from 'express'
import { getPool } from '../db/pool.js'
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js'
import { buildCapiEvent, hashExternalId } from '../lib/metaCapi.js'

type PurchaseWebhookBody = Record<string, unknown>

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length) return value
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return asString(v)
}

function verifyWebhook(req: Request): { ok: true } | { ok: false; status: number } {
  const secret = asString(process.env.WEBHOOK_SECRET)
  if (!secret) return { ok: false, status: 500 }

  const timestamp = getHeader(req, 'x-webhook-timestamp')
  const signature = getHeader(req, 'x-webhook-signature')
  if (!timestamp || !signature) return { ok: false, status: 401 }

  const ts = asNumber(timestamp)
  if (!ts) return { ok: false, status: 401 }

  const tolerance = Number(process.env.WEBHOOK_TOLERANCE_SECONDS || 300)
  if (Math.abs(nowSeconds() - Math.floor(ts)) > tolerance) {
    return { ok: false, status: 401 }
  }

  const raw = req.rawBody ? req.rawBody.toString('utf8') : ''
  const message = `${Math.floor(ts)}.${raw}`
  const expected = hmacSha256Hex(secret, message)

  if (!safeEqualHex(signature, expected)) return { ok: false, status: 401 }
  return { ok: true }
}

function pickOrderId(body: PurchaseWebhookBody): string | undefined {
  return (
    asString(body.order_id) ||
    asString(body.orderId) ||
    asString(body.id) ||
    asString(body.transaction_id) ||
    asString(body.transactionId)
  )
}

const router = express.Router()

router.post('/purchase', async (req: Request, res: Response) => {
  const verification = verifyWebhook(req)
  if (verification.ok !== true) {
    res
      .status((verification as { ok: false; status: number }).status)
      .json({ success: false, error: 'Unauthorized' })
    return
  }

  const siteKey =
    asString(req.headers['x-site-key']) ||
    asString(process.env.TRACKING_SITE_KEY) ||
    'default'

  const body = (req.body || {}) as PurchaseWebhookBody
  const orderId = pickOrderId(body)
  if (!orderId) {
    res.status(400).json({ success: false, error: 'Missing order_id' })
    return
  }

  const eventTime =
    asNumber(body.event_time) || asNumber(body.created_at) || nowSeconds()
  const eventId =
    asString(body.event_id) || asString(body.eventId) || `purchase:${orderId}`

  const value =
    asNumber(body.value) ||
    asNumber(body.total) ||
    asNumber(body.amount) ||
    asNumber(body.price)

  const currency =
    asString(body.currency) || asString(body.currency_code) || asString(body.moeda)

  const buyerExternalId =
    asString(body.external_id) || asString(body.buyer_external_id) || asString(body.user_id)

  const buyerEmail = asString(body.email) || asString(body.buyer_email)
  const buyerPhone = asString(body.phone) || asString(body.buyer_phone)

  const externalIds: string[] = []
  if (buyerExternalId) externalIds.push(hashExternalId(buyerExternalId))
  if (buyerEmail) externalIds.push(hashExternalId(buyerEmail))
  if (buyerPhone) externalIds.push(hashExternalId(buyerPhone))

  const buyerHash = externalIds.length ? externalIds[0] : undefined

  const capiEvent = buildCapiEvent({
    event_name: 'Purchase',
    event_time: Math.floor(eventTime),
    event_id: eventId,
    event_source_url: asString(body.event_source_url) || asString(body.eventSourceUrl),
    client_ip_address: asString(body.client_ip_address),
    client_user_agent: asString(body.client_user_agent),
    fbp: asString(body.fbp),
    fbc: asString(body.fbc),
    external_ids: externalIds.length ? externalIds : undefined,
    custom_data: {
      value: value ?? undefined,
      currency: currency ?? undefined,
      content_type: asString(body.content_type) || 'product',
    },
  })

  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const insertPurchase = await client.query(
      `
        INSERT INTO purchases (
          site_key,
          order_id,
          event_time,
          event_id,
          value,
          currency,
          buyer_external_id_hash,
          payload
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (site_key, order_id) DO NOTHING
      `,
      [
        siteKey,
        orderId,
        Math.floor(eventTime),
        eventId,
        value ?? null,
        currency ?? null,
        buyerHash ?? null,
        body,
      ],
    )

    const inserted = insertPurchase.rowCount === 1

    if (inserted) {
      await client.query(
        `
          INSERT INTO meta_outbox (
            site_key,
            event_name,
            event_time,
            event_id,
            payload
          )
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (site_key, event_id) DO NOTHING
        `,
        [siteKey, 'Purchase', Math.floor(eventTime), eventId, capiEvent],
      )
    }

    await client.query('COMMIT')

    res.status(200).json({ success: true, deduped: !inserted })
  } catch {
    await client.query('ROLLBACK')
    res.status(500).json({ success: false, error: 'Failed to process webhook' })
  } finally {
    client.release()
  }
})

export default router
