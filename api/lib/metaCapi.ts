import { normalizeForHash, sha256Hex } from './crypto.js'

export type MetaCapiEvent = {
  event_name: string
  event_time: number
  event_id: string
  event_source_url?: string
  action_source: 'website'
  user_data: {
    client_ip_address?: string
    client_user_agent?: string
    fbp?: string
    fbc?: string
    external_id?: string[]
  }
  custom_data?: Record<string, unknown>
}

export function hashExternalId(input: string): string {
  return sha256Hex(normalizeForHash(input))
}

export function buildCapiEvent(input: {
  event_name: string
  event_time: number
  event_id: string
  event_source_url?: string
  client_ip_address?: string
  client_user_agent?: string
  fbp?: string
  fbc?: string
  external_ids?: string[]
  custom_data?: Record<string, unknown>
}): MetaCapiEvent {
  return {
    event_name: input.event_name,
    event_time: input.event_time,
    event_id: input.event_id,
    event_source_url: input.event_source_url,
    action_source: 'website',
    user_data: {
      client_ip_address: input.client_ip_address,
      client_user_agent: input.client_user_agent,
      fbp: input.fbp,
      fbc: input.fbc,
      external_id: input.external_ids?.length ? input.external_ids : undefined,
    },
    custom_data: input.custom_data,
  }
}

