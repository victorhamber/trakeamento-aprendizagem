import { describe, it, expect } from 'vitest';
import {
  csvCell,
  csvFilenameForAccount,
  flattenPurchaseForCsv,
  parseExportSiteIds,
  purchasesToCsv,
  splitPersonName,
} from './admin-purchase-export';

describe('splitPersonName', () => {
  it('separa nome e sobrenome', () => {
    expect(splitPersonName('Maria Silva Souza')).toEqual({ fn: 'Maria', ln: 'Silva Souza' });
  });
});

describe('flattenPurchaseForCsv', () => {
  it('usa colunas da compra e a landing do CAPI', () => {
    const row = flattenPurchaseForCsv({
      site_name: 'EA Trend',
      site_domain: 'exemplo.com',
      order_id: 'HP123',
      platform: 'hotmart',
      amount: 97,
      currency: 'BRL',
      status: 'approved',
      customer_email: 'a@b.com',
      customer_phone: '11999999999',
      customer_name: 'Ana Lima',
      utm_source: 'facebook',
      custom_data: { content_name: 'Kit' },
      raw_payload: {
        data: { product: { name: 'Produto X' }, buyer: { email: 'ignored@x.com' } },
        _capi_debug: { event_source_url: 'https://exemplo.com/obrigado', referrer_url: 'https://exemplo.com/vsl' },
        hottok: 'secret-should-drop',
      },
    });
    expect(row.email).toBe('a@b.com');
    expect(row.fn).toBe('Ana');
    expect(row.ln).toBe('Lima');
    expect(row.value).toBe('97');
    expect(row.landing_page).toBe('https://exemplo.com/obrigado');
    expect(row.referrer).toBe('https://exemplo.com/vsl');
    expect(row.product).toBe('Kit');
    expect(row.webhook_json).not.toContain('secret-should-drop');
  });
});

describe('purchasesToCsv', () => {
  it('gera CSV com BOM e ponto-e-vírgula', () => {
    const csv = purchasesToCsv([
      {
        customer_email: 'a@b.com',
        customer_name: 'Ana',
        amount: 10,
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('email;phone;fn');
    expect(csv).toContain('a@b.com');
  });
});

describe('csvCell', () => {
  it('escapa aspas e quebras', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });
});

describe('parseExportSiteIds', () => {
  it('trata ausência como todos os sites', () => {
    expect(parseExportSiteIds(undefined)).toBeNull();
    expect(parseExportSiteIds('')).toBeNull();
  });

  it('aceita lista e ignora inválidos', () => {
    expect(parseExportSiteIds('12, 8,12,abc')).toEqual([12, 8]);
    expect(parseExportSiteIds(['3', '5'])).toEqual([3, 5]);
    expect(parseExportSiteIds('x')).toEqual([]);
  });
});

describe('csvFilenameForAccount', () => {
  it('inclui o site quando filtrado', () => {
    const name = csvFilenameForAccount('Wellington', 'a@b.com', 'Zap Ban');
    expect(name).toMatch(/^compras-wellington-zap-ban-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
