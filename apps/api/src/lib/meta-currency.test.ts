import { describe, it, expect } from 'vitest';
import {
  buildMetaPurchaseCommerceFields,
  ensureMetaRoasMoneyFields,
  normalizeMetaCurrencyCode,
  parseMetaEventValue,
} from './meta-currency';

describe('normalizeMetaCurrencyCode', () => {
  it('aceita códigos ISO de 3 letras', () => {
    expect(normalizeMetaCurrencyCode('mxn')).toBe('MXN');
    expect(normalizeMetaCurrencyCode('BRL')).toBe('BRL');
    expect(normalizeMetaCurrencyCode(' USD ')).toBe('USD');
  });

  it('cai no fallback para valores inválidos no Meta', () => {
    expect(normalizeMetaCurrencyCode('R$')).toBe('BRL');
    expect(normalizeMetaCurrencyCode('MX$')).toBe('BRL');
    expect(normalizeMetaCurrencyCode('REAL')).toBe('BRL');
    expect(normalizeMetaCurrencyCode('BR')).toBe('BRL');
    expect(normalizeMetaCurrencyCode(185)).toBe('BRL');
    expect(normalizeMetaCurrencyCode('0')).toBe('BRL');
    expect(normalizeMetaCurrencyCode('')).toBe('BRL');
    expect(normalizeMetaCurrencyCode(undefined)).toBe('BRL');
  });

  it('respeita fallback customizado', () => {
    expect(normalizeMetaCurrencyCode('REAL', 'USD')).toBe('USD');
  });
});

describe('parseMetaEventValue', () => {
  it('aceita número e string com vírgula', () => {
    expect(parseMetaEventValue(97)).toBe(97);
    expect(parseMetaEventValue('97,50')).toBe(97.5);
    expect(parseMetaEventValue(0)).toBe(0);
  });

  it('rejeita vazio e negativo', () => {
    expect(parseMetaEventValue(undefined)).toBeUndefined();
    expect(parseMetaEventValue('')).toBeUndefined();
    expect(parseMetaEventValue(-1)).toBeUndefined();
  });
});

describe('ensureMetaRoasMoneyFields', () => {
  it('não envia 0 em Lead/Download/Group — usa fallback ou 1 + BRL', () => {
    expect(ensureMetaRoasMoneyFields('Lead', {})).toEqual({ value: 1, currency: 'BRL' });
    expect(ensureMetaRoasMoneyFields('Lead', { value: 0 }, 'BRL', 185)).toEqual({
      value: 185,
      currency: 'BRL',
    });
    expect(ensureMetaRoasMoneyFields('Download', { currency: 'R$' })).toEqual({
      value: 1,
      currency: 'BRL',
    });
    expect(ensureMetaRoasMoneyFields('Group', { moeda: 'MX$' })).toMatchObject({
      value: 1,
      currency: 'BRL',
    });
  });

  it('preserva valor real e normaliza moeda', () => {
    expect(ensureMetaRoasMoneyFields('Lead', { value: '47', currency: 'mxn' })).toEqual({
      value: 47,
      currency: 'MXN',
    });
  });

  it('não inventa valor 0 em Purchase sem preço', () => {
    const out = ensureMetaRoasMoneyFields('Purchase', { order_id: 'x' });
    expect(out.value).toBeUndefined();
    expect(out.currency).toBeUndefined();
    expect(out.order_id).toBe('x');
  });

  it('normaliza moeda de Purchase quando já há valor', () => {
    expect(ensureMetaRoasMoneyFields('Purchase', { value: 185, currency: 'R$' })).toEqual({
      value: 185,
      currency: 'BRL',
    });
  });
});

describe('buildMetaPurchaseCommerceFields', () => {
  it('não envia value 0 e inclui contents + order_id', () => {
    expect(buildMetaPurchaseCommerceFields({ value: 0, currency: 'BRL', orderId: 'HP123' })).toEqual({
      content_type: 'product',
      num_items: 1,
      content_ids: ['HP123'],
      order_id: 'HP123',
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 497,
        currency: 'brl',
        contentId: 'prod_1',
        orderId: 'HP123',
      })
    ).toEqual({
      content_type: 'product',
      num_items: 1,
      value: 497,
      currency: 'BRL',
      content_ids: ['prod_1'],
      order_id: 'HP123',
      contents: [{ id: 'prod_1', quantity: 1, item_price: 497 }],
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 5.97,
        currency: 'BRL',
        contentId: 'offer_bump',
        orderId: 'HP-bump',
      }).content_ids
    ).toEqual(['offer_bump']);
    expect(
      buildMetaPurchaseCommerceFields({
        value: 24.14,
        currency: 'BRL',
        contentId: 'offer_entry',
        orderId: 'HP-entry',
      })
    ).toMatchObject({
      value: 24.14,
      content_ids: ['offer_entry'],
      contents: [{ id: 'offer_entry', quantity: 1, item_price: 24.14 }],
    });
  });
});
