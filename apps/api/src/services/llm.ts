import axios, { AxiosError } from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmConfig {
  apiKey: string;
  model: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRY_ATTEMPTS = 2;
const MAX_SNAPSHOT_CHARS = 60_000;
const BREAKDOWN_MAX_ROWS = 10;

// ─── Service ──────────────────────────────────────────────────────────────────

export class LlmService {

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  /**
   * Truncates snapshot to stay within token limits.
   * Priority: keep meta + capi + derived + signals. Trim LP content + segments last.
   */
  private sanitizeSnapshot(snapshot: unknown): string {
    const snap = structuredClone(snapshot) as Record<string, unknown>;

    // Truncate landing page content
    const lp = this.asRecord(snap.landing_page);
    if (typeof lp.content === 'string' && lp.content.length > 3000) {
      lp.content = lp.content.slice(0, 3000) + '\n[...conteúdo truncado...]';
      snap.landing_page = lp;
    }

    // Limit breakdown rows
    const mb = this.asRecord(snap.meta_breakdown);
    for (const key of ['campaigns', 'adsets', 'ads']) {
      const arr = Array.isArray(mb[key]) ? (mb[key] as unknown[]) : [];
      if (arr.length > BREAKDOWN_MAX_ROWS) mb[key] = arr.slice(0, BREAKDOWN_MAX_ROWS);
    }
    snap.meta_breakdown = mb;

    const json = JSON.stringify(snap, null, 2);
    if (json.length <= MAX_SNAPSHOT_CHARS) return json;

    // Emergency: remove segments
    const snapReduced = { ...snap };
    delete snapReduced.segments;
    const signals = Array.isArray(snapReduced.signals) ? snapReduced.signals : [];
    snapReduced.signals = signals.slice(0, 5);

    return JSON.stringify(snapReduced, null, 2).slice(0, MAX_SNAPSHOT_CHARS)
      + '\n...snapshot truncado por limite de tokens...';
  }

  // ── DB Config ──────────────────────────────────────────────────────────────

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

  // ── OpenAI call with retry ─────────────────────────────────────────────────

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
      if (!content || typeof content !== 'string') throw new Error('Resposta inválida da OpenAI — content vazio.');
      this.log('info', `OpenAI OK (${content.length} chars)`);
      return content;
    } catch (error) {
      const isRetryable = axios.isAxiosError(error) &&
        ((error as AxiosError).response?.status === 429 ||
         ((error as AxiosError).response?.status ?? 0) >= 500);

      if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
        const delay = attempt * 2000;
        this.log('warn', `Retrying in ${delay}ms (attempt ${attempt})...`);
        await new Promise(res => setTimeout(res, delay));
        return this.callOpenAI(apiKey, model, systemPrompt, userContent, attempt + 1);
      }

      if (axios.isAxiosError(error)) {
        this.log('error', 'OpenAI Axios error', {
          status: (error as AxiosError).response?.status,
          data: (error as AxiosError).response?.data,
        });
      } else if (error instanceof Error) {
        this.log('error', 'OpenAI error', error.message);
      }
      throw error;
    }
  }

  // ── Public entry point ─────────────────────────────────────────────────────

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
    const userContent = `Dados estruturados do período (JSON):\n\n${snapshotJson}`;

    try {
      return await this.callOpenAI(apiKey, model, systemPrompt, userContent);
    } catch {
      this.log('warn', 'All OpenAI attempts failed — returning fallback report');
      return this.fallbackReport(snapshot);
    }
  }

  // ── System Prompt ──────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `\
🤖 AGENTE ANALISTA DE PERFORMANCE — TRAJETTU (META ADS + CAPI + CRO)
══════════════════════════════════════════════════════════════════════

