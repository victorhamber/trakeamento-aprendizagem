import axios, { AxiosError } from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

interface LlmConfig {
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 12000;
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
    if (typeof lp.content === 'string' && lp.content.length > 12_000) {
      lp.content = lp.content.slice(0, 12_000) + '\n[...truncado...]';
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

  /** Secoes "esperadas" opcionais: nao gerar aviso no relatorio se o modelo omitir (evita falsos positivos). */
  private getExpectedSections(_snapshot: Record<string, unknown>): string[] {
    return [];
  }

  private validateOutput(content: string, snapshot?: Record<string, unknown>): { valid: boolean; missing: string[]; missingExpected: string[]; truncated: boolean } {
    const missing = this.REQUIRED_SECTIONS.filter(
      section => !content.includes(section)
    );
    const trimmed = content.trimEnd();
    const truncated = !trimmed.endsWith('*') && !trimmed.endsWith('---') && !trimmed.endsWith('|')
      && !trimmed.endsWith('.') && !trimmed.endsWith(')')
      && trimmed.length > 2000;

    const expected = snapshot ? this.getExpectedSections(snapshot) : [];
    const missingExpected = expected.filter(s => !content.includes(s));

    return { valid: missing.length === 0, missing, missingExpected, truncated };
  }

  private appendValidationWarnings(content: string, missing: string[], missingExpected: string[], truncated: boolean): string {
    const warnings: string[] = [];
    if (truncated) {
      warnings.push('> ⚠️ **Aviso:** Este relatório pode estar incompleto (resposta truncada pelo modelo).');
    }
    if (missing.length > 0) {
      warnings.push(`> ⚠️ **Seções ausentes:** ${missing.join(', ')}. O modelo não seguiu a estrutura completa.`);
    }
    if (missingExpected.length > 0) {
      warnings.push(`> ⚠️ **Seções esperadas não incluídas:** ${missingExpected.join(', ')}. Dados disponíveis não foram utilizados.`);
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
    const snapRecord = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {};
    const systemPrompt = this.buildSystemPrompt(snapRecord);
    const snapshotJson = this.sanitizeSnapshot(snapshot);
    const userBriefing = this.buildUserBriefing(snapRecord);
    const userContent = `${userBriefing}\n\n---\n\nDados completos (JSON):\n\n${snapshotJson}`;
    try {
      let content = await this.callOpenAI(apiKey, model, systemPrompt, userContent);
      const validation = this.validateOutput(content, snapRecord);

      if (!validation.valid) {
        this.log('warn', `Output missing sections: ${validation.missing.join(', ')}. Retrying...`);
        try {
          const retryPrompt = `Voce gerou um relatorio incompleto. As seguintes secoes OBRIGATORIAS estao faltando: ${validation.missing.join(', ')}.\n\nPor favor, gere o relatorio COMPLETO seguindo a estrutura exata do system prompt. Inclua TODAS as secoes obrigatorias.\n\nDados:\n\n${snapshotJson}`;
          content = await this.callOpenAI(apiKey, model, systemPrompt, retryPrompt);
          const revalidation = this.validateOutput(content, snapRecord);
          content = this.appendValidationWarnings(content, revalidation.missing, revalidation.missingExpected, revalidation.truncated);
        } catch {
          content = this.appendValidationWarnings(content, validation.missing, validation.missingExpected, validation.truncated);
        }
      } else {
        content = this.appendValidationWarnings(content, [], validation.missingExpected, validation.truncated);
      }

      return content;
    } catch {
      this.log('warn', 'All OpenAI attempts failed — returning fallback report');
      return this.fallbackReport(snapshot);
    }
  }

  private buildUserBriefing(snap: Record<string, unknown>): string {
    const meta = this.asRecord(snap.meta);
    const capi = this.asRecord(snap.capi);
    const site = this.asRecord(snap.site);
    const sales = this.asRecord(snap.sales);
    const derived = this.asRecord(snap.derived);
    const trend = snap.trend ? this.asRecord(snap.trend) : null;
    const uc = this.asRecord(snap.user_context);
    const signals = Array.isArray(snap.signals) ? snap.signals as Record<string, unknown>[] : [];
    const mb = this.asRecord(snap.meta_breakdown);
    const ads = Array.isArray(mb.ads) ? mb.ads as Record<string, unknown>[] : [];
    const adsets = Array.isArray(mb.adsets) ? mb.adsets as Record<string, unknown>[] : [];

    const lines: string[] = [];
    lines.push(`# Briefing Estruturado\n`);
    lines.push(`**Periodo:** ${snap.period_days} dias (${snap.since} ate ${snap.until})`);
    lines.push(`**Objetivo da campanha:** ${meta.objective || 'Nao informado'}`);
    if (uc.stated_objective) lines.push(`**Objetivo declarado pelo usuario:** ${uc.stated_objective}`);
    lines.push('');

    lines.push(`## Metricas Meta Ads`);
    lines.push(`- Investimento: ${this.fmtMoney(meta.spend)}`);
    lines.push(`- Resultados (evento otimizado): ${this.fmtInt(meta.results)} | CPA: ${this.fmtMoney(meta.cost_per_result)}`);
    lines.push(`- Impressoes: ${this.fmtInt(meta.impressions)} | Alcance: ${this.fmtInt(meta.reach)} (contas da Central de Contas) | Frequencia: ${this.fmt(meta.frequency_avg)}`);
    lines.push(`- Cliques: ${this.fmtInt(meta.clicks)} | Link Clicks Unicos: ${this.fmtInt(meta.unique_link_clicks)}`);
    lines.push(`- CTR: ${this.fmtPct(derived.ctr_calc_pct)} | CPC: ${this.fmtMoney(derived.cpc_calc)} | CPM: ${this.fmtMoney(derived.cpm_calc)}`);
    lines.push(`- LP Views: ${this.fmtInt(meta.landing_page_views)} | Taxa LP View: ${this.fmtPct(meta.connect_rate_pct)}`);
    lines.push(`- Hook Rate: ${meta.hook_rate_pct != null ? this.fmtPct(meta.hook_rate_pct) : 'N/A (sem video)'}`);
    lines.push(`- Video 3s Views: ${this.fmtInt(meta.video_3s_views)}`);
    lines.push(`- Leads: ${this.fmtInt(meta.leads)} | Checkouts: ${this.fmtInt(meta.initiates_checkout)} | Compras Meta: ${this.fmtInt(meta.purchases)}`);
    lines.push('');

    lines.push(`## Comportamento no Site`);
    lines.push(`- Page Views (CAPI): ${this.fmtInt(capi.page_views)}`);
    lines.push(`- Load Time: ${site.effective_load_ms != null ? this.fmtMs(site.effective_load_ms) : 'Sem dados'}`);
    lines.push(`- Dwell Time: ${site.effective_dwell_ms != null ? this.fmtMs(site.effective_dwell_ms) : 'Sem dados'}`);
    lines.push(`- Scroll Medio: ${site.effective_scroll_pct != null ? this.fmtPct(site.effective_scroll_pct) : 'Sem dados'}`);
    lines.push(`- Bounces Estimados: ${this.fmtInt(site.bounces_est)} de ${this.fmtInt(site.engagement_events)} sessoes`);
    lines.push(`- Cliques CTA: ${this.fmtInt(site.clicks_cta)}`);
    lines.push(`- Discrepancia Cliques→LP: ${derived.click_to_lp_discrepancy_pct != null ? this.fmtPct(derived.click_to_lp_discrepancy_pct) : 'N/A'}`);
    lines.push('');

    const lpBrief = this.asRecord(snap.landing_page);
    if (typeof lpBrief.content === 'string' && lpBrief.content.length > 0) {
      lines.push(`## Landing page — texto capturado para auditoria`);
      lines.push(`- URL: ${lpBrief.url || 'N/A'}`);
      lines.push(`- Proveniencia: ${String(lpBrief.content_note || 'Servidor fez GET do HTML e extraiu texto plano.')}`);
      lines.push(`- Caracteres no recorte: ${lpBrief.content.length}`);
      lines.push('');
    } else if (lpBrief.url) {
      lines.push(`## Landing page`);
      lines.push(`- URL: ${lpBrief.url}`);
      lines.push(`- ${String(lpBrief.content_note || 'Sem texto — nao invente copy da pagina.')}`);
      lines.push('');
    }

    lines.push(`## Vendas Reais (Banco)`);
    lines.push(`- Compras: ${this.fmtInt(sales.purchases)} | Receita: ${this.fmtMoney(sales.revenue)}`);
    lines.push(`- ROAS Real: ${sales.roas != null ? this.fmt(sales.roas) + 'x' : 'N/A'}`);
    if (sales.meta_roas != null) lines.push(`- ROAS Meta (pixel): ${this.fmt(sales.meta_roas)}x (Receita Meta: ${this.fmtMoney(sales.meta_revenue)})`);
    lines.push('');

    if (signals.length > 0) {
      lines.push(`## Sinais Detectados (pre-calculados)`);
      for (const sig of signals) {
        lines.push(`- [${sig.area}] ${sig.signal}: ${sig.evidence}`);
      }
      lines.push('');
    }

    if (ads.length > 0) {
      lines.push(`## Top Anuncios (por gasto)`);
      for (const ad of ads.slice(0, 8)) {
        const a = ad as Record<string, unknown>;
        const hookStr = a.hook_rate_pct != null ? this.fmtPct(a.hook_rate_pct) : 'N/A(img)';
        lines.push(`- ${a.name}: Gasto=${this.fmtMoney(a.spend)} | Resultados=${this.fmtInt(a.results)} | CPA=${this.fmtMoney(a.cost_per_result)} | CTR=${this.fmtPct(a.ctr_calc_pct)} | Hook=${hookStr}`);
      }
      lines.push('');
    }

    if (trend) {
      lines.push(`## Tendencia vs Periodo Anterior`);
      const tSpend = this.asRecord(trend.spend);
      const tResults = this.asRecord(trend.results);
      const tCPA = this.asRecord(trend.cpa);
      const tCTR = this.asRecord(trend.ctr);
      const tROAS = this.asRecord(trend.roas);
      lines.push(`- Spend: ${this.fmtMoney(tSpend.previous)} → ${this.fmtMoney(tSpend.current)} (${tSpend.change_pct != null ? tSpend.change_pct + '%' : '—'})`);
      lines.push(`- Results: ${this.fmtInt(tResults.previous)} → ${this.fmtInt(tResults.current)} (${tResults.change_pct != null ? tResults.change_pct + '%' : '—'})`);
      lines.push(`- CPA: ${this.fmtMoney(tCPA.previous)} → ${this.fmtMoney(tCPA.current)} (${tCPA.change_pct != null ? tCPA.change_pct + '%' : '—'})`);
      lines.push(`- CTR: ${this.fmtPct(tCTR.previous)} → ${this.fmtPct(tCTR.current)}`);
      if (tROAS.current != null) lines.push(`- ROAS: ${this.fmt(tROAS.previous)}x → ${this.fmt(tROAS.current)}x`);
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildSystemPrompt(snapshot?: Record<string, unknown>): string {
    const snap = snapshot || {};
    const meta = this.asRecord(snap.meta);
    const site = this.asRecord(snap.site);
    const sales = this.asRecord(snap.sales);
    const uc = this.asRecord(snap.user_context);
    const lp = this.asRecord(snap.landing_page);
    const mb = this.asRecord(snap.meta_breakdown);
    const segments = this.asRecord(snap.segments);
    const ads = Array.isArray(mb.ads) ? mb.ads : [];
    const creatives = Array.isArray(uc.creatives) ? uc.creatives : [];
    const hasMessageMatch = !!snap.message_match;
    const hasTrend = !!snap.trend;
    const hasLPContent = typeof lp.content === 'string' && lp.content.length > 0;
    const hasCreatives = creatives.length > 0;
    const hasTemporalData = Object.keys(this.asRecord(segments.hourly)).length > 0 || Object.keys(this.asRecord(segments.day_of_week)).length > 0;
    const hasMetaSpend = Number(meta.spend || 0) > 0;

    const sections: string[] = [];

    // ── Core identity ──
    sections.push(`Voce e um Consultor Senior de Performance e CRO especializado em Meta Ads para o mercado brasileiro.
Voce cobra caro pela sua consultoria. Cada relatorio que voce produz deve justificar esse valor: diagnostico preciso, linguagem direta, acoes concretas e nenhuma frase generica.

Seu tom: firme, educativo, assertivo. Como um mentor que ja gastou milhoes em ads e sabe exatamente onde o dinheiro esta vazando. Nunca use linguagem corporativa vazia. Fale de dor, conversao e dinheiro.

Benchmarks BR de referencia: CTR (1-2%), CPC (R$0.50-2.50), CPM (R$15-40), Tx Conversao LP (1-3%), Taxa LP View (>70%).`);

    // ── Diretrizes alinhadas ao modelo de analista Meta Ads (Performance / funil / leilao) ──
    sections.push(`
=== DIRETRIZES META ADS (PERFIL E METODOLOGIA) ===

Voce tambem atua como Analista de Performance Senior em Meta Ads. Missao: identificar gargalos no funil e recomendacoes acionaveis para melhorar ROAS e custo por resultado (CPA do evento otimizado).

Diretrizes de analise:
- Foco no objetivo: priorize SEMPRE a metrica principal da campanha (compras, leads, finalizacoes de compra, etc.) — no JSON, isso e meta.results / evento otimizado.
- Visao de funil: relacione Impressoes > Cliques (link) > acoes no site (LP views, eventos CAPI) > conversoes.
- Contexto de leilao: use CPM e CTR para comentar competitividade e relevancia do criativo (sem generalizar sem dados).
- Nao invente metricas ausentes (null no JSON): declare "sem dados" quando aplicavel.

Terminologia Meta: ao reportar alcance ou tamanho de audiencia, prefira "contas da Central de Contas" em vez de "pessoas" de forma generica.

Alinhamento com a estrutura OBRIGATORIA deste relatorio:
- Em ## Diagnostico Executivo: comece com 1-2 frases de resumo executivo (equivalente ao "Resumo Executivo" da Meta), depois a tabela.
- ## Analise do Funil e ## Diagnostico de 3 Camadas cobrem o papel de "Diagnostico de Performance" (explicacao tecnica do porque dos numeros).
- Em ## Plano de Acao: use lista NUMERADA (1., 2., 3., ...) com passos praticos (lances, criativos, publico, pagina). Mantenha o titulo exato ## Plano de Acao.`);

    // ── Pre-analysis checklist ──
    sections.push(`
=== CHECKLIST PRE-ANALISE (execute mentalmente antes de escrever) ===

1. meta.results = quantidade de conversoes do EVENTO OTIMIZADO. Este e o KPI principal.
2. O evento de otimizacao PODE SER DIFERENTE do objetivo macro (meta.objective).
   Ex: objetivo=OUTCOME_SALES mas otimizado para CADASTRO_GRUPO → sucesso = cadastros.
   JULGUE SEMPRE por meta.results. Se results > 0, a campanha esta convertendo.
3. sales.purchases e sales.revenue = dados REAIS do banco. Compare com meta.purchases para discrepancias.
4. hook_rate_pct = null → anuncio de IMAGEM. NUNCA mencione hook rate para imagens.
5. site.effective_dwell_ms = null → dados de comportamento NAO capturados. Diga isso. NAO invente.
6. utm_filters_skipped != null → dados de CAPI/site cobrem TODO o trafego, nao so a campanha.`);

    // ── ROAS interpretation ──
    sections.push(`
=== ROAS E VENDAS ===

| ROAS | Status | Acao |
|------|--------|------|
| > 3.0 | Excelente | Escalar |
| 2.0-3.0 | Saudavel | Otimizar |
| 1.0-2.0 | Marginal | Avaliar margem |
| < 1.0 | Prejuizo | Acao urgente |
| null | Sem dados | Sem vendas ou evento nao e Purchase |

Se meta.purchases != sales.purchases → sinalize DISCREPANCIA com possiveis causas.`);

    // ── 3-layer diagnostic rules ──
    sections.push(`
=== DIAGNOSTICO EM 3 CAMADAS (parte MAIS VALIOSA) ===

Camada 1 — ORIGEM: CTR, Hook Rate, Frequencia, CPM
Camada 2 — PONTE: connect_rate (LP Views / Link Clicks), discrepancia clique-LP, UTMs
Camada 3 — DESTINO: Load Time, Dwell, Scroll, Bounce

CRUZAMENTO OBRIGATORIO:
- CTR alto + Dwell baixo = Message Mismatch (promessa do ad ≠ pagina)
- CTR alto + Dwell alto + 0 conversao = Oferta/CTA fraco
- CTR baixo + Dwell alto = Criativo fraco, pagina boa → foco no anuncio`);

    // ── Conditional: Creatives HSO ──
    if (hasCreatives) {
      sections.push(`
=== ANALISE DE CRIATIVOS (HSO — Russell Brunson) ===

Para CADA criativo em user_context.creatives, analise:
- HOOK: O gancho para o scroll? Gera curiosidade imediata?
- STORY: Constroi narrativa, empatia, prova social?
- OFFER: CTA clara e irresistivel? Vende o CLIQUE (nao o produto)?
De notas de 1-10 para cada. Forneca REESCRITA COMPLETA de copy para cada criativo.
A IA NAO assiste videos — analise baseada em copy/descricao/metricas.`);
    }

    // ── Conditional: Message Match ──
    if (hasMessageMatch) {
      sections.push(`
=== MESSAGE MATCH (Coerencia Anuncio ↔ Pagina) ===

Compare ad_headline vs lp_headline. Se incongruente (🔴 MISMATCH), OBRIGATORIAMENTE forneca:
1. Nova headline para o anuncio OU para a LP
2. Palavras-chave que devem aparecer em AMBOS
NUNCA sinalize mismatch sem dar a solucao concreta.`);
    }

    // ── Conditional: Landing Page — analista por dobras (direto do mercado BR) ──
    if (hasLPContent) {
      sections.push(`
=== ANALISTA DE LANDING PAGE (AUDITORIA PROFUNDA — OBRIGATORIO) ===

FONTE DOS DADOS (anti-alucinacao):
- Baseie-se APENAS em landing_page.content, landing_page.url, landing_page.content_source e landing_page.content_note do JSON.
- Esse texto veio de GET HTTP no servidor (HTML convertido em texto; limite ~12000 chars). NAO e browser headless completo: conteudo carregado so por JS pode faltar.
- Se content estiver vazio ou content_source indicar falha, diga explicitamente e NAO invente texto ou estrutura da pagina.

METODOLOGIA:
1) Classifique o produto por faixa de PRECO encontrada no texto: Low ate R$197 | Mid R$198-997 | High R$998-4997 | Ultra R$5000+. Se nao achar preco, diga "preco nao identificado no recorte" e trabalhe com hipotese Mid **marcada como fragil**.

2) Principios universais: clareza em ~8s (o que e, para quem, quanto); nivel de consciencia do avatar na headline; densidade de prova proporcional ao ticket; CTA coerente com ticket; sem frases genericas tipo "transforme sua vida" — use resultado especifico.

3) Dobras por nivel (audite cada uma como Presente / Fraco / Ausente / Fora de ordem, com 1 frase cada):
- Low: D1 Hero ate D12 FAQ+CTA final (hero, dor, agitacao, solucao, tangibilizacao, para quem, checklist entregaveis, prova, bonus, oferta, garantia, FAQ).
- Mid: D1-D15 (inclui quebra de crenca, novo mecanismo, autoridade, qualificacao para quem NAO e, urgencia).
- High: D1-D18 (inclui custo de nao agir, jornada de transformacao, modulos, cases longos, empilhamento de valor, garantia detalhada).
- Ultra: carta longa/VSL fluida — historia, problema profundo, autoridade narrativa, mecanismo como visao, prova qualitativa, exclusividade, aplicacao, investimento, CTA alta intencao.

4) Entregue na secao "## Analise da Landing Page" (Markdown):
- **Fonte dos dados** (1 frase citando content_note).
- **Nivel estimado** + justificativa.
- **Tabela ou lista**: cada dobra do nivel com status + observacao.
- **Top 5 gaps** que mais prejudicam conversao.
- **Reescritas e estrutura**: alem de headline/subhead, proponha copy em bullets para secoes fracas (prova, oferta, CTA, garantia, FAQ, urgencia) quando aplicavel.
- Cruze com metricas de comportamento (dwell, scroll, load) do JSON quando fizer sentido.

Tambem integre: Schwartz (consciencia) e PAS onde couber, sem substituir o checklist de dobras.`);
    }

    // ── Conditional: Pareto ──
    if (ads.length > 1) {
      sections.push(`
=== PARETO 80/20 (Perry Marshall) ===

Identifique quais 20% dos anuncios/adsets geram 80% dos resultados.
Identifique quais sao os "sanguessugas" gastando sem converter.
Recomende: CORTAR os perdedores, REALOCAR para os vencedores. Com numeros concretos.`);
    }

    // ── Conditional: Trend ──
    if (hasTrend) {
      sections.push(`
=== TENDENCIA ===

Compare periodo atual vs anterior. Use setas: ↑ (melhora), ↓ (piora), → (estavel, < 5%).
Destaque se CPA esta piorando, CTR caindo (fadiga), ou ROAS deteriorando.`);
    }

    // ── Conditional: User context ──
    if (uc.stated_objective) {
      sections.push(`
=== CONTEXTO DO USUARIO ===

O usuario declarou objetivo: "${uc.stated_objective}". Use como REFERENCIA PRINCIPAL.
Se conflitar com meta.objective, priorize o que o usuario declarou.`);
    }

    // ── Response structure ──
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

    if (hasMetaSpend) {
      sections.push(`
---

## Vendas e ROAS

| Fonte | Compras | Receita | ROAS |
|:---|---:|---:|---:|
| Meta (Pixel/CAPI) | [meta.purchases] | — | — |
| **Banco (real)** | **[sales.purchases]** | **R$[sales.revenue]** | **[sales.roas]x** |

*Comente discrepancia ou ausencia de dados. Se webhook nao configurado, mencione.*`);
    }

    if (ads.length > 0) {
      sections.push(`
---

## Analise de Criativos

### Performance por Anuncio (dados Meta)

| Anuncio | Resultados | Custo | CPA | CTR | Hook Rate | Diagnostico |
|:---|---:|---:|---:|---:|---:|:---|
| [nome] | X | R$X | R$X | X% | X% ou N/A(img) | [Vencedor/Otimizar/Fadiga] |

*Hook Rate: so para VIDEO (video_3s_views > 0). N/A para imagem.*`);
    }

    if (hasCreatives) {
      sections.push(`
### Avaliacao Qualitativa dos Criativos

Para CADA criativo:

#### 🏷️ [ad_name]
**Copy Atual**: [analise critica]
**Estrutura & Hook**: [avaliacao do gancho e CTA]
**Nota de Potencial**: [X/10] — [justificativa]

> **🔥 Sugestao Pronta de Copy (Reescrita)**:
> - **Hook**: [nova frase de impacto]
> - **Corpo**: [reescrita persuasiva]
> - **CTA**: [chamada urgente]

### 🏆 Veredito dos Criativos
[Qual tem melhor estrutura e deve receber mais verba]`);
    }

    if (hasTrend) {
      sections.push(`
---

## Tendencia

| Metrica | Anterior | Atual | Variacao | Tendencia |
|:---|---:|---:|---:|:---:|
| Spend/Results/CPA/CTR/ROAS | — | — | — | ↑/↓/→ |`);
    }

    if (hasTemporalData) {
      sections.push(`
---

## Distribuicao Temporal
- Melhores horarios (top 3) e melhores dias
- Recomendacao de ajuste de orcamento por horario/dia`);
    }

    sections.push(`
---

## Auditoria Tecnica

| Area | Item | Status | Detalhes |
|:---|:---|:---:|:---|
| Rastreamento | UTMs, Macros, Discrepancia, Funil de dados, Vendas Meta vs Banco | OK/Alert | [dados] |
| Comportamento | Load Time, Scroll, Dwell | OK/Alert | [dados] |`);

    if (hasLPContent) {
      sections.push(`
---

## Analise da Landing Page

Estrutura obrigatoria (use subtitulos ## ou ###):
1. **Fonte dos dados** — como o texto foi obtido; limitacoes (JS, truncamento).
2. **Nivel do produto** — faixa de preco e decisao de compra esperada.
3. **Auditoria por dobra** — checklist do nivel (Presente/Fraco/Ausente + 1 frase por dobra).
4. **Gaps criticos** — top 5.
5. **Congruencia anuncio-pagina** — se houver criativos/message_match no JSON.
6. **Comportamento vs pagina** — dwell, scroll, load (dados do JSON).
7. **Otimizacao** — headline, subhead, **e** blocos adicionais (prova, oferta, CTA, garantia, FAQ, urgencia) em formato acionavel.

Nao limite a analise a apenas headline/subheadline.`);
    }

    sections.push(`
---

## Diagnostico de 3 Camadas

### 🔵 Camada 1 — Origem (Meta Ads)
[CTR, Hook Rate, Frequencia, CPM + diagnostico]

### 🟡 Camada 2 — Ponte (Clique → Pagina)
[Taxa LP View, Discrepancia, UTMs + diagnostico]

### 🟢 Camada 3 — Destino (Comportamento)
[Load, Dwell, Scroll, Bounce + diagnostico]

### 🔗 Cruzamento das 3 Camadas
[Analise cruzada: "CTR [X] + Dwell [X] + Conversao [X] = [diagnostico preciso]"]`);

    if (hasMessageMatch) {
      sections.push(`
---

## Message Match
| Criativo | Promessa | Headline LP | Veredicto |
|:---|:---|:---|:---:|
[Para cada criativo + analise de coerencia + solucoes se mismatch]`);
    }

    if ((hasCreatives || hasLPContent) && ads.length > 1) {
      sections.push(`
---

## Analise Avancada: Copy, Frameworks e 80/20
1. **Schwartz** (5 niveis de consciencia)
2. **PAS** (Problem-Agitation-Solution)
3. **Pareto 80/20** (20% que gera 80% + sanguessugas para cortar)`);
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

### ✅ Checklist Final
- [ ] [Acao 1]
- [ ] [Acao 2]
- [ ] [Acao 3]

---
*Diagnostico gerado por Analista IA (Frameworks: PAS, HSO, Pareto, Schwartz) — Meta Ads + CAPI + DB.*`);

    return sections.join('\n');
  }

  private buildFallbackResumoLines(
    snap: Record<string, unknown>,
    m: Record<string, unknown>,
    d: Record<string, unknown>,
    sales: Record<string, unknown>,
    trend: Record<string, unknown> | null,
    skipped: string[]
  ): string[] {
    const L: string[] = [];
    L.push(
      'Relatorio automatico **sem IA**. Configure uma chave OpenAI nas configuracoes da conta para analise completa com LLM.'
    );
    L.push('');
    L.push(
      `**Periodo:** ${this.fmtInt(snap.period_days)} dias | **Objetivo (Meta):** ${String(m.objective || '—')}`
    );
    L.push('');
    if (skipped.length > 0) {
      L.push(
        `> **UTM:** Macros nao resolvidas — filtros ignorados: ${skipped.join(', ')}. Dados de site/CAPI podem incluir trafego alem da campanha filtrada.`
      );
      L.push('');
    }
    const spend = Number(m.spend || 0);
    const results = Number(m.results || 0);
    let s1 = `Nos ultimos **${this.fmtInt(snap.period_days)} dias**, investimento **${this.fmtMoney(m.spend)}**`;
    if (results > 0) {
      s1 += `, **${this.fmtInt(results)}** resultado(s) no evento otimizado e CPA **${this.fmtMoney(m.cost_per_result)}**.`;
    } else if (spend > 0) {
      s1 += ` e **nenhum resultado** no evento otimizado — vale revisar evento, volume e congruencia do funil.`;
    } else {
      s1 += `; **sem gasto** neste recorte.`;
    }
    L.push(s1);
    const purchases = Number(sales.purchases || 0);
    const roas = d.roas != null ? Number(d.roas) : NaN;
    if (purchases > 0 && Number.isFinite(roas)) {
      L.push(
        `Vendas no banco: **${this.fmtInt(purchases)}** compra(s), ROAS real **${this.fmt(roas)}x**.`
      );
    }
    if (trend) {
      const ts = this.asRecord(trend.spend);
      const ch = ts.change_pct;
      if (ch != null && ch !== '') {
        L.push(`Versus periodo anterior: variacao de gasto **${ch}%**.`);
      }
    }
    return L;
  }

  private buildFallbackDiagnosticoPerformance(
    m: Record<string, unknown>,
    d: Record<string, unknown>,
    capi: Record<string, unknown>,
    site: Record<string, unknown>,
    sales: Record<string, unknown>,
    signals: Record<string, unknown>[],
    discPct: number
  ): string[] {
    const L: string[] = [];
    L.push('### Funil resumido');
    L.push('');
    L.push(
      `**Impressoes** ${this.fmtInt(m.impressions)} → **Cliques em link** ${this.fmtInt(m.unique_link_clicks)} → **LP Views (Pixel)** ${this.fmtInt(m.landing_page_views)} → **Resultados (evento otimizado)** ${this.fmtInt(m.results)}.`
    );
    L.push(`**CAPI — Page Views:** ${this.fmtInt(capi.page_views)} (quando rastreado).`);
    L.push('');
    L.push('### Contexto de leilao (CTR / CPM / alcance)');
    L.push('');
    L.push(
      `- **CTR** ${this.fmtPct(d.ctr_calc_pct)} | **CPM** ${this.fmtMoney(d.cpm_calc)} | **Alcance** ${this.fmtInt(m.reach)} contas da Central de Contas`
    );
    L.push(
      '- Referencia ampla mercado BR (nao e regra): CTR ~1–2%, CPM ~R$15–40 — interpretar conforme seu nicho.'
    );
    L.push('');
    if (Number.isFinite(discPct)) {
      const flag = discPct > 40 ? 'critico' : discPct > 25 ? 'atencao' : 'monitorar';
      L.push(`**Discrepancia clique → visitas/LP:** ${discPct.toFixed(1)}% (${flag}).`);
      L.push('');
    }
    L.push('### Sinais pre-calculados');
    L.push('');
    if (signals.length === 0) {
      L.push('- Nenhum sinal extra neste recorte.');
    } else {
      for (const sig of signals) {
        const area = String(sig.area ?? '');
        const signal = String(sig.signal ?? '');
        const evidence = String(sig.evidence ?? '');
        L.push(`- **${area}** — ${signal}${evidence ? `: ${evidence}` : ''}`);
      }
    }
    L.push('');
    L.push('### Comportamento no destino');
    L.push('');
    L.push(
      `- Load: ${site.effective_load_ms != null ? this.fmtMs(site.effective_load_ms) : 'sem dados'} | Scroll: ${site.effective_scroll_pct != null ? this.fmtPct(site.effective_scroll_pct) : 'sem dados'} | Dwell: ${site.effective_dwell_ms != null ? this.fmtMs(site.effective_dwell_ms) : 'sem dados'}.`
    );
    const purchases = Number(sales.purchases || 0);
    if (purchases > 0) {
      L.push(
        `- **Compras (banco):** ${this.fmtInt(purchases)} — comparar com compras atribuidas no Meta quando fizer sentido.`
      );
    }
    return L;
  }

  private buildFallbackPlanoNumerado(
    m: Record<string, unknown>,
    d: Record<string, unknown>,
    sales: Record<string, unknown>,
    site: Record<string, unknown>,
    capi: Record<string, unknown>,
    signals: Record<string, unknown>[],
    discPct: number
  ): string[] {
    const steps: string[] = [];
    const spend = Number(m.spend || 0);
    const ctr = Number(d.ctr_calc_pct);
    const cpm = Number(d.cpm_calc);
    const roas = d.roas != null ? Number(d.roas) : NaN;

    if (Number.isFinite(discPct) && discPct > 25) {
      steps.push(
        'Revisar pixel, URLs de destino e UTMs para reduzir discrepancia entre cliques no anuncio e visitas na landing page.'
      );
    }
    if (spend > 0 && Number.isFinite(ctr) && ctr < 0.5) {
      steps.push(
        'CTR baixo: priorizar testes de criativo (novos angulos) e checar relevancia do publico e posicionamentos.'
      );
    }
    if (spend > 0 && Number.isFinite(cpm) && cpm > 45) {
      steps.push(
        'CPM elevado: avaliar competicao no leilao, segmentacao e rotacao de criativos para refrescar entrega.'
      );
    }
    const loadMs = site.effective_load_ms != null ? Number(site.effective_load_ms) : null;
    if (loadMs != null && loadMs > 3500) {
      steps.push(
        'Otimizar performance da pagina (imagens, LCP, hospedagem) — carregamento lento aumenta abandono.'
      );
    }
    if (spend > 0 && Number.isFinite(roas) && roas < 1) {
      steps.push(
        'ROAS real abaixo de 1x: revisar oferta, margem e alinhamento promessa do anuncio com a pagina antes de escalar verba.'
      );
    }
    if (spend > 0 && Number(m.results || 0) === 0) {
      steps.push(
        'Confirmar no Gerenciador se o evento de conversao otimizado dispara corretamente e se ha volume para aprendizagem.'
      );
    }
    const pv = Number(capi.page_views || 0);
    const lpv = Number(m.landing_page_views || 0);
    if (spend > 0 && pv === 0 && lpv === 0) {
      steps.push(
        'Verificar implementacao de PageView / Landing Page View (Pixel + CAPI) para atribuicao e sinais de qualidade.'
      );
    }

    for (const sig of signals.slice(0, 3)) {
      const area = String(sig.area || '');
      const ev = String(sig.evidence || sig.signal || '');
      if (ev) steps.push(`Agir com base no sinal (${area}): ${ev}`);
    }

    const fillers = [
      'Documentar hipoteses e rodar teste A/B com orcamento limitado em criativo ou segmentacao.',
      'Alinhar primeira dobra da LP com a promessa principal do anuncio (message match).',
      'Agendar revisao semanal dos anuncios com pior CPA e realocar verba para os melhores.',
    ];
    for (const f of fillers) {
      if (steps.length >= 7) break;
      if (!steps.some((s) => s === f)) steps.push(f);
    }

    return steps.slice(0, 7);
  }

  private fallbackReport(snapshot: unknown): string {
    const snap = this.asRecord(snapshot);
    const m = this.asRecord(snap.meta);
    const capi = this.asRecord(snap.capi);
    const site = this.asRecord(snap.site);
    const sales = this.asRecord(snap.sales);
    const d = this.asRecord(snap.derived);
    const signals = Array.isArray(snap.signals) ? (snap.signals as Record<string, unknown>[]) : [];
    const mb = this.asRecord(snap.meta_breakdown);
    const campaigns = Array.isArray(mb.campaigns) ? (mb.campaigns as Record<string, unknown>[]) : [];
    const adsets = Array.isArray(mb.adsets) ? (mb.adsets as Record<string, unknown>[]) : [];
    const ads = Array.isArray(mb.ads) ? (mb.ads as Record<string, unknown>[]) : [];
    const segments = this.asRecord(snap.segments);
    const trend = snap.trend ? this.asRecord(snap.trend as Record<string, unknown>) : null;

    const skipped = Array.isArray(snap.utm_filters_skipped) ? (snap.utm_filters_skipped as string[]) : [];
    const applied = snap.utm_filters_applied;

    const discPct = Number(d.click_to_lp_discrepancy_pct);
    const discStatus = !Number.isFinite(discPct)
      ? '—'
      : discPct > 40
        ? `CRITICO ${discPct.toFixed(1)}%`
        : discPct > 25
          ? `Alerta ${discPct.toFixed(1)}%`
          : `OK ${discPct.toFixed(1)}%`;

    const lines: string[] = [];

    lines.push('## Resumo Executivo');
    lines.push('');
    lines.push(...this.buildFallbackResumoLines(snap, m, d, sales, trend, skipped));
    lines.push('');

    if (applied) {
      lines.push(`> **Filtros UTM aplicados:** ${JSON.stringify(applied)}`);
      lines.push('');
    }

    lines.push('## Diagnostico de Performance');
    lines.push('');
    lines.push(...this.buildFallbackDiagnosticoPerformance(m, d, capi, site, sales, signals, discPct));
    lines.push('');

    lines.push(`## Metricas Principais`);
    lines.push('');
    lines.push(`| Campo | Valor | Descricao |`);
    lines.push(`|---|---:|---|`);
    lines.push(`| **Resultados (evento otimizado)** | **${this.fmtInt(m.results)}** | Metrica principal |`);
    lines.push(`| CPA | ${this.fmtMoney(m.cost_per_result)} | Custo por resultado |`);
    lines.push(`| Investimento | ${this.fmtMoney(m.spend)} | Total gasto |`);
    lines.push(`| Impressoes | ${this.fmtInt(m.impressions)} | |`);
    lines.push(`| Alcance | ${this.fmtInt(m.reach)} | Contas da Central de Contas |`);
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
    lines.push(
      `| Rastreamento | Discrepancia | ${discStatus.split(' ')[0]} | Cliques vs LP Views: ${Number.isFinite(discPct) ? `${discPct.toFixed(1)}%` : 'N/A'} |`
    );
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

    const plano = this.buildFallbackPlanoNumerado(m, d, sales, site, capi, signals, discPct);
    lines.push('## Plano de Acao');
    lines.push('');
    plano.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push('');
    lines.push('---');
    lines.push('*Relatorio basico sem IA. Configure OpenAI nas configuracoes da conta para analise completa.*');

    return lines.join('\n');
  }
}

export const llmService = new LlmService();