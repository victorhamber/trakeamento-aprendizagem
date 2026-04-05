import React from 'react';

export type FirstPartyCampaignRow = {
  utm_campaign: string | null;
  label: string;
  visits: number;
  unique_visitors: number;
  leads: number;
  purchases: number;
  initiate_checkout: number;
  add_to_cart: number;
  page_engagement: number;
  conversion_rate: number;
  investido: number | null;
  performance_tier: 'strong' | 'medium' | 'low' | 'none';
  rank: number;
};

export type SpendSource = 'matched' | 'unmatched' | 'none';

type Props = {
  rows: FirstPartyCampaignRow[];
  loading: boolean;
  spendSource: SpendSource;
  topLabel: string | null;
  periodSelector: React.ReactNode;
  onRefresh: () => void;
  refreshing?: boolean;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value);

const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value);

function tierCardClass(tier: FirstPartyCampaignRow['performance_tier']) {
  switch (tier) {
    case 'strong':
      return 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.08] to-transparent dark:from-emerald-500/[0.12]';
    case 'medium':
      return 'border-amber-500/35 bg-gradient-to-br from-amber-500/[0.07] to-transparent dark:from-amber-500/[0.1]';
    case 'low':
      return 'border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/25';
    default:
      return 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/15';
  }
}

function tierStroke(tier: FirstPartyCampaignRow['performance_tier']) {
  switch (tier) {
    case 'strong':
      return 'stroke-emerald-500';
    case 'medium':
      return 'stroke-amber-500';
    case 'low':
      return 'stroke-zinc-400';
    default:
      return 'stroke-zinc-500';
  }
}

function ConversionRing({
  rate,
  tier,
}: {
  rate: number;
  tier: FirstPartyCampaignRow['performance_tier'];
}) {
  const pct = Math.min(100, Math.max(0, rate));
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="relative w-[92px] h-[92px] shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className="stroke-zinc-200 dark:stroke-zinc-700"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className={tierStroke(tier)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {pct < 0.1 && pct > 0 ? '<0.1' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(pct)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">% conv.</span>
      </div>
    </div>
  );
}

export function CampaignsVitrine({
  rows,
  loading,
  spendSource,
  topLabel,
  periodSelector,
  onRefresh,
  refreshing = false,
}: Props) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 overflow-hidden shadow-sm">
      <div className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-3 bg-gradient-to-r from-rose-500/[0.06] via-violet-500/[0.06] to-amber-500/[0.08]">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Vitrine do site</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">
            Como escolher bolo na padaria: cada cartão é um rótulo que veio no link (utm_campaign). O site usa isso
            para saber qual campanha mandou cada visita.
          </p>
          {topLabel && rows.length > 0 && (
            <p className="text-xs font-medium text-violet-800 dark:text-violet-300 mt-2">
              Quem está na vitrine de honra:{' '}
              <span className="text-zinc-900 dark:text-zinc-100">{topLabel}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {periodSelector}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 bg-white/80 dark:bg-zinc-900/80 hover:bg-white dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
          >
            {refreshing ? (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
            Atualizar vitrine
          </button>
        </div>
      </div>

      {spendSource === 'unmatched' && (
        <div className="px-4 py-2.5 text-xs text-amber-950 dark:text-amber-100/95 bg-amber-400/15 dark:bg-amber-500/10 border-b border-amber-500/25 leading-relaxed">
          Há investimento na Meta neste período, mas nenhum nome do link bateu com o nome da campanha lá. Use o{' '}
          <strong>mesmo texto</strong> no utm_campaign e no nome da campanha.
        </div>
      )}

      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 h-44 animate-pulse bg-zinc-100/80 dark:bg-zinc-900/40"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 px-4 max-w-md mx-auto">
            <div className="text-4xl mb-3" aria-hidden>
              🥐
            </div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">A vitrine ainda está vazia</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
              Quando as visitas chegarem com <strong>utm_campaign</strong> no link, cada nome vira um cartão aqui —
              fácil de comparar, sem jargão de anúncios.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((row) => (
              <article
                key={`${row.label}-${row.rank}`}
                className={`rounded-xl border p-4 flex gap-3 transition-shadow hover:shadow-md ${tierCardClass(
                  row.performance_tier
                )} ${row.rank === 1 ? 'ring-2 ring-amber-400/40 dark:ring-amber-500/30' : ''}`}
              >
                <ConversionRing rate={row.conversion_rate} tier={row.performance_tier} />
                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug break-words">
                      {row.label}
                    </h4>
                    {row.rank === 1 && (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300 bg-amber-400/25 dark:bg-amber-500/20 px-2 py-0.5 rounded-full">
                        #1
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    {formatNumber(row.visits)} visitas no site
                    {row.unique_visitors > 0 ? (
                      <span className="text-zinc-500"> · ~{formatNumber(row.unique_visitors)} “rostos” diferentes</span>
                    ) : null}
                  </p>
                  <div className="mt-auto pt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                    <span>
                      Contatos: <strong className="tabular-nums">{formatNumber(row.leads)}</strong>
                    </span>
                    <span>
                      Compras: <strong className="tabular-nums">{formatNumber(row.purchases)}</strong>
                    </span>
                    {row.initiate_checkout > 0 && (
                      <span>
                        Carrinho: <strong className="tabular-nums">{formatNumber(row.initiate_checkout)}</strong>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs">
                    {row.investido != null ? (
                      <span className="text-zinc-800 dark:text-zinc-200">
                        Investido (Meta):{' '}
                        <strong className="tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(row.investido)}
                        </strong>
                      </span>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-500">
                        Investido: — (sem nome igual na Meta)
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
