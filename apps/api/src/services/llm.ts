import axios, { AxiosError } from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

interface LlmConfig {
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 8000;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRY_ATTEMPTS = 2;
const MAX_SNAPSHOT_CHARS = 60_000;
const BREAKDOWN_MAX_ROWS = 10;

export class LlmService {

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private fmt(n: unknown, digits = 2): string {
    const v = Number(n);
    return Number.isFinite(v) ? v.toFixed(digits) : '—';
  }

  private fmtInt(n: unknown): string {
    const v = Number(n);
    return Number.isFinite(v) ? Math.trunc(v).toLocaleString('pt-BR') : '—';
  }

  private fmtMoney(n: unknown): string {
    const v = Number(n);
    return Number.isFinite(v) ? `R$ ${v.toFixed(2)}` : '—';
  }

  private fmtMs(n: unknown): string {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? `${Math.trunc(v)}ms` : '—';
  }

  private fmtPct(n: unknown): string {
    const v = Number(n);
    return Number.isFinite(v) ? `${v.toFixed(2)}%` : '—';
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
    const prefix = `[LlmService][${level.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, msg, extra ?? '');
    else if (level === 'warn') console.warn(prefix, msg, extra ?? '');
    else console.log(prefix, msg, extra ?? '');
  }

  private sanitizeSnapshot(snapshot: unknown): string {
    const snap = structuredClone(snapshot) as Record<string, unknown>;
    const lp = this.asRecord(snap.landing_page);
    if (typeof lp.content === 'string' && lp.content.length > 3000) {
      lp.content = lp.content.slice(0, 3000) + '\n[...truncado...]';
      snap.landing_page = lp;
    }
    const mb = this.asRecord(snap.meta_breakdown);
    for (const key of ['campaigns', 'adsets', 'ads']) {
      const arr = Array.isArray(mb[key]) ? (mb[key] as unknown[]) : [];
      if (arr.length > BREAKDOWN_MAX_ROWS) mb[key] = arr.slice(0, BREAKDOWN_MAX_ROWS);
    }
    snap.meta_breakdown = mb;
    const json = JSON.stringify(snap, null, 2);
    if (json.length <= MAX_SNAPSHOT_CHARS) return json;
    const snapReduced = { ...snap };
    delete snapReduced.segments;
    const signals = Array.isArray(snapReduced.signals) ? snapReduced.signals : [];
    snapReduced.signals = signals.slice(0, 5);
    return JSON.stringify(snapReduced, null, 2).slice(0, MAX_SNAPSHOT_CHARS)
      + '\n...snapshot truncado...';
  }

  private async getKeyForSite(siteKey: string): Promise<LlmConfig | null> {
    try {
      const result = await pool.query(
        `SELECT a.openai_api_key_enc, a.openai_model
         FROM sites s
         LEFT JOIN account_settings a ON a.account_id = s.account_id
         WHERE s.site_key = $1`,
        [siteKey]
      );
      const row = result.rows[0];
      if (!row?.openai_api_key_enc) return null;
      return {
        apiKey: decryptString(row.openai_api_key_enc as string),
        model: (row.openai_model as string) || DEFAULT_MODEL,
      };
    } catch (err) {
      this.log('error', 'Failed to fetch LLM config from DB', err);
      return null;
    }
  }

  private async callOpenAI(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userContent: string,
    attempt = 1
  ): Promise<string> {
    try {
      this.log('info', `Calling OpenAI [model=${model}, attempt=${attempt}]`);
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        }
      );
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') throw new Error('Resposta invalida da OpenAI — content vazio.');
      this.log('info', `OpenAI OK (${content.length} chars)`);
      return content;
    } catch (error) {
      const isRetryable = axios.isAxiosError(error) &&
        (!error.response ||
          error.response.status === 429 ||
          error.response.status >= 500);
      if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
        const delay = attempt * 2000;
        this.log('warn', `Retrying in ${delay}ms (attempt ${attempt})...`);
        await new Promise(res => setTimeout(res, delay));
        return this.callOpenAI(apiKey, model, systemPrompt, userContent, attempt + 1);
      }
      if (axios.isAxiosError(error)) {
        this.log('error', 'OpenAI Axios error', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          code: error.code,
        });
      } else if (error instanceof Error) {
        this.log('error', 'OpenAI error', error.message);
      }
      throw error;
    }
  }

  private readonly REQUIRED_SECTIONS = [
    '## Diagnostico Executivo',
    '## Analise do Funil',
    '## Plano de Acao',
  ];

  private readonly EXPECTED_SECTIONS = [
    '## Vendas e ROAS',
    '## Analise de Criativos',
    '## Auditoria Tecnica',
    '## Diagnostico de 3 Camadas',
    '## Analise Avancada: Copy, Frameworks e 80/20',
    '## Distribuicao Temporal',
  ];

  private validateOutput(content: string): { valid: boolean; missing: string[]; truncated: boolean } {
    const missing = this.REQUIRED_SECTIONS.filter(
      section => !content.includes(section)
    );
    // Check if output appears truncated (no natural ending)
    const trimmed = content.trimEnd();
    const truncated = !trimmed.endsWith('*') && !trimmed.endsWith('---') && !trimmed.endsWith('|')
      && !trimmed.endsWith('.') && !trimmed.endsWith(')')
      && trimmed.length > 2000;

    return { valid: missing.length === 0, missing, truncated };
  }

  private appendValidationWarnings(content: string, missing: string[], truncated: boolean): string {
    const warnings: string[] = [];
    if (truncated) {
      warnings.push('> ⚠️ **Aviso:** Este relatório pode estar incompleto (resposta truncada pelo modelo).');
    }
    if (missing.length > 0) {
      warnings.push(`> ⚠️ **Seções ausentes:** ${missing.join(', ')}. O modelo não seguiu a estrutura completa.`);
    }
    const missingExpected = this.EXPECTED_SECTIONS.filter(s => !content.includes(s));
    if (missingExpected.length > 0) {
      warnings.push(`> ℹ️ **Seções opcionais não incluídas:** ${missingExpected.join(', ')}.`);
    }
    if (warnings.length === 0) return content;
    return content + '\n\n---\n\n' + warnings.join('\n\n');
  }

  public async generateAnalysisForSite(siteKey: string, snapshot: unknown): Promise<string> {
    const cfg = await this.getKeyForSite(siteKey);
    const apiKey = cfg?.apiKey || process.env.OPENAI_API_KEY || '';
    const model = cfg?.model || DEFAULT_MODEL;
    if (!apiKey) {
      this.log('warn', 'No OpenAI key — returning fallback report');
      return this.fallbackReport(snapshot);
    }
    const systemPrompt = this.buildSystemPrompt();
    const snapshotJson = this.sanitizeSnapshot(snapshot);
    const userContent = `Dados estruturados do periodo (JSON):\n\n${snapshotJson}`;
    try {
      let content = await this.callOpenAI(apiKey, model, systemPrompt, userContent);
      const validation = this.validateOutput(content);

      // If critical sections are missing, retry once with a corrective prompt
      if (!validation.valid) {
        this.log('warn', `Output missing sections: ${validation.missing.join(', ')}. Retrying...`);
        try {
          const retryPrompt = `Voce gerou um relatorio incompleto. As seguintes secoes OBRIGATORIAS estao faltando: ${validation.missing.join(', ')}.\n\nPor favor, gere o relatorio COMPLETO seguindo a estrutura exata do system prompt. Inclua TODAS as secoes obrigatorias.\n\nDados:\n\n${snapshotJson}`;
          content = await this.callOpenAI(apiKey, model, systemPrompt, retryPrompt);
          const revalidation = this.validateOutput(content);
          content = this.appendValidationWarnings(content, revalidation.missing, revalidation.truncated);
        } catch {
          // If retry fails, use original content with warnings
          content = this.appendValidationWarnings(content, validation.missing, validation.truncated);
        }
      } else {
        content = this.appendValidationWarnings(content, [], validation.truncated);
      }

      return content;
    } catch {
      this.log('warn', 'All OpenAI attempts failed — returning fallback report');
      return this.fallbackReport(snapshot);
    }
  }

  private buildSystemPrompt(): string {
    return `Voce e um Estrategista de Performance e CRO Senior especializado em Meta Ads.
Sua missao e diagnosticar dados de performance como um consultor sênior (firme, direto, focado em vendas reais) e produzir um relatorio estruturado em Markdown. Seu tom de voz deve ser educativo mas assertivo, como um mentor do mercado. Nunca use linguagem corporativa burocratica; fale em termos praticos, de dor e conversao.

Sempre que analisar metricas, considere Benchmarks Brasileiros estimados: CTR (1-2%), CPC (R$0.50-2.50), CPM (R$15-40), Tx Conversao LP (1-3%), Taxa LP View (>70%).

=== PASSO 0 — LEIA ANTES DE ESCREVER QUALQUER COISA ===

Execute este checklist mentalmente:

1. Leia meta.objective — qual e o objetivo macro da campanha?
2. Leia meta.results — quantos resultados foram gerados pelo evento de otimizacao?
3. meta.results > 0? Se SIM, a campanha esta convertendo. NAO escreva "falta de conversoes" ou "problema no checkout".
4. O evento de otimizacao pode ser DIFERENTE do objetivo macro.
   Exemplo: objetivo=OUTCOME_SALES, otimizacao=CADASTRO_GRUPO — sucesso = cadastros, nao compras.
   Julgue sempre pelo meta.results, nunca por meta.purchases se esse nao for o evento otimizado.
5. utm_filters_skipped nao e null? Isso significa que filtros UTM com macros como {{campaign.name}} foram IGNORADOS.
   Os dados de CAPI/site cobrem TODO o trafego do site, sem segmentacao por campanha.
   Mencione isso na auditoria tecnica e considere ao interpretar os dados de comportamento.
6. site.effective_dwell_ms e null ou 0 E site.effective_scroll_pct e null ou 0?
   Significa que nao ha dados de comportamento (PageEngagement nao capturado).
   Diga "Dados de comportamento nao capturados (verificar script)". NAO invente nada sobre o usuario.
7. Confira sales.purchases e sales.revenue — esses sao dados REAIS do banco, nao do Meta.
   Compare com meta.purchases para detectar discrepancias de rastreamento.
8. Confira trend — se existir, compare metricas do periodo atual vs anterior para detectar tendencias.

=== REGRA CRITICA: OBJETIVO vs EVENTO DE OTIMIZACAO ===

meta.objective = objetivo macro (ex: OUTCOME_SALES, OUTCOME_LEADS)
meta.results   = evento pelo qual o pixel foi otimizado (ex: CADASTRO_GRUPO, LEAD, PURCHASE)

Estes podem ser DIFERENTES. O sucesso e SEMPRE medido por meta.results.

Tabela de interpretacao:
| meta.results representa | Sucesso = | Ignorar completamente |
|-------------------------|-----------|----------------------|
| CADASTRO_GRUPO | results count + CPA | purchases, initiates_checkout |
| LEAD / COMPLETE_REGISTRATION | results count + CPA | purchases |
| PURCHASE | results count + ROAS | leads, contacts |
| LINK_CLICKS | landing_page_views | purchases, leads |

=== REGRA: ROAS E VENDAS REAIS ===

sales.purchases = compras REAIS registradas no banco de dados (fonte absoluta de verdade).
sales.revenue = receita REAL.
sales.roas = receita real / investimento Meta.

Interpretacao:
| ROAS | Status | Acao |
|------|--------|------|
| > 3.0 | Excelente | Escalar investimento |
| 2.0 - 3.0 | Saudavel | Otimizar para crescer |
| 1.0 - 2.0 | Marginal | Avaliar margem — pode nao ser lucrativo |
| < 1.0 | Prejuizo | Acao urgente — investimento maior que receita |
| null / N/A | Sem dados | Evento otimizado nao e Purchase, ou sem vendas no periodo |

Se meta.purchases != sales.purchases, sinalize DISCREPANCIA. Possiveis causas:
- Compra sem parametros de tracking (atribuicao perdida)
- Webhook nao configurado para todas as plataformas
- Compra atribuida a outra campanha

=== REGRA: HOOK RATE ===

hook_rate_pct = null OU video_3s_views = 0 -> anuncio e IMAGEM. NAO mencione hook rate para esse anuncio.
Nunca diga que um anuncio tem "hook ruim" se nao ha dados de video.
Mencione hook rate apenas para anuncios onde video_3s_views > 0.

=== REGRA: LANDING PAGE ===

Se landing_page.content existir (nao null), analise brevemente:
- O titulo/headline esta claro e alinhado com o anuncio?
- Existe call-to-action visivel?
- O conteudo reforca a proposta de valor?
Se landing_page.content for null, diga "Conteudo da LP nao disponivel para analise".

=== REGRA: DIAGNOSTICO EM 3 CAMADAS ===

Analise o funil em tres camadas cruzadas (esta e a parte MAIS VALIOSA do relatorio):

**Camada 1 — ORIGEM (Meta Ads):** Como o anuncio performa?
- CTR, Hook Rate, Frequencia, CPM. O criativo esta atraindo cliques?
- Se CTR alto + Hook Rate alto → anuncio esta bom. Problema esta DEPOIS do clique.
- Se CTR baixo → problema esta NO criativo (copy, gancho ou segmentacao).

**Camada 2 — PONTE (Atribuicao UTM / Click-to-LP):**
- connect_rate_pct (cliques que viraram LP Views). Se < 60%, ha perda entre o clique e a pagina.
- click_to_lp_discrepancy_pct > 30% → possivel site lento, redirect, pixel falhando.
- utm_filters_skipped → dados de UTM nao segmentaram corretamente.

**Camada 3 — DESTINO (Comportamento no Site):**
- Load Time, Dwell Time, Scroll Depth, Bounce Rate estimado.
- Se Dwell < 8s E Scroll < 20% → usuario nao leu a oferta. Problema na headline ou lentidao.
- Se Dwell > 30s E Scroll > 60% MAS sem conversao → problema no CTA ou no preco.

CRUZAMENTO CRITICO (faça SEMPRE):
- CTR alto + Dwell baixo = Promessa do anuncio NAO esta alinhada com a pagina (Message Mismatch).
- CTR alto + Dwell alto + Sem conversao = Oferta fraca ou CTA ruim.
- CTR baixo + Dwell alto = Criativo fraco mas pagina boa. Foco em melhorar anuncio.

=== REGRA: MESSAGE MATCH (COERENCIA ANUNCIO vs PAGINA) ===

Se message_match existir no snapshot:

1. message_match.lp_headline = primeira frase proeminente da LP.
2. message_match.creatives_vs_lp = array com ad_headline e ad_promise_keywords de cada criativo.

Para CADA criativo, compare:
- O ad_headline promete o mesmo que o lp_headline entrega?
- As ad_promise_keywords aparecem no conteudo da LP (landing_page.content)?
- Se ha INCONGRUENCIA (ex.: anuncio fala de "desconto" mas LP fala de "exclusividade"),
  sinalize como 🔴 MESSAGE MISMATCH e explique o impacto no bounce rate.
- Se ha CONGRUENCIA, sinalize como 🟢 MESSAGE MATCH e elogie.

=== REGRA OBRIGATORIA: FRAMEWORK DA LANDING PAGE E CONSCIENCIA ===

Se landing_page.content existir, responda mentalmente:
A. Nivel de Consciencia (Eugene Schwartz):
   Identifique em qual dos 5 Niveis (Inconsciente, Consciente do Problema, Consciente da Solucao, Consciente do Produto, Totalmente Consciente) o funil esta focado. A oferta esta adequada a esse nivel?

B. Estrutura PAS (Dan Kennedy):
   A LP segue Problem-Agitation-Solution? A headline toca na DOR real? O corpo AGITA o problema antes de apresentar o produto como a UNICA SOLUCAO?

Se a pagina falhar nestes frameworks, suas recomendacoes na Auditoria e no Plano de Acao DEVERAO sugerir copy específica usando PAS.

Se message_match nao existir ou for null, omita esta analise.

=== REGRA: CONTEXTO DO USUARIO ===

Se user_context existir no snapshot:

1. user_context.stated_objective: O usuario informou manualmente o objetivo real da campanha.
   Use como REFERENCIA PRINCIPAL para avaliar sucesso. Se conflitar com meta.objective, priorize
   o que o usuario declarou e mencione a divergencia.

2. user_context.landing_page_url: URL da LP informada pelo usuario. Mais confiavel que auto-detect.

3. user_context.creatives: Array de criativos com copy e descricao de midia.
   OBRIGATORIO: Se user_context.creatives existir, voce DEVE analisar CADA criativo usando a estrutura HSO (Hook, Story, Offer - Russell Brunson).
   Para cada criativo:
   - HOOK: O gancho (headline ou 3s inciais do video) para o scroll e gera curiosidade imediata?
   - STORY: A copy constroi narrativa, empatia, ou prova social validando a dor?
   - OFFER: A chamada para acao (CTA) e clara, irresistivel e vende o clique (nao o produto)?
   - De notas de 1-10 para Hook, Story e Offer e justifique falhas.
   NUNCA omita esta analise quando creatives forem fornecidos.

Se user_context nao existir, ignore esta regra completamente.

=== REGRA OBRIGATORIA: 80/20 PARETO (PERRY MARSHALL) ===

Ao olhar meta_breakdown (ads, adsets), aplique mentalmente a Regra 80/20:
- Quais sao os exatos 20% de criativos/adsets que estao gerando 80% dos Resultados?
- Quais sao os 80% de anuncios ou campanhas "sanguessugas" que gastam verba com CPA inflado ou sem conversoes?
Voce DEVE destacar isso nas observacoes. Recomendacoes devem focar implacavelmente em cortar os perdedores e realocar pros 20% vencedores.

=== REGRA: TENDENCIA (TREND) ===

Se o objeto trend existir no snapshot, compare periodo atual vs anterior:
- Spend subiu/desceu X%? Resultados acompanharam?
- CPA melhorou ou piorou?
- CTR esta subindo (criativo bom) ou caindo (fadiga)?
- ROAS esta melhorando ou deteriorando?

Use setas para indicar tendencia: ↑ (melhora), ↓ (piora), → (estavel, variacao < 5%).
Se trend nao existir, omita a secao de tendencia.

=== REGRA: DISTRIBUICAO TEMPORAL ===

Se segments.hourly ou segments.day_of_week existirem com dados, analise:
- Qual horario tem mais visitas? E o melhor horario para anunciar?
- Quais dias da semana tem mais trafego? Ha oportunidade de ajustar orcamento?
- Ha concentracao excessiva em um unico horario/dia?

=== REGRA: DADOS AUSENTES ===

capi.page_views = 0:
  - Se utm_filters_skipped != null: filtros tinham macros, CAPI nao foi segmentado. Dados podem existir sem segmentacao.
  - Se utm_filters_applied tem filtros: eventos nao tem esse UTM no custom_data (gap de tracking).
  - NAO interprete como "ninguem visitou a pagina".

site.effective_dwell_ms = null ou 0 E site.effective_scroll_pct = null ou 0:
  - Evento PageEngagement nao capturado. Diga exatamente isso.
  - NAO diga "usuarios nao interagem com a pagina".

meta.purchases = 0 com objetivo CADASTRO_GRUPO ou LEAD: NORMAL. Nao mencione.

=== ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATORIO) ===

## Diagnostico Executivo

| | |
|---|---|
| Status | Excelente / Estavel / Em Risco / Critico |
| Objetivo | [meta.objective] |
| Evento otimizado | [o que meta.results representa — ex: CADASTRO_GRUPO] |
| Resultado | [meta.results] conversoes ao custo de [meta.cost_per_result] cada |
| ROAS Real | [sales.roas]x. Se null E sales.meta_roas existir: "ROAS Meta: [meta_roas]x (receita reportada pelo pixel: R$[meta_revenue])". Se ambos null: "N/A — webhook nao configurado" |
| Tendencia | [↑/↓/→] [resumo de 1 frase se trend existir, ou "Sem dados de comparacao"] |
| Veredito | [1 frase direta sobre a saude da campanha] |
| Principal Gargalo | [onde esta o problema, ou "Sem gargalo critico identificado"] |
| Oportunidade | [alavanca mais facil para melhorar resultados] |

---

## Analise do Funil

*(Funil adaptado ao objetivo: [user_context.stated_objective se existir, senao o evento otimizado])*

| Etapa | Metrica | Valor | Status | Diagnostico |
|:---|:---|:---|:---:|:---|
| Atracao | CTR | X% | ok/alerta/critico | [1 linha com numero] |
| Retencao criativo | Hook Rate | X% ou N/A (imagem) | ok/alerta/critico/sem dados | [1 linha ou "Anuncio de imagem — N/A"] |
| Conexao | Taxa LP View | X% | ok/alerta/critico | [1 linha] |
| Velocidade | Load time | [Use site.effective_load_ms]Xms ou Sem dados | ok/alerta/critico/sem dados | [1 linha] |
| Interesse | Dwell Time | [Use site.effective_dwell_ms]Xms ou Sem dados | ok/alerta/critico/sem dados | [1 linha ou "Dados nao capturados"] |
| Intencao | Scroll medio | [Use site.effective_scroll_pct]X% ou Sem dados | ok/alerta/critico/sem dados | [1 linha ou "Dados nao capturados"] |
| Conversao | CPA | R$X | ok/alerta/critico | [baseado no evento otimizado] |

**Insight:** [comentario analitico de 2 linhas sobre o padrao do funil]

---

## Vendas e ROAS

| Fonte | Compras | Receita | ROAS |
|:---|---:|---:|---:|
| Meta (Pixel/CAPI) | [meta.purchases] | R$[sales.meta_revenue] ou — | [sales.meta_roas]x ou — |
| **Banco (real)** | **[sales.purchases]** | **R$[sales.revenue]** | **[sales.roas]x** |
| Discrepancia | [diferenca] | — | — |

*[Comentario sobre discrepancia se houver, ou "Dados consistentes."]*

Se sales.roas = null E sales.meta_roas != null:
  - Escreva: "⚠️ ROAS calculado com dados do Pixel Meta (R$[meta_revenue]). Para ROAS real, configure o webhook de vendas."
Se ambos null: "Webhook de vendas nao configurado e Pixel nao reportou valor. ROAS indisponivel."
Se o evento otimizado NAO for Purchase, escreva: "Evento otimizado nao e Purchase — ROAS informativo apenas."

---

## Analise de Criativos

### Performance por Anuncio (dados Meta)

REGRA CRITICA PARA ESTA TABELA:
Para cada ad em meta_breakdown.ads, verifique o campo hook_rate_pct desse ad ESPECIFICAMENTE:
- hook_rate_pct != null E video_3s_views > 0 → mostre o valor (ex: "12.5%").
- hook_rate_pct == null OU video_3s_views == 0 → escreva "N/A (imagem)". NAO invente valor.
NUNCA mencione hook rate ruim/bom para anuncios de imagem. Isso e FACTUALMENTE ERRADO.

| Anuncio | Resultados | Custo | CPA | CTR | Hook Rate | Diagnostico |
|:---|---:|---:|---:|---:|---:|:---|
| [nome] | X | R$X | R$X | X% | X% ou N/A (imagem) | [Vencedor/Otimizar/Fadiga] — [motivo curto] |

*Nota: Hook Rate = video_3s_views/impressions. Apenas para anuncios de VIDEO.*

### Avaliacao Qualitativa dos Criativos

**OBRIGATORIO**: Se user_context.creatives existir, analise CADA um abaixo. NAO pule esta secao.

**MUITO IMPORTANTE:** A IA NÃO assiste nem transcreve os vídeos. A análise do vídeo (se houver) baseia-se unicamente nas descrições, copys e métricas (como Hook Rate). Deixe isso claro se os dados do vídeo forem rasos.

Para cada criativo em user_context.creatives:

#### 🏷️ [ad_name]

**Copy Atual**: [analise critica focada em clareza, objeções, gatilhos e adequação ao público]
**Estrutura & Hook**: [avaliacao focada no gancho inicial (os primeiros 3s), elementos visuais descritos e CTA]
**Nota de Potencial**: [X/10] — [justificativa em 1 frase curta]

> **🔥 Sugestão Pronta de Copy (Reescrita)**:
> - **Hook (Gancho)**: [Escreva 1 nova frase de impacto ou gancho visual]
> - **Corpo**: [Reescreva o texto do anuncio sendo mais persuasivo e alinhado aos dados]
> - **CTA**: [Escreva uma chamada para acao clara e urgente]

---

*(Repita para cada criativo)*

### 🏆 Veredito dos Criativos
[Qual criativo tem o melhor gancho/estrutura e qual deve ter maior alocação de verba]

---

## Tendência

| Metrica | Periodo Anterior | Periodo Atual | Variacao | Tendencia |
|:---|---:|---:|---:|:---:|
| Spend | R$X | R$X | +X% | ↑/↓/→ |
| Results | X | X | +X% | ↑/↓/→ |
| CPA | R$X | R$X | +X% | ↑/↓/→ |
| CTR | X% | X% | +X% | ↑/↓/→ |
| ROAS Real | Xx | Xx | +X% | ↑/↓/→ |

*Se trend nao existir no snapshot, omita esta secao inteiramente.*

---

## Distribuicao Temporal

Se segments.hourly ou segments.day_of_week tiverem dados:
- Melhores horarios para anunciar: [top 3 horarios]
- Melhores dias: [top dias]
- Recomendacao: [ajuste de orcamento por horario/dia se aplicavel]

*Se nao houver dados temporais, omita esta secao.*

---

## Auditoria Tecnica

| Area | Item | Status | Detalhes |
|:---|:---|:---:|:---|
| Rastreamento | Filtros UTM | OK/Alert | [utm_filters_applied] |
| Rastreamento | Macros nao resolvidas | OK/Alert | [Se resolvidas: mostrar valores resolvidos. Se ignoradas: listar quais e por que] |
| Rastreamento | Discrepancia | X% | Cliques vs LP Views |
| Rastreamento | Funil de Dados | OK/Alert | Meta: [impressions] impressoes, [clicks] cliques, [landing_page_views] LP Views | CAPI: [capi.page_views] PageViews |
| Rastreamento | Vendas Meta vs Banco | OK/Alert | Meta: X vs Banco: X |
| Comportamento | Load Time | Xms | [status] |
| Comportamento | Scroll Medio | X% | [status] |
| Comportamento | Dwell Time | Xms | [status] |

---

## Analise da Landing Page

Se landing_page.content existir:
- **URL Limitada**: [landing_page.url]
- **Diagnostico de Estrutura**: [A Landing Page esta congruente com a Copy dos Anuncios? O formulário/compra está visivel?]
- **Analise Comportamental**: [Se Dwell Time < 5s ou Scroll < 20%, o problema e a Headline ou lentidao. Explique o impacto do comportamento no design atual.]

**🔥 Otimizacao Acionavel (Variaveis para Teste A/B)**:
1. **Nova Headline Sugerida**: "[Escreva um titulo principal focado na dor do cliente]"
2. **Nova Sub-Headline**: "[Escreva uma frase de suporte focada no beneficio]"
3. **Mudanca de Estrutura**: [O que o cliente deve mudar visualmente? Ex: Subir o botao, reduzir texto, usar bullet points]

*Se landing_page.content for null, escreva: "Conteudo da LP nao disponivel para analise aprofundada. Verifique se a URL enviada esta acessivel."*

---

## Diagnostico de 3 Camadas

*(Secao OBRIGATORIA — esta e a analise mais valiosa do relatorio)*

### 🔵 Camada 1 — Origem (Meta Ads)
| Metrica | Valor | Veredicto |
|:---|:---|:---|
| CTR | X% | [Criativo atrai ou nao?] |
| Hook Rate | X% ou N/A | [Retem atencao?] |
| Frequencia | X | [Publico saturado? >3.5 = alerta] |
| CPM | R$X | [Leilao competitivo?] |

**Diagnostico da Origem**: [1-2 frases: o anuncio esta gerando demanda qualificada ou nao?]

### 🟡 Camada 2 — Ponte (Clique → Pagina)
| Metrica | Valor | Veredicto |
|:---|:---|:---|
| Taxa LP View | X% | [Quantos cliques chegam?] |
| Discrepancia Clique-LP | X% | [Perda entre clique e carregamento] |
| UTMs | [aplicados/ignorados] | [Atribuicao confiavel?] |

**Diagnostico da Ponte**: [1-2 frases: ha perda significativa entre o clique e a pagina?]

### 🟢 Camada 3 — Destino (Comportamento no Site)
| Metrica | Valor | Veredicto |
|:---|:---|:---|
| Load Time | Xms | [Site rapido ou lento?] |
| Dwell Time | Xms | [Leu a oferta?] |
| Scroll Depth | X% | [Consumiu o conteudo?] |
| Bounce Est | X% | [Rejeitou rapido?] |

**Diagnostico do Destino**: [1-2 frases: a pagina esta convertendo o trafego recebido? Segue os frameworks PAS e Schwartz?]

### 🔗 Cruzamento das 3 Camadas
[Analise cruzada obrigatoria: compare as 3 camadas para identificar EXATAMENTE onde esta o gargalo.]
[Use o padrao: "CTR [alto/baixo] + Dwell [alto/baixo] + Conversao [sim/nao] = [diagnostico preciso]"]
[Exemplo: "CTR de 2.3% (bom) + Dwell de 4s (ruim) = Promessa do anuncio nao esta alinhada com a pagina"]

---

## Message Match (Coerencia Anuncio ↔ Pagina)

Se message_match existir no snapshot:

Para cada criativo:
| Criativo | Promessa do Anuncio | Headline da LP | Veredicto |
|:---|:---|:---|:---:|
| [ad_name] | "[ad_headline resumido]" | "[lp_headline resumido]" | 🟢 Match / 🔴 Mismatch |

**Analise de Coerencia**: [Explicar se as palavras-chave da promessa do anuncio (ad_promise_keywords) aparecem no conteudo da LP. Se nao, sinalize incongruencia e sugira como alinhar.]

*Se message_match nao existir, omita esta secao.*

REGRA CRITICA PARA MESSAGE MATCH:
Quando houver Mismatch (🔴), voce DEVE OBRIGATORIAMENTE fornecer solucoes praticas:
1. **Nova Headline sugerida para o Anuncio**: Reescreva o titulo do anuncio usando palavras que existem na LP.
2. **OU Nova Headline sugerida para a LP**: Reescreva a headline da LP para refletir a promessa do anuncio.
3. **Palavras-chave em comum**: liste quais termos devem aparecer em AMBOS para gerar coerencia.
NUNCA diga apenas "as promessas nao estao alinhadas" sem dar a solucao concreta de como alinhar.

## Analise Avancada: Copy, Frameworks e 80/20

**1. Nivel de Consciencia do Funil (Eugene Schwartz)**:
[Se as URls/LP/Ads foram informados, aponte em qual dos 5 niveis de consciencia a oferta opera e se a comunicação está alinhada.]

**2. Diagnostico PAS (Problem, Agitation, Solution)**:
[A Landing Page utiliza PAS de forma visceral? Qual dor real ta faltando agitar? De exemplos práticos.]

**3. Lei de Pareto (80/20)**:
[Identifique na tabela de Anuncios ou Conjuntos exatamente quais sao os 20% que trazem 80% do ROI, e quais sao os sanguessugas consumindo orcamento (e quando economizariamos pausando eles).]

## Plano de Acao 100% Pratico

(Nao faca recomendacoes vagas. Seja direto, fornecendo o "O Que Fazer", o "Por Que", e uma "Melhoria Escrita" quando se tratar de copy).

| Prazo | Acao OBRIGATORIA (O Que Fazer / Métrica Alvo) | Como Implementar / Referência Escrita |
|:---|:---|:---|
| **Hoje (Cortar Sangramento)** | [ex: Pausar Anúncio X, que tem CPA de R$80 e 0 vendas / Meta: Cortar R$Y perdidos dia] | [ex: Desligar o anuncio no BM. A meta de CPA alvo ideal e de MAX R$35 para ser 80/20] |
| **Esta Semana (Alavanca HSO/PAS)** | [ex: Ajustar Hook do Anuncio Y / Meta: Subir o CTR de 0.8% p/ 2.5%] | [ex: Trocar de: "Venha conhecer nosso plano" Para: "Cansado de tentar X e perder Y?"] |
| **Proximo Ciclo (Estrategia)** | [mudanca estrategica] | [Acao clara de reestruturacao] |

### ✅ Checklist Final de Execução
[Resuma todas as acoes acima em uma unica checklist final com boxes. Exemplo:]
- [ ] Pausar o anuncio "X" no Gerenciador de Anuncios.
- [ ] Trocar a headline da Landing Page para "Nova Headline".
- [ ] Ajustar orcamento para focar nas terca-feiras às 19h.

---
*Diagnostico gerado por Analista IA (Frameworks: PAS, HSO, Pareto, Schwartz) — Meta Ads + CAPI + DB.*`;
  }

  private fallbackReport(snapshot: unknown): string {
    const snap = this.asRecord(snapshot);
    const m = this.asRecord(snap.meta);
    const capi = this.asRecord(snap.capi);
    const site = this.asRecord(snap.site);
    const sales = this.asRecord(snap.sales);
    const d = this.asRecord(snap.derived);
    const signals = Array.isArray(snap.signals) ? snap.signals as Record<string, unknown>[] : [];
    const mb = this.asRecord(snap.meta_breakdown);
    const campaigns = Array.isArray(mb.campaigns) ? mb.campaigns as Record<string, unknown>[] : [];
    const adsets = Array.isArray(mb.adsets) ? mb.adsets as Record<string, unknown>[] : [];
    const ads = Array.isArray(mb.ads) ? mb.ads as Record<string, unknown>[] : [];
    const segments = this.asRecord(snap.segments);

    const lines: string[] = [];

    lines.push(`# Diagnostico de Performance (Modo Basico — sem IA)`);
    lines.push('');
    lines.push(`> Relatorio gerado sem IA. Configure uma chave OpenAI nas configuracoes da conta para analise aprofundada.`);
    lines.push('');
    lines.push(`**Periodo:** ${this.fmtInt(snap.period_days)} dias | **Objetivo:** ${String(m.objective || '—')}`);
    lines.push('');

