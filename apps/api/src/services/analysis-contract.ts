export const REQUIRED_ANALYSIS_SECTIONS = [
  '## Diagnostico Executivo',
  '## Analise do Funil',
  '## Plano de Acao',
] as const;

/** Variantes aceitas para a mesma secao logica (prompt vs titulo exato no contrato). */
const HEADING_EQUIVALENTS: Record<string, readonly string[]> = {
  '## Diagnostico Executivo': ['## Diagnostico Executivo', '## Diagnóstico Executivo'],
  '## Analise do Funil': ['## Analise do Funil', '## Análise do Funil'],
  '## Plano de Acao': [
    '## Plano de Acao',
    '## Plano de Ação',
    '## Plano de Acao 100% Pratico',
    '## Plano de Ação 100% Prático',
  ],
};

export type AnalysisValidationResult = {
  valid: boolean;
  missing: string[];
  missingExpected: string[];
  truncated: boolean;
  outOfOrder: string[];
  headings: string[];
};

function collectMarkdownHeadings(content: string): string[] {
  return Array.from(content.matchAll(/^##\s+.+$/gm)).map((match) => match[0].trim());
}

function normalizeHeading(input: string): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function headingVariants(canonical: string): readonly string[] {
  return HEADING_EQUIVALENTS[canonical] || [canonical];
}

/** Primeira posicao no documento onde aparece qualquer variante do titulo obrigatorio. */
function findSectionIndex(headings: string[], canonical: string): number {
  const variants = headingVariants(canonical);
  const normalizedHeadings = headings.map(normalizeHeading);
  let best = -1;
  for (const v of variants) {
    const i = normalizedHeadings.findIndex((h) => h === normalizeHeading(v));
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

export function validateAnalysisMarkdown(
  content: string,
  expectedSections: string[] = [],
  requiredSections: readonly string[] = REQUIRED_ANALYSIS_SECTIONS
): AnalysisValidationResult {
  const headings = collectMarkdownHeadings(content);
  const missing = requiredSections.filter((section) => findSectionIndex(headings, section) === -1);
  const missingExpected = expectedSections.filter((section) => findSectionIndex(headings, section) === -1);

  const outOfOrder: string[] = [];
  let previousIndex = -1;
  for (const section of requiredSections) {
    const index = findSectionIndex(headings, section);
    if (index === -1) continue;
    if (index < previousIndex) outOfOrder.push(section);
    previousIndex = index;
  }

  const trimmed = content.trimEnd();
  const truncated = !trimmed.endsWith('*')
    && !trimmed.endsWith('---')
    && !trimmed.endsWith('|')
    && !trimmed.endsWith('.')
    && !trimmed.endsWith(')')
    && trimmed.length > 2000;

  return {
    valid: missing.length === 0 && outOfOrder.length === 0,
    missing,
    missingExpected,
    truncated,
    outOfOrder,
    headings,
  };
}
