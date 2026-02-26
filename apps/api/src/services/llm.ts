import axios, { AxiosError } from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmConfig {
  apiKey: string;
  model: string;
}

interface Signal {
  area?: unknown;
  signal?: unknown;
  weight?: unknown;
  evidence?: unknown;
}

interface SnapshotSite {
  pageviews?: unknown;
  avg_load_time_ms?: unknown;
  avg_dwell_time_ms?: unknown;
  avg_max_scroll_pct?: unknown;
  clicks_cta?: unknown;
  bounces_est?: unknown;
  capi?: {
    page_views?: unknown;
    leads?: unknown;
    avg_load_time_ms?: unknown;
    deep_scroll_count?: unknown;
    avg_dwell_time_ms?: unknown;
  };
}

interface SnapshotMeta {
  objective?: unknown;
  results?: unknown;
  cost_per_result?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  landing_page_views?: unknown;
  leads?: unknown;
  contacts?: unknown;
  initiates_checkout?: unknown;
  purchases?: unknown;
}

interface SnapshotSales {
  purchases?: unknown;
  revenue?: unknown;
}

interface SnapshotDerived {
  ctr_calc_pct?: unknown;
  cpc_calc?: unknown;
  cpm_calc?: unknown;
  connect_rate_pct?: unknown;
  lp_to_purchase_rate_pct?: unknown;
  pv_to_purchase_rate_pct?: unknown;
}

interface BreakdownRow {
  name?: unknown;
  objective?: unknown;
  results?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  landing_page_views?: unknown;
  leads?: unknown;
  purchases?: unknown;
  cost_per_result?: unknown;
}

