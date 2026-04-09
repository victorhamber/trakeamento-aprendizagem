import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { ReportWizard } from './ReportWizard';

export type FunnelCampaignOption = { id: string; name: string; is_active?: boolean };

type FunnelRow = {
  id: string;
  name: string;
  objective_metric?: number;
  objective_metric_label?: string;
  spend: number;
  meta_revenue?: number;
  meta_roas?: number;
  funnel: {
    link_clicks: number;
    landing_page_views: number;
    objective_metric?: number;
    adds_to_cart: number;
    initiates_checkout: number;
    purchases: number;
    impressions: number;
  };
  funnel_rates: {
    lp_from_clicks_pct: number;
    checkout_from_lp_pct: number;
    purchase_from_checkout_pct: number;
  };
  bottleneck: { from: string; to: string; drop_pct: number; severity: string } | null;
  bottleneck_plain?: string;
  present: 'strong' | 'ok' | 'weak' | 'idle';
  present_label: string;
  future: 'promising' | 'uncertain' | 'limited';
  future_label: string;
  adset_name?: string | null;
  first_party_page?: string | null;
};

type Props = {
  siteId: number;
  siteKey: string;
  campaigns: FunnelCampaignOption[];
  hasMetaConnection: boolean;
  hasAdAccount: boolean;
  metricsPreset: string;
  metricsSince: string;
  metricsUntil: string;
  periodSelector: React.ReactNode;
  selectClsCompact: string;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);

const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value);

type DiagnosisReport = {
  analysis_text?: string;
  context?: Record<string, unknown>;
} & Record<string, unknown>;

const chatMarkdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 space-y-1 my-2 text-[13px] leading-relaxed">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 space-y-1 my-2 text-[13px] leading-relaxed">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="text-[13px] leading-relaxed">{children}</li>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="text-[12px] px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100">
      {children}
    </code>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-500"
    >
      {children}
    </a>
  ),
};

function splitMarkdownH2Sections(text: string): Array<{ title: string; body: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\n##\s+/);
  const sections: Array<{ title: string; body: string }> = [];
  const hasLeading = !trimmed.startsWith('## ') && parts[0]?.trim();
  if (hasLeading) {
    sections.push({ title: 'Resumo executivo', body: parts[0].trim() });
  }
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]?.trim();
    if (!part) continue;
    const lines = part.split('\n');
    const title = lines[0]?.trim() || 'Seção';
    const body = lines.slice(1).join('\n').trim();
    sections.push({ title, body });
  }
  if (!sections.length) {
    sections.push({ title: 'Conteúdo', body: trimmed });
  }
  return sections;
}

const reportMarkdownComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 my-4">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-zinc-50 dark:bg-zinc-900/60">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="text-xs text-zinc-600 dark:text-zinc-400 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
      {children}
    </td>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-8 mb-4 flex items-center gap-2">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-6 mb-3 bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-md inline-flex items-center gap-2">
      {children}
    </h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3 leading-relaxed">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{children}</strong>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-amber-500/50 bg-gradient-to-r from-amber-500/10 to-transparent rounded-r-lg px-4 py-3 my-5 text-zinc-700 dark:text-zinc-300 not-italic">
      {children}
    </blockquote>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-none space-y-2 my-3 text-zinc-600 dark:text-zinc-400">{children}</ul>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex gap-2">
      <span className="text-amber-500 mt-0.5">•</span>
      <span>{children}</span>
    </li>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-2 my-3 text-zinc-600 dark:text-zinc-400">{children}</ol>
  ),
  hr: () => <div className="my-8 h-px w-full bg-zinc-200 dark:bg-zinc-800/80" />,
};

function formatGeneratedAt(iso: string) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return iso;
  }
}

function periodPresetLabel(preset: string, since: string, until: string): string {
  switch (preset) {
    case 'today':
      return 'Hoje';
    case 'yesterday':
      return 'Ontem';
    case 'last_7d':
      return 'Últimos 7 dias';
    case 'last_14d':
      return 'Últimos 14 dias';
    case 'last_30d':
      return 'Últimos 30 dias';
    case 'maximum':
      return 'Período máximo';
    case 'custom':
      return since && until ? `${since} → ${until}` : 'Período personalizado';
    default:
      return preset;
  }
}

function SpendDelta({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.01) return <span className="text-zinc-500">(=)</span>;
  if (d > 0) return <span className="text-rose-600 dark:text-rose-400">(+{formatMoney(d)})</span>;
  return <span className="text-emerald-600 dark:text-emerald-400">({formatMoney(d)})</span>;
}

function buildFunnelSummary(args: {
  campaignName: string;
  periodLabel: string;
  primary: FunnelRow;
  comparePrimary?: FunnelRow;
  compareLabel?: string | null;
  generatedAt?: string | null;
}): string {
  const { campaignName, periodLabel, primary, comparePrimary, compareLabel, generatedAt } = args;
  const f = primary.funnel;
  const lines = [
    `📊 Resumo — ${campaignName}`,
    `Período: ${periodLabel}`,
    '',
    `Cliques no link: ${formatNumber(f.link_clicks)}`,
    `Ver página (LP): ${formatNumber(f.landing_page_views)}`,
    `${primary.objective_metric_label || 'Objetivo'}: ${formatNumber(primary.objective_metric || (f as any).objective_metric || 0)}`,
    `Checkout: ${formatNumber(f.initiates_checkout)}`,
    `Compras (Meta): ${formatNumber(f.purchases)}`,
    '',
    `Taxas: clique→página ${primary.funnel_rates.lp_from_clicks_pct}% | página→checkout ${primary.funnel_rates.checkout_from_lp_pct}% | checkout→compra ${primary.funnel_rates.purchase_from_checkout_pct}%`,
    `Investido: ${formatMoney(primary.spend)}`,
    '',
    primary.bottleneck_plain ? `O que importa: ${primary.bottleneck_plain}` : '',
    primary.present_label ? `Situação: ${primary.present_label}` : '',
    primary.future_label ? `Próximo passo: ${primary.future_label}` : '',
  ];

  if (comparePrimary && compareLabel) {
    const p = comparePrimary;
    lines.push(
      '',
      `— Comparativo (${compareLabel}) —`,
      `Cliques: ${formatNumber(p.funnel.link_clicks)} | LP: ${formatNumber(p.funnel.landing_page_views)} | Checkout: ${formatNumber(p.funnel.initiates_checkout)} | Compras: ${formatNumber(p.funnel.purchases)}`,
      `Investido: ${formatMoney(p.spend)}`
    );
  }

  if (generatedAt) {
    lines.push('', `Atualizado: ${formatGeneratedAt(generatedAt)}`);
  }

  return lines.filter(Boolean).join('\n');
}

