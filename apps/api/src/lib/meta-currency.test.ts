import { describe, it, expect } from 'vitest';
import {
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
  it('força 0 + BRL em Lead/Download/Group sem valor', () => {
    expect(ensureMetaRoasMoneyFields('Lead', {})).toEqual({ value: 0, currency: 'BRL' });
    expect(ensureMetaRoasMoneyFields('Download', { currency: 'R$' })).toEqual({
      value: 0,
      currency: 'BRL',
    });
    expect(ensureMetaRoasMoneyFields('Group', { moeda: 'MX$' })).toMatchObject({
      value: 0,
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
