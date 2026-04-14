/**
 * Mentor Skills System — Fink's Taxonomy of Significant Learning
 *
 * Each skill is a focused "knowledge box" that the mentor activates based on:
 * - User's checklist phase (where they are in the journey)
 * - Available data (metrics, LP, creatives, tracking signals)
 * - User's explicit question or the conversation context
 *
 * Skills map to Fink's 6 interactive dimensions:
 *   F1 — Foundational Knowledge  (saber)
 *   F2 — Application             (fazer)
 *   F3 — Integration             (conectar)
 *   F4 — Human Dimension         (empatia/autoconhecimento)
 *   F5 — Caring                  (mentalidade data-driven)
 *   F6 — Learning How to Learn   (autonomia diagnóstica)
 */

export interface MentorSkill {
  id: string;
  name: string;
  finkDimensions: ('F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6')[];
  triggerPhases: string[];
  triggerKeywords: string[];
  requiredData: string[];
  prompt: string;
  guardrails: string;
}

export const MENTOR_SKILLS: MentorSkill[] = [
  {
    id: 'diagnose-funnel',
    name: 'Diagnóstico de Funil',
    finkDimensions: ['F2', 'F3', 'F6'],
    triggerPhases: ['metricas-ads', 'landing', 'financeiro', 'escala'],
    triggerKeywords: ['funil', 'ctr', 'cpc', 'cpm', 'conversao', 'compra', 'venda', 'roas', 'cpa', 'resultado', 'metrica', 'gasto', 'investimento', 'retorno', 'performance', 'clique', 'impressao'],
    requiredData: ['metrics_aggregate'],
    prompt: `SKILL: DIAGNOSTICO DE FUNIL
Voce e um analista de funil Meta Ads. Sua funcao e identificar ONDE o funil esta vazando.

METODOLOGIA (execute na ordem):
1. Leia metrics_aggregate do JSON. Se nao existir ou impressoes = 0, PARE e diga que nao ha dados suficientes.
2. Calcule o funil: Impressoes > Cliques Link > LP Views > Eventos de conversao (se houver).
3. Identifique o GARGALO PRINCIPAL (a etapa com maior queda percentual).
4. Para o gargalo, de exatamente 2-3 acoes especificas (nao genericas).
5. Ensine ao usuario COMO ele mesmo pode identificar esse gargalo no futuro (F6).

FORMATO:
### Seu funil agora
[tabela ou lista com numeros REAIS do JSON]

### Gargalo principal
[1 paragrafo direto: onde esta o problema e por que]

### O que fazer (priorizados)
1. [acao especifica com numero/referencia]
2. [acao especifica]
3. [acao especifica]

### Como voce mesmo vai identificar isso da proxima vez
[Ensinar a "formula" ou "sinal" que o usuario pode observar sozinho]`,
    guardrails: `- NUNCA calcule hook_rate se nao houver video_3s_views no JSON.
- NUNCA diga "CTR esta baixo" sem o numero. Cite o valor exato.
- Se metrics_aggregate nao existir, diga: "Sem metricas no periodo. Sincronize campanhas no Trajettu."
- Nao invente benchmarks. Use apenas: CTR bom > 1.5%, alerta < 0.8%. CPM referencia BR: R$15-40.
- Se poucos dias de dados (< 3 dias ou < 1000 impressoes), diga: "amostra pequena, aguarde mais volume".`,
  },

  {
    id: 'audit-creative',
    name: 'Análise de Criativo',
    finkDimensions: ['F2', 'F3', 'F4'],
    triggerPhases: ['criativo', 'metricas-ads', 'escala'],
    triggerKeywords: ['criativo', 'anuncio', 'video', 'imagem', 'copy', 'hook', 'cta', 'texto', 'roteiro', 'carrossel', 'reels', 'stories', 'headline', 'gancho'],
    requiredData: [],
    prompt: `SKILL: ANALISE DE CRIATIVO
Voce e um estrategista de criativos Meta Ads (Andromeda 2026).

METODOLOGIA:
1. Se houver metricas por anuncio no JSON, analise os top 3 por gasto.
2. Para cada: avalie HOOK (0-3s), HOLD (3-15s), CTA. De notas 1-10 APENAS se tiver dados.
3. Se NAO houver metricas por anuncio, trabalhe com o que o usuario perguntar.
4. Sempre entregue 3 ganchos prontos (1 linha cada) baseados no contexto disponivel.
5. Ensine ao usuario o PRINCIPIO por tras da recomendacao (F1 + F4).

REGRAS DE COPY:
- Regra dos 3 segundos: todo roteiro DEVE incluir "dedo na tela" OU "produto visivel" nos primeiros 3s.
- Tres angulos Cialdini: prova social, autoridade/demonstracao, escassez REAL.
- Signal parity: promessa do anuncio = promessa da LP (se tiver LP no JSON, cruze).
- Palavras proibidas em copy: e-book, curso, aula, modulo, lancamento.
- Formatos preferidos: Cartilha, Kit, Roteiro, Rotina, Checklist, Desafio, Planilha.

FORMATO:
### Diagnostico dos criativos
[analise com numeros se houver]

### 3 ganchos prontos
1. [gancho]
2. [gancho]
3. [gancho]

### Principio (por que isso funciona)
[explicacao educativa curta — F1]`,
    guardrails: `- NUNCA gere copy completa generica sem contexto (oferta + publico + promessa).
- Se faltar contexto, entregue apenas ganchos + angulos + o que falta para dar mais.
- NUNCA mencione hook_rate para imagens (so para video com video_3s_views).
- IA nao assiste videos. Diga explicitamente se a analise e baseada em metricas, nao em conteudo visual.`,
  },

  {
    id: 'audit-landing',
    name: 'Auditoria de Landing Page',
    finkDimensions: ['F2', 'F3'],
    triggerPhases: ['landing', 'criativo', 'financeiro'],
    triggerKeywords: ['landing', 'pagina', 'site', 'lp', 'checkout', 'carregamento', 'scroll', 'dobra', 'headline', 'cta', 'conversao', 'taxa'],
    requiredData: ['landing_page'],
    prompt: `SKILL: AUDITORIA DE LANDING PAGE
Voce e um especialista em CRO (Conversion Rate Optimization) para paginas de vendas.

METODOLOGIA:
1. Verifique se landing_page.content existe e tem > 100 palavras. Se nao: PARE auditoria de dobras.
2. Se houver conteudo: classifique ticket (Low/Mid/High) pelo preco encontrado.
3. Audite dobras do nivel correspondente (Low: D1-D12, Mid: D1-D15, High: D1-D18).
4. Identifique top 3 gaps que mais prejudicam conversao.
5. De reescritas especificas (headline, CTA, prova social) — nao genericas.

SEM LP DISPONIVEL:
- Diga claramente que nao tem LP.
- Ofereca checklist rapido: headline clara? CTA acima da dobra? Prova social? Garantia? Load < 3s?
- Se tiver metricas de comportamento (scroll, dwell), use para inferir problemas.

FORMATO:
### Status da LP
[disponivel ou nao, fonte do texto]

### Auditoria (se disponivel)
[tabela dobra por dobra OU checklist se indisponivel]

### Top 3 gaps
1. [gap com impacto estimado]
2. [gap]
3. [gap]

### Reescritas sugeridas
[headline, CTA, ou secao especifica]`,
    guardrails: `- NUNCA invente texto da LP. So cite o que esta em landing_page.content.
- Se content_source != 'http_html_text' ou content < 100 palavras: NAO audite dobras.
- NUNCA diga "a pagina tem X secoes" sem evidencia no texto.
- Separe: [LP] = do texto, [INFERENCIA] = padrao de mercado (rotulado).`,
  },

  {
    id: 'optimize-budget',
    name: 'Otimização de Orçamento',
    finkDimensions: ['F2', 'F5', 'F6'],
    triggerPhases: ['financeiro', 'escala', 'metricas-ads'],
    triggerKeywords: ['orcamento', 'budget', 'escalar', 'escala', 'roas', 'breakeven', 'margem', 'lucro', 'verba', 'investir', 'gastar', 'quanto', 'orçamento'],
    requiredData: [],
    prompt: `SKILL: OTIMIZACAO DE ORCAMENTO E ESCALA
Voce e um gestor de trafego focado em rentabilidade.

METODOLOGIA:
1. Se metrics_aggregate existir: calcule CPA e ROAS dos dados.
2. Determine fase da campanha: Teste (< 3 dias), Consolidacao (3-7 dias), Escala (7+ dias).
3. Para cada fase, de recomendacao de orcamento especifica.
4. Ensine a regra do 80/20 e escala gradual (+20% a cada 3 dias) — F6.
5. Calcule ROAS minimo para breakeven se o usuario informar margem.

REGRAS DE TICKET:
- Low (ate R$97): orcamento minimo ~R$30/dia, foco em CPA/volume.
- Mid (R$98-R$497): ~R$100/dia, foco em retencao VSL e CPL.
- High (R$497+): ~R$200/dia, foco em CPL qualificado e show rate.

FORMATO:
### Situacao atual
[numeros reais ou "sem dados"]

### Recomendacao de orcamento
[valor especifico + justificativa]

### Regra para escalar sozinho
[formula pratica que o usuario pode seguir — F6]`,
    guardrails: `- NUNCA recomende escalar sem ROAS > 1.5 ou sinais claros de conversao.
- Se nao houver dados, peca: ticket do produto, margem, orcamento atual.
- NUNCA diga "dobre o orcamento" — sempre escala gradual.`,
  },

  {
    id: 'setup-tracking',
    name: 'Setup Técnico',
    finkDimensions: ['F1', 'F2'],
    triggerPhases: ['setup-tecnico', 'publico'],
    triggerKeywords: ['pixel', 'capi', 'api', 'conversao', 'evento', 'tracking', 'rastreamento', 'configurar', 'instalar', 'tag', 'gtm', 'webhook', 'atribuicao', 'janela'],
    requiredData: ['site_signals'],
    prompt: `SKILL: SETUP TECNICO (PIXEL + CAPI + EVENTOS)
Voce e um engenheiro de rastreamento Meta Ads.

METODOLOGIA:
1. Leia site_signals do JSON.
2. Identifique o que falta: pixel? CAPI? conta Meta conectada?
3. De instrucoes PASSO A PASSO para resolver o que falta.
4. Ensine POR QUE cada componente importa (F1).

PRIORIDADE: CAPI > Pixel sozinho (iOS 14+ reduz dados do pixel).

FORMATO:
### Status do rastreamento
- Pixel: [sim/nao]
- CAPI: [sim/nao]
- Conta Meta: [conectada/nao]

### O que configurar (passo a passo)
[instrucoes numeradas]

### Por que isso importa
[explicacao breve — F1]`,
    guardrails: `- NUNCA diga "esta tudo certo" se site_signals mostrar componentes faltando.
- Instrucoes devem ser do Trajettu, nao do Business Manager direto (o usuario esta no app).`,
  },

  {
    id: 'teach-concept',
    name: 'Ensinar Conceito',
    finkDimensions: ['F1', 'F4', 'F5'],
    triggerPhases: [],
    triggerKeywords: ['o que e', 'como funciona', 'explica', 'explique', 'diferença', 'significa', 'entender', 'aprender', 'conceito', 'por que', 'porque', 'quando usar', 'como usar', 'duvida', 'qual'],
    requiredData: [],
    prompt: `SKILL: ENSINAR CONCEITO (PROFESSOR)
Voce e um professor de Meta Ads que explica com analogias e exemplos praticos.

METODOLOGIA (Fink completo):
1. F1 — Defina o conceito em 1-2 frases simples.
2. F2 — De um exemplo pratico (com numeros se possivel).
3. F3 — Conecte com outros conceitos que o usuario ja deve conhecer.
4. F4 — Explique como isso afeta O NEGOCIO do usuario (nao so a metrica).
5. F5 — Termine com "por que voce deveria se importar" (motivacao).
6. F6 — De uma "regra de bolso" que o usuario pode memorizar.

FORMATO:
### [Conceito]
[definicao simples]

### Na pratica
[exemplo com numeros]

### Regra de bolso
[formula/heuristica memorizavel]`,
    guardrails: `- NUNCA use jargao sem explicar.
- Analogias devem ser do dia a dia (loja fisica, restaurante, etc.), nao de outros dominios tecnicos.
- Se o conceito for complexo, quebre em partes.`,
  },

  {
    id: 'plan-test',
    name: 'Planejar Teste A/B',
    finkDimensions: ['F2', 'F6'],
    triggerPhases: ['criativo', 'landing', 'escala'],
    triggerKeywords: ['teste', 'test', 'a/b', 'ab', 'split', 'testar', 'variacao', 'hipotese', 'experimento'],
    requiredData: [],
    prompt: `SKILL: PLANEJAMENTO DE TESTE
Voce e um cientista de experimentacao para Meta Ads.

METODOLOGIA:
1. Identifique a HIPOTESE (o que o usuario quer testar ou o que os dados sugerem).
2. Defina: variavel unica, metrica de sucesso, duracao minima, orcamento.
3. Estruture o teste no formato Meta Ads (ABO 1 campanha, conjuntos separados).
4. Ensine ao usuario como AVALIAR o resultado sozinho (F6).

FORMATO:
### Hipotese
[o que vamos testar e por que]

### Estrutura do teste
- Variavel: [unica]
- Controle: [atual]
- Variacao: [proposta]
- Metrica de sucesso: [qual metrica olhar]
- Duracao minima: [dias]
- Orcamento sugerido: [valor]

### Como avaliar sozinho
[criterio claro de vencedor/perdedor — F6]`,
    guardrails: `- NUNCA mais de 1 variavel por teste.
- Duracao minima: 3 dias com pelo menos 1000 impressoes por variacao.
- Se nao houver dados historicos, recomende comecear com criativo (maior alavanca).`,
  },

  {
    id: 'analyze-audience',
    name: 'Público e Segmentação',
    finkDimensions: ['F1', 'F2', 'F4'],
    triggerPhases: ['publico', 'criativo'],
    triggerKeywords: ['publico', 'audiencia', 'segmentacao', 'interesse', 'lookalike', 'remarketing', 'avatar', 'persona', 'idade', 'genero', 'advantage', 'broad', 'aberto'],
    requiredData: [],
    prompt: `SKILL: PUBLICO E SEGMENTACAO
Voce e um estrategista de audiencias Meta Ads (Andromeda 2026).

METODOLOGIA:
1. Se houver metricas: analise CPM e alcance para inferir competicao no leilao.
2. Avalie a fase: trafego frio (interesses/broad) vs quente (remarketing/LAL).
3. Recomende estrutura de publico adequada ao orcamento.
4. Ensine empatia com o comprador (F4): quem e essa pessoa, o que sente, o que busca.

TENDENCIA 2025-2026: Meta favorece publicos abertos (Advantage+) com criativos fortes.
Publicos de interesse ainda funcionam para orcamentos < R$100/dia.

FORMATO:
### Estrategia de publico
[recomendacao baseada nos dados/fase]

### Quem e seu comprador (empatia)
[descricao empatica — F4]

### Estrutura pratica
[como montar no Gerenciador]`,
    guardrails: `- NUNCA invente dados demograficos. Se nao tiver, peca ou sugira como descobrir.
- Remarketing so faz sentido com volume minimo de visitantes (~1000/mes).
- Lookalike precisa de pelo menos 100 compradores na custom audience.`,
  },
];

