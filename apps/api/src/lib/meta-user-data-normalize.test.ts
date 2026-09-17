import { describe, it, expect } from 'vitest';
import {
  normalizeMetaCity,
  normalizeMetaCountry,
  normalizeMetaPersonName,
  normalizeMetaState,
  splitMetaPersonName,
} from './meta-user-data-normalize';

describe('normalizeMetaCity', () => {
  it('remove espaços e acentos', () => {
    expect(normalizeMetaCity('São Paulo')).toBe('saopaulo');
    expect(normalizeMetaCity('Menlo Park')).toBe('menlopark');
  });
});

describe('normalizeMetaState', () => {
  it('aceita UF e nome por extenso', () => {
    expect(normalizeMetaState('SP')).toBe('sp');
    expect(normalizeMetaState('São Paulo')).toBe('sp');
    expect(normalizeMetaState('Rio de Janeiro')).toBe('rj');
  });
});

describe('normalizeMetaCountry', () => {
  it('normaliza para ISO-2', () => {
    expect(normalizeMetaCountry('BR')).toBe('br');
    expect(normalizeMetaCountry('Brasil')).toBe('br');
    expect(normalizeMetaCountry('Brazil')).toBe('br');
  });
});

describe('splitMetaPersonName', () => {
  it('separa primeiro nome e sobrenome', () => {
    expect(splitMetaPersonName('João da Silva')).toEqual({ fn: 'joao', ln: 'da silva' });
    expect(splitMetaPersonName('Maria')).toEqual({ fn: 'maria', ln: '' });
  });

  it('normaliza acentos', () => {
    expect(normalizeMetaPersonName('José')).toBe('jose');
  });
});