interface Snapshot {
  period_days?: unknown;
  meta?: SnapshotMeta;
  site?: SnapshotSite;
  sales?: SnapshotSales;
  derived?: SnapshotDerived;
  signals?: Signal[];
  meta_breakdown?: {
    campaigns?: BreakdownRow[];
    adsets?: BreakdownRow[];
    ads?: BreakdownRow[];
  };
  segments?: {
    hourly?: Record<string, unknown>;
    day_of_week?: Record<string, unknown>;
  };
  landing_page?: {
    url?: string;
    content?: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.2; // Lower = more deterministic/analytical
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRY_ATTEMPTS = 2;
const MAX_SNAPSHOT_CHARS = 60_000; // ~15k tokens — prevents context overflow
const BREAKDOWN_MAX_ROWS = 10;

// ─── Service ──────────────────────────────────────────────────────────────────

export class LlmService {

  // ── Helpers ────────────────────────────────────────────────────────────────

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private formatNumber(n: unknown, digits = 2): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  private formatInt(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return Math.trunc(v).toLocaleString('pt-BR');
  }

  private formatMoney(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `R$ ${v.toFixed(2)}`;
  }

  private formatMs(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `${Math.trunc(v)}ms`;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
    const prefix = `[LlmService][${level.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, msg, extra ?? '');
    } else if (level === 'warn') {
      console.warn(prefix, msg, extra ?? '');
    } else {
      console.log(prefix, msg, extra ?? '');
    }
  }

  /**
   * Truncates the snapshot JSON so it never exceeds MAX_SNAPSHOT_CHARS.
   * Strips landing_page content first (largest, least critical for metrics).
   */
  private sanitizeSnapshot(snapshot: unknown): string {
    const snap = structuredClone(snapshot) as Record<string, unknown>;

    // Truncate landing_page content to avoid token explosion
    const lp = this.asRecord(snap.landing_page);
    if (typeof lp.content === 'string' && lp.content.length > 3000) {
      lp.content = lp.content.slice(0, 3000) + '\n[...conteúdo truncado...]';
      snap.landing_page = lp;
    }

    // Limit breakdown arrays
    const mb = this.asRecord(snap.meta_breakdown);
    for (const key of ['campaigns', 'adsets', 'ads'] as const) {
      const arr = Array.isArray(mb[key]) ? (mb[key] as unknown[]) : [];
      if (arr.length > BREAKDOWN_MAX_ROWS) {
        mb[key] = arr.slice(0, BREAKDOWN_MAX_ROWS);
      }
    }
    snap.meta_breakdown = mb;

    const json = JSON.stringify(snap, null, 2);
    if (json.length <= MAX_SNAPSHOT_CHARS) return json;

    // Last resort: truncate signals and segments
    const snapReduced = { ...snap };
    delete snapReduced.segments;
    const signals = Array.isArray(snapReduced.signals) ? snapReduced.signals : [];
    snapReduced.signals = signals.slice(0, 5);

    return JSON.stringify(snapReduced, null, 2).slice(0, MAX_SNAPSHOT_CHARS)
      + '\n...snapshot truncado por limite de tokens...';
  }

  // ── DB / Config ────────────────────────────────────────────────────────────

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

  // ── Core: OpenAI call with retry ───────────────────────────────────────────

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
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: REQUEST_TIMEOUT_MS,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Resposta inválida da OpenAI API — content vazio.');
      }

      this.log('info', `OpenAI response received (${content.length} chars)`);
      return content;

    } catch (error) {
      const isRetryable = this.isRetryableError(error);

      if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
        const delay = attempt * 2000;
        this.log('warn', `Retrying in ${delay}ms (attempt ${attempt})...`);
        await new Promise(res => setTimeout(res, delay));
        return this.callOpenAI(apiKey, model, systemPrompt, userContent, attempt + 1);
      }

      // Log structured error
      if (axios.isAxiosError(error)) {
        const axErr = error as AxiosError;
        this.log('error', 'OpenAI Axios error', {
          status: axErr.response?.status,
          data: axErr.response?.data,
          message: axErr.message,
        });
      } else if (error instanceof Error) {
        this.log('error', 'OpenAI error', error.message);
      }

      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    const status = (error as AxiosError).response?.status;
    // Retry on rate limit (429) or server errors (5xx), not on auth (401/403) or bad request (400)
    return status === 429 || (status !== undefined && status >= 500);
  }

  // ── Public entry point ─────────────────────────────────────────────────────

  public async generateAnalysisForSite(
    siteKey: string,
    snapshot: unknown
  ): Promise<string> {
    // 1. Resolve API key (DB → env fallback)
    const cfg = await this.getKeyForSite(siteKey);
    const apiKey = cfg?.apiKey || process.env.OPENAI_API_KEY || '';
    const model = cfg?.model || DEFAULT_MODEL;

    if (!apiKey) {
      this.log('warn', 'No OpenAI key configured — returning fallback report');
      return this.fallbackReport(snapshot as Snapshot);
    }

    // 2. Prepare inputs
    const systemPrompt = this.buildSystemPrompt();
    const snapshotJson = this.sanitizeSnapshot(snapshot);
    const userContent = `Dados estruturados do período (JSON):\n\n${snapshotJson}`;

    // 3. Call OpenAI with retry, fallback on failure
    try {
      return await this.callOpenAI(apiKey, model, systemPrompt, userContent);
    } catch {
      this.log('warn', 'All OpenAI attempts failed — returning fallback report');
      return this.fallbackReport(snapshot as Snapshot);
    }
  }

  // ── System Prompt ──────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `\
🤖 AGENTE ANALISTA DE PERFORMANCE — META ADS + GA4 + CRO
══════════════════════════════════════════════════════════

PAPEL (ROLE)
Você é um Analista de Tráfego Sênior e Cientista de Dados, especializado em Meta Ads, GA4, Pixel da Meta e CRO (Conversion Rate Optimization). Você raciocina como um gestor de tráfego experiente com mais de 10 anos de experiência — não como um assistente genérico.

SUA MISSÃO: Receber dados multicanal e diagnosticar com precisão cirúrgica por que uma campanha está ou não gerando resultados — apontando o gargalo exato e o plano de ação mais inteligente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO DOS DADOS (INPUTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Você receberá um JSON com os seguintes blocos:

• \`meta\` → Métricas agregadas do Meta Ads: Investimento, Impressões, Alcance, CPM, CTR (Link), CPC, Frequência, Resultados, CPA, ROAS.
• \`meta_breakdown\` → Detalhamento por campanha, conjunto de anúncios e anúncios individuais. USE ESSES DADOS para identificar vencedores e ofensores.
• \`site\` → Métricas do site rastreadas pelo tracking interno:
    - \`pageviews\`: total de visualizações de página.
    - \`avg_load_time_ms\`: tempo médio de carregamento. Acima de 3000ms = crítico.
    - \`avg_dwell_time_ms\`: tempo médio de permanência. Abaixo de 10s = abandono.
    - \`avg_max_scroll_pct\`: profundidade de rolagem. Abaixo de 30% = não leram a oferta.
    - \`clicks_cta\`: cliques em botões de ação (CTA).
    - \`bounces_est\`: visitas com < 5s e < 10% de scroll.
    - \`capi\`: dados de servidor (mais precisos que o Pixel):
        - \`page_views\`: visitas reais rastreadas (fonte da verdade).
        - \`leads\`: leads confirmados no servidor.
        - \`avg_load_time_ms\`: velocidade no servidor.
        - \`deep_scroll_count\`: pessoas que rolaram > 50% da página.
        - \`avg_dwell_time_ms\`: tempo real de permanência.
• \`derived\` → Métricas calculadas: CTR, CPC, CPM, connect_rate, conversion rates.
• \`signals\` → Sinais automáticos detectados (anomalias, alertas, padrões).
• \`landing_page\` → URL + conteúdo textual extraído. Use para avaliar alinhamento com o criativo.
• \`segments\` → Distribuição por hora (\`hourly\`) e dia da semana (\`day_of_week\`). Use para identificar padrões de performance temporal.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE ANÁLISE (RACIOCÍNIO OBRIGATÓRIO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGRA 0 — INTEGRIDADE DOS DADOS
Use SOMENTE os dados fornecidos. Jamais invente números, benchmarks ou médias de mercado não solicitadas.
Se um dado estiver ausente, declare: "Dado não disponível — análise parcial."
Um valor 0 pode ser "nenhum evento" OU "tracking quebrado". Investigue antes de concluir.

REGRA 1 — OBJETIVO É REI
Leia o campo \`objective\` antes de qualquer análise.
• Se objetivo = LEADS/CADASTRO → meça por \`results\` (quantidade) e \`cost_per_result\` (CPA). Compras zeradas são IRRELEVANTES.
• Se objetivo = CONVERSÃO/COMPRA → meça por \`purchases\` e ROAS.
• Se objetivo = TRÁFEGO → meça por CTR, CPC e landing_page_views.
NUNCA aponte como problema uma métrica que não corresponde ao objetivo da campanha.

REGRA 2 — FUNIL (DO TOPO À BASE)
Analise sempre nessa ordem:
  Entrega → Clique → Landing → Engajamento → CTA → Conversão

REGRA 3 — DISCREPÂNCIA META x SITE
Compare \`meta.clicks\` com \`site.capi.page_views\` (ou \`site.pageviews\` se capi indisponível).
• Quebra > 20–30% → suspeita de: lentidão, cliques acidentais, pixel mal instalado ou redirect quebrado.
• Zeros em conversão com CTR alto = tracking quebrado, não funil frio.

REGRA 4 — ANÁLISE DO ANÚNCIO (CRIATIVO)
• Alto CTR + baixa conversão = desalinhamento entre promessa do anúncio e landing page.
• Compare o conteúdo de \`landing_page.content\` com a mensagem inferida dos anúncios.
• Use \`meta_breakdown.ads\` para ranquear anúncios por CTR, CPA e resultados.

REGRA 5 — SATURAÇÃO DO PÚBLICO
• Frequência > 3.5 + CPA crescente = público saturado. Sugira nova segmentação ou criativo.
• Cruce com \`site.avg_dwell_time_ms\`: dwell time baixo mesmo com alta frequência = público errado.

REGRA 6 — LANDING PAGE
• Cruce \`site.avg_dwell_time_ms\` e \`site.avg_max_scroll_pct\` com taxa de conversão.
• Tráfego chegando mas sem cliques em CTA = falha na oferta, layout ou velocidade.
• Avalie velocidade: \`site.capi.avg_load_time_ms\` > 3000ms = ação imediata.

REGRA 7 — SEGMENTOS TEMPORAIS
• Analise \`segments.hourly\` e \`segments.day_of_week\`.
• Se há padrão claro (ex: conversões concentradas de 9h–13h), sugira dayparting.

REGRA 8 — SEM VAGABUNDEZ ANALÍTICA
• PROIBIDO: "Talvez a landing page não esteja convertendo bem."
• OBRIGATÓRIO: "A landing page recebeu 150 visitas e gerou 2 leads (1,3% de conversão). O scroll médio de 22% indica que a maioria nem chegou na oferta. O problema está no topo da página."
• Sempre cite os números exatos ao fazer uma afirmação.
• Sempre compare resultados entre anúncios/conjuntos quando o breakdown estiver disponível.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA DE SAÍDA OBRIGATÓRIA (MARKDOWN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 1. DIAGNÓSTICO GERAL DA CAMPANHA
- **Status:** [Excelente / Razoável / Crítico]
- **Resumo:** (2–3 linhas sobre o impacto real nos resultados, citando números)
- **Ação Recomendada:** [Escalar / Manter / Otimizar / Pausar + justificativa objetiva]

---

## 📋 2. TABELA DE MÉTRICAS (META x SITE x BANCO)
| Métrica | Meta Ads | Site / CAPI | Banco Interno | Discrepância |
|---|---|---|---|---|
| Cliques / Visitas | | | — | |
| Conversões | | | | |
| CPA | | — | — | — |
| ROAS | | — | | |

---

## 🔍 3. ANÁLISE DO FUNIL
- **Entrega (CPM / Alcance):** [diagnóstico com números]
- **Clique (CTR / CPC):** [diagnóstico com números]
- **Landing (Velocidade / Bounce):** [diagnóstico com números]
- **Engajamento (Scroll / Dwell Time):** [diagnóstico com números]
- **Conversão (CTA / Resultado):** [diagnóstico com números]

→ **🎯 Gargalo Principal:** [etapa exata onde o funil quebra, com evidência numérica]

---

## 🧩 4. AVALIAÇÃO DOS CONJUNTOS DE ANÚNCIOS
Para cada conjunto relevante:
- **[Nome]:** [Veredito] — [Justificativa cruzando público + comportamento no site + CPA]

---

## 🎯 5. AVALIAÇÃO DOS ANÚNCIOS
- **🏆 Vencedores:** [Nome, CTR, CPA, por que funciona, confirmação no banco]
- **🚨 Ofensores:** [Nome, onde gasta sem retorno, gargalo identificado]

---

## 🖥️ 6. DIAGNÓSTICO DA PÁGINA DE DESTINO
- **Alinhamento criativo x promessa:** [ok / problema — citar evidência]
- **Velocidade:** [ms — ok / alerta / crítico]
- **Retenção:** [scroll % + dwell time — interpretação]
- **Sugestão prática:** [ação específica e implementável]

---

## 📅 7. ANÁLISE DE SEGMENTOS TEMPORAIS
(Somente se \`segments\` estiver disponível e mostrar padrão relevante)
- Melhor horário/dia: [dados]
- Pior horário/dia: [dados]
- Recomendação: [dayparting, orçamento concentrado, etc.]

---

## ⚠️ 8. HIPÓTESES ALTERNATIVAS
(O que mais poderia explicar os resultados além do gargalo principal? Liste 2–3 hipóteses com base nos dados.)

---

## ✅ 9. PLANO DE AÇÃO PRIORITÁRIO
1. **[Hoje]** — [Ação imediata específica]
2. **[Esta semana]** — [Ação de curto prazo]
3. **[Próximo ciclo]** — [Ação estratégica]
`;
  }

  // ── Fallback Report ────────────────────────────────────────────────────────

  /**
   * Generates a structured Markdown report without AI when:
   * - OpenAI key is not configured
   * - All OpenAI retry attempts fail
   */
  private fallbackReport(snapshot: Snapshot): string {
    const m = snapshot.meta ?? {};
    const s = snapshot.site ?? {};
    const capi = s.capi ?? {};
    const sa = snapshot.sales ?? {};
    const d = snapshot.derived ?? {};
    const signals: Signal[] = snapshot.signals ?? [];
    const mb = snapshot.meta_breakdown ?? {};
    const campaigns = mb.campaigns ?? [];
    const adsets = mb.adsets ?? [];
    const ads = mb.ads ?? [];
    const segments = snapshot.segments;

    const lines: string[] = [];

    // ── Header ───────────────────────────────────────────────────────────────
    lines.push(`# 📊 Diagnóstico de Performance (Modo Básico)`);
    lines.push('');
    lines.push(`> ⚠️ Relatório gerado sem IA. Configure uma chave OpenAI para análise aprofundada com diagnóstico de gargalos e recomendações personalizadas.`);
    lines.push('');
    lines.push(`**Período analisado:** ${this.formatInt(snapshot.period_days)} dias`);
    lines.push('');

    // ── Metrics table ─────────────────────────────────────────────────────────
    lines.push(`## 📋 Tabela de Métricas`);
    lines.push('');
    lines.push(`| Área | Métrica | Valor | Observação |`);
    lines.push(`|---|---|---:|---|`);

    // Meta
    lines.push(`| **Meta** | Objetivo | ${m.objective || '—'} | Tipo de resultado otimizado |`);
    lines.push(`| Meta | Resultados | ${this.formatInt(m.results)} | Métrica principal conforme objetivo |`);
    lines.push(`| Meta | Custo por resultado | ${this.formatMoney(m.cost_per_result)} | Spend ÷ Resultados |`);
    lines.push(`| Meta | Investimento total | ${this.formatMoney(m.spend)} | Gasto no período |`);
    lines.push(`| Meta | Impressões | ${this.formatInt(m.impressions)} | Alcance dos anúncios |`);
    lines.push(`| Meta | Cliques (link) | ${this.formatInt(m.clicks)} | Total de cliques |`);
    lines.push(`| Meta | CTR | ${this.formatNumber(d.ctr_calc_pct)}% | Cliques ÷ Impressões |`);
    lines.push(`| Meta | CPC | ${this.formatMoney(d.cpc_calc)} | Custo médio por clique |`);
    lines.push(`| Meta | CPM | ${this.formatMoney(d.cpm_calc)} | Custo por mil impressões |`);
    lines.push(`| Meta | Connect Rate | ${this.formatNumber(d.connect_rate_pct)}% | Cliques → Landing page views |`);
    lines.push(`| Meta | Landing Page Views | ${this.formatInt(m.landing_page_views)} | Chegaram ao site (Meta) |`);
    lines.push(`| Meta | Leads | ${this.formatInt(m.leads)} | Leads registrados (Pixel) |`);
    lines.push(`| Meta | Iniciar checkout | ${this.formatInt(m.initiates_checkout)} | Checkouts iniciados (Pixel) |`);
    lines.push(`| Meta | Compras (Pixel) | ${this.formatInt(m.purchases)} | Compras rastreadas pelo Pixel |`);
    lines.push('');

    // CAPI / Site
    lines.push(`| **CAPI** | Page Views (servidor) | ${this.formatInt(capi.page_views)} | Visitas reais confirmadas |`);
    lines.push(`| CAPI | Leads (servidor) | ${this.formatInt(capi.leads)} | Leads confirmados no servidor |`);
    lines.push(`| CAPI | Velocidade (servidor) | ${this.formatMs(capi.avg_load_time_ms)} | Acima de 3000ms = crítico |`);
    lines.push(`| CAPI | Deep scroll (>50%) | ${this.formatInt(capi.deep_scroll_count)} | Engajamento real com conteúdo |`);
    lines.push(`| CAPI | Dwell time | ${this.formatMs(capi.avg_dwell_time_ms)} | Tempo real na página |`);
    lines.push('');

    // Site
    lines.push(`| **Site** | Page Views | ${this.formatInt(s.pageviews)} | Total de páginas vistas |`);
    lines.push(`| Site | Velocidade | ${this.formatMs(s.avg_load_time_ms)} | Tempo médio de carregamento |`);
    lines.push(`| Site | Dwell time | ${this.formatMs(s.avg_dwell_time_ms)} | Permanência média |`);
    lines.push(`| Site | Scroll médio | ${s.avg_max_scroll_pct != null ? `${this.formatInt(s.avg_max_scroll_pct)}%` : '—'} | Profundidade de rolagem |`);
    lines.push(`| Site | Cliques em CTA | ${this.formatInt(s.clicks_cta)} | Cliques em botões de ação |`);
    lines.push(`| Site | Bounces estimados | ${this.formatInt(s.bounces_est)} | Visitas < 5s e < 10% scroll |`);
    lines.push('');

    // Conversions
    lines.push(`| **Conversão** | Compras (banco) | ${this.formatInt(sa.purchases)} | Compras via webhook/API |`);
    lines.push(`| Conversão | Receita | ${this.formatMoney(sa.revenue)} | Receita total rastreada |`);
    lines.push(`| Conversão | Taxa LPV → Compra | ${this.formatNumber(d.lp_to_purchase_rate_pct)}% | LPV para venda |`);
    lines.push(`| Conversão | Taxa PV → Compra | ${this.formatNumber(d.pv_to_purchase_rate_pct)}% | Page view para venda |`);
    lines.push('');

    // ── Breakdown ─────────────────────────────────────────────────────────────
    if (campaigns.length || adsets.length || ads.length) {
      lines.push(`## 🧩 Breakdown por Nível (Meta Ads)`);
      lines.push('');
      lines.push(`| Nível | Nome | Objetivo | Resultados | Investimento | Impressões | Cliques | LPV | Leads | Compras | CPA |`);
      lines.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`);

      const renderRows = (level: string, rows: BreakdownRow[]) => {
        for (const row of rows.slice(0, BREAKDOWN_MAX_ROWS)) {
          lines.push(
            `| ${level} | ${String(row.name || '—')} | ${String(row.objective || '—')} | ${this.formatInt(row.results)} | ${this.formatMoney(row.spend)} | ${this.formatInt(row.impressions)} | ${this.formatInt(row.clicks)} | ${this.formatInt(row.landing_page_views)} | ${this.formatInt(row.leads)} | ${this.formatInt(row.purchases)} | ${this.formatMoney(row.cost_per_result)} |`
          );
        }
      };

      renderRows('Campanha', campaigns);
      renderRows('Conjunto', adsets);
      renderRows('Anúncio', ads);
      lines.push('');
    }

    // ── Segments ──────────────────────────────────────────────────────────────
    if (segments?.hourly || segments?.day_of_week) {
      lines.push(`## 📅 Distribuição Temporal`);
      lines.push('');
      if (segments.hourly) {
        lines.push('**Por hora do dia:**');
        lines.push('');
        lines.push('| Hora | Valor |');
        lines.push('|---|---:|');
        for (const [hour, val] of Object.entries(segments.hourly).slice(0, 24)) {
          lines.push(`| ${hour}h | ${this.formatNumber(val)} |`);
        }
        lines.push('');
      }
      if (segments.day_of_week) {
        lines.push('**Por dia da semana:**');
        lines.push('');
        lines.push('| Dia | Valor |');
        lines.push('|---|---:|');
        for (const [day, val] of Object.entries(segments.day_of_week)) {
          lines.push(`| ${day} | ${this.formatNumber(val)} |`);
        }
        lines.push('');
      }
    }

    // ── Signals ───────────────────────────────────────────────────────────────
    lines.push(`## ⚠️ Sinais Automáticos Detectados`);
    lines.push('');
    if (!signals.length) {
      lines.push(`- **Sem sinais.** Volume de dados insuficiente (Meta e/ou eventos no site).`);
      lines.push(`- Aguarde mais dados ou verifique Pixel + CAPI + tracking de eventos.`);
    } else {
      for (const sig of signals.slice(0, 8)) {
        lines.push(`- **[${String(sig.area)}]** ${String(sig.signal)} *(confiança: ${this.formatNumber(sig.weight)})*`);
        lines.push(`  - ${String(sig.evidence)}`);
      }
    }
    lines.push('');

    // ── Quick actions ─────────────────────────────────────────────────────────
    lines.push(`## ✅ Próximas Ações (Diagnóstico Manual)`);
    lines.push('');
    lines.push(`1. **Validar dados do Meta** — Confirme registros na tabela \`meta_insights_daily\` para os últimos ${this.formatInt(snapshot.period_days)} dias.`);
    lines.push(`2. **Verificar tracking de eventos** — Valide que \`PageView\` e \`PageEngagement\` chegam em \`web_events\` sem duplicação.`);
    lines.push(`3. **Analisar connect rate** — Se CTR está ok mas Connect Rate < 70%, investigue destino do anúncio, velocidade e consistência da promessa.`);
    lines.push(`4. **Cruzar resultados por objetivo** — Compare \`results\` com \`purchases\`/\`leads\`/\`contacts\` para detectar discrepâncias de tracking.`);
    lines.push(`5. **Verificar velocidade da landing page** — CAPI \`avg_load_time_ms\` acima de 3000ms requer ação imediata.`);
    lines.push(`6. **Ativar análise com IA** — Configure uma chave OpenAI nas configurações da conta para diagnóstico completo com hipóteses e recomendações.`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`*Relatório básico gerado automaticamente. Para análise aprofundada com diagnóstico de gargalos, hipóteses alternativas e plano de ação priorizado, ative o diagnóstico via IA configurando uma chave OpenAI.*`);

    return lines.join('\n');
  }
}

export const llmService = new LlmService();