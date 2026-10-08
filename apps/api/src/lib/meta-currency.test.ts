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

  it('entende milhar e decimal no formato brasileiro', () => {
    expect(parseMetaEventValue('1.297')).toBe(1297);
    expect(parseMetaEventValue('1.297,00')).toBe(1297);
    expect(parseMetaEventValue('1.297,50')).toBe(1297.5);
    expect(parseMetaEventValue('R$ 1.997')).toBe(1997);
    expect(parseMetaEventValue('12.500.000')).toBe(12500000);
    expect(parseMetaEventValue('597')).toBe(597);
  });

  it('mantém decimal com ponto quando não é milhar', () => {
    expect(parseMetaEventValue('9.99')).toBe(9.99);
    expect(parseMetaEventValue('1997.00')).toBe(1997);
    expect(parseMetaEventValue('1,297.50')).toBe(1297.5);
    expect(parseMetaEventValue('0.997')).toBe(0.997);
  });

  it('rejeita vazio e negativo', () => {
    expect(parseMetaEventValue(undefined)).toBeUndefined();
    expect(parseMetaEventValue('')).toBeUndefined();
    expect(parseMetaEventValue(-1)).toBeUndefined();
  });
});

describe('ensureMetaRoasMoneyFields', () => {
  it('não inventa valor em Lead/Download/evento personalizado', () => {
    expect(ensureMetaRoasMoneyFields('Lead', { content_name: 'form' })).toEqual({
      content_name: 'form',
    });
    expect(ensureMetaRoasMoneyFields('Lead', { value: 0, currency: 'BRL' })).toEqual({});
    expect(ensureMetaRoasMoneyFields('Download', { currency: 'R$' })).toEqual({});
    expect(ensureMetaRoasMoneyFields('Corretora', { moeda: 'MX$' })).toEqual({});
  });

  it('preserva valor digitado na regra e normaliza moeda', () => {
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
  it('envia só value, currency e order_id — sem catálogo', () => {
    expect(buildMetaPurchaseCommerceFields({ value: 0, currency: 'BRL', orderId: 'HP123' })).toEqual({
      num_items: 1,
      order_id: 'HP123',
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 597,
        currency: 'brl',
        contentId: '5986726',
        orderId: 'HP4243995799',
      })
    ).toEqual({
      num_items: 1,
      value: 597,
      currency: 'BRL',
      order_id: 'HP4243995799',
    });
    expect(
      buildMetaPurchaseCommerceFields({
        value: 24,
        currency: 'BRL',
        contentId: 'f7x5lf5w',
        orderId: 'HP1',
      }).contents
    ).toBeUndefined();
  });
});

describe('sanitizeMetaCommerceCustomData', () => {
  it('tira catálogo do Purchase e mantém o preço da venda', () => {
    const out = sanitizeMetaCommerceCustomData('Purchase', {
      value: 1997,
      currency: 'BRL',
      content_ids: ['5986726'],
      content_type: 'product',
      contents: [{ id: '5986726', quantity: 1, item_price: 1997 }],
      content_name: 'EA TREND',
      order_id: 'HP4243995799',
    });
    expect(out.contents).toBeUndefined();
    expect(out.content_ids).toBeUndefined();
    expect(out.content_type).toBeUndefined();
    expect(out.value).toBe(1997);
    expect(out.currency).toBe('BRL');
    expect(out.content_name).toBe('EA TREND');
    expect(out.order_id).toBe('HP4243995799');
  });

  it('também tira id numérico de produto no Purchase', () => {
    const out = sanitizeMetaCommerceCustomData('Purchase', {
      content_ids: ['5986726'],
      content_type: 'product',
      value: 24,
      currency: 'BRL',
    });
    expect(out.content_ids).toBeUndefined();
    expect(out.content_type).toBeUndefined();
    expect(out.value).toBe(24);
  });
});
