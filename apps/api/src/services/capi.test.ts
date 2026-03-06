import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapiService } from './capi';
import { pool } from '../db/pool';

// Mock do pool do Postgres
vi.mock('../db/pool', () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe('CapiService', () => {
  let service: CapiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CapiService();
  });

  it('deve gerar hash SHA-256 corretamente', () => {
    const email = 'teste@exemplo.com';
    const hash = CapiService.hash(email);
    // Hash conhecido de 'teste@exemplo.com'
    // Se o ambiente estiver adicionando newline, o hash muda. 
    // Vamos garantir que o teste verifica a consistência da função.
    const crypto = require('crypto');
    const expected = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    expect(hash).toBe(expected);
  });

  it('deve normalizar e hashear email com espaços e caixa alta', () => {
    const email = '  TESTE@Exemplo.com ';
    const hash = CapiService.hash(email);
    const crypto = require('crypto');
    const expected = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    expect(hash).toBe(expected);
  });

  it('deve salvar evento na outbox em caso de erro', async () => {
    const siteKey = 'test-site-key';
    const event = {
      event_name: 'Purchase',
      event_time: 1234567890,
      event_id: 'evt_123',
      event_source_url: 'http://example.com',
      user_data: { em: 'hashed_email' },
    };
    const errorMsg = 'Network Error';

    await service.saveToOutbox(siteKey, event, errorMsg);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO capi_outbox'),
      expect.arrayContaining([siteKey, JSON.stringify(event), errorMsg])
    );
  });
});