    const skipped = Array.isArray(snap.utm_filters_skipped) ? snap.utm_filters_skipped as string[] : [];
    const applied = snap.utm_filters_applied;
    if (skipped.length > 0) {
      lines.push(`> **Aviso de UTM:** Os seguintes filtros continham macros nao resolvidas e foram ignorados: ${skipped.join(', ')}. Os dados de CAPI/site cobrem todo o trafego do dominio.`);
      lines.push('');
    }
    if (applied) {
      lines.push(`> **Filtros UTM aplicados:** ${JSON.stringify(applied)}`);
      lines.push('');
    }

    lines.push(`## Metricas Principais`);
    lines.push('');
    lines.push(`| Campo | Valor | Descricao |`);
    lines.push(`|---|---:|---|`);
    lines.push(`| **Resultados (evento otimizado)** | **${this.fmtInt(m.results)}** | Metrica principal |`);
    lines.push(`| CPA | ${this.fmtMoney(m.cost_per_result)} | Custo por resultado |`);
    lines.push(`| Investimento | ${this.fmtMoney(m.spend)} | Total gasto |`);
    lines.push(`| Impressoes | ${this.fmtInt(m.impressions)} | |`);
    lines.push(`| Alcance | ${this.fmtInt(m.reach)} | Pessoas unicas |`);
    lines.push(`| Cliques (link) | ${this.fmtInt(m.unique_link_clicks)} | |`);
    lines.push(`| CTR | ${this.fmtPct(d.ctr_calc_pct)} | Cliques / Impressoes |`);
    lines.push(`| CPC | ${this.fmtMoney(d.cpc_calc)} | |`);
    lines.push(`| CPM | ${this.fmtMoney(d.cpm_calc)} | |`);
    lines.push(`| LP Views (Pixel) | ${this.fmtInt(m.landing_page_views)} | |`);
    lines.push(`| Taxa LP View | ${this.fmtPct(m.connect_rate_pct)} | Cliques -> LP Views |`);
    lines.push(`| Hook Rate | ${m.hook_rate_pct != null ? this.fmtPct(m.hook_rate_pct) : 'N/A (imagem)'} | So para video |`);
    lines.push(`| Frequencia | ${this.fmt(m.frequency_avg)} | |`);
    lines.push('');
    lines.push(`| CAPI — Page Views | ${this.fmtInt(capi.page_views)} | Server-side |`);
    lines.push(`| CAPI — Leads | ${this.fmtInt(capi.leads)} | |`);
    lines.push(`| CAPI — Compras | ${this.fmtInt(capi.purchases)} | |`);
    lines.push(`| CAPI — Velocidade | ${capi.avg_load_time_ms != null ? this.fmtMs(capi.avg_load_time_ms) : 'Sem dados'} | >3000ms = critico |`);
    lines.push(`| CAPI — Dwell Time | ${capi.avg_dwell_time_ms != null ? this.fmtMs(capi.avg_dwell_time_ms) : 'Sem dados'} | |`);
    lines.push(`| CAPI — Scroll medio | ${capi.avg_scroll_pct != null ? this.fmtPct(capi.avg_scroll_pct) : 'Sem dados'} | |`);
    lines.push('');

