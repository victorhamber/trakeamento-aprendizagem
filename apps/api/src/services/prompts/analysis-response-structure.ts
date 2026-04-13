import type { AnalysisProfile } from './analysis-profiles';
import type { AnalysisPromptContext } from './analysis-prompt-context';

function buildFullResponseStructure(ctx: AnalysisPromptContext): string {
  const sections: string[] = [];
  sections.push(`
=== ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATORIO) ===

## Diagnostico Executivo

Abra esta secao com 1-2 frases curtas de resumo executivo (o que aconteceu no periodo). Depois preencha a tabela.

| | |
|---|---|
| Status | Excelente / Estavel / Em Risco / Critico |
| Objetivo | [meta.objective] |
| Evento otimizado | [o que meta.results representa] |
| Resultado | [meta.results] conversoes ao custo de [CPA] cada |
| ROAS Real | [sales.roas]x ou "N/A" com explicacao |
| Tendencia | ↑/↓/→ + resumo (ou "Sem dados de comparacao") |
| Veredito | 1 frase direta sobre a saude da campanha |
| Principal Gargalo | Onde esta o problema (ou "Sem gargalo critico") |
| Oportunidade | Alavanca mais facil para melhorar |

---

## Analise do Funil

| Etapa | Metrica | Valor | Status | Diagnostico |
|:---|:---|:---|:---:|:---|
| Atracao | CTR | X% | ok/alerta/critico | [analise] |
| Retencao criativo | Hook Rate | X% ou N/A (imagem) | — | [analise] |
| Conexao | Taxa LP View | X% | — | [analise] |
| Velocidade | Load time | Xms ou Sem dados | — | [analise] |
| Interesse | Dwell Time | Xms ou Sem dados | — | [analise] |
| Intencao | Scroll medio | X% ou Sem dados | — | [analise] |
| Conversao | CPA | R$X | — | [baseado no evento otimizado] |

**Insight:** [2 linhas sobre o padrao do funil]`);

  if (ctx.hasMetaSpend) {
    sections.push(`
---

## Vendas e ROAS

| Fonte | Compras | Receita | ROAS |
|:---|---:|---:|---:|
| Meta (Pixel/CAPI) | [meta.purchases] | — | — |
| **Banco (real)** | **[sales.purchases]** | **R$[sales.revenue]** | **[sales.roas]x** |

*Comente discrepancia ou ausencia de dados. Se webhook nao configurado, mencione.*`);
  }

  if (ctx.hasAdsBreakdown) {
    sections.push(`
---

## Analise de Criativos

### Performance por Anuncio (dados Meta)

Regras de interpretacao:
- **CPA**: se **Resultados = 0**, CPA deve ser **"—"** (nao existe custo por resultado).
- **"Fadiga"**: so use se houver **evidencia** (ex.: frequencia alta + piora de CTR/CPA no tempo). Se nao houver tendencia por anuncio no JSON, prefira **"Otimizar"** ou **"Sem sinal / pouco dado"**.
- Use no maximo **5 anuncios** (top por gasto). Para o resto, agregue em 1 linha de observacao.

Inclua tambem as metricas de funil por anuncio quando existirem no JSON:
- **LP Views** e **Clique → Pagina (Connect Rate)**.
- **Checkout** (initiates_checkout) e **Compras** quando existirem.

| Anuncio | Resultados | Custo | CPA | CTR | Hook Rate | LP Views | Clique → Pagina | Checkout | Compras | Diagnostico |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| [nome] | X | R$X | R$X ou — | X% | X% ou N/A(img) | X | X% | X | X | [Vencedor/Otimizar/Sem sinal] |

*Hook Rate: so para VIDEO (video_3s_views > 0). N/A para imagem.*`);
  }

  if (ctx.hasCreatives) {
    sections.push(`
### Avaliacao Qualitativa dos Criativos

Para no maximo **3 criativos**:

#### 🏷️ [ad_name]
**Copy Atual**: [analise critica]
**Estrutura & Hook**: [avaliacao do gancho e CTA]
**Nota de Potencial**: [X/10] — [justificativa]

Sempre entregue **exemplos** (nao apenas conceitos). Regras:
- Se houver **contexto suficiente** (oferta + publico/ICP + promessa/beneficio + pelo menos 1 objeção), gere **1 reescrita completa** (hook + corpo + CTA) e **2 variações de hook**.
- Se faltar contexto, ainda assim gere **3 ganchos curtos (1 linha)** + **2 CTAs** + **1 estrutura de anuncio** em bullet points com **placeholders** (ex.: [beneficio], [mecanismo], [prova real]) e um **criterio de decisao** (qual metrica deve subir).

> **Sugestoes de Copy (com exemplos)**:
> - **Hooks (3 opcoes)**: [3 frases]
> - **CTA (2 opcoes)**: [2 frases]
> - **Versao completa (se houver contexto)**:
>   - **Hook**: [...]
>   - **Corpo**: [...]
>   - **CTA**: [...]

### Veredito dos Criativos
[Qual tem melhor estrutura e deve receber mais verba]`);
  }

  if (ctx.hasTrend) {
    sections.push(`
---

## Tendencia

| Metrica | Anterior | Atual | Variacao | Tendencia |
|:---|---:|---:|---:|:---:|
| Spend/Results/CPA/CTR/ROAS | — | — | — | ↑/↓/→ |`);
  }

  if (ctx.hasTemporalData && ctx.temporalHasVolume) {
    sections.push(`
---

## Distribuicao Temporal
- Melhores horarios (top 3) e melhores dias
- Recomendacao de ajuste de orcamento por horario/dia`);
  } else if (ctx.hasTemporalData && !ctx.temporalHasVolume) {
    sections.push(`
---

## Distribuicao Temporal
Sem recomendacao por horario/dia: **amostra pequena** para afirmar padroes. Prefira coletar mais volume antes de otimizar agenda.`);
  }

  sections.push(`
---

## Auditoria Tecnica

| Area | Item | Status | Detalhes |
|:---|:---|:---:|:---|
| Rastreamento | UTMs, Macros, Discrepancia, Funil de dados, Vendas Meta vs Banco | OK/Alert | [dados] |
| Comportamento | Load Time, Scroll, Dwell | OK/Alert | [dados] |`);

  if (ctx.hasLPDeepAudit) {
    sections.push(`
---

## Analise da Landing Page

Estrutura obrigatoria (use subtitulos ## ou ###):
1. **Fonte dos dados** — como o texto foi obtido; limitacoes (JS, truncamento).
2. **Nivel do produto** — faixa de preco e decisao de compra esperada.
   - Se o JSON trouxer "landing_page.price_best" e "amount_brl" nao for nulo, use **BRL convertido** (mencione a moeda original e que e conversao).
   - Se "amount_brl" for nulo mas houver moeda nao-BRL, diga: "preco em [moeda], conversao indisponivel no momento" (nao chute).
3. **Auditoria por dobra** — checklist do nivel (Presente/Fraco/Ausente + 1 frase por dobra).
4. **Gaps criticos** — top 5.
5. **Congruencia anuncio-pagina** — se houver criativos/message_match no JSON.
6. **Comportamento vs pagina** — dwell, scroll, load (dados do JSON).
7. **Otimizacao** — headline, subhead, **e** blocos adicionais (prova, oferta, CTA, garantia, FAQ, urgencia) em formato acionavel.
   - Se o JSON trouxer "landing_page.social_proof_detected" = true, **nao diga** "falta prova social". Em vez disso, avalie **robustez** (quantidade, especificidade, prova verificavel, diversidade) e proponha como fortalecer (ex.: provas numericas reais, estudos de caso, prints verificaveis, selos reais, audit trail), sem inventar nada.

Nao limite a analise a apenas headline/subheadline.`);
  } else if (ctx.hasLPAnyText) {
    sections.push(`
---

## Analise da Landing Page
O recorte de HTML/texto parece **insuficiente** para uma auditoria por dobras (possivel pagina dinamica).
Faca uma analise **conservadora** baseada em checklist + metricas (load/dwell/scroll) sem citar secoes especificas.`);
  }

  if (ctx.hasMessageMatch) {
    sections.push(`
---

## Message Match
| Criativo | Promessa | Headline LP | Veredicto |
|:---|:---|:---|:---:|
[Para cada criativo + analise de coerencia + solucoes se mismatch]`);
  }

  sections.push(`
---

## Plano de Acao 100% Pratico

Inclua uma lista NUMERADA no inicio desta secao (1., 2., 3., ...) com os passos mais urgentes; depois pode usar a tabela por prazo.

| Prazo | Acao (O Que + Metrica Alvo) | Como Implementar |
|:---|:---|:---|
| **Hoje** | [cortar sangramento — ex: pausar anuncio X] | [passo a passo com numeros] |
| **Esta Semana** | [alavanca HSO/PAS — ex: nova copy] | [antes/depois concreto] |
| **Proximo Ciclo** | [mudanca estrategica] | [reestruturacao clara] |

### Checklist Final
- [ ] [Acao 1]
- [ ] [Acao 2]
- [ ] [Acao 3]

---
*Diagnostico gerado por Analista IA (Frameworks: PAS, HSO, Pareto, Schwartz) — Meta Ads + CAPI + DB.*`);

  return sections.join('\n');
}

