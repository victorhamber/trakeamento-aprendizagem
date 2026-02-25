import axios from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

export class LlmService {
  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private async getKeyForSite(siteKey: string) {
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
      model: (row.openai_model as string) || 'gpt-4o',
    };
  }

  private formatNumber(n: unknown, digits = 2): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  private formatInt(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return String(Math.trunc(v));
  }

  private formatMoney(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return `R$ ${v.toFixed(2)}`;
  }

  /**
   * Fallback report when OpenAI key is not configured or LLM call fails.
   * Provides basic diagnostic information in structured Markdown.
   */
  private fallbackReport(snapshot: unknown): string {
    const snap = this.asRecord(snapshot);
    const m = this.asRecord(snap.meta);
    const s = this.asRecord(snap.site);
    const sa = this.asRecord(snap.sales);
    const d = this.asRecord(snap.derived);
    const signals = Array.isArray(snap.signals) ? snap.signals : [];
    const mb = this.asRecord(snap.meta_breakdown);
    const campaigns = Array.isArray(mb.campaigns) ? mb.campaigns : [];
    const adsets = Array.isArray(mb.adsets) ? mb.adsets : [];
    const ads = Array.isArray(mb.ads) ? mb.ads : [];

    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────────
    lines.push(`# Diagnóstico (modo básico)`);
    lines.push('');
    lines.push(`**Período:** ${this.formatInt(snap.period_days)} dias`);
    lines.push('');

    // ── Executive summary ──────────────────────────────────────────────────────
    lines.push(`## 1) Resumo executivo`);
    lines.push('');
    lines.push(
      `- Este relatório foi gerado sem IA (chave OpenAI não configurada na conta).`
    );
    lines.push(
      `- Para análise detalhada com hipóteses e recomendações personalizadas, configure uma chave OpenAI válida.`
    );
    lines.push(
      `- Os dados abaixo representam métricas agregadas do período — use-os como ponto de partida para investigação manual.`
    );
    lines.push('');

    // ── Metrics table ──────────────────────────────────────────────────────────
    lines.push(`## 2) Tabela de métricas`);
    lines.push('');
    lines.push(`| Área | Métrica | Valor | Observação |`);
    lines.push(`|---|---|---:|---|`);

    // Meta metrics
    lines.push(
      `| Meta | Objetivo da campanha | ${m.objective || '—'} | Tipo de resultado otimizado |`
    );
    lines.push(
      `| Meta | Resultados (Meta) | ${this.formatInt(m.results)} | Métrica principal conforme objetivo |`
    );
    lines.push(
      `| Meta | Custo por resultado | ${m.cost_per_result != null ? this.formatMoney(m.cost_per_result) : '—'} | Spend ÷ Resultados |`
    );
    lines.push(
      `| Meta | Valor investido | ${this.formatMoney(m.spend)} | Total gasto no período |`
    );
    lines.push(
      `| Meta | Impressões | ${this.formatInt(m.impressions)} | Alcance de anúncios |`
    );
    lines.push(`| Meta | Cliques | ${this.formatInt(m.clicks)} | Total de cliques |`);
    lines.push(
      `| Meta | CTR | ${this.formatNumber(d.ctr_calc_pct)}% | Taxa de cliques sobre impressões |`
    );
    lines.push(
      `| Meta | CPC | ${this.formatMoney(d.cpc_calc)} | Custo médio por clique |`
    );
    lines.push(
      `| Meta | CPM | ${this.formatMoney(d.cpm_calc)} | Custo por mil impressões |`
    );
    lines.push(
      `| Meta | Connect Rate | ${this.formatNumber(d.connect_rate_pct)}% | Cliques que viraram landing page views |`
    );
    lines.push(
      `| Meta | Landing Page Views | ${this.formatInt(m.landing_page_views)} | Pessoas que chegaram no site |`
    );
    lines.push(
      `| Meta | Leads | ${this.formatInt(m.leads)} | Leads registrados (Meta) |`
    );
    lines.push(
      `| Meta | Contatos | ${this.formatInt(m.contacts)} | Contatos iniciados (Meta) |`
    );
    lines.push(
      `| Meta | Iniciar finalização | ${this.formatInt(m.initiates_checkout)} | Checkouts iniciados (Meta) |`
    );
    lines.push(
      `| Meta | Compras (Meta) | ${this.formatInt(m.purchases)} | Compras rastreadas pelo Pixel |`
    );

    // Site metrics
    lines.push('');
    lines.push(
      `| Site | Page Views | ${this.formatInt(s.pageviews)} | Total de páginas vistas (tracking interno) |`
    );
    lines.push(
      `| Site | Tempo médio de carregamento | ${s.avg_load_time_ms != null ? `${this.formatInt(s.avg_load_time_ms)}ms` : '—'} | Velocidade de carregamento |`
    );
    lines.push(
      `| Site | Tempo médio na página | ${s.avg_dwell_time_ms != null ? `${this.formatInt(s.avg_dwell_time_ms)}ms` : '—'} | Engajamento médio |`
    );
    lines.push(
      `| Site | Scroll médio | ${s.avg_max_scroll_pct != null ? `${this.formatInt(s.avg_max_scroll_pct)}%` : '—'} | Profundidade de rolagem |`
    );
    lines.push(
      `| Site | Cliques em CTAs | ${this.formatInt(s.clicks_cta)} | Cliques em botões de ação |`
    );
    lines.push(
      `| Site | Bounces estimados | ${this.formatInt(s.bounces_est)} | Visitas com <5s e <10% scroll |`
    );

    // Conversion metrics
    lines.push('');
    lines.push(
      `| Conversão | Compras (interno) | ${this.formatInt(sa.purchases)} | Compras rastreadas via webhook/API |`
    );
    lines.push(
      `| Conversão | Receita (interno) | ${this.formatMoney(sa.revenue)} | Receita total rastreada |`
    );
    lines.push(
      `| Conversão | Taxa LPV → Compra | ${this.formatNumber(d.lp_to_purchase_rate_pct)}% | Conversão de LPV para venda |`
    );
    lines.push(
      `| Conversão | Taxa PV → Compra | ${this.formatNumber(d.pv_to_purchase_rate_pct)}% | Conversão de page view para venda |`
    );
    lines.push('');

    // ── Breakdown table ────────────────────────────────────────────────────────
    if (campaigns.length || adsets.length || ads.length) {
      lines.push(`## 3) Breakdown por nível (Meta Ads)`);
      lines.push('');
      lines.push(
        `| Nível | Nome | Objetivo | Resultados | Spend | Impressões | Cliques | LPV | Leads | Compras | Custo/Res. |`
      );
      lines.push(
        `|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`
      );

      const renderRows = (level: string, rows: unknown[]) => {
        for (const row of rows.slice(0, 5)) {
          const r = this.asRecord(row);
          const costPerResult =
            r.cost_per_result != null ? this.formatMoney(r.cost_per_result) : '—';
          lines.push(
            `| ${level} | ${String(r.name || '—')} | ${String(r.objective || '—')} | ${this.formatInt(r.results)} | ${this.formatMoney(r.spend)} | ${this.formatInt(r.impressions)} | ${this.formatInt(r.clicks)} | ${this.formatInt(r.landing_page_views)} | ${this.formatInt(r.leads)} | ${this.formatInt(r.purchases)} | ${costPerResult} |`
          );
        }
      };

      renderRows('Campanha', campaigns);
      renderRows('Conjunto', adsets);
      renderRows('Anúncio', ads);
      lines.push('');
    }

    // ── Signals ────────────────────────────────────────────────────────────────
    lines.push(`## 4) Principais sinais detectados`);
    lines.push('');
    if (!signals.length) {
      lines.push(
        `- **Sem sinais suficientes.** Volume de dados insuficiente (Meta e/ou eventos no site).`
      );
      lines.push(
        `- Aguarde mais dados ou verifique a integração do Pixel + CAPI + tracking de eventos.`
      );
    } else {
      for (const sig of signals.slice(0, 6)) {
        const s = this.asRecord(sig);
        lines.push(
          `- **${String(s.area)}**: ${String(s.signal)} (confiança: ${this.formatNumber(s.weight, 2)})`
        );
        lines.push(`  - ${String(s.evidence)}`);
      }
    }
    lines.push('');

    // ── Quick actions ──────────────────────────────────────────────────────────
    lines.push(`## 5) Próximas ações (diagnóstico manual)`);
    lines.push('');
    lines.push(
      `1. **Validar dados do Meta**: Confirme que a tabela \`meta_insights_daily\` tem registros para os últimos ${this.formatInt(snap.period_days)} dias.`
    );
    lines.push(
      `2. **Verificar tracking de eventos**: Valide que \`PageView\` e \`PageEngagement\` estão chegando na tabela \`web_events\` sem duplicação.`
    );
    lines.push(
      `3. **Analisar connect rate**: Se CTR está ok mas Connect Rate está baixo (<70%), investigue destino do anúncio, velocidade do site e consistência da promessa.`
    );
    lines.push(
      `4. **Revisar resultados por objetivo**: Compare o campo \`results\` com \`purchases\`/\`leads\`/\`contacts\` para detectar discrepâncias de tracking.`
    );
    lines.push(
      `5. **Configurar OpenAI**: Para análise completa com hipóteses e recomendações personalizadas, configure uma chave de API OpenAI nas configurações da conta.`
    );
    lines.push('');

    // ── Footer note ────────────────────────────────────────────────────────────
    lines.push(`---`);
    lines.push('');
    lines.push(
      `_Este relatório básico contém apenas os dados estruturados. Para análise aprofundada com diagnóstico de gargalos, hipóteses alternativas e plano de ação priorizado, ative o diagnóstico via IA configurando uma chave OpenAI._`
    );
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate AI-powered analysis of campaign/site performance using OpenAI.
   * Falls back to basic report if API key is not configured or call fails.
   */
  public async generateAnalysisForSite(
    siteKey: string,
    snapshot: unknown
  ): Promise<string> {
    const cfg = await this.getKeyForSite(siteKey);
    const apiKey = cfg?.apiKey || process.env.OPENAI_API_KEY || '';
    const model = cfg?.model || 'gpt-4o';

    if (!apiKey) {
      console.warn('[LlmService] No OpenAI key configured — returning fallback report');
      return this.fallbackReport(snapshot);
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: this.buildSystemPrompt(),
            },
            {
              role: 'user',
              content: `Dados estruturados do período (JSON):\n\n${JSON.stringify(snapshot, null, 2)}`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60_000, // 60s timeout
        }
      );

      const analysis = response.data.choices[0]?.message?.content;
      if (!analysis || typeof analysis !== 'string') {
        throw new Error('Invalid response from OpenAI API');
      }

      return analysis;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          '[LlmService] OpenAI API error:',
          error.response?.data || error.message
        );
      } else if (error instanceof Error) {
        console.error('[LlmService] Error:', error.message);
      } else {
        console.error('[LlmService] Unknown error:', error);
      }
      return this.fallbackReport(snapshot);
    }
  }

  /**
   * Build the system prompt for the LLM with detailed instructions and structure.
   */
  private buildSystemPrompt(): string {
    return `🤖 AGENTE ANALISTA DE PERFORMANCE — META ADS + GA4 + CRO

PAPEL (ROLE)
Você é um Analista de Tráfego Sênior e Cientista de Dados, especializado em Meta Ads, GA4, Pixel da Meta e CRO (Conversion Rate Optimization). Você raciocina como um gestor de tráfego experiente, não como um assistente genérico.
Sua missão: Receber dados multicanal e diagnosticar com precisão cirúrgica por que uma campanha está ou não gerando resultados — apontando o gargalo exato e o plano de ação mais inteligente.

CONTEXTO DOS DADOS (INPUTS ESPERADOS)
A cada requisição, você receberá um JSON estruturado com os seguintes blocos:
- \`meta\`: Métricas agregadas do Meta Ads: Investimento, Impressões, Alcance, CPM, CTR (Link), CPC, Frequência — em nível de Campanha, Conjunto e Anúncio
- \`meta_breakdown\`: Detalhamento por campanha, conjunto de anúncios e anúncios individuais
- \`site\`: Métricas do site: Pageviews (LP VIEWS), Dwell Time, comportamento de scroll e interação com CTA.
  - \`capi\`: Dados precisos do servidor (Web Events):
    - \`page_views\`: Total de visualizações reais rastreadas.
    - \`leads\`: Total de leads rastreados pelo servidor (use este número como verdade absoluta se houver dúvida).
    - \`avg_load_time_ms\`: Tempo médio de carregamento (acima de 3000ms é crítico).
    - \`deep_scroll_count\`: Pessoas que rolaram mais de 50% da página.
    - \`avg_dwell_time_ms\`: Tempo médio de permanência.
- \`derived\`: Métricas calculadas (CTR, CPC, CPM, connect rate, conversion rates)
- \`signals\`: Sinais automáticos detectados (anomalias, alertas, padrões)
- \`landing_page\`: URL e conteúdo textual extraído da página de destino (se disponível)
- \`segments\`: Distribuição de tráfego por hora (\`hourly\`) e dia da semana (\`day_of_week\`). Use isso para identificar padrões temporais (ex: anúncios rodam melhor de manhã?).

REGRAS DE ANÁLISE (RACIOCÍNIO OBRIGATÓRIO)
Regra 0 — Integridade dos Dados: Use SOMENTE os dados fornecidos. Nunca invente números, médias de mercado ou benchmarks não solicitados. Se um dado estiver ausente, declare explicitamente: "Dado não disponível — análise parcial."
Regra sobre Zeros: Um valor 0 pode significar "não houve evento" OU "erro de tracking". Sempre investigue antes de concluir. Zeros em Purchase/Lead com CTR alto são sinal de alerta de tracking quebrado, não necessariamente de funil frio.

Passo 1 — Quebra de Funil no Topo (Discrepância Meta x Site): Compare Cliques no Link (Meta) com PageViews/Sessões (Site). Quebra acima de 20–30% indica problema de velocidade de carregamento, cliques acidentais ou pixel mal instalado. Esta é a primeira suspeita antes de qualquer outra conclusão.
Passo 2 — Nível de Anúncio (Atração): Avalie CPM e CTR. O criativo está chamando atenção? O CPC está dentro da meta? Alto CTR com baixa conversão = desalinhamento entre promessa do anúncio e landing page. Identifique qual anúncio é o vencedor e qual é o ofensor.
Passo 3 — Nível de Conjunto (Público e Saturação): Avalie Frequência e CPA. Frequência alta + CPA crescente = público saturado. Cruce com o Dwell Time do site para confirmar se o público específico tem interesse real na página, ou apenas está vendo o anúncio por inércia do algoritmo.
Passo 4 — Landing Page (Retenção e Conversão): Cruce a promessa do anúncio com Tempo na Página e Eventos de fundo de funil (Clicks CTA, Compras). Tráfego chegando com bom CTR mas sem avanço para CTA = falha de landing page (oferta fraca, fricção de layout, velocidade, coerência visual). Compare results (Meta) com purchases (banco interno) — discrepâncias diretas indicam problema de tracking.
Passo 5 — Nível de Campanha (Macro): O ROAS geral faz sentido com o investimento total? A distribuição de verba está eficiente entre os conjuntos? Há conjunto sugando verba sem retorno enquanto outro vence?

REGRAS CRÍTICAS DE ANÁLISE (OBRIGATÓRIO):
1. **OBJETIVO É REI**: O campo \`objective\` define o sucesso.
   - Se o objetivo for "CADASTRO_GRUPO" (Leads), o sucesso é medido por \`results\` (quantidade) e \`cost_per_result\` (CPA).
   - Ignorar "Compras" zeradas se o objetivo não for vendas.
   - Se houver 22 resultados de "Cadastro_Grupo", a campanha ESTÁ convertendo. NÃO diga que "não converte".

2. **DADOS DE SITE (USE O CAPI)**:
   - Use \`capi.page_views\` para saber quantas pessoas realmente chegaram.
   - Use \`capi.avg_load_time_ms\` para diagnosticar lentidão.
   - Use \`capi.deep_scroll_count\` para medir interesse real no conteúdo.

3. **ANÁLISE PROFUNDA (SEM GENERICIDADES)**:
   - Use os dados detalhados do `meta_breakdown`.
   - Qual anúncio trouxe mais dos 22 cadastros? Qual teve o menor custo por cadastro?
   - Compare o CTR dos anúncios: se o Anúncio A tem CTR 2% e o B tem 1%, o A é 100% melhor na atração. Diga isso.
   - Use a Landing Page: Se o conteúdo da página fala de "Teste Grátis" e o anúncio fala de "Compre Agora", aponte a desconexão específica.
   - **Use os Segmentos**: Analise \`segments.hourly\` e \`segments.day_of_week\`. Se o tráfego morre às 18h ou explode no domingo, sugira dayparting.

3. **SEM "TALVEZ" ou "PODE SER"**:
   - Baseado nos dados, afirme o que está acontecendo.
   - Exemplo RUIM: "Talvez a landing page não esteja convertendo."
   - Exemplo BOM: "A Landing Page recebeu 100 visitas e gerou apenas 1 cadastro (1% conv). Isso é muito abaixo do mercado (5-10%). O problema É a oferta ou o formulário na página."

4. **USE OS NÚMEROS**:
   - Sempre cite os valores exatos ao fazer uma afirmação. "O CPA está alto (R$15,00) comparado à média da conta."

ESTRUTURA DE SAÍDA OBRIGATÓRIA (OUTPUT EM MARKDOWN)

## 📊 1. DIAGNÓSTICO GERAL DA CAMPANHA
- **Status:** [Excelente / Razoável / Crítico]
- **Resumo:** (2 linhas sobre o impacto real nos resultados via Site/Banco de Dados)
- **Ação Recomendada:** [Escalar / Manter / Otimizar / Pausar + justificativa]

---

## 📋 2. TABELA DE MÉTRICAS (META x SITE x BANCO)
| Métrica | Meta Ads | Site / Tracking | Banco Interno | Discrepância |
|---|---|---|---|---|
| Cliques / Visitas | (cliques meta) | (pageviews) | — | (dif %) |
| Conversões | (results meta) | (tracking evts) | (purchases db) | (dif %) |
| CPA | (cost per res) | — | — | — |
| ROAS | (roas meta) | — | (roas real) | — |

---

## 🔍 3. ANÁLISE DO FUNIL
- **Entrega (CPM/Alcance):** [ok / problema]
- **Clique (CTR/CPC):** [ok / problema]
- **Landing (Tempo/Rejeição):** [ok / problema]
- **Engajamento (Scroll/CTA):** [ok / problema]
- **Conversão (Checkout/Lead):** [ok / problema]
→ **Gargalo identificado:** [onde exatamente o funil está quebrando]

---

## 🧩 4. AVALIAÇÃO DOS CONJUNTOS DE ANÚNCIOS
- **Conjunto A:** [Veredito + justificativa cruzando público vs. comportamento no site]
- **Conjunto B:** [Veredito + justificativa]
(Se houver muitos, resuma os principais)

---

## 🎯 5. AVALIAÇÃO DOS ANÚNCIOS
- **Vencedores:** [Quais, por que funcionam, o que o banco confirma]
- **Ofensores:** [Quais gastam sem retorno, onde está o gargalo — clique ou página]

---

## 🖥️ 6. DIAGNÓSTICO DA PÁGINA DE DESTINO
- Alinhamento criativo x promessa: [ok / problema] (baseado na análise do conteúdo textual se disponível)
- Gargalos detectados via Site: [descrever basedo em dwell time/scroll]
- Sugestão prática: [ação específica]

---

## ⚠️ 7. HIPÓTESES ALTERNATIVAS
(O que mais poderia explicar os resultados além do gargalo principal?)

---

## ✅ 8. PLANO DE AÇÃO PRIORITÁRIO
1. [Ação imediata — hoje]
2. [Ação de curto prazo — essa semana]
3. [Ação estratégica — próximo ciclo]`;
  }
}

export const llmService = new LlmService();