    const discPct = Number(d.click_to_lp_discrepancy_pct);
    const discStatus = !Number.isFinite(discPct) ? '—'
      : discPct > 40 ? `CRITICO ${discPct.toFixed(1)}%`
        : discPct > 25 ? `Alerta ${discPct.toFixed(1)}%`
          : `OK ${discPct.toFixed(1)}%`;
    lines.push(`| Discrepancia Cliques->Visitas | ${discStatus} | >25% = investigar |`);
    lines.push('');
    lines.push(`| **Banco — Compras** | **${this.fmtInt(sales.purchases)}** | Verdade absoluta |`);
    lines.push(`| Banco — Receita | ${this.fmtMoney(sales.revenue)} | |`);
    lines.push(`| ROAS real | ${d.roas != null ? this.fmt(d.roas) + 'x' : 'N/A'} | |`);
    lines.push('');

    if (campaigns.length || adsets.length || ads.length) {
      lines.push(`## Breakdown por Nivel`);
      lines.push('');
      lines.push(`| Nivel | Nome | Results | Spend | CTR | LP Views | Taxa LP | Hook Rate | CPA |`);
      lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|`);
      const renderRows = (level: string, rows: Record<string, unknown>[]) => {
        for (const row of rows.slice(0, BREAKDOWN_MAX_ROWS)) {
          const hookRate = row.hook_rate_pct != null ? this.fmtPct(row.hook_rate_pct) : 'N/A';
          lines.push(`| ${level} | ${String(row.name || '—')} | ${this.fmtInt(row.results)} | ${this.fmtMoney(row.spend)} | ${this.fmtPct(row.ctr_calc_pct)} | ${this.fmtInt(row.landing_page_views)} | ${this.fmtPct(row.connect_rate_pct)} | ${hookRate} | ${this.fmtMoney(row.cost_per_result)} |`);
        }
      };
      renderRows('Campanha', campaigns);
      renderRows('Conjunto', adsets);
      renderRows('Anuncio', ads);
      lines.push('');
    }

    const hourly = this.asRecord(segments.hourly);
    const dow = this.asRecord(segments.day_of_week);
    const dowNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    if (Object.keys(hourly).length > 0 || Object.keys(dow).length > 0) {
      lines.push(`## Distribuicao Temporal`);
      lines.push('');
      if (Object.keys(hourly).length > 0) {
        lines.push('**Por hora:**');
        lines.push('');
        lines.push('| Hora | Visitas |');
        lines.push('|---|---:|');
        for (const [h, v] of Object.entries(hourly)) lines.push(`| ${h}h | ${this.fmtInt(v)} |`);
        lines.push('');
      }
      if (Object.keys(dow).length > 0) {
        lines.push('**Por dia:**');
        lines.push('');
        lines.push('| Dia | Visitas |');
        lines.push('|---|---:|');
        for (const [dd, v] of Object.entries(dow)) lines.push(`| ${dowNames[Number(dd)] || dd} | ${this.fmtInt(v)} |`);
        lines.push('');
      }
    }

