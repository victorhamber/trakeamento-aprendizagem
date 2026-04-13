import { z } from 'zod';
import {
  REQUIRED_ANALYSIS_SECTIONS,
  type AnalysisValidationResult,
  validateAnalysisMarkdown,
} from '../analysis-contract';

export const ANALYSIS_PROFILES = ['full', 'landing-page', 'funnel', 'creative'] as const;
export type AnalysisProfile = (typeof ANALYSIS_PROFILES)[number];
export const analysisProfileSchema = z.enum(ANALYSIS_PROFILES);

export const ANALYSIS_PROFILE_DEFAULT: AnalysisProfile = 'full';

/** Seções obrigatórias no Markdown por perfil (validação pós-modelo). */
export const REQUIRED_SECTIONS_BY_PROFILE: Record<AnalysisProfile, readonly string[]> = {
  full: REQUIRED_ANALYSIS_SECTIONS,
  'landing-page': ['## Diagnostico Executivo', '## Analise da Landing Page', '## Plano de Acao'],
  funnel: ['## Diagnostico Executivo', '## Analise do Funil', '## Plano de Acao'],
  creative: ['## Diagnostico Executivo', '## Analise de Criativos', '## Plano de Acao'],
};

export function validateAnalysisMarkdownForProfile(
  content: string,
  profile: AnalysisProfile,
  expectedSections: string[] = []
): AnalysisValidationResult {
  const required = REQUIRED_SECTIONS_BY_PROFILE[profile] || REQUIRED_ANALYSIS_SECTIONS;
  return validateAnalysisMarkdown(content, expectedSections, required);
}

/** Módulos de instrução (exceto response-structure) desligados por perfil para enxugar contexto. */
export function promptModuleAllowedForProfile(moduleId: string, profile: AnalysisProfile): boolean {
  if (profile === 'full') return true;
  if (profile === 'landing-page') {
    return moduleId !== 'creative-analysis' && moduleId !== 'trend-analysis';
  }
  if (profile === 'funnel') {
    return moduleId !== 'creative-analysis' && moduleId !== 'landing-page';
  }
  if (profile === 'creative') {
    return moduleId !== 'landing-page';
  }
  return true;
}
