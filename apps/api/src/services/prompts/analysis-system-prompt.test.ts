import { describe, expect, it } from 'vitest';
import { buildAnalysisSystemPrompt, getEnabledAnalysisPromptModules } from './analysis-system-prompt';

describe('analysis-system-prompt', () => {
  it('habilita modulos especificos conforme o snapshot', () => {
    const modules = getEnabledAnalysisPromptModules({
      meta: { spend: 100, unique_link_clicks: 300 },
      trend: { ctr: { current: 1.2 } },
      user_context: {
        stated_objective: 'gerar leads',
        creatives: [{ ad_name: 'Criativo A' }],
      },
      message_match: { lp_headline: 'Oferta' },
      landing_page: {
        content_source: 'http_html_text',
        content: 'x'.repeat(1400),
      },
      segments: {
        hourly: { '10': 12 },
      },
      meta_breakdown: {
        ads: [{ id: '1' }],
      },
    });

    expect(modules).toContain('creative-analysis');
    expect(modules).toContain('landing-page');
    expect(modules).toContain('message-match');
    expect(modules).toContain('trend-analysis');
    expect(modules).toContain('user-context');
  });

  it('gera prompt com estrutura obrigatoria', () => {
    const prompt = buildAnalysisSystemPrompt({
      meta: { spend: 100 },
      landing_page: { content_source: 'fetch_failed_or_empty', content: '' },
      user_context: {},
      meta_breakdown: {},
      segments: {},
    });

    expect(prompt).toContain('## Diagnostico Executivo');
    expect(prompt).toContain('## Analise do Funil');
    expect(prompt).toContain('## Plano de Acao 100% Pratico');
  });

  it('perfil funnel omite modulo de criativos HSO mesmo com creatives no snapshot', () => {
    const snapshot = {
      meta: { spend: 100, unique_link_clicks: 300 },
      user_context: { creatives: [{ ad_name: 'A' }] },
      meta_breakdown: { ads: [{ id: '1' }] },
      segments: {},
      landing_page: { content: '', content_source: 'fetch_failed_or_empty' },
    };
    const modules = getEnabledAnalysisPromptModules(snapshot, 'funnel');
    expect(modules).not.toContain('creative-analysis');
    const prompt = buildAnalysisSystemPrompt(snapshot, { profile: 'funnel' });
    expect(prompt).not.toContain('=== ANALISE DE CRIATIVOS (HSO');
    expect(prompt).toContain('PERFIL FUNIL');
  });

  it('perfil landing-page omite tendencia na estrutura e modulos', () => {
    const snapshot = {
      meta: { spend: 50 },
      trend: { ctr: { current: 1 } },
      user_context: {},
      meta_breakdown: {},
      segments: {},
      landing_page: { content_source: 'http_html_text', content: 'x'.repeat(1300) },
    };
    expect(getEnabledAnalysisPromptModules(snapshot, 'landing-page')).not.toContain('trend-analysis');
    const prompt = buildAnalysisSystemPrompt(snapshot, { profile: 'landing-page' });
    expect(prompt).toContain('PERFIL LANDING PAGE');
    expect(prompt).not.toContain('=== TENDENCIA ===');
  });
});
