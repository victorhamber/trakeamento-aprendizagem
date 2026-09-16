import { describe, it, expect } from 'vitest';
import {
  buildMetaPurchaseCommerceFields,
  ensureMetaRoasMoneyFields,
  normalizeMetaCurrencyCode,
  parseMetaEventValue,
  sanitizeMetaCommerceCustomData,
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
  it('não envia value 0, contents nem offer code como content_ids', () => {
    expect(buildMetaPurchaseCommerceFields({ value: 0, currency: 'BRL', orderId: 'HP123' })).toEqual({
      num_items: 1,
      order_id: 'HP123',
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 33.15,
        currency: 'brl',
        contentId: '5986726',
        orderId: 'HP4243995799',
      })
    ).toEqual({
      num_items: 1,
      value: 33.15,
      currency: 'BRL',
      contents: [{ quantity: 1, item_price: 33.15, id: '5986726' }],
      content_ids: ['5986726'],
      content_type: 'product',
      order_id: 'HP4243995799',
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 33.15,
        currency: 'BRL',
        contentId: 'f7x5lf5w',
        orderId: 'HP4243995799',
      })
    ).toEqual({
      num_items: 1,
      value: 33.15,
      currency: 'BRL',
      contents: [{ quantity: 1, item_price: 33.15 }],
      order_id: 'HP4243995799',
    });
  });
});

describe('sanitizeMetaCommerceCustomData', () => {
  it('remove content_ids de oferta Hotmart e contents com id inválido no Purchase', () => {
    const out = sanitizeMetaCommerceCustomData('Purchase', {
      value: 33.15,
      currency: 'BRL',
      content_ids: ['f7x5lf5w'],
      content_type: 'product',
      contents: [{ id: 'f7x5lf5w', quantity: 1, item_price: 33.15 }],
      order_id: 'HP4243995799',
    });
    expect(out.contents).toBeUndefined();
    expect(out.content_ids).toBeUndefined();
    expect(out.content_type).toBeUndefined();
    expect(out.value).toBe(33.15);
    expect(out.order_id).toBe('HP4243995799');
  });

  it('mantém contents com item_price e id numérico', () => {
    const out = sanitizeMetaCommerceCustomData('Purchase', {
      value: 22,
      currency: 'EUR',
      contents: [{ id: '5986726', quantity: 1, item_price: 22 }],
      content_ids: ['5986726'],
      content_type: 'product',
    });
    expect(out.contents).toEqual([{ quantity: 1, item_price: 22, id: '5986726' }]);
    expect(out.content_ids).toEqual(['5986726']);
  });

  it('mantém product id numérico', () => {
    const out = sanitizeMetaCommerceCustomData('Purchase', {
      content_ids: ['5986726'],
      content_type: 'product',
    });
    expect(out.content_ids).toEqual(['5986726']);
  });
});