/** Perfil landing: foco CRO/LP; sem tabela completa de funil nem bloco longo de criativos. */
function buildLandingResponseStructure(ctx: AnalysisPromptContext): string {
  const parts: string[] = [];
  parts.push(`
=== ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATORIO) — PERFIL LANDING PAGE ===

Prioridade: **conversao na pagina**, copy, prova, CTA, velocidade e congruencia com anuncio. Use apenas dados do JSON.

## Diagnostico Executivo

1-2 frases de resumo. Depois tabela compacta:

| | |
|---|---|
| Status | Excelente / Estavel / Em Risco / Critico |
| ROAS / CPA (se houver) | [valores ou "sem dados"] |
| Principal hipotese de perda na LP | [1 frase] |
| Proximo teste de maior impacto | [1 linha] |

Se meta.spend > 0, no maximo **3 linhas** de contexto de trafego (CTR/CPC/connect) — nao substitua a analise de LP.

**NAO** inclua a secao "## Analise do Funil" neste perfil.`);

  if (ctx.hasMetaSpend) {
    parts.push(`
---

## Vendas e ROAS (resumo)

Tabela curta Meta vs Banco se aplicavel; 1-2 frases de leitura.`);
  }

  parts.push(`
---

## Analise da Landing Page

Secao principal. Siga o modulo de auditoria do system prompt (dobras ou checklist conservador).
Inclua: fonte dos dados, nivel de ticket (se identificavel), gaps, otimizacoes acionaveis, cruzamento com dwell/scroll/load.`);

  parts.push(`
---

## Auditoria Tecnica

| Area | Item | Status | Detalhes |
|:---|:---|:---:|:---|
| Rastreamento | UTMs, discrepancia clique→LP | OK/Alert | [dados] |
| Comportamento | Load, scroll, dwell | OK/Alert | [dados] |`);

  if (ctx.hasMessageMatch) {
    parts.push(`
---

## Message Match

Tabela criativo / promessa / headline LP + correcoes se mismatch.`);
  }

  parts.push(`
---

## Plano de Acao 100% Pratico

Lista NUMERADA (1., 2., 3., ...) **priorizando LP/CRO** (testes, copy, prova social real, velocidade, mobile). Depois tabela por prazo se quiser.

---
*Perfil: landing-page — Meta Ads + CAPI + DB.*`);

  return parts.join('\n');
}