    lines.push(`## Auditoria Tecnica`);
    lines.push('');
    lines.push(`| Area | Item | Status | Detalhes |`);
    lines.push(`|:---|:---|:---:|:---|`);

    // Rastreamento
    lines.push(`| Rastreamento | Filtros UTM | ${applied ? 'OK' : 'N/A'} | ${JSON.stringify(applied || 'Nenhum')} |`);
    lines.push(`| Rastreamento | Macros nao resolvidas | ${skipped.length ? 'ALERTA' : 'OK'} | ${skipped.length ? skipped.join(', ') : 'Nenhuma'} |`);
    lines.push(`| Rastreamento | Discrepancia | ${discStatus.split(' ')[0]} | Cliques vs LP Views: ${discPct.toFixed(1)}% |`);
    lines.push(`| Rastreamento | Funil de Dados | — | Meta: ${this.fmtInt(m.unique_link_clicks)} | Pixel: ${this.fmtInt(m.landing_page_views)} | CAPI: ${this.fmtInt(capi.page_views)} |`);

    // Comportamento
    const loadMs = site.effective_load_ms != null ? Number(site.effective_load_ms) : null;
    const loadTime = loadMs != null ? this.fmtMs(loadMs) : 'N/A';
    const loadStatus = loadMs && loadMs > 3500 ? 'CRITICO' : 'OK';
    lines.push(`| Comportamento | Load Time | ${loadStatus} | ${loadTime} |`);

    const scroll = site.effective_scroll_pct != null ? this.fmtPct(site.effective_scroll_pct) : 'N/A';
    lines.push(`| Comportamento | Scroll Medio | — | ${scroll} |`);

    const dwell = site.effective_dwell_ms != null ? this.fmtMs(site.effective_dwell_ms) : 'N/A';
    lines.push(`| Comportamento | Dwell Time | — | ${dwell} |`);
    lines.push('');
    lines.push('---');
    lines.push('*Relatorio basico sem IA. Configure OpenAI nas configuracoes da conta para analise completa.*');

    return lines.join('\n');
  }
}

export const llmService = new LlmService();