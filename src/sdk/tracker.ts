export type TrackerConfig = {
  endpoint?: string
  siteKey?: string
}

export type TrackEventInput = {
  event_name: string
  event_id?: string
  event_time?: number
  event_source_url?: string
  event_url?: string
  page_title?: string
  load_time_ms?: number
  fbp?: string
  fbc?: string
  external_id?: string
  custom_data?: Record<string, unknown>
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}=([^;]*)`),
  )
  return match ? decodeURIComponent(match[1]) : undefined
}

function setCookie(
  name: string,
  value: string,
  opts: { days?: number; sameSite?: 'Lax' | 'Strict' | 'None'; secure?: boolean } = {},
): void {
  const days = Number.isFinite(opts.days) ? Number(opts.days) : 365
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  const sameSite = opts.sameSite || 'Lax'
  const secure = opts.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:')
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Expires=${expires}`,
    'Path=/',
    `SameSite=${sameSite}`,
  ]
  if (secure) parts.push('Secure')
  document.cookie = parts.join('; ')
}

function safeGetLocalStorage(key: string): string | undefined {
  try {
    const v = localStorage.getItem(key)
    return v && v.trim() ? v : undefined
  } catch {
    return undefined
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function pickFbclidFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const v = u.searchParams.get('fbclid')
    return v && v.trim() ? v.trim() : undefined
  } catch {
    return undefined
  }
}

function randomDigits(len: number): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (!c?.getRandomValues) return Math.floor(Math.random() * 10 ** len).toString().padStart(len, '0')
  const buf = new Uint8Array(len)
  c.getRandomValues(buf)
  return Array.from(buf).map((b) => String(b % 10)).join('')
}

function buildFbp(nowMs: number): string {
  // Formato padrão observado: fb.1.<ms>.<random>
  return `fb.1.${nowMs}.${randomDigits(10)}`
}

function buildFbc(nowMs: number, fbclid: string): string {
  // Formato padrão: fb.1.<ms>.<fbclid>
  return `fb.1.${nowMs}.${fbclid}`
}

function getLoadTimeMs(): number | undefined {
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  if (nav && Number.isFinite(nav.duration)) return Math.round(nav.duration)
  return undefined
}

export function createEventId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  if (!c?.getRandomValues) {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const buf = new Uint8Array(16)
  c.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sendEvent(
  endpoint: string,
  siteKey: string | undefined,
  payload: TrackEventInput,
): Promise<void> {
  const body = JSON.stringify(payload)

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    const ok = navigator.sendBeacon(endpoint, blob)
    if (ok) return
  }

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(siteKey ? { 'x-site-key': siteKey } : {}),
    },
    body,
    keepalive: true,
  }).then(() => undefined)
}

export function createTracker(config: TrackerConfig = {}) {
  const endpoint = config.endpoint || '/api/ingest/events'
  const siteKey = config.siteKey

  const EXTERNAL_ID_COOKIE = '_ta_external_id'
  const EXTERNAL_ID_LS = 'ta:external_id'
  const FBP_COOKIE = '_fbp'
  const FBC_COOKIE = '_fbc'

  const getOrCreateExternalId = (): string | undefined => {
    const fromCookie = getCookie(EXTERNAL_ID_COOKIE)
    if (fromCookie) return fromCookie

    const fromLs = safeGetLocalStorage(EXTERNAL_ID_LS)
    if (fromLs) {
      // re-hidrata cookie quando possível (mantém consistência para requests)
      setCookie(EXTERNAL_ID_COOKIE, fromLs, { days: 365, sameSite: 'Lax' })
      return fromLs
    }

    const id = createEventId()
    // tenta persistir em ambos — alguns browsers bloqueiam cookie, outros bloqueiam storage
    setCookie(EXTERNAL_ID_COOKIE, id, { days: 365, sameSite: 'Lax' })
    safeSetLocalStorage(EXTERNAL_ID_LS, id)
    return id
  }

  const getOrCreateFbp = (): string | undefined => {
    const fromCookie = getCookie(FBP_COOKIE)
    if (fromCookie) return fromCookie
    const now = Date.now()
    const fbp = buildFbp(now)
    setCookie(FBP_COOKIE, fbp, { days: 90, sameSite: 'Lax' })
    return fbp
  }

  const getOrCreateFbc = (eventSourceUrl: string): string | undefined => {
    const fromCookie = getCookie(FBC_COOKIE)
    if (fromCookie) return fromCookie
    const fbclid = pickFbclidFromUrl(eventSourceUrl)
    if (!fbclid) return undefined
    const now = Date.now()
    const fbc = buildFbc(now, fbclid)
    setCookie(FBC_COOKIE, fbc, { days: 90, sameSite: 'Lax' })
    return fbc
  }

  const track = async (input: TrackEventInput): Promise<{ event_id: string }> => {
    const eventId = input.event_id || createEventId()
    const eventTime = input.event_time || Math.floor(Date.now() / 1000)
    const eventSourceUrl = input.event_source_url || window.location.href
    const fbpResolved = input.fbp || getCookie(FBP_COOKIE) || getOrCreateFbp()
    const fbcResolved = input.fbc || getCookie(FBC_COOKIE) || getOrCreateFbc(eventSourceUrl)

    const payload: TrackEventInput = {
      ...input,
      event_id: eventId,
      event_time: eventTime,
      event_source_url: eventSourceUrl,
      event_url: input.event_url || window.location.href,
      page_title: input.page_title || document.title,
      load_time_ms: input.load_time_ms ?? getLoadTimeMs(),
      fbp: fbpResolved,
      fbc: fbcResolved,
      // external_id persistente (por navegador) quando não fornecido pelo caller
      external_id: input.external_id || getOrCreateExternalId(),
    }

    await sendEvent(endpoint, siteKey, payload)
    return { event_id: eventId }
  }

  return {
    createEventId,
    getExternalId: getOrCreateExternalId,
    track,
    pageView: (custom_data?: Record<string, unknown>) =>
      track({ event_name: 'PageView', custom_data }),
  }
}
