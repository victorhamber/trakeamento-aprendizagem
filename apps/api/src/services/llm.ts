import axios from 'axios';
import { pool } from '../db/pool';
import { decryptString } from '../lib/crypto';

export class LlmService {
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

  private formatNumber(n: any, digits = 2) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(digits);
  }

  private formatInt(n: any) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return String(Math.trunc(v));
  }

  private fallbackReport(snapshot: any): string {
    const m = snapshot?.meta || {};
    const s = snapshot?.site || {};
    const sa = snapshot?.sales || {};
    const d = snapshot?.derived || {};
    const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];

    const lines: string[] = [];
    lines.push(`# Diagnóstico (modo básico)`);
    lines.push('');
    lines.push(`Período: últimos ${this.formatInt(snapshot?.period_days)} dias`);
    lines.push('');
    lines.push(`## Métricas principais`);
    lines.push(`- Spend: R$ ${this.formatNumber(m.spend)}`);
    lines.push(`- Impressions: ${this.formatInt(m.impressions)}`);
    lines.push(`- Clicks: ${this.formatInt(m.clicks)}`);
    lines.push(`- CTR (calc): ${this.formatNumber(d.ctr_calc_pct)}%`);
    lines.push(`- CPM (calc): R$ ${this.formatNumber(d.cpm_calc)}`);
    lines.push(`- CPC (calc): R$ ${this.formatNumber(d.cpc_calc)}`);
    lines.push(`- Landing Page Views: ${this.formatInt(m.landing_page_views)}`);
    lines.push(`- Click → LP: ${this.formatNumber(d.click_to_lp_rate_pct)}%`);
    lines.push(`- PageViews: ${this.formatInt(s.pageviews)}`);
    lines.push(`- Avg load: ${s.avg_load_time_ms != null ? `${this.formatInt(s.avg_load_time_ms)}ms` : '—'}`);
    lines.push(`- Avg dwell: ${s.avg_dwell_time_ms != null ? `${this.formatInt(s.avg_dwell_time_ms)}ms` : '—'}`);
    lines.push(`- CTA clicks: ${this.formatInt(s.clicks_cta)}`);
    lines.push(`- Purchases (interno): ${this.formatInt(sa.purchases)}`);
    lines.push(`- Revenue (interno): R$ ${this.formatNumber(sa.revenue)}`);
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

    lines.push(`## Próximos passos (ação rápida)`);
    lines.push(`1. Rodar sync de métricas do Meta (ads) e confirmar que há dados em meta_insights_daily.`);
    lines.push(`2. Instalar/atualizar o snippet no site e validar PageView + PageEngagement chegando.`);
    lines.push(`3. Se tiver cliques e 0 LPV, revisar velocidade, destino do anúncio e consistência de promessa.`);
    lines.push('');

    return lines.join('\n');
  }

  public async generateAnalysisForSite(siteKey: string, snapshot: any): Promise<string> {
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
                `\n\nFormato de saída (Markdown):` +
                `\n1) Resumo executivo (3–6 bullets)` +
                `\n2) Tabela de métricas (Meta + Site + Conversão)` +
                `\n3) Diagnóstico do gargalo (com evidências)` +
                `\n4) Hipóteses alternativas (2–4) + como refutar (teste/experimento)` +
                `\n5) Plano de ação (até 10 ações) com prioridade: Alta/Média/Baixa` +
                `\n6) Checklist de tracking (eventos e consistência)` +
                `\n\nBenchmarks: use faixas típicas como referência, mas deixe claro que variam por nicho/país/objetivo.`
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
    } catch (error: any) {
      console.error('LLM Error:', error.response?.data || error.message);
      return this.fallbackReport(snapshot);
    }
  }
}

export const llmService = new LlmService();
