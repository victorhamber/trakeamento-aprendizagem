import { describe, it, expect } from 'vitest';
import { buildCrmQualificationCapiPayload } from './crm-qualification';
import type { CapiEvent } from '../services/capi';

const original: CapiEvent = {
  event_name: 'Purchase',
  event_time: 1_700_000_000,
  event_id: 'evt_1',
  action_source: 'website',
  user_data: { em: ['abc'] },
  custom_data: { value: 497, currency: 'BRL' },
};

describe('buildCrmQualificationCapiPayload', () => {
  it('não manda value 0 no funil CRM', () => {
    const out = buildCrmQualificationCapiPayload({
      originalCapiEvent: original,
      leadEventSource: 'Trajettu',
      crmEventName: 'Compra realizada',
    });
    expect(out.event_name).toBe('Compra realizada');
    expect(out.action_source).toBe('system_generated');
    expect(out.custom_data).toEqual({
      event_source: 'crm',
      lead_event_source: 'Trajettu',
    });
    expect(out.event_id).toBe('evt_1_crm');
  });

  it('ignora value 0 mesmo se o caller passar', () => {
    const out = buildCrmQualificationCapiPayload({
      originalCapiEvent: original,
      leadEventSource: 'Trajettu',
      includeValueAndCurrency: { value: 0, currency: 'BRL' },
    });
    expect(out.custom_data?.value).toBeUndefined();
    expect(out.custom_data?.currency).toBeUndefined();
  });

  it('só inclui dinheiro quando o valor é > 0', () => {
    const out = buildCrmQualificationCapiPayload({
      originalCapiEvent: original,
      leadEventSource: 'Trajettu',
      includeValueAndCurrency: { value: 497, currency: 'brl' },
    });
    expect(out.custom_data).toMatchObject({ value: 497, currency: 'BRL' });
  });
});
