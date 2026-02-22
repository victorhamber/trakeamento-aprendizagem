import express, { type Request, type Response } from 'express'
import { getPool } from '../db/pool.js'
import { buildCapiEvent, hashExternalId } from '../lib/metaCapi.js'

type IngestEventBody = {
  event_name?: unknown
  event_time?: unknown
  event_id?: unknown
  event_source_url?: unknown
  event_url?: unknown
  page_title?: unknown
  load_time_ms?: unknown
  fbp?: unknown
  fbc?: unknown
  external_id?: unknown
  client_ip_address?: unknown
  client_user_agent?: unknown
  custom_data?: unknown
}

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

const router = express.Router()

router.post('/events', async (req: Request, res: Response) => {
  const siteKey =
    asString(req.headers['x-site-key']) ||
    asString(process.env.TRACKING_SITE_KEY) ||
    'default'

  const body = (req.body || {}) as IngestEventBody

  const eventName = asString(body.event_name)
  const eventId = asString(body.event_id)
  const eventTime = asNumber(body.event_time)

  if (!eventName || !eventId || !eventTime) {
    res.status(400).json({
      success: false,
      error: 'Missing required fields: event_name, event_id, event_time',
    })
    return
  }

  const eventSourceUrl = asString(body.event_source_url)
  const eventUrl = asString(body.event_url)
  const pageTitle = asString(body.page_title)
  const loadTimeMs = asNumber(body.load_time_ms)
  const fbp = asString(body.fbp)
  const fbc = asString(body.fbc)
  const clientIpAddress = asString(body.client_ip_address)
  const clientUserAgent =
    asString(body.client_user_agent) || asString(req.headers['user-agent'])

  const externalIdRaw = asString(body.external_id)
  const externalIdHash = externalIdRaw ? hashExternalId(externalIdRaw) : undefined

  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const insertEvent = await client.query(
      `
        INSERT INTO web_events (
          site_key,
          event_name,
          event_time,
          event_id,
          event_source_url,
          event_url,
          page_title,
          load_time_ms,
          fbp,
          fbc,
          external_id_hash,
          client_ip_address,
          client_user_agent,
          payload
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (site_key, event_id) DO NOTHING
      `,
      [
        siteKey,
        eventName,
        Math.floor(eventTime),
        eventId,
        eventSourceUrl,
        eventUrl,
        pageTitle,
        loadTimeMs ? Math.floor(loadTimeMs) : null,
        fbp,
        fbc,
        externalIdHash,
        clientIpAddress,
        clientUserAgent,
        req.body,
      ],
    )

    const inserted = insertEvent.rowCount === 1

    if (inserted) {
      const capiEvent = buildCapiEvent({
        event_name: eventName,
        event_time: Math.floor(eventTime),
        event_id: eventId,
        event_source_url: eventSourceUrl,
        client_ip_address: clientIpAddress,
        client_user_agent: clientUserAgent,
        fbp,
        fbc,
        external_ids: externalIdHash ? [externalIdHash] : undefined,
        custom_data:
          typeof body.custom_data === 'object' && body.custom_data
            ? (body.custom_data as Record<string, unknown>)
            : undefined,
      })

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
        [siteKey, eventName, Math.floor(eventTime), eventId, capiEvent],
      )
    }

    await client.query('COMMIT')

    res.status(200).json({
      success: true,
      deduped: !inserted,
    })
  } catch {
    await client.query('ROLLBACK')
    res.status(500).json({
      success: false,
      error: 'Failed to ingest event',
    })
  } finally {
    client.release()
  }
})

export default router