/** Perfil funil: funil + vendas + tendencia; sem avaliacao qualitativa longa de criativos. */
function buildFunnelResponseStructure(ctx: AnalysisPromptContext): string {
  const sections: string[] = [];
  sections.push(`
=== ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATORIO) — PERFIL FUNIL ===

## Diagnostico Executivo

Resumo executivo + mesma tabela base do relatorio completo (status, objetivo, evento, resultados, ROAS, tendencia, gargalo).

---

## Analise do Funil

Tabela completa de etapas (CTR, hook, LP view, load, dwell, scroll, CPA) + **Insight** em 2 linhas.

**NAO** inclua "## Analise de Criativos" neste perfil (nem tabela por anuncio nem bloco HSO qualitativo).`);

  if (ctx.hasMetaSpend) {
    sections.push(`
---

## Vendas e ROAS

Tabela Meta vs Banco + comentario de discrepancia.`);
  }

  if (ctx.hasTrend) {
    sections.push(`
---

## Tendencia

Tabela comparativa periodo anterior vs atual.`);

  }

  if (ctx.hasTemporalData && ctx.temporalHasVolume) {
    sections.push(`
---

## Distribuicao Temporal

Top horarios/dias + recomendacao de agenda.`);
  } else if (ctx.hasTemporalData && !ctx.temporalHasVolume) {
    sections.push(`
---

## Distribuicao Temporal

Volume insuficiente — nao force otimizacao por horario.`);
  }

  sections.push(`
---

## Auditoria Tecnica

Rastreamento + comportamento (tabela).`);

  if (ctx.hasLPDeepAudit || ctx.hasLPAnyText) {
    sections.push(`
---

## Analise da Landing Page (compacta)

Maximo **8-12 linhas** ou bullets: conexao clique→LP, hipoteses de friccao, 3 acoes. Nao replique auditoria completa por dobras a menos que o gargalo principal seja LP.`);
  }

  sections.push(`
---

## Plano de Acao 100% Pratico

Numerado + tabela por prazo. Foco em **gargalos de funil** (atencao, clique, pagina, evento otimizado).

---
*Perfil: funnel — Meta Ads + CAPI + DB.*`);

  return sections.join('\n');
}

