export const REQUIRED_ANALYSIS_SECTIONS = [
  '## Diagnostico Executivo',
  '## Analise do Funil',
  '## Plano de Acao',
] as const;

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

function findHeadingIndex(headings: string[], section: string): number {
  return headings.findIndex((heading) => heading === section);
}

export function validateAnalysisMarkdown(
  content: string,
  expectedSections: string[] = [],
  requiredSections: readonly string[] = REQUIRED_ANALYSIS_SECTIONS
): AnalysisValidationResult {
  const headings = collectMarkdownHeadings(content);
  const missing = requiredSections.filter((section) => findHeadingIndex(headings, section) === -1);
  const missingExpected = expectedSections.filter((section) => findHeadingIndex(headings, section) === -1);

  const outOfOrder: string[] = [];
  let previousIndex = -1;
  for (const section of requiredSections) {
    const index = findHeadingIndex(headings, section);
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