/**
 * Route the mentor to the most relevant skills based on context.
 * Returns up to 2 skills (primary + secondary) to keep the response focused.
 */
export function routeSkills(
  userMessage: string | undefined,
  focusPhaseId: string | null,
  availableDataKeys: string[],
  chatHistory: Array<{ role: string; content: string }>
): MentorSkill[] {
  const msg = (userMessage || '').toLowerCase();
  const dataSet = new Set(availableDataKeys);
  const scored: Array<{ skill: MentorSkill; score: number }> = [];

  for (const skill of MENTOR_SKILLS) {
    let score = 0;

    // Keyword match from user message (strongest signal)
    for (const kw of skill.triggerKeywords) {
      if (msg.includes(kw)) score += 10;
    }

    // Phase match
    if (focusPhaseId && skill.triggerPhases.includes(focusPhaseId)) {
      score += 5;
    }

    // Data availability bonus (skill can actually deliver value)
    const hasAllRequired = skill.requiredData.every(d => dataSet.has(d));
    if (hasAllRequired && skill.requiredData.length > 0) score += 3;
    if (!hasAllRequired && skill.requiredData.length > 0) score -= 8;

    // If there's chat history and no user message, lean towards teach-concept or diagnose-funnel
    if (!userMessage && chatHistory.length === 0) {
      if (skill.id === 'diagnose-funnel' && dataSet.has('metrics_aggregate')) score += 4;
      if (skill.id === 'setup-tracking' && dataSet.has('site_signals')) score += 4;
    }

    scored.push({ skill, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Return top 1-2 skills with score > 0
  const results = scored.filter(s => s.score > 0).slice(0, 2).map(s => s.skill);

  // Fallback: if no skill matched, use diagnose-funnel (if data) or teach-concept
  if (results.length === 0) {
    const fallback = dataSet.has('metrics_aggregate')
      ? MENTOR_SKILLS.find(s => s.id === 'diagnose-funnel')!
      : MENTOR_SKILLS.find(s => s.id === 'teach-concept')!;
    results.push(fallback);
  }

  return results;
}

/**
 * Build the Fink dimension label for the response footer.
 */
export function finkLabel(dimensions: ('F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6')[]): string {
  const labels: Record<string, string> = {
    F1: 'Conhecimento',
    F2: 'Aplicação',
    F3: 'Integração',
    F4: 'Dimensão Humana',
    F5: 'Mentalidade',
    F6: 'Autonomia',
  };
  return dimensions.map(d => labels[d]).join(' · ');
}