/** Perfil criativos: performance por anuncio + qualitativo; sem auditoria longa de LP. */
function buildCreativeResponseStructure(ctx: AnalysisPromptContext): string {
  const parts: string[] = [];
  parts.push(`
=== ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATORIO) — PERFIL CRIATIVOS ===

## Diagnostico Executivo

Resumo curto (2-4 linhas) + tabela: Status, Objetivo, Resultados/CPA, ROAS, principal criativo ou conjunto em destaque.

**NAO** inclua a secao "## Analise do Funil" (tabela de etapas). Se precisar, cite **uma** metrica de funil no executivo apenas como contexto.`);

  if (ctx.hasMetaSpend) {
    parts.push(`
---

## Vendas e ROAS

Tabela resumida + 1 frase ligando criativo a resultado.`);
  }

  if (ctx.hasAdsBreakdown) {
    parts.push(`
---

## Analise de Criativos

### Performance por Anuncio (dados Meta)

Mesmas regras do relatorio completo (CPA "—" se resultados 0, fadiga so com evidencia, ate 5 anuncios).

| Anuncio | Resultados | Custo | CPA | CTR | Hook Rate | LP Views | Clique → Pagina | Diagnostico |
|:---|---:|---:|---:|---:|---:|---:|---:|:---|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |`);
  }

  if (ctx.hasCreatives) {
    parts.push(`
### Avaliacao Qualitativa dos Criativos

Ate 3 criativos: copy, hook, oferta, nota /10, sugestoes com exemplos (como no relatorio completo).

### Veredito dos Criativos

Qual escalar, qual pausar, qual testar.`);
  } else if (!ctx.hasAdsBreakdown) {
    parts.push(`
---

## Analise de Criativos

Sem breakdown de anuncios no JSON: diga explicitamente "sem dados por anuncio" e use apenas user_context.creatives se existirem, com ressalvas.`);
  }

  if (ctx.hasTrend) {
    parts.push(`
---

## Tendencia

Impacto nos criativos (CTR, frequencia, CPA) quando couber.`);
  }

  if (ctx.hasTemporalData && ctx.temporalHasVolume) {
    parts.push(`
---

## Distribuicao Temporal

Opcional e curto se ajudar a priorizar criativos por janela.`);
  }

  parts.push(`
---

## Auditoria Tecnica

Foco em sinais que afetam leitura de criativo (discrepancia, atribuicao, dados faltantes).`);

  if (ctx.hasMessageMatch) {
    parts.push(`
---

## Message Match

Coerencia anuncio ↔ LP.`);
  }

  parts.push(`
---

## Plano de Acao 100% Pratico

Priorize **testes de criativo** (hooks, formatos, angulos, CTAs), lances por anuncio vencedor, e pausa de sangramento.

---
*Perfil: creative — Meta Ads + CAPI + DB.*`);

  return parts.join('\n');
}

export function buildResponseStructurePrompt(ctx: AnalysisPromptContext, profile: AnalysisProfile): string {
  switch (profile) {
    case 'full':
      return buildFullResponseStructure(ctx);
    case 'landing-page':
      return buildLandingResponseStructure(ctx);
    case 'funnel':
      return buildFunnelResponseStructure(ctx);
    case 'creative':
      return buildCreativeResponseStructure(ctx);
    default:
      return buildFullResponseStructure(ctx);
  }
}
