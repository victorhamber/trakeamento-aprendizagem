import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export type FunnelCampaignOption = { id: string; name: string };

type FunnelRow = {
  id: string;
  name: string;
  spend: number;
  funnel: {
    link_clicks: number;
    landing_page_views: number;
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
  present: 'strong' | 'ok' | 'weak' | 'idle';
  present_label: string;
  future: 'promising' | 'uncertain' | 'limited';
  future_label: string;
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

function FunnelBars({ f }: { f: FunnelRow['funnel'] }) {
  const max = Math.max(f.link_clicks, f.landing_page_views, f.initiates_checkout, f.purchases, 1);
  const items = [
    { label: 'Cliques no link', v: f.link_clicks, color: 'bg-violet-500' },
    { label: 'Ver página (LP)', v: f.landing_page_views, color: 'bg-indigo-500' },
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
  const [level, setLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign');
  const [adsetFilter, setAdsetFilter] = useState('');
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [adsetOptions, setAdsetOptions] = useState<FunnelCampaignOption[]>([]);

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

  const loadFunnel = useCallback(async () => {
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
      const res = await api.get('/meta/campaigns/funnel-breakdown', { params });
      setRows(res.data?.rows || []);
    } catch (e) {
      console.error(e);
      setRows([]);
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
  ]);

  useEffect(() => {
    if (campaigns.length && !campaignId) {
      setCampaignId(String(campaigns[0].id));
    }
  }, [campaigns, campaignId]);

  useEffect(() => {
    setRows([]);
  }, [campaignId, level, adsetFilter]);

  useEffect(() => {
    if (!hasMetaConnection || !hasAdAccount || !campaignId) return;
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    if (level !== 'ad') {
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
    if (level !== 'ad') setAdsetFilter('');
  }, [level]);

  if (!hasMetaConnection || !hasAdAccount) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-900/40 p-6 text-sm text-zinc-600 dark:text-zinc-400">
        Conecte a Meta e defina a conta de anúncios para ver o funil por campanha, conjunto e anúncio — os números batem com
        a tabela técnica (compras, checkout, etc.).
      </div>
    );
  }

  if (!campaigns.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-900/40 p-6 text-sm text-zinc-600 dark:text-zinc-400">
        Nenhuma campanha listada ainda. Abra a tabela técnica abaixo ou atualize o período para carregar campanhas da Meta.
      </div>
    );
  }

  const primary = rows[0];

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/60 bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900/80 dark:to-zinc-950/90 overflow-hidden shadow-sm dark:shadow-lg">
      <div className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Funil da campanha</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-500 max-w-xl leading-relaxed">
            Escolha a campanha e o nível. O funil usa os mesmos dados da Meta (compras = coluna da tabela). O destaque
            mostra onde mais “vaza” entre etapas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{periodSelector}</div>
      </div>

      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-2 items-center bg-zinc-50/80 dark:bg-zinc-900/50">
        <select
          aria-label="Campanha para análise do funil"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className={selectClsCompact + ' min-w-[200px] max-w-[280px]'}
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
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
        {level === 'ad' && (
          <select
            aria-label="Filtrar por conjunto de anúncios"
            value={adsetFilter}
            onChange={(e) => setAdsetFilter(e.target.value)}
            className={selectClsCompact + ' max-w-[220px]'}
          >
            <option value="">Todos os anúncios da campanha</option>
            {adsetOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => loadFunnel().catch(() => {})}
          disabled={loading}
          className="text-xs px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          {loading ? 'Carregando…' : 'Atualizar funil'}
        </button>
      </div>

      <div className="p-4">
        {loading && rows.length === 0 ? (
          <div className="h-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800/50" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 py-8 text-center">Sem dados de insights para esta campanha neste período.</p>
        ) : level === 'campaign' && primary ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <FunnelBars f={primary.funnel} />
              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                  <div className="text-zinc-600 dark:text-zinc-400">Clique → Página</div>
                  <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">
                    {primary.funnel_rates.lp_from_clicks_pct}%
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                  <div className="text-zinc-600 dark:text-zinc-400">Página → Checkout</div>
                  <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">
                    {primary.funnel_rates.checkout_from_lp_pct}%
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-2 border border-zinc-200 dark:border-zinc-700/50">
                  <div className="text-zinc-600 dark:text-zinc-400">Checkout → Compra</div>
                  <div className="text-zinc-900 dark:text-zinc-200 font-semibold tabular-nums">
                    {primary.funnel_rates.purchase_from_checkout_pct}%
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {primary.bottleneck && (
                <div
                  className={`rounded-xl border px-4 py-3 ${severityBorder(primary.bottleneck.severity)}`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
                    Onde está o gargalo
                  </div>
                  <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-snug">
                    Entre <strong>{primary.bottleneck.from}</strong> e <strong>{primary.bottleneck.to}</strong> perde-se
                    cerca de <strong>{primary.bottleneck.drop_pct}%</strong> do que passava na etapa anterior.
                  </p>
                </div>
              )}
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
              <div className="text-xs text-zinc-500 pt-2">
                Investido no período:{' '}
                <strong className="text-zinc-900 dark:text-zinc-200 tabular-nums">{formatMoney(primary.spend)}</strong>
              </div>
            </div>
          </div>
        ) : (
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
                  <FunnelBars f={r.funnel} />
                </div>
                <div className="text-xs space-y-2">
                  {r.bottleneck && (
                    <div className={`rounded-lg border px-3 py-2 ${severityBorder(r.bottleneck.severity)}`}>
                      <span className="text-zinc-700 dark:text-zinc-300">
                        Gargalo: {r.bottleneck.from} → {r.bottleneck.to} (~{r.bottleneck.drop_pct}%)
                      </span>
                    </div>
                  )}
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
        )}
      </div>
    </div>
  );
}
