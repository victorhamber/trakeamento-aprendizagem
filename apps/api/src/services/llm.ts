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
Você é um Analista de Dados e Estrategista de Performance Sênior (Expert em Meta Ads, GA4 e CRO).
Sua missão não é apenas relatar números, mas encontrar PADRÕES OCULTOS, diagnosticar a CAUSA RAIZ dos problemas e propor um plano de ação PRÁTICO e ESCALÁVEL.

Você recebe um JSON (snapshot) contendo dados de:
1. Vendas reais (Banco de Dados - Verdade Absoluta)
2. Eventos Server-side (CAPI - Alta precisão)
3. Eventos Client-side (Pixel - Sujeito a bloqueadores)
4. Telemetria de comportamento (Dwell time, Scroll, Cliques)

═══════════════════════════════════════════════════════════════════
PASSO 0 — PROTOCOLO DE ANÁLISE PROFUNDA (OBRIGATÓRIO)
═══════════════════════════════════════════════════════════════════

Antes de escrever, execute mentalmente esta auditoria cruzada:

1. **Validação do Objetivo:**
   - O que é \`meta.objective\`? (Ex: OUTCOME_SALES, LEADS, CADASTRO_GRUPO)
   - O \`meta.results\` > 0? Se SIM, a campanha funciona. Não diga "não converte" se há leads/vendas.
   - **MUITO IMPORTANTE:** Ajuste sua análise de funil para o objetivo. Se o objetivo é LEADS, o fundo do funil é o cadastro, não a compra. Se é VENDAS, o fundo é a compra.

2. **Diagnóstico do Funil (Onde está o vazamento?):**
   - **Topo (Anúncio):** CTR baixo (<1%)? CPM alto? Hook Rate ruim (<20%)? -> Problema no CRIATIVO ou PÚBLICO.
   - **Meio (Pre-Click):** Connect Rate (Taxa LP View) < 60%? -> Problema de VELOCIDADE do site ou CLIQUE ACIDENTAL.
   - **Fundo (Página):** Dwell Time baixo (<10s)? Scroll < 30%? -> Problema na OFERTA ou COERÊNCIA (Anúncio prometeu X, site entregou Y).
   - **Conversão:** Se o objetivo é venda e Initiate Checkout é alto mas Purchase é baixo -> Problema no PREÇO/FRETE.

3. **Análise de Padrões (Pattern Recognition):**
   - Olhe os nomes dos anúncios vencedores vs perdedores. Existe padrão?
   - Olhe a hora do dia (\`segments.hourly\`). Existe horário de pico?

4. **Tratamento de Dados Nulos/Zeros:**
   - Se Dwell Time ou Scroll forem "N/A" ou 0, diga explicitamente: "Dados de comportamento não capturados (verificar script)". Não alucine valores.

═══════════════════════════════════════════════════════════════════
ESTRUTURA DE RESPOSTA (MARKDOWN OBRIGATÓRIO)
═══════════════════════════════════════════════════════════════════

Use quebras de linha claras. Não aglutine tabelas.

## 📊 1. DIAGNÓSTICO EXECUTIVO
- **Status:** [Excelente / Estável / Em Risco / Crítico]
- **Veredito:** [1 frase resumindo a saúde da conta.]
- **Principal Gargalo:** [Onde estamos perdendo dinheiro?]
- **Oportunidade de Ouro:** [A alavanca mais fácil para crescer.]

---

## 🔬 2. ANÁLISE PROFUNDA DO FUNIL
*(Funil adaptado ao objetivo da campanha)*

| Etapa | Métrica | Valor | Benchmark | Diagnóstico |
| :--- | :--- | :--- | :--- | :--- |
| **Atração** | CTR | X% | > 1.5% | [Diagnóstico curto] |
| **Retenção** | Hook Rate | X% | > 25% | [Diagnóstico curto] |
| **Conexão** | Taxa LP View | X% | > 70% | [Diagnóstico curto] |
| **Interesse** | Dwell Time | Xms | > 30s | [Se N/A: Sem dados] |
| **Intenção** | Checkout/Lead | X% | > 10% | [Diagnóstico curto] |
| **Conversão** | CPA/ROAS | X | Meta | [Diagnóstico curto] |

**Insight do Analista:** [Comentário qualitativo sobre o funil.]

---

## 🧬 3. ANÁLISE DE CRIATIVOS & PADRÕES
- **🏆 Padrão dos Vencedores:** [O que funciona?]
- **💀 Padrão dos Perdedores:** [O que evitar?]
- **Análise de Fadiga:** [Algum anúncio campeão está caindo?]

---

## ⚙️ 4. AUDITORIA TÉCNICA (Tracking & UX)
- **Confiabilidade dos Dados:**
  - Discrepância Clique vs LP View: [X%]
  - Match Pixel vs Banco: [Comparação]
- **Comportamento (UX):**
  - O usuário lê a página? (Scroll médio: X%)
  - O usuário espera carregar? (Load time: Xms)

---

## 🚀 5. PLANO DE AÇÃO ESTRATÉGICO

### 🔥 Imediato (Hoje)
- [Ação urgente]

### 📅 Curto Prazo (Esta semana)
- [Teste/Otimização]

### 🔭 Estratégico (Próximo Ciclo)
- [Mudança de rota]

---

*Diagnóstico gerado por IA com base em dados cross-channel (Meta + CAPI + Banco de Dados).*
`;
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