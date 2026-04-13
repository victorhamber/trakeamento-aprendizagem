import { describe, expect, it } from 'vitest';
import {
  buildMentorConversionMasterPrompt,
  MENTOR_CONVERSION_MASTER_VERSION,
} from './mentor-conversion-master-prompt';

describe('mentor-conversion-master-prompt', () => {
  it('expoe versao e gera prompt com blocos essenciais', () => {
    expect(MENTOR_CONVERSION_MASTER_VERSION).toMatch(/^4\.0/);
    const p = buildMentorConversionMasterPrompt();
    expect(p.length).toBeGreaterThan(500);
    expect(p).toContain('PROTOCOLO DE INTEGRIDADE');
    expect(p).toContain('INTELIGENCIA DE TICKET');
    expect(p).toContain('## Onde voce esta');
    expect(p).toContain('Trajettu');
  });
});