function presentBadgeClass(p: FunnelRow['present']) {
  switch (p) {
    case 'strong':
      return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30';
    case 'ok':
      return 'bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/30';
    case 'weak':
      return 'bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/30';
    default:
      return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-600';
  }
}

function futureBadgeClass(f: FunnelRow['future']) {
  switch (f) {
    case 'promising':
      return 'bg-violet-500/15 text-violet-800 dark:text-violet-200 border-violet-500/30';
    case 'limited':
      return 'bg-orange-500/15 text-orange-800 dark:text-orange-200 border-orange-500/30';
    default:
      return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-600';
  }
}

function FunnelBars({ f, objectiveLabel }: { f: FunnelRow['funnel']; objectiveLabel?: string }) {
  const max = Math.max(f.link_clicks, f.landing_page_views, f.objective_metric || 0, f.initiates_checkout, f.purchases, 1);
  const items = [
    { label: 'Cliques no link', v: f.link_clicks, color: 'bg-violet-500' },
    { label: 'Ver página (LP)', v: f.landing_page_views, color: 'bg-indigo-500' },
    { label: objectiveLabel || 'Objetivo', v: Number(f.objective_metric || 0), color: 'bg-sky-500' },
    { label: 'Checkout', v: f.initiates_checkout, color: 'bg-amber-500' },
    { label: 'Compras', v: f.purchases, color: 'bg-emerald-500' },
  ];
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-[11px] text-zinc-600 dark:text-zinc-500 mb-0.5">
            <span>{it.label}</span>
            <span className="tabular-nums font-medium text-zinc-800 dark:text-zinc-200">{formatNumber(it.v)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800/80 overflow-hidden">
            <div
              className={`h-full ${it.color} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(100, (it.v / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type BenchLevel = 'bad' | 'ok' | 'good' | 'strong';

function benchLevel(rate01: number, badLt: number, okLt: number, goodLt: number): BenchLevel {
  if (!Number.isFinite(rate01) || rate01 < 0) return 'bad';
  if (rate01 < badLt) return 'bad';
  if (rate01 < okLt) return 'ok';
  if (rate01 < goodLt) return 'good';
  return 'strong';
}

function benchPill(level: BenchLevel) {
  const base = 'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold';
  if (level === 'strong')
    return { cls: base + ' bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30', label: 'Muito forte' };
  if (level === 'good') return { cls: base + ' bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/30', label: 'Bom' };
  if (level === 'ok') return { cls: base + ' bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/30', label: 'Aceitável' };
  return { cls: base + ' bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/30', label: 'Ruim' };
}

function toPct(rate01: number): number {
  if (!Number.isFinite(rate01) || rate01 <= 0) return 0;
  return Math.round(rate01 * 1000) / 10;
}

function leigoHeadline(primary: FunnelRow) {
  const v = Number(primary.funnel.landing_page_views || 0);
  const ic = Number(primary.funnel.initiates_checkout || 0);
  const p = Number(primary.funnel.purchases || 0);
  const visitToIc = v > 0 ? ic / v : 0;
  const icToPurchase = ic > 0 ? p / ic : 0;
  const l1 = benchLevel(visitToIc, 0.03, 0.06, 0.12);
  const l2 = benchLevel(icToPurchase, 0.15, 0.25, 0.40);

  if (ic >= 1 && p === 0) {
    return {
      oneLiner: 'Você está perdendo gente no checkout: começam, mas não concluem.',
      oneAction: 'Ação agora: revise pagamento (Pix/cartão), garantia e o “preço final” (frete/juros) no checkout.',
    };
  }
  if (l1 === 'bad') {
    return {
      oneLiner: 'O gargalo está na página: muita gente entra, pouca inicia checkout.',
      oneAction: 'Ação agora: ajuste a headline para bater com o anúncio e coloque prova social acima do botão.',
    };
  }
  if (l2 === 'bad') {
    return {
      oneLiner: 'O gargalo está no checkout/oferta: iniciam checkout, mas poucos compram.',
      oneAction: 'Ação agora: simplifique o checkout e deixe garantia/benefícios e formas de pagamento muito claros.',
    };
  }
  return {
    oneLiner: 'Seu funil está no caminho: agora é melhorar criativo e repetir o que está funcionando.',
    oneAction: 'Ação agora: duplique o melhor anúncio e teste 1 variação de ângulo (mesma oferta, nova promessa).',
  };
}

function FunnelInfoCards({ row }: { row: FunnelRow }) {
  const lp = Number(row.funnel.landing_page_views || 0);
  const ic = Number(row.funnel.initiates_checkout || 0);
  const p = Number(row.funnel.purchases || 0);
  const clicks = Number(row.funnel.link_clicks || 0);
  const visitToPurchase = lp > 0 ? p / lp : 0;
  // Clique → página (connect rate) costuma precisar ser bem mais alto para ser "bom".
  // Ex.: <55% geralmente indica problema de carregamento/redirect/tracking/qualidade do tráfego.
  const pillC2LP = benchPill(benchLevel(clicks > 0 ? lp / clicks : 0, 0.55, 0.65, 0.75));
  const pillV2IC = benchPill(benchLevel(lp > 0 ? ic / lp : 0, 0.03, 0.06, 0.12));
  const pillIC2P = benchPill(benchLevel(ic > 0 ? p / ic : 0, 0.15, 0.25, 0.40));
  const pillV2P = benchPill(benchLevel(visitToPurchase, 0.01, 0.02, 0.04));
  return (
    <>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
        <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
          <div className="flex items-center justify-between gap-2">
            <div className="text-zinc-600 dark:text-zinc-400">Clique → página</div>
            <span className={pillC2LP.cls} title="Benchmark global DR (2025–2026)">
              {pillC2LP.label}
            </span>
          </div>
          <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">{row.funnel_rates.lp_from_clicks_pct}%</div>
        </div>
        <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
          <div className="flex items-center justify-between gap-2">
            <div className="text-zinc-600 dark:text-zinc-400">Página → checkout</div>
            <span className={pillV2IC.cls} title="Benchmark global DR (2025–2026)">
              {pillV2IC.label}
            </span>
          </div>
          <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">{row.funnel_rates.checkout_from_lp_pct}%</div>
        </div>
        <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
          <div className="flex items-center justify-between gap-2">
            <div className="text-zinc-600 dark:text-zinc-400">Checkout → compra</div>
            <span className={pillIC2P.cls} title="Benchmark global DR (2025–2026)">
              {pillIC2P.label}
            </span>
          </div>
          <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">{row.funnel_rates.purchase_from_checkout_pct}%</div>
        </div>
      </div>
      <div className="mt-2">
        <div className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
          <span className="font-medium">Visita → compra:</span>
          <span className={pillV2P.cls} title="Benchmark global DR (2025–2026)">
            {pillV2P.label}
          </span>
          <span className="tabular-nums">{toPct(visitToPurchase)}%</span>
        </div>
      </div>
    </>
  );
}

function severityBorder(sev: string | undefined) {
  if (sev === 'high') return 'border-rose-400 dark:border-rose-500/50 bg-rose-500/10';
  if (sev === 'medium') return 'border-amber-400 dark:border-amber-500/45 bg-amber-500/10';
  return 'border-zinc-200 dark:border-zinc-600/50 bg-zinc-50 dark:bg-zinc-800/40';
}

export function CampaignFunnelPanel({
  siteId,
  siteKey,
  campaigns,
  hasMetaConnection,
  hasAdAccount,
  metricsPreset,
  metricsSince,
  metricsUntil,
  periodSelector,
  selectClsCompact,
}: Props) {
  const MAX_REPORT_HISTORY = 5;
  const [campaignId, setCampaignId] = useState('');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<'active' | 'all'>('active');
  const [level, setLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign');
  const [adsetFilter, setAdsetFilter] = useState('');
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [adsetOptions, setAdsetOptions] = useState<FunnelCampaignOption[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareRows, setCompareRows] = useState<FunnelRow[]>([]);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'assistant' | 'user'; content: string }>>([
    {
      role: 'assistant',
      content:
        'Me diga o que você quer melhorar (criativo, página, checkout, oferta) e eu vou te guiando com base nos dados do funil. Se quiser, pergunte qualquer coisa.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [simpleMode, setSimpleMode] = useState(true);
  const [activePanel, setActivePanel] = useState<'chat' | 'report' | 'history'>('chat');
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardAds, setWizardAds] = useState<Array<{ id: string; name: string }>>([]);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [reportHistory, setReportHistory] = useState<
    Array<{ id: string; storageKey: string; createdAt: string; campaignId: string; campaignName: string; periodLabel: string }>
  >([]);
  const chatBoxRef = React.useRef<HTMLDivElement | null>(null);
  const chatAutoScrollRef = React.useRef(true);
  const chatInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const filteredCampaigns = useMemo(() => {
    if (campaignStatusFilter === 'all') return campaigns;
    return campaigns.filter((c) => c.is_active !== false);
  }, [campaigns, campaignStatusFilter]);

  const selectedCampaignName = useMemo(() => {
    const c = filteredCampaigns.find((x) => x.id === campaignId);
    return c?.name || '';
  }, [filteredCampaigns, campaignId]);

  const periodLabel = useMemo(
    () => periodPresetLabel(metricsPreset, metricsSince, metricsUntil),
    [metricsPreset, metricsSince, metricsUntil]
  );

  const reportStorageKey = useMemo(() => {
    if (!campaignId) return '';
    const since = metricsPreset === 'custom' ? metricsSince : '';
    const until = metricsPreset === 'custom' ? metricsUntil : '';
    return `funnel:report:${siteId}:${campaignId}:${metricsPreset}:${since}:${until}`;
  }, [siteId, campaignId, metricsPreset, metricsSince, metricsUntil]);

  const historyStorageKey = useMemo(() => `funnel:report-history:${siteId}`, [siteId]);

  const reportSections = useMemo(
    () => splitMarkdownH2Sections(report?.analysis_text || ''),
    [report?.analysis_text]
  );

  const visibleReportSections = useMemo(
    () => reportSections.filter((s) => !s.title.toLowerCase().includes('tabela de métricas')),
    [reportSections]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((h: any) => ({
            id: String(h?.id || ''),
            storageKey: String(h?.storageKey || h?.id || ''),
            createdAt: String(h?.createdAt || ''),
            campaignId: String(h?.campaignId || ''),
            campaignName: String(h?.campaignName || ''),
            periodLabel: String(h?.periodLabel || ''),
          }))
          .filter((h: any) => h.id && h.storageKey && h.createdAt)
          .slice(0, MAX_REPORT_HISTORY);
        setReportHistory(normalized);
        localStorage.setItem(historyStorageKey, JSON.stringify(normalized));
      }
    } catch {
      /* ignore */
    }
  }, [historyStorageKey, MAX_REPORT_HISTORY]);

  useEffect(() => {
    if (!reportStorageKey) {
      setReport(null);
      return;
    }
    try {
      const raw = localStorage.getItem(reportStorageKey);
      if (!raw) {
        setReport(null);
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setReport(parsed as DiagnosisReport);
    } catch {
      setReport(null);
    }
  }, [reportStorageKey]);

  const dateParams = useCallback(() => {
    const p: Record<string, string | number> = { site_id: siteId };
    if (metricsPreset === 'custom') {
      p.since = metricsSince;
      p.until = metricsUntil;
    } else {
      p.date_preset = metricsPreset;
    }
    return p;
  }, [siteId, metricsPreset, metricsSince, metricsUntil]);

  const sendChatText = useCallback(
    async (userMsgRaw: string) => {
      const userMsg = (userMsgRaw || '').trim();
      if (!userMsg || !campaignId) return;
      setChatInput('');
      setChatMessages((m) => [...m, { role: 'user', content: userMsg }]);
      setChatLoading(true);
      try {
        const params: Record<string, string | number> = {
          site_id: siteId,
          campaign_id: campaignId,
        };
        if (metricsPreset === 'custom') {
          params.since = metricsSince;
          params.until = metricsUntil;
        } else {
          params.date_preset = metricsPreset;
        }
        const res = await api.post(
          '/recommendations/chat',
          { messages: [...chatMessages, { role: 'user', content: userMsg }].slice(-12) },
          { params }
        );
        const answer = typeof res.data?.answer === 'string' ? res.data.answer : 'Não consegui responder agora. Tente novamente.';
        setChatMessages((m) => [...m, { role: 'assistant', content: answer }]);
      } catch (e) {
        console.error(e);
        setChatMessages((m) => [
          ...m,
          { role: 'assistant', content: 'Falha ao falar com a IA agora. Verifique a configuração da OpenAI em Inteligência IA.' },
        ]);
      } finally {
        setChatLoading(false);
      }
    },
    [campaignId, siteId, metricsPreset, metricsSince, metricsUntil, chatMessages]
  );

  const sendChat = useCallback(() => sendChatText(chatInput), [sendChatText, chatInput]);

  const chatQuickActions = useMemo(
    () => [
      { key: 'page', label: 'Quero melhorar a página', text: 'Quero melhorar a página. O que eu faço primeiro olhando esse funil?' },
      { key: 'checkout', label: 'Quero melhorar o checkout', text: 'Quero melhorar o checkout. O que eu faço primeiro olhando esse funil?' },
      { key: 'creative', label: 'Quero melhorar o criativo', text: 'Quero melhorar o criativo. Me diga o que testar (ângulos/copy) com base nos números.' },
      { key: 'offer', label: 'Quero melhorar a oferta', text: 'Quero melhorar a oferta. O que mexer (preço/garantia/bônus) com base no funil?' },
      { key: 'scale', label: 'Quero escalar', text: 'Quero escalar. Qual é o maior risco hoje e o que eu devo arrumar antes de aumentar orçamento?' },
    ],
    []
  );

  useEffect(() => {
    if (!campaignId) return;
    setChatMessages((m) => {
      const already = m.some((x) => x.role === 'assistant' && x.content.includes('Escolha um dos botões'));
      if (already) return m;
      return [
        ...m,
        {
          role: 'assistant',
          content:
            'Escolha um dos botões abaixo para eu te guiar passo a passo (ou escreva sua pergunta).',
        },
      ];
    });
  }, [campaignId]);

  const openReportWizard = useCallback(async () => {
    if (!campaignId) return;
    setWizardLoading(true);
    setReportError(null);
    try {
      const res = await api.get(`/integrations/sites/${siteId}/meta/ads`, {
        params: { campaign_id: campaignId },
      });
      setWizardAds((res.data?.ads || []).map((a: any) => ({ id: String(a.id), name: String(a.name || a.id) })));
    } catch (e) {
      console.error(e);
      setWizardAds([]);
    } finally {
      setWizardLoading(false);
      setShowWizard(true);
    }
  }, [siteId, campaignId]);

  const handleWizardGenerate = useCallback(
    async (context: { objective: string; landing_page_url: string; selected_ad_ids?: string[] }) => {
      if (!campaignId) return;
      setShowWizard(false);
      setReportLoading(true);
      setReportError(null);
      try {
        const params: Record<string, string> = { campaign_id: campaignId };
        if (metricsPreset === 'custom') {
          params.since = metricsSince;
          params.until = metricsUntil;
        } else {
          params.date_preset = metricsPreset;
        }
        const res = await api.post(
          '/recommendations/generate',
          {
            objective: context.objective,
            landing_page_url: context.landing_page_url,
            selected_ad_ids: context.selected_ad_ids,
          },
          { headers: { 'x-site-key': siteKey }, params }
        );
        const next = (res.data || null) as DiagnosisReport | null;
        setReport(next);
        setActivePanel('report');
        if (next && reportStorageKey) {
          localStorage.setItem(reportStorageKey, JSON.stringify(next));
          const now = new Date().toISOString();
          const itemId = `${reportStorageKey}:${now}`;
          const campaignName = selectedCampaignName || 'Campanha';
          localStorage.setItem(itemId, JSON.stringify(next));
          const entry = { id: itemId, storageKey: itemId, createdAt: now, campaignId: String(campaignId), campaignName, periodLabel };
          setReportHistory((prev) => {
            const updated = [entry, ...prev].slice(0, MAX_REPORT_HISTORY);
            localStorage.setItem(historyStorageKey, JSON.stringify(updated));
            return updated;
          });
        }
      } catch (err: unknown) {
        console.error(err);
        const apiError =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error ||
              (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.message
            : undefined;
        setReport(null);
        setActivePanel('chat');
        setReportError(apiError || 'Erro ao gerar relatório. Tente novamente em instantes.');
      } finally {
        setReportLoading(false);
      }
    },
    [
      campaignId,
      metricsPreset,
      metricsSince,
      metricsUntil,
      siteKey,
      reportStorageKey,
      historyStorageKey,
      selectedCampaignName,
      periodLabel,
    ]
  );

  const copyReport = useCallback(async () => {
    const text = (report?.analysis_text || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, [report?.analysis_text]);

  const openWhatsAppReport = useCallback(() => {
    const text = (report?.analysis_text || '').trim();
    if (!text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, [report?.analysis_text]);

  const openEmailReport = useCallback(() => {
    const text = (report?.analysis_text || '').trim();
    if (!text) return;
    const subject = `Relatório — ${selectedCampaignName || 'campanha'} (${periodLabel})`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }, [report?.analysis_text, selectedCampaignName, periodLabel]);

  const openHistoryItem = useCallback((storageKey: string) => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setReport(parsed as DiagnosisReport);
        setActivePanel('report');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const deleteHistoryItem = useCallback(
    (storageKey: string) => {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      setReportHistory((prev) => {
        const updated = prev.filter((h) => h.storageKey !== storageKey);
        localStorage.setItem(historyStorageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [historyStorageKey]
  );

  const clearHistory = useCallback(() => {
    for (const h of reportHistory) {
      try {
        localStorage.removeItem(h.storageKey);
      } catch {
        /* ignore */
      }
    }
    setReportHistory([]);
    localStorage.setItem(historyStorageKey, JSON.stringify([]));
  }, [historyStorageKey, reportHistory]);

  const onChatScroll = useCallback(() => {
    const el = chatBoxRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    chatAutoScrollRef.current = distanceToBottom < 80;
  }, []);

  useEffect(() => {
    const el = chatBoxRef.current;
    if (!el) return;
    if (!chatAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [chatMessages.length, chatLoading]);

  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    // Autosize: cresce até um limite; depois vira scroll.
    el.style.height = '0px';
    const maxPx = 160; // ~8-9 linhas
    const next = Math.min(maxPx, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [chatInput]);

  const loadFunnel = useCallback(async (opts?: { force?: boolean }) => {
    if (!hasMetaConnection || !hasAdAccount) return;
    if (!campaignId) return;
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        ...dateParams(),
        campaign_id: campaignId,
        level,
      };
      if (level === 'ad' && adsetFilter) params.adset_id = adsetFilter;
      if (level === 'campaign' && compareEnabled && metricsPreset !== 'maximum') {
        params.compare = '1';
      }
      if (opts?.force) params.force = '1';
      const res = await api.get('/meta/campaigns/funnel-breakdown', { params });
      let list = (res.data?.rows || []) as FunnelRow[];
      // Permite isolar um conjunto na visão "Por conjunto" sem precisar mudar o endpoint.
      if (level === 'adset' && adsetFilter) {
        list = list.filter((r) => String(r.id) === String(adsetFilter));
      }
      setRows(list.map((r) => ({ ...r, bottleneck_plain: r.bottleneck_plain ?? '' })));
      setGeneratedAt(typeof res.data?.generated_at === 'string' ? res.data.generated_at : null);
      if (level === 'campaign' && compareEnabled) {
        setCompareRows((res.data?.compare_rows as FunnelRow[]) || []);
        setCompareLabel(typeof res.data?.compare_label === 'string' ? res.data.compare_label : null);
      } else {
        setCompareRows([]);
        setCompareLabel(null);
      }
    } catch (e) {
      console.error(e);
      setRows([]);
      setGeneratedAt(null);
      setCompareRows([]);
      setCompareLabel(null);
    } finally {
      setLoading(false);
    }
  }, [
    hasMetaConnection,
    hasAdAccount,
    campaignId,
    level,
    adsetFilter,
    dateParams,
    metricsPreset,
    metricsSince,
    metricsUntil,
    compareEnabled,
  ]);

  useEffect(() => {
    if (!filteredCampaigns.length) {
      if (campaignId) setCampaignId('');
      return;
    }
    const ok = filteredCampaigns.some((c) => c.id === campaignId);
    if (!campaignId || !ok) setCampaignId(String(filteredCampaigns[0].id));
  }, [filteredCampaigns, campaignId]);

  useEffect(() => {
    setRows([]);
  }, [campaignId, level, adsetFilter]);

  useEffect(() => {
    if (!hasMetaConnection || !hasAdAccount || !campaignId) return;
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    if (level === 'campaign') {
      setAdsetOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/meta/campaigns/funnel-breakdown', {
          params: { ...dateParams(), campaign_id: campaignId, level: 'adset' },
        });
        const list: FunnelCampaignOption[] = (res.data?.rows || []).map((r: { id: string; name: string }) => ({
          id: String(r.id),
          name: r.name || r.id,
        }));
        if (!cancelled) setAdsetOptions(list);
      } catch {
        if (!cancelled) setAdsetOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasMetaConnection, hasAdAccount, campaignId, level, dateParams, metricsPreset, metricsSince, metricsUntil]);

  useEffect(() => {
    loadFunnel().catch(() => {});
  }, [loadFunnel]);

  useEffect(() => {
    if (level === 'campaign') setAdsetFilter('');
  }, [level]);

  const copySummary = useCallback(async () => {
    const primary = rows[0];
    if (!primary) return;
    const text = buildFunnelSummary({
      campaignName: selectedCampaignName || primary.name || 'Campanha',
      periodLabel,
      primary,
      comparePrimary: compareRows[0],
      compareLabel,
      generatedAt,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      /* ignore */
    }
  }, [rows, selectedCampaignName, periodLabel, compareRows, compareLabel, generatedAt]);

  const openWhatsAppSummary = useCallback(() => {
    const primary = rows[0];
    if (!primary) return;
    const text = buildFunnelSummary({
      campaignName: selectedCampaignName || primary.name || 'Campanha',
      periodLabel,
      primary,
      comparePrimary: compareRows[0],
      compareLabel,
      generatedAt,
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, [rows, selectedCampaignName, periodLabel, compareRows, compareLabel, generatedAt]);

  const openEmailSummary = useCallback(() => {
    const primary = rows[0];
    if (!primary) return;
    const text = buildFunnelSummary({
      campaignName: selectedCampaignName || primary.name || 'Campanha',
      periodLabel,
      primary,
      comparePrimary: compareRows[0],
      compareLabel,
      generatedAt,
    });
    const subject = `Funil — ${selectedCampaignName || primary.name || 'campanha'} (${periodLabel})`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }, [rows, selectedCampaignName, periodLabel, compareRows, compareLabel, generatedAt]);

  if (!hasMetaConnection || !hasAdAccount) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-900/40 p-6 text-sm text-zinc-600 dark:text-zinc-400">
        Conecte a Meta e defina a conta de anúncios para ver o funil por campanha, conjunto e anúncio — os números são os mesmos
        do Gerenciador de Anúncios (compras, checkout, etc.).
      </div>
    );
  }

  if (!campaigns.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-900/40 p-6 text-sm text-zinc-600 dark:text-zinc-400">
        Nenhuma campanha carregada ainda. Confira a aba <strong>Meta Ads</strong> ou mude o período (ex.: últimos 7 dias).
      </div>
    );
  }

  if (!filteredCampaigns.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-900/40 p-6 text-sm text-zinc-600 dark:text-zinc-400 space-y-3">
        <p>Nenhuma campanha <strong>ativa</strong> aparece na lista. Mude o filtro para “Ativas e pausadas” ou reative uma campanha na Meta.</p>
        <select
          aria-label="Campanhas ativas ou todas"
          value={campaignStatusFilter}
          onChange={(e) => setCampaignStatusFilter(e.target.value as 'active' | 'all')}
          className={selectClsCompact}
        >
          <option value="active">Só campanhas ativas</option>
          <option value="all">Ativas e pausadas</option>
        </select>
      </div>
    );
  }

  const primary = rows[0];
  const comparePrimary = compareRows[0];
  const leigo = primary ? leigoHeadline(primary) : null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900/80 dark:to-zinc-950/90 overflow-hidden shadow-sm dark:shadow-lg">
      <div className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Funil da campanha</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-500 max-w-xl leading-relaxed">
            Mesmos números da Meta. A caixa colorida explica em linguagem simples onde mais gente desiste — sem siglas
            difíceis.
          </p>
          {generatedAt && !loading ? (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-500 pt-0.5">
              Dados da Meta: <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatGeneratedAt(generatedAt)}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">{periodSelector}</div>
      </div>

      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-2 items-center bg-zinc-50/80 dark:bg-zinc-900/50">
        <select
          aria-label="Campanhas ativas ou todas"
          value={campaignStatusFilter}
          onChange={(e) => setCampaignStatusFilter(e.target.value as 'active' | 'all')}
          className={selectClsCompact}
        >
          <option value="active">Só campanhas ativas</option>
          <option value="all">Ativas e pausadas</option>
        </select>
        <select
          aria-label="Campanha para análise do funil"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className={selectClsCompact + ' min-w-[200px] max-w-[280px]'}
        >
          {filteredCampaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {(c.name || c.id) + (c.is_active === false ? ' (pausada)' : '')}
            </option>
          ))}
        </select>
        <select
          aria-label="Nível do funil"
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
          className={selectClsCompact}
        >
          <option value="campaign">Visão da campanha</option>
          <option value="adset">Por conjunto</option>
          <option value="ad">Por anúncio</option>
        </select>
        {(level === 'ad' || level === 'adset') && (
          <select
            aria-label="Filtrar por conjunto de anúncios"
            value={adsetFilter}
            onChange={(e) => setAdsetFilter(e.target.value)}
            className={selectClsCompact + ' max-w-[220px]'}
          >
            <option value="">
              {level === 'ad' ? 'Todos os anúncios da campanha' : 'Todos os conjuntos da campanha'}
            </option>
            {adsetOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {level === 'campaign' ? (
          <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={simpleMode}
              onChange={(e) => setSimpleMode(e.target.checked)}
              className="rounded border-zinc-400"
            />
            Modo simples
          </label>
        ) : null}
        {level === 'campaign' && metricsPreset !== 'maximum' ? (
          <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => setCompareEnabled(e.target.checked)}
              className="rounded border-zinc-400"
            />
            Comparar período anterior
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => loadFunnel({ force: true }).catch(() => {})}
          disabled={loading}
          className="text-xs px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          {loading ? 'Carregando…' : 'Atualizar funil'}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {loading && rows.length === 0 ? (
          <div className="h-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800/50" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 py-8 text-center px-4">
            Ainda não há números guardados para esta campanha neste período. Toque em <strong>Atualizar funil</strong> para
            buscar direto na Meta (demora alguns segundos na primeira vez).
          </p>
        ) : level === 'campaign' && primary ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/35 p-5 space-y-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">Funil da campanha</div>
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{primary.name}</div>
                </div>

                <FunnelBars f={primary.funnel} objectiveLabel={primary.objective_metric_label} />
                <FunnelInfoCards row={primary} />

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => copySummary()}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {copyFeedback ? 'Copiado!' : 'Copiar resumo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openWhatsAppSummary()}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/20"
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => openEmailSummary()}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    E-mail
                  </button>
                </div>

                <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-2">
                  <span>
                    Investido:{' '}
                    <strong className="text-zinc-900 dark:text-zinc-200 tabular-nums">{formatMoney(primary.spend)}</strong>
                  </span>
                  {Number(primary.meta_revenue || 0) > 0 ? (
                    <>
                      <span className="text-zinc-500">·</span>
                      <span>
                        Receita (Meta):{' '}
                        <strong className="text-zinc-900 dark:text-zinc-200 tabular-nums">
                          {formatMoney(Number(primary.meta_revenue || 0))}
                        </strong>
                      </span>
                      <span className="text-zinc-500">·</span>
                      <span>
                        ROAS (Meta):{' '}
                        <strong className="text-zinc-900 dark:text-zinc-200 tabular-nums">
                          {(Number(primary.meta_roas || 0)).toFixed(2)}x
                        </strong>
                      </span>
                    </>
                  ) : null}
                  {comparePrimary ? (
                    <span className="text-zinc-500">
                      vs. anterior <strong className="tabular-nums">{formatMoney(comparePrimary.spend)}</strong>{' '}
                      <SpendDelta cur={primary.spend} prev={comparePrimary.spend} />
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                {simpleMode && leigo ? (
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/35 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                      Diagnóstico rápido
                    </div>
                    <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed font-semibold">{leigo.oneLiner}</div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mt-2">{leigo.oneAction}</div>
                  </div>
                ) : null}

                {primary.bottleneck_plain ? (
                  <div className={`rounded-2xl border p-4 ${severityBorder(primary.bottleneck?.severity)}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                      O que isso quer dizer
                    </div>
                    <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-relaxed">{primary.bottleneck_plain}</p>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/35 p-4 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <span className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${presentBadgeClass(primary.present)}`}>
                      Agora:{' '}
                      {primary.present === 'strong'
                        ? 'performando bem'
                        : primary.present === 'ok'
                          ? 'no caminho'
                          : primary.present === 'weak'
                            ? 'precisa atenção'
                            : 'pouco dado'}
                    </span>
                    <span className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${futureBadgeClass(primary.future)}`}>
                      Futuro:{' '}
                      {primary.future === 'promising'
                        ? 'potencial'
                        : primary.future === 'limited'
                          ? 'arriscado escalar'
                          : 'depende de testes'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{primary.present_label}</p>
                  <p className="text-xs text-zinc-500 leading-relaxed border-t border-zinc-200 dark:border-zinc-800 pt-3">{primary.future_label}</p>
                </div>

                <p className="text-xs text-zinc-600 dark:text-zinc-400 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 px-4 py-3 leading-relaxed">
                  Para ver <strong>conjunto, anúncio, página no site, checkout e compras</strong> por criativo, escolha{' '}
                  <strong>Por anúncio</strong> acima. A lista ordena primeiro quem tem mais <strong>compras</strong> na Meta.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Assistente IA</div>
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Campanha: <span className="font-medium">{selectedCampaignName || '—'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 p-1">
                    {([
                      { key: 'chat', label: 'Chat' },
                      { key: 'report', label: 'Relatório', disabled: !report },
                      { key: 'history', label: 'Histórico', disabled: reportHistory.length === 0 },
                    ] as Array<{ key: 'chat' | 'report' | 'history'; label: string; disabled?: boolean }>).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        disabled={t.disabled}
                        onClick={() => setActivePanel(t.key)}
                        className={
                          'text-[11px] px-3 py-1.5 rounded-lg transition-colors ' +
                          (activePanel === t.key
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800') +
                          (t.disabled ? ' opacity-40 cursor-not-allowed' : '')
                        }
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => openReportWizard().catch(() => {})}
                    disabled={!campaignId || wizardLoading || reportLoading || chatLoading}
                    className="text-[11px] px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white border border-blue-600/40 disabled:opacity-40"
                    title="Gera um relatório completo (salva no histórico)"
                  >
                    {wizardLoading || reportLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Gerando relatório…
                      </span>
                    ) : (
                      'Gerar relatório'
                    )}
                  </button>
                </div>
              </div>

              {reportError ? (
                <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {reportError}
                </div>
              ) : null}

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/35 overflow-hidden flex flex-col h-[620px] max-h-[72vh]">
                {activePanel === 'chat' ? (
                  <>
                    <div
                      ref={chatBoxRef}
                      onScroll={onChatScroll}
                      className="flex-1 overflow-auto p-4 space-y-3 custom-scrollbar"
                    >
                      {chatMessages.map((m, idx) => (
                        <div key={idx} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                          <div
                            className={
                              'max-w-[92%] px-4 py-3 shadow-sm ' +
                              (m.role === 'user'
                                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-2xl rounded-br-md'
                                : 'bg-white/95 text-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-100 border border-zinc-200/70 dark:border-zinc-800/80 rounded-2xl rounded-bl-md')
                            }
                          >
                            {m.role === 'assistant' ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
                                {m.content}
                              </ReactMarkdown>
                            ) : (
                              <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {chatLoading ? (
                        <div className="flex justify-start">
                          <div className="max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 text-[13px] leading-relaxed bg-white/95 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-300">
                            Digitando…
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/35 p-3 space-y-2">
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Ações rápidas</div>
                      <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                        {chatQuickActions.map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            onClick={() => sendChatText(a.text).catch(() => {})}
                            disabled={chatLoading || !campaignId}
                            className="shrink-0 text-[11px] px-3 py-1.5 rounded-full border border-zinc-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-900/70 disabled:opacity-40"
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-2 items-end">
                        <textarea
                          ref={chatInputRef}
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              sendChat().catch(() => {});
                            }
                          }}
                          placeholder={campaignId ? 'Escreva sua mensagem…' : 'Selecione uma campanha para começar'}
                          className="flex-1 text-sm rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 outline-none focus:border-blue-500/50 resize-none overflow-y-auto min-h-[52px] max-h-[160px] leading-relaxed"
                          disabled={chatLoading || !campaignId}
                          rows={1}
                        />
                        <button
                          type="button"
                          onClick={() => sendChat().catch(() => {})}
                          disabled={chatLoading || !chatInput.trim() || !campaignId}
                          className="text-sm px-4 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {chatLoading ? 'Enviando…' : 'Enviar'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : activePanel === 'report' ? (
                  <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                    {reportLoading ? (
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                        <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Gerando relatório… isso pode levar alguns segundos.
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800/70 animate-pulse" />
                          <div className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-800/70 animate-pulse" />
                          <div className="h-4 w-5/6 rounded bg-zinc-200 dark:bg-zinc-800/70 animate-pulse" />
                        </div>
                      </div>
                    ) : null}
                    {!report?.analysis_text ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/30 px-6 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
                        Nenhum relatório gerado ainda.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => copyReport().catch(() => {})}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            Copiar
                          </button>
                          <button
                            type="button"
                            onClick={() => openWhatsAppReport()}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/20"
                          >
                            WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => openEmailReport()}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            E-mail
                          </button>
                        </div>
                        {visibleReportSections.map((section, index) => (
                          <div
                            key={`${section.title}-${index}`}
                            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-zinc-950/25 overflow-hidden"
                          >
                            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800/40 bg-zinc-50 dark:bg-zinc-900/40">
                              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</div>
                            </div>
                            {section.body ? (
                              <div className="px-4 py-4">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={reportMarkdownComponents}>
                                  {section.body}
                                </ReactMarkdown>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                    {reportHistory.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/30 px-6 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
                        Sem relatórios no histórico.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 px-4 py-3">
                          <div className="text-xs text-zinc-600 dark:text-zinc-400">
                            Mantemos apenas os <strong>{MAX_REPORT_HISTORY}</strong> relatórios mais recentes neste navegador.
                          </div>
                          <button
                            type="button"
                            onClick={() => clearHistory()}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            Limpar histórico
                          </button>
                        </div>
                        {reportHistory.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => openHistoryItem(h.storageKey)}
                            className="w-full text-left rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 px-4 py-3 hover:bg-white dark:hover:bg-zinc-950/40 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                  {h.campaignName}
                                </div>
                                <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                                  {h.periodLabel} · {new Date(h.createdAt).toLocaleString('pt-BR')}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    deleteHistoryItem(h.storageKey);
                                  }}
                                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15"
                                  title="Excluir este relatório do histórico"
                                >
                                  Excluir
                                </button>
                                <span className="text-[11px] text-blue-600 dark:text-blue-400">Abrir</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <ReportWizard
                open={showWizard}
                onClose={() => setShowWizard(false)}
                onGenerate={handleWizardGenerate}
                ads={wizardAds}
                loading={wizardLoading || reportLoading}
              />
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {level === 'ad' ? (
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">Campanha:</span>{' '}
                {selectedCampaignName || '—'} · Ordenado por compras e checkouts (Meta).{' '}
                <span className="font-medium text-zinc-800 dark:text-zinc-200">Página (site)</span> aparece quando o link do
                anúncio envia <code className="text-[10px] bg-zinc-200/80 dark:bg-zinc-800 px-1 rounded">utm_campaign</code>{' '}
                igual ao nome da campanha e{' '}
                <code className="text-[10px] bg-zinc-200/80 dark:bg-zinc-800 px-1 rounded">utm_content</code> com o id do
                anúncio (parâmetros dinâmicos).
              </p>
            ) : null}
            <div className="space-y-3 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50/80 dark:bg-zinc-900/40 p-4 grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 truncate" title={r.name}>
                      {r.name}
                    </div>
                    {level === 'ad' ? (
                      <div className="mb-2 space-y-0.5">
                        {r.adset_name ? (
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2" title={r.adset_name}>
                            Conjunto: {r.adset_name}
                          </div>
                        ) : null}
                        {r.first_party_page ? (
                          <div
                            className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate"
                            title={r.first_party_page}
                          >
                            Página (site): {r.first_party_page}
                          </div>
                        ) : null}
                        <div className="text-[10px] text-zinc-500 font-mono truncate" title={r.id}>
                          {r.id}
                        </div>
                      </div>
                    ) : null}
                    <FunnelBars f={r.funnel} objectiveLabel={r.objective_metric_label} />
                    <FunnelInfoCards row={r} />
                  </div>
                <div className="text-xs space-y-2">
                  {r.bottleneck_plain ? (
                    <div className={`rounded-lg border px-3 py-2 ${severityBorder(r.bottleneck?.severity)}`}>
                      <span className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{r.bottleneck_plain}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`px-2 py-0.5 rounded border text-[10px] ${presentBadgeClass(r.present)}`}>
                      {r.present === 'strong' ? 'Bom' : r.present === 'weak' ? 'Atenção' : r.present === 'ok' ? 'Ok' : '—'}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-[10px] ${futureBadgeClass(r.future)}`}>
                      {r.future === 'promising' ? 'Potencial' : r.future === 'limited' ? 'Cuidado' : 'Neutro'}
                    </span>
                    <span className="text-zinc-500 tabular-nums">{formatMoney(r.spend)}</span>
                    {Number(r.meta_revenue || 0) > 0 ? (
                      <span className="text-zinc-500 tabular-nums">
                        · {formatMoney(Number(r.meta_revenue || 0))} · {(Number(r.meta_roas || 0)).toFixed(2)}x
                      </span>
                    ) : null}
                  </div>
                  <p className="text-zinc-500 leading-relaxed">{r.present_label}</p>
                </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
