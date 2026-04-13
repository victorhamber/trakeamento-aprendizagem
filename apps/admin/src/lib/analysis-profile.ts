export type AnalysisProfileId = 'full' | 'landing-page' | 'funnel' | 'creative';

export const ANALYSIS_PROFILE_OPTIONS: readonly {
  value: AnalysisProfileId;
  label: string;
  description: string;
}[] = [
  {
    value: 'full',
    label: 'Completo',
    description: 'Funil, vendas, criativos, landing e tendência',
  },
  {
    value: 'landing-page',
    label: 'Landing / CRO',
    description: 'Foco em página, copy e congruência com anúncio',
  },
  {
    value: 'funnel',
    label: 'Funil',
    description: 'Etapas do funil, vendas e plano (sem bloco longo de criativos)',
  },
  {
    value: 'creative',
    label: 'Criativos',
    description: 'Performance por anúncio e sugestões de copy',
  },
] as const;

export type ReportWizardGenerateContext = {
  objective: string;
  landing_page_url: string;
  selected_ad_ids?: string[];
  analysisProfile: AnalysisProfileId;
};

export function labelForAnalysisProfile(id: string | undefined | null): string {
  if (!id) return 'Completo';
  const found = ANALYSIS_PROFILE_OPTIONS.find((o) => o.value === id);
  return found?.label ?? id;
}
