import { normalizeForHash, sha256Hex } from './crypto.js'

export type MetaCapiEvent = {
  event_name: string
  event_time: number
  event_id: string
  event_source_url?: string
  action_source: 'website' | 'system_generated'
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

export function buildCrmQualificationCapiEvent(args: {
  originalEvent: MetaCapiEvent
  label: string
  includeValueAndCurrency?: { value: number; currency: string }
}): MetaCapiEvent {
  const { originalEvent, label, includeValueAndCurrency } = args
  const safeLabel =
    typeof label === 'string' && label.trim().length
      ? label.trim().slice(0, 120)
      : originalEvent.event_name

  const custom_data: Record<string, unknown> = {
    event_source: 'crm',
    lead_event_source: safeLabel,
  }
  if (includeValueAndCurrency) {
    if (Number.isFinite(includeValueAndCurrency.value)) custom_data.value = includeValueAndCurrency.value
    if (includeValueAndCurrency.currency) custom_data.currency = includeValueAndCurrency.currency
  }

  return {
    event_name: 'Lead',
    event_time: originalEvent.event_time,
    event_id: `${originalEvent.event_id}_crm`,
    event_source_url: originalEvent.event_source_url,
    action_source: 'system_generated',
    user_data: originalEvent.user_data,
    custom_data,
  }
}

