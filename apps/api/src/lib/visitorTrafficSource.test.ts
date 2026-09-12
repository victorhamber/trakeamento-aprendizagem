import { describe, expect, it } from 'vitest';
import { resolveSaleOriginFromHistory, utmHasSaleOrigin } from './visitorTrafficSource';

describe('utmHasSaleOrigin', () => {
  it('exige source, campanha ou conteúdo', () => {
    expect(utmHasSaleOrigin({ click_id: 'abc', utm_source: '', utm_campaign: '', utm_content: '', utm_medium: '', utm_term: '' })).toBe(
      false
    );
    expect(utmHasSaleOrigin({ utm_source: 'ig', utm_medium: 'social', utm_campaign: '', utm_content: '', utm_term: '', click_id: '' })).toBe(
      true
    );
  });
});

describe('resolveSaleOriginFromHistory', () => {
  it('usa o histórico quando o toque da compra não tem origem', () => {
    const out = resolveSaleOriginFromHistory({ click_id: 'x', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' }, [
      { click_id: 'x', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' },
      {
        utm_source: 'ig',
        utm_medium: 'social',
        utm_content: 'link_in_bio',
        utm_campaign: '',
        utm_term: '',
        click_id: '',
      },
    ]);
    expect(out?.utm_source).toBe('ig');
    expect(out?.utm_medium).toBe('social');
    expect(out?.utm_content).toBe('link_in_bio');
    expect(out?.click_id).toBe('x');
  });

  it('mantém o toque da compra quando já tem origem', () => {
    const out = resolveSaleOriginFromHistory(
      { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'camp-a', utm_content: '', utm_term: '', click_id: '' },
      [{ utm_source: 'ig', utm_medium: 'social', utm_campaign: '', utm_content: 'bio', utm_term: '', click_id: '' }]
    );
    expect(out?.utm_source).toBe('facebook');
    expect(out?.utm_campaign).toBe('camp-a');
    expect(out?.utm_content).toBe('bio');
  });
});