PAPEL
Você é um Analista de Tráfego Sênior especializado em Meta Ads, rastreamento de eventos server-side (CAPI) e CRO. Você raciocina como um gestor de tráfego experiente, citando números exatos e dando diagnósticos concretos — nunca afirmações vagas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MAPA COMPLETO DOS CAMPOS DO JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HIERARQUIA DE CONFIABILIDADE (da mais para menos confiável):
  1. \`sales.*\`  → banco de dados interno (webhooks) — VERDADE ABSOLUTA para receita/conversões
  2. \`capi.*\`   → eventos server-side — VERDADE para comportamento no site (não afetado por iOS/adblock)
  3. \`meta.*\`   → Pixel Meta / API — estimado, pode ter subcontagem

─── BLOCO: meta ──────────────────────────────────────────────────────────────
\`meta.objective\`
  → Objetivo da campanha (ex: CADASTRO_GRUPO, OUTCOME_LEADS, OUTCOME_SALES, LINK_CLICKS).
  → DEFINE como medir o sucesso. Leia ANTES de qualquer análise.

\`meta.results\`
  → ⭐ MÉTRICA PRINCIPAL. Quantidade de resultados conforme o objetivo.
  → "Objetivo (9)" na UI = meta.results = 9 cadastros/leads/vendas.
  → Se results > 0, a campanha ESTÁ convertendo. Nunca diga que não converte se este campo > 0.

\`meta.cost_per_result\`
  → CPA: custo médio por resultado. Calcule: meta.spend ÷ meta.results.

\`meta.landing_page_views\`
  → "LP Views" na UI. Pessoas que clicaram no anúncio E cuja página carregou (medido pelo Pixel).
  → Diferente de \`capi.page_views\` (que é server-side e mais preciso).

\`meta.connect_rate_pct\`
  → "Taxa LP View" na UI. Fórmula: landing_page_views ÷ link_clicks × 100.
  → Mede quantos cliques efetivamente chegaram à página. < 60% = problema.

\`meta.hook_rate_pct\`
  → "Hook Rate" na UI. Fórmula: video_3s_views ÷ impressions × 100.
  → Mede se os primeiros segundos do vídeo prendem atenção. null = sem dados de vídeo.
  → < 15% = hook fraco (primeiros 3 segundos do criativo precisam de revisão).

\`meta.initiates_checkout\`
  → "Finalização" na UI. Evento InitiateCheckout do Pixel.
  → Para objetivo de vendas: se este é 0 mas há cliques, o checkout pode estar com problema.

\`meta.purchases\`
  → Compras rastreadas pelo Pixel. Pode divergir de \`sales.purchases\` (banco interno).
  → Discrepância alta = problema de deduplicação ou Pixel mal configurado.

─── BLOCO: capi ──────────────────────────────────────────────────────────────
\`capi.page_views\`
  → Page views confirmados server-side. Mais preciso que \`meta.landing_page_views\`.
  → Use como referência principal ao calcular taxa de conversão real.

\`capi.avg_load_time_ms\`
  → Tempo de carregamento da página (servidor). > 3000ms = crítico. > 5000ms = emergência.

\`capi.avg_dwell_time_ms\`
  → Tempo médio que os usuários ficam na página (server-side). < 8000ms = abandono rápido.

\`capi.avg_scroll_pct\`
  → Scroll médio da página. < 30% = a maioria não chegou na oferta.

\`capi.deep_scroll_count\`
  → Quantidade de usuários que rolaram > 50% da página (engajamento real com o conteúdo).

\`capi.leads\` / \`capi.purchases\`
  → Eventos de conversão confirmados server-side. Mais confiáveis que \`meta.leads\`/\`meta.purchases\`.

─── BLOCO: site ──────────────────────────────────────────────────────────────
\`site.effective_dwell_ms\`
  → Melhor valor disponível de dwell time (CAPI se disponível, fallback para PageEngagement).

\`site.effective_scroll_pct\`
  → Melhor valor disponível de scroll (mesma lógica).

\`site.clicks_cta\`
  → Cliques em botões de ação (CTA) rastreados na página.

\`site.bounces_est\`
  → Estimativa de bounces: visitas com < 5s de permanência + < 10% scroll + 0 cliques.

─── BLOCO: sales ─────────────────────────────────────────────────────────────
\`sales.purchases\`
  → Compras confirmadas no banco de dados via webhook. VERDADE ABSOLUTA para conversões de venda.

\`sales.revenue\`
  → Receita confirmada no banco de dados.

\`sales.roas\`
  → ROAS real: sales.revenue ÷ meta.spend. Use este, não o ROAS do Meta.

─── BLOCO: derived ───────────────────────────────────────────────────────────
\`derived.ctr_calc_pct\`       → CTR calculado: clicks ÷ impressions × 100
\`derived.cpc_calc\`           → CPC calculado: spend ÷ clicks
\`derived.cpm_calc\`           → CPM calculado: spend ÷ impressions × 1000
\`derived.connect_rate_pct\`   → Taxa LP View (mesmo que meta.connect_rate_pct)
\`derived.hook_rate_pct\`      → Hook Rate (mesmo que meta.hook_rate_pct)
\`derived.click_to_lp_discrepancy_pct\`
  → % de cliques que NÃO geraram page view (quebra no topo do funil).
  → > 25% = sinal de alerta. > 40% = crítico (tracking quebrado ou site inacessível).
\`derived.lp_to_result_rate_pct\`
  → Taxa de conversão da landing page: results ÷ landing_page_views × 100
\`derived.roas\`               → ROAS real (mesmo que sales.roas)

─── BLOCO: meta_breakdown ────────────────────────────────────────────────────
Contém arrays \`campaigns\`, \`adsets\`, \`ads\` — cada item tem:
  - \`name\`, \`results\`, \`spend\`, \`ctr_calc_pct\`, \`connect_rate_pct\`, \`hook_rate_pct\`,
    \`cost_per_result\`, \`landing_page_views\`, \`leads\`, \`purchases\`
Use para comparar performance entre anúncios e identificar vencedores/ofensores.

─── BLOCO: signals ───────────────────────────────────────────────────────────
Anomalias detectadas automaticamente. Cada sinal tem \`area\`, \`signal\`, \`weight\` (0-1), \`evidence\`.
Weight > 0.7 = problema confirmado. Weight 0.5-0.7 = suspeita. Use como guia, não como verdade absoluta.

─── BLOCO: segments ──────────────────────────────────────────────────────────
\`segments.hourly\`      → page views por hora (0-23)
\`segments.day_of_week\` → page views por dia (0=Domingo, 6=Sábado)
Use para sugerir dayparting se houver concentração clara de performance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE ANÁLISE (OBRIGATÓRIAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGRA 1 — OBJETIVO É REI
Leia \`meta.objective\` antes de qualquer coisa. O sucesso da campanha é medido por \`meta.results\`.
- CADASTRO_GRUPO / LEAD_GENERATION / OUTCOME_LEADS → sucesso = results (leads/cadastros) e CPA
- OUTCOME_SALES / CONVERSIONS → sucesso = sales.purchases e sales.roas
- LINK_CLICKS / TRAFFIC → sucesso = landing_page_views e connect_rate_pct
NUNCA aponte como problema uma métrica fora do escopo do objetivo.
Se meta.results > 0 → a campanha ESTÁ convertendo. Não diga que "não converte".

REGRA 2 — FUNIL COMPLETO
Analise sempre nesta ordem:
  Entrega (CPM/Reach) → Clique (CTR/CPC) → Landing (Connect Rate/Velocidade)
  → Engajamento (Dwell/Scroll) → CTA (clicks_cta) → Conversão (results/purchases)
O gargalo é onde a taxa cai de forma anormal. Identifique o estágio EXATO.

REGRA 3 — DISCREPÂNCIA CLIQUES vs VISITAS
Compare \`meta.clicks\` (ou \`meta.unique_link_clicks\`) com \`capi.page_views\`.
- \`derived.click_to_lp_discrepancy_pct\` > 25% → sinal de alerta
- > 40% → crítico: tracking quebrado, site inacessível ou cliques acidentais
Se \`capi.page_views\` = 0 mas há cliques → Pixel provavelmente não instalado na landing page.

REGRA 4 — ZERO NÃO É SEMPRE FALHA
Um campo zerado pode ser:
(a) "Não aconteceu" → normal se o objetivo não inclui essa métrica
(b) "Erro de tracking" → problema se o objetivo deveria gerar esse evento
SEMPRE verifique \`meta.objective\` antes de interpretar um zero.

REGRA 5 — USE OS NÚMEROS, NUNCA SEJA VAGO
❌ PROIBIDO: "Talvez a landing page não esteja convertendo bem."
✅ OBRIGATÓRIO: "A landing page recebeu ${this.PLACEHOLDER_example('capi.page_views')} visitas confirmadas e gerou ${this.PLACEHOLDER_example('meta.results')} resultados (taxa ${this.PLACEHOLDER_example('derived.lp_to_result_rate_pct')}%). O scroll médio de ${this.PLACEHOLDER_example('capi.avg_scroll_pct')}% indica que a maioria saiu antes de ler a oferta."
Sempre cite valores exatos ao fazer uma afirmação.

REGRA 6 — USE O META_BREAKDOWN
Compare CTR, CPA e connect_rate entre anúncios e conjuntos.
Se Anúncio A tem CTR 3% e Anúncio B tem CTR 1%: "Anúncio A atrai 3x mais cliques que o B".
Identifique qual anúncio gerou mais resultados e qual está consumindo verba sem retorno.

REGRA 7 — HOOK RATE (APENAS PARA VÍDEO)
Se \`meta.hook_rate_pct\` é null → sem dados de vídeo, não mencione hook rate.
Se disponível: < 15% = primeiros 3 segundos do vídeo são fracos → sugira reformular o início.

REGRA 8 — DADOS AUSENTES
Se um campo é null ou 0 de forma suspeita, declare: "Dado indisponível — análise parcial neste ponto."
Nunca invente valores. Nunca use benchmarks de mercado sem citar a fonte.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA DE SAÍDA OBRIGATÓRIA (MARKDOWN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 1. DIAGNÓSTICO GERAL
- **Status:** [Excelente / Razoável / Crítico]
- **Objetivo da campanha:** [objective] → mede-se por [métrica principal]
- **Resumo:** (2–3 linhas com os números mais relevantes do período)
- **Ação Recomendada:** [Escalar / Manter / Otimizar / Pausar + justificativa objetiva]

---

## 📋 2. TABELA DE MÉTRICAS (META × CAPI × BANCO)
| Métrica | Meta (Pixel) | CAPI (Servidor) | Banco Interno | Discrepância |
|---|---|---|---|---|
| Investimento | meta.spend | — | — | — |
| Resultados principais | meta.results | capi.leads ou capi.purchases | sales.purchases | (dif) |
| Cliques / Visitas | meta.unique_link_clicks | capi.page_views | — | derived.click_to_lp_discrepancy_pct |
| CPA | meta.cost_per_result | — | — | — |
| ROAS | — | — | sales.roas | — |
(Preencher com os valores reais do JSON)

---

## 🔍 3. ANÁLISE DO FUNIL
- **Entrega** (CPM R$X, Alcance Y pessoas): [diagnóstico]
- **Clique** (CTR X%, CPC R$Y): [diagnóstico]
- **Landing** (Connect Rate X%, Velocidade Yms): [diagnóstico]
- **Engajamento** (Dwell Xms, Scroll Y%, CTA Z cliques): [diagnóstico]
- **Conversão** (Results X, Taxa Y%): [diagnóstico]

→ 🎯 **Gargalo identificado:** [etapa exata + evidência numérica]

---

## 🧩 4. AVALIAÇÃO DOS CONJUNTOS DE ANÚNCIOS
Para cada conjunto relevante:
- **[Nome]:** [Veredito] — [dados: spend, results, CPA, connect_rate, frequência]

---

## 🎯 5. AVALIAÇÃO DOS ANÚNCIOS
- **🏆 Vencedores:** [nome, CTR, CPA, results — por que funciona]
- **🚨 Ofensores:** [nome, onde gasta sem retorno, qual métrica comprova]

---

## 🖥️ 6. DIAGNÓSTICO DA LANDING PAGE
- **Velocidade:** [Xms — ok / alerta / crítico]
- **Retenção:** [dwell Xms + scroll Y% — interpretação]
- **Alinhamento criativo × promessa:** [análise do conteúdo da LP vs. mensagem dos anúncios]
- **Sugestão específica:** [ação implementável]

---

## 📅 7. SEGMENTOS TEMPORAIS
(Só se segments mostrar padrão relevante com diferença > 30% entre períodos)
- Melhor período: [hora/dia + dado]
- Pior período: [hora/dia + dado]
- Recomendação: [dayparting ou concentração de orçamento]

---

## ⚠️ 8. HIPÓTESES ALTERNATIVAS
(2–3 hipóteses além do gargalo principal, baseadas nos dados)

---

## ✅ 9. PLANO DE AÇÃO
1. **[Hoje]** — [ação imediata e específica]
2. **[Esta semana]** — [ação de curto prazo]
3. **[Próximo ciclo]** — [ação estratégica]
`;
  }

  // Placeholder helper (just for documentation in the prompt — replaced by real values at runtime)
  private PLACEHOLDER_example(field: string): string {
    return `{${field}}`;
  }

  // ── Fallback Report ────────────────────────────────────────────────────────

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

    lines.push(`# 📊 Diagnóstico de Performance (Modo Básico — sem IA)`);
    lines.push('');
    lines.push(`> ⚠️ Relatório gerado sem IA. Configure uma chave OpenAI nas configurações da conta para análise aprofundada.`);
    lines.push('');
    lines.push(`**Período:** ${this.fmtInt(snap.period_days)} dias | **Objetivo:** ${String(m.objective || '—')}`);
    lines.push('');

    // ── Metrics ───────────────────────────────────────────────────────────────
    lines.push(`## 📋 Métricas Principais`);
    lines.push('');
    lines.push(`| Campo | Valor | Descrição |`);
    lines.push(`|---|---:|---|`);

    // Meta
    lines.push(`| **Meta — Resultados** | **${this.fmtInt(m.results)}** | ⭐ Métrica principal (objetivo: ${String(m.objective || '—')}) |`);
    lines.push(`| Meta — CPA | ${this.fmtMoney(m.cost_per_result)} | Custo por resultado |`);
    lines.push(`| Meta — Investimento | ${this.fmtMoney(m.spend)} | Total gasto no período |`);
    lines.push(`| Meta — Impressões | ${this.fmtInt(m.impressions)} | Alcance de anúncios |`);
    lines.push(`| Meta — Alcance | ${this.fmtInt(m.reach)} | Pessoas únicas alcançadas |`);
    lines.push(`| Meta — Cliques (link) | ${this.fmtInt(m.unique_link_clicks)} | Cliques únicos no link |`);
    lines.push(`| Meta — CTR | ${this.fmtPct(d.ctr_calc_pct)} | Cliques ÷ Impressões |`);
    lines.push(`| Meta — CPC | ${this.fmtMoney(d.cpc_calc)} | Custo por clique |`);
    lines.push(`| Meta — CPM | ${this.fmtMoney(d.cpm_calc)} | Custo por mil impressões |`);
    lines.push(`| Meta — LP Views | ${this.fmtInt(m.landing_page_views)} | Pessoas que chegaram à landing (Pixel) |`);
    lines.push(`| Meta — Taxa LP View | ${this.fmtPct(m.connect_rate_pct)} | Cliques → LP Views |`);
    lines.push(`| Meta — Hook Rate | ${m.hook_rate_pct != null ? this.fmtPct(m.hook_rate_pct) : '—'} | Retenção vídeo 3s ÷ Impressões |`);
    lines.push(`| Meta — Frequência | ${this.fmt(m.frequency_avg)} | Média de vezes que viu o anúncio |`);
    lines.push(`| Meta — Leads (Pixel) | ${this.fmtInt(m.leads)} | Leads rastreados pelo Pixel |`);
    lines.push(`| Meta — Finalização | ${this.fmtInt(m.initiates_checkout)} | InitiateCheckout (Pixel) |`);
    lines.push(`| Meta — Compras (Pixel) | ${this.fmtInt(m.purchases)} | Compras rastreadas pelo Pixel |`);
    lines.push('');

    // CAPI
    lines.push(`| **CAPI — Page Views** | **${this.fmtInt(capi.page_views)}** | Visitas reais server-side |`);
    lines.push(`| CAPI — Leads | ${this.fmtInt(capi.leads)} | Leads server-side (mais preciso) |`);
    lines.push(`| CAPI — Compras | ${this.fmtInt(capi.purchases)} | Compras server-side |`);
    lines.push(`| CAPI — Velocidade | ${this.fmtMs(capi.avg_load_time_ms)} | > 3000ms = crítico |`);
    lines.push(`| CAPI — Dwell Time | ${this.fmtMs(capi.avg_dwell_time_ms)} | Tempo real na página |`);
    lines.push(`| CAPI — Scroll médio | ${capi.avg_scroll_pct != null ? this.fmtPct(capi.avg_scroll_pct) : '—'} | Profundidade de rolagem |`);
    lines.push(`| CAPI — Deep scroll (>50%) | ${this.fmtInt(capi.deep_scroll_count)} | Usuários que leram o conteúdo |`);
    lines.push('');

    // Discrepancy
    const discPct = Number(d.click_to_lp_discrepancy_pct);
    const discStatus = !Number.isFinite(discPct) ? '—'
      : discPct > 40 ? `⚠️ ${discPct.toFixed(1)}% (CRÍTICO)`
      : discPct > 25 ? `⚠️ ${discPct.toFixed(1)}% (Alerta)`
      : `✅ ${discPct.toFixed(1)}% (OK)`;
    lines.push(`| **Discrepância Cliques→Visitas** | ${discStatus} | > 25% = tracking ou velocidade |`);
    lines.push('');

    // Sales (source of truth)
    lines.push(`| **Banco — Compras** | **${this.fmtInt(sales.purchases)}** | ✅ Verdade absoluta para conversões |`);
    lines.push(`| Banco — Receita | ${this.fmtMoney(sales.revenue)} | Receita confirmada |`);
    lines.push(`| Banco — ROAS | ${d.roas != null ? this.fmt(d.roas) + 'x' : '—'} | Receita real ÷ Investimento |`);
    lines.push('');

    // ── Breakdown ─────────────────────────────────────────────────────────────
    if (campaigns.length || adsets.length || ads.length) {
      lines.push(`## 🧩 Breakdown por Nível`);
      lines.push('');
      lines.push(`| Nível | Nome | Resultados | Spend | CTR | LP Views | Taxa LP | Hook Rate | CPA |`);
      lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|`);

      const renderRows = (level: string, rows: Record<string, unknown>[]) => {
        for (const row of rows.slice(0, BREAKDOWN_MAX_ROWS)) {
          const hookRate = row.hook_rate_pct != null ? this.fmtPct(row.hook_rate_pct) : '—';
          lines.push(
            `| ${level} | ${String(row.name || '—')} | ${this.fmtInt(row.results)} | ${this.fmtMoney(row.spend)} | ${this.fmtPct(row.ctr_calc_pct)} | ${this.fmtInt(row.landing_page_views)} | ${this.fmtPct(row.connect_rate_pct)} | ${hookRate} | ${this.fmtMoney(row.cost_per_result)} |`
          );
        }
      };

      renderRows('Campanha', campaigns);
      renderRows('Conjunto', adsets);
      renderRows('Anúncio', ads);
      lines.push('');
    }

    // ── Segments ──────────────────────────────────────────────────────────────
    const hourly = this.asRecord(segments.hourly);
    const dow = this.asRecord(segments.day_of_week);
    const dowNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    if (Object.keys(hourly).length > 0 || Object.keys(dow).length > 0) {
      lines.push(`## 📅 Distribuição Temporal`);
      lines.push('');
      if (Object.keys(hourly).length > 0) {
        lines.push('**Visitas por hora do dia:**');
        lines.push('');
        lines.push('| Hora | Visitas |');
        lines.push('|---|---:|');
        for (const [h, v] of Object.entries(hourly)) {
          lines.push(`| ${h}h | ${this.fmtInt(v)} |`);
        }
        lines.push('');
      }
      if (Object.keys(dow).length > 0) {
        lines.push('**Visitas por dia da semana:**');
        lines.push('');
        lines.push('| Dia | Visitas |');
        lines.push('|---|---:|');
        for (const [d, v] of Object.entries(dow)) {
          const dayName = dowNames[Number(d)] || d;
          lines.push(`| ${dayName} | ${this.fmtInt(v)} |`);
        }
        lines.push('');
      }
    }

    // ── Signals ───────────────────────────────────────────────────────────────
    lines.push(`## ⚠️ Sinais Detectados`);
    lines.push('');
    if (!signals.length) {
      lines.push(`- Sem sinais. Volume de dados insuficiente ou integração de Pixel/CAPI pendente.`);
    } else {
      for (const sig of signals.slice(0, 8)) {
        const weight = Number(sig.weight || 0);
        const icon = weight >= 0.75 ? '🔴' : weight >= 0.60 ? '🟡' : '🟢';
        lines.push(`- ${icon} **[${String(sig.area)}]** ${String(sig.signal)} *(peso: ${weight.toFixed(2)})*`);
        lines.push(`  - ${String(sig.evidence)}`);
      }
    }
    lines.push('');

    // ── Actions ───────────────────────────────────────────────────────────────
    lines.push(`## ✅ Próximas Ações (diagnóstico manual)`);
    lines.push('');
    lines.push(`1. **Validar objetivo** — Confirme que \`meta.objective\` = "${String(m.objective || '?')}" e que \`meta.results\` representa o evento certo.`);
    lines.push(`2. **Verificar discrepância** — Cliques: ${this.fmtInt(m.unique_link_clicks)} × LP Views: ${this.fmtInt(m.landing_page_views)} × CAPI page_views: ${this.fmtInt(capi.page_views)}. Diferença > 25% exige investigação.`);
    lines.push(`3. **Checar velocidade** — CAPI avg_load_time_ms: ${this.fmtMs(capi.avg_load_time_ms)}. Acima de 3000ms = ação imediata.`);
    lines.push(`4. **Analisar engajamento** — Dwell: ${this.fmtMs(capi.avg_dwell_time_ms)}, Scroll: ${capi.avg_scroll_pct != null ? this.fmtPct(capi.avg_scroll_pct) : '—'}. Abaixo de 15s/50% = landing page não está convertendo.`);
    lines.push(`5. **Ativar IA** — Configure uma chave OpenAI para diagnóstico automático com hipóteses e plano de ação.`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`*Relatório básico gerado automaticamente sem IA. Para análise completa, configure OpenAI nas configurações da conta.*`);

    return lines.join('\n');
  }
}

export const llmService = new LlmService();