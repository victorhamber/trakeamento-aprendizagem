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

  private formatNumber(n: unknown, digits = 2) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  private formatInt(n: unknown) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return String(Math.trunc(v));
  }

  private fallbackReport(snapshot: unknown): string {
    const snap = this.asRecord(snapshot);
    const m = this.asRecord(snap.meta);
    const s = this.asRecord(snap.site);
    const sa = this.asRecord(snap.sales);
    const d = this.asRecord(snap.derived);
    const signals = Array.isArray(snap.signals) ? snap.signals : [];

    const lines: string[] = [];
    lines.push(`# Diagnóstico (modo básico)`);
    lines.push('');
    lines.push(`Período: últimos ${this.formatInt(snap.period_days)} dias`);
    lines.push('');
    lines.push(`## Resumo executivo`);
    lines.push(`- Relatório básico gerado sem IA (chave OpenAI não configurada).`);
    lines.push(`- Para maior precisão, ative a IA e garanta volume de dados (Meta + eventos no site).`);
    lines.push('');

    lines.push(`## Tabela de métricas`);
    lines.push(`| Área | Métrica | Valor |`);
    lines.push(`|---|---:|---:|`);
    lines.push(`| Meta | Valor usado | R$ ${this.formatNumber(m.spend)} |`);
    lines.push(`| Meta | Impressões | ${this.formatInt(m.impressions)} |`);
    lines.push(`| Meta | Cliques | ${this.formatInt(m.clicks)} |`);
    lines.push(`| Meta | CTR | ${this.formatNumber(d.ctr_calc_pct)}% |`);
    lines.push(`| Meta | CPC | R$ ${this.formatNumber(d.cpc_calc)} |`);
    lines.push(`| Meta | CPM | R$ ${this.formatNumber(d.cpm_calc)} |`);
    lines.push(`| Meta | Resultado | ${this.formatInt(d.result_metric)} |`);
    lines.push(`| Meta | Finalização | ${this.formatInt(m.initiates_checkout)} |`);
    lines.push(`| Meta | Compra | ${this.formatInt(m.purchases)} |`);
    lines.push(`| Meta | Connect Rate | ${this.formatNumber(d.connect_rate_pct)}% |`);
    lines.push(`| Site | Landing Page Views | ${this.formatInt(m.landing_page_views)} |`);
    lines.push(`| Site | PageViews | ${this.formatInt(s.pageviews)} |`);
    lines.push(`| Site | Avg load | ${s.avg_load_time_ms != null ? `${this.formatInt(s.avg_load_time_ms)}ms` : '—'} |`);
    lines.push(`| Site | Avg dwell | ${s.avg_dwell_time_ms != null ? `${this.formatInt(s.avg_dwell_time_ms)}ms` : '—'} |`);
    lines.push(`| Site | CTA clicks | ${this.formatInt(s.clicks_cta)} |`);
    lines.push(`| Conversão | Purchases (interno) | ${this.formatInt(sa.purchases)} |`);
    lines.push(`| Conversão | Revenue (interno) | R$ ${this.formatNumber(sa.revenue)} |`);
    lines.push('');

    lines.push(`## Principais sinais`);
    if (!signals.length) {
      lines.push(`- Sem sinais suficientes. Falta volume de dados (Meta e/ou eventos no site).`);
    } else {
      for (const sig of signals.slice(0, 6)) {
        lines.push(`- ${sig.area}: ${sig.signal} (conf ${this.formatNumber(sig.weight, 2)}) — ${sig.evidence}`);
      }
    }
    lines.push('');

    lines.push(`## Próximas ações (rápidas)`);
    lines.push(`1) Confirmar dados do Meta (meta_insights_daily) e janela de ${this.formatInt(snap.period_days)} dias.`);
    lines.push(`2) Validar PageView + PageEngagement chegando (web_events) e sem duplicação por cache/script.`);
    lines.push(`3) Se tiver cliques e LPV baixo, revisar destino do anúncio, velocidade e consistência de promessa.`);
    lines.push('');

    return lines.join('\n');
  }

  public async generateAnalysisForSite(siteKey: string, snapshot: unknown): Promise<string> {
    const cfg = await this.getKeyForSite(siteKey);
    const apiKey = cfg?.apiKey || process.env.OPENAI_API_KEY || '';
    const model = cfg?.model || 'gpt-4o';
    if (!apiKey) return this.fallbackReport(snapshot);

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                `Você é um analista sênior de Meta Ads + CRO + Tracking.` +
                `\n\nObjetivo: identificar POR QUE o anúncio não tem resultados e apontar o gargalo mais provável (criativo, público, página, promessa, oferta/produto, checkout, tracking).` +
                `\n\nRegras:` +
                `\n- Use somente os dados fornecidos; não invente números.` +
                `\n- Quando faltar dado, declare explicitamente o que falta e como coletar.` +
                `\n- Pense como um funil: Entrega -> Clique -> Landing -> Engajamento -> CTA -> Conversão.` +
                `\n- Priorize evidências quantitativas e dê um nível de confiança (0–100%).` +
                `\n- Evite parágrafos longos: prefira bullets curtos e deixe uma linha em branco entre blocos.` +
                `\n\nFormato obrigatório (Markdown, com títulos e espaçamento):` +
                `\n# Diagnóstico` +
                `\n## 1) Resumo executivo` +
                `\n- 4–7 bullets, linguagem simples para leigos, sem jargão excessivo.` +
                `\n## 2) Tabela de métricas (Meta + Site + Conversão)` +
                `\n- Use uma tabela Markdown com colunas: Área | Métrica | Valor | Observação` +
                `\n## 3) Onde está travando (leitura do funil)` +
                `\n- Quebra por etapas: Entrega, Clique, Landing, Engajamento, CTA, Compra.` +
                `\n- Para cada etapa: evidência + impacto + confiança.` +
                `\n## 4) Hipóteses alternativas` +
                `\n- 2–4 hipóteses + como refutar com teste prático.` +
                `\n## 5) Plano de ação` +
                `\n- Até 10 ações em bullets com prioridade: Alta/Média/Baixa.` +
                `\n## 6) Checklist de tracking` +
                `\n- Liste eventos esperados e o que validar (dedupe, URL, parâmetros, pixel, CAPI).` +
                `\n\nBenchmarks: cite faixas típicas (quando aplicável), mas deixe claro que variam por nicho/país/objetivo.` +
                `\n\nImportante: preserve legibilidade. Se algo ficar incerto, diga exatamente que dado falta.`
            },
            {
              role: 'user',
              content: `Dados estruturados (JSON):\n${JSON.stringify(snapshot)}`
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices[0].message.content;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error('LLM Error:', error.response?.data || error.message);
      } else if (error instanceof Error) {
        console.error('LLM Error:', error.message);
      } else {
        console.error('LLM Error:', error);
      }
      return this.fallbackReport(snapshot);
    }
  }
}

export const llmService = new LlmService();
