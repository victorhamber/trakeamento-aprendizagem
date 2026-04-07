import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

export type FunnelCampaignOption = { id: string; name: string; is_active?: boolean };

type FunnelRow = {
  id: string;
  name: string;
  objective_metric?: number;
  objective_metric_label?: string;
  spend: number;
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
  /** Só nível «anúncio» (Meta). */
  adset_name?: string | null;
  /** Página mais vista no site quando UTM bate com campanha + id do anúncio. */
  first_party_page?: string | null;
};

type Props = {
  siteId: number;
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

function PctDelta({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.05) {
    return <span className="text-zinc-500 tabular-nums">(=)</span>;
  }
  if (d > 0) {
    return <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">(↑{d}%)</span>;
  }
  return <span className="text-rose-600 dark:text-rose-400 tabular-nums">(↓{Math.abs(d)}%)</span>;
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

function severityBorder(sev: string | undefined) {
  if (sev === 'high') return 'border-rose-400 dark:border-rose-500/50 bg-rose-500/10';
  if (sev === 'medium') return 'border-amber-400 dark:border-amber-500/45 bg-amber-500/10';
  return 'border-zinc-200 dark:border-zinc-600/50 bg-zinc-50 dark:bg-zinc-800/40';
}

export function CampaignFunnelPanel({
  siteId,
  campaigns,
  hasMetaConnection,
  hasAdAccount,
  metricsPreset,
  metricsSince,
  metricsUntil,
  periodSelector,
  selectClsCompact,
}: Props) {
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
              <div>
                <FunnelBars f={primary.funnel} objectiveLabel={primary.objective_metric_label} />
                {compareEnabled && compareLabel ? (
                  <p className="text-[10px] text-zinc-500 mt-2">
                    Comparativo: <strong>{compareLabel}</strong>
                    {!comparePrimary ? ' — sem dados salvos nesse intervalo.' : null}
                  </p>
                ) : null}
                <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                  <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                    <div className="text-zinc-600 dark:text-zinc-400">Clique → página</div>
                    <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums flex flex-wrap items-center gap-1">
                      {primary.funnel_rates.lp_from_clicks_pct}%
                      <PctDelta cur={primary.funnel_rates.lp_from_clicks_pct} prev={comparePrimary?.funnel_rates.lp_from_clicks_pct} />
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                    <div className="text-zinc-600 dark:text-zinc-400">Página → checkout</div>
                    <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums flex flex-wrap items-center gap-1">
                      {primary.funnel_rates.checkout_from_lp_pct}%
                      <PctDelta
                        cur={primary.funnel_rates.checkout_from_lp_pct}
                        prev={comparePrimary?.funnel_rates.checkout_from_lp_pct}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                    <div className="text-zinc-600 dark:text-zinc-400">Checkout → compra</div>
                    <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums flex flex-wrap items-center gap-1">
                      {primary.funnel_rates.purchase_from_checkout_pct}%
                      <PctDelta
                        cur={primary.funnel_rates.purchase_from_checkout_pct}
                        prev={comparePrimary?.funnel_rates.purchase_from_checkout_pct}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {primary.bottleneck_plain ? (
                  <div className={`rounded-xl border px-4 py-3 ${severityBorder(primary.bottleneck?.severity)}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                      O que isso quer dizer
                    </div>
                    <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-relaxed">{primary.bottleneck_plain}</p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
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
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${presentBadgeClass(primary.present)}`}
                  >
                    Agora:{' '}
                    {primary.present === 'strong'
                      ? 'performando bem'
                      : primary.present === 'ok'
                        ? 'no caminho'
                        : primary.present === 'weak'
                          ? 'precisa atenção'
                          : 'pouco dado'}
                  </span>
                  <span
                    className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${futureBadgeClass(primary.future)}`}
                  >
                    Futuro:{' '}
                    {primary.future === 'promising'
                      ? 'potencial'
                      : primary.future === 'limited'
                        ? 'arriscado escalar'
                        : 'depende de testes'}
                  </span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{primary.present_label}</p>
                <p className="text-xs text-zinc-500 leading-relaxed border-t border-zinc-200 dark:border-zinc-800 pt-3">
                  {primary.future_label}
                </p>
                <div className="text-xs text-zinc-500 pt-2 flex flex-wrap items-center gap-2">
                  <span>
                    Investido:{' '}
                    <strong className="text-zinc-900 dark:text-zinc-200 tabular-nums">{formatMoney(primary.spend)}</strong>
                  </span>
                  {comparePrimary ? (
                    <span className="text-zinc-500">
                      vs. anterior <strong className="tabular-nums">{formatMoney(comparePrimary.spend)}</strong>{' '}
                      <SpendDelta cur={primary.spend} prev={comparePrimary.spend} />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-400 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/30 px-3 py-2 leading-relaxed">
              Para ver <strong>conjunto, anúncio, página no site, checkout e compras</strong> por criativo, escolha{' '}
              <strong>Por anúncio</strong> acima. A lista ordena primeiro quem tem mais <strong>compras</strong> na Meta.
            </p>
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
