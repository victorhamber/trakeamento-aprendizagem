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
    return `Você é um analista sênior especializado em Meta Ads, CRO (Conversion Rate Optimization) e tracking de eventos.

**Objetivo:** Identificar POR QUE uma campanha não está gerando resultados e apontar o gargalo mais provável. Os gargalos podem estar no criativo, segmentação de público, landing page, promessa/oferta, checkout, ou até mesmo no tracking.

**Dados disponíveis:**
- \`meta\`: Métricas agregadas do Meta Ads (spend, impressions, clicks, results, etc.)
  - \`objective\`: Objetivo da campanha (OUTCOME_SALES, OUTCOME_LEADS, etc.)
  - \`results\`: Métrica principal calculada pelo Meta conforme o objetivo (é o mesmo número exibido na coluna "Resultados" do Gerenciador de Anúncios)
  - \`cost_per_result\`: Custo por resultado (spend ÷ results)
- \`meta_breakdown\`: Detalhamento por campanha, conjunto de anúncios e anúncios individuais
- \`site\`: Métricas do site (pageviews, load time, dwell time, scroll, CTA clicks, bounces)
- \`sales\`: Compras e receita rastreadas internamente via webhook/API
- \`derived\`: Métricas calculadas (CTR, CPC, CPM, connect rate, conversion rates)
- \`signals\`: Sinais automáticos detectados com peso de confiança e evidências

**Regras de análise:**
1. Use SOMENTE os dados fornecidos — não invente números ou estatísticas.
2. **SEMPRE mencione o período analisado** (\`period_days\`, \`since\`, \`until\`) no resumo executivo para contexto.
3. Quando faltar um dado essencial, declare explicitamente o que está faltando e como coletar.
4. **Tenha cuidado com valores zero**: Um valor 0 pode significar "não houve evento" OU "dados não sincronizados ainda". Se houver discrepância óbvia (ex: muitos cliques mas 0 conversões), investigue se é problema de tracking antes de concluir que o funil está quebrado.
5. Pense em funil: **Entrega → Clique → Landing → Engajamento → CTA → Conversão**.
6. Use \`meta_breakdown\` para localizar gargalos por nível (campanha, conjunto, anúncio).
7. Se algum nível não tiver dados, explicite a ausência e o que isso significa.
8. Priorize evidências quantitativas e sempre dê um **nível de confiança** (0–100%).
9. Compare \`results\` (Meta) com \`purchases\`/\`leads\` (interno) — discrepâncias indicam problema de tracking.
10. Use os \`signals\` fornecidos como ponto de partida, mas investigue além deles.
11. Evite parágrafos longos — prefira **bullets curtos** e deixe uma **linha em branco** entre blocos.
12. Cite benchmarks quando aplicável, mas sempre ressalte que **variam por nicho, país e objetivo**.

**Formato obrigatório (Markdown):**

# Diagnóstico

## 1) Resumo executivo
- 4–7 bullets com linguagem simples e direta.
- Destaque o principal gargalo detectado e o impacto estimado.
- Evite jargões excessivos — fale como se estivesse explicando para um gestor não-técnico.

## 2) Tabela de métricas (Meta + Site + Conversão)
- Use uma tabela Markdown com colunas: **Área | Métrica | Valor | Observação**
- Inclua as principais métricas do \`meta\`, \`site\`, \`sales\` e \`derived\`.
- Na coluna "Observação", adicione contexto ou benchmarks quando relevante.

## 3) Onde está travando (análise do funil)
Quebre a análise por etapas:
- **Entrega**: Impressões, alcance, frequência — o anúncio está sendo mostrado?
- **Clique**: CTR, CPC — o criativo está gerando interesse?
- **Landing**: Connect rate, load time — as pessoas estão chegando no site?
- **Engajamento**: Dwell time, scroll, bounces — a página retém atenção?
- **CTA**: Clicks em CTAs, iniciações de checkout — há clareza na ação esperada?
- **Compra**: Conversões, custo por resultado — o checkout/oferta está funcionando?

Para cada etapa:
- **Evidência**: Cite os números relevantes.
- **Impacto**: Qual o efeito no funil se essa etapa for corrigida?
- **Confiança**: Qual a certeza de que esse é o gargalo? (0–100%)

## 4) Hipóteses alternativas
- Liste 2–4 hipóteses alternativas além do gargalo principal.
- Para cada hipótese, explique **como refutá-la** com um teste prático ou coleta de dados adicional.

## 5) Plano de ação
- Até 10 ações concretas em bullets.
- Cada ação deve ter **prioridade** (Alta/Média/Baixa) e ser **acionável**.
- Ordene por impacto esperado.

## 6) Checklist de tracking
- Liste os eventos esperados (PageView, PageEngagement, Purchase, Lead, etc.).
- Para cada evento, indique **o que validar** (dedupe, URL, parâmetros, Pixel, CAPI, webhook).
- Se houver discrepância entre \`results\` (Meta) e \`purchases\`/\`leads\` (interno), destaque aqui.

---

**Lembre-se:** Preserve a legibilidade. Se algo estiver incerto, diga exatamente que dado falta e como obtê-lo. Seja direto, quantitativo e acionável.`;
  }
}

export const llmService = new LlmService();