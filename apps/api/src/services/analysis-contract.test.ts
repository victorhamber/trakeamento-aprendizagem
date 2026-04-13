import { describe, expect, it } from 'vitest';
import { validateAnalysisMarkdown } from './analysis-contract';

describe('validateAnalysisMarkdown', () => {
  it('aceita relatorio com secoes obrigatorias em ordem', () => {
    const result = validateAnalysisMarkdown([
      '## Diagnostico Executivo',
      'Resumo',
      '## Analise do Funil',
      'Funil',
      '## Plano de Acao',
      '1. Fazer algo.',
    ].join('\n\n'));

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.outOfOrder).toEqual([]);
  });

  it('marca secoes fora de ordem', () => {
    const result = validateAnalysisMarkdown([
      '## Analise do Funil',
      'Funil',
      '## Diagnostico Executivo',
      'Resumo',
      '## Plano de Acao',
      '1. Fazer algo.',
    ].join('\n\n'));

    expect(result.valid).toBe(false);
    expect(result.outOfOrder).toContain('## Analise do Funil');
  });

  it('aceita lista customizada de secoes obrigatorias', () => {
    const required = ['## Diagnostico Executivo', '## Analise da Landing Page', '## Plano de Acao'] as const;
    const ok = validateAnalysisMarkdown(
      [
        '## Diagnostico Executivo',
        'X',
        '## Analise da Landing Page',
        'Y',
        '## Plano de Acao',
        'Z',
      ].join('\n\n'),
      [],
      required
    );
    expect(ok.valid).toBe(true);
  });
});
