import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type BuyerRow = {
  buyer_key: string;
  external_id: string | null;
  purchases_count: number;
  revenue: number;
  last_purchase_at: string | null;
};

type BuyerDetail = {
  buyer: {
    buyer_key?: string;
    external_id: string | null;
    email_hash: string | null;
    fbp: string | null;
    fbc: string | null;
    last_seen_at?: string | null;
    last_traffic_source?: string | null;
  };
  purchases: Array<{
    id: number;
    order_id: string;
    platform: string | null;
    amount: number | null;
    currency: string | null;
    status: string;
    purchased_at: string;
  }>;
  behavior: {
    lookback_days: number;
    pageviews_before_last_purchase: number;
    top_pages_before_last_purchase: Array<{ url: string; count: number }>;
    last_pageview_before_last_purchase?: null | { url: string; at: string };
    last_touch: null | Record<string, string>;
    meta_attribution: null | {
      campaign_id?: string | null;
      campaign_name?: string | null;
      adset_id?: string | null;
      adset_name?: string | null;
      ad_id?: string | null;
      ad_name?: string | null;
    };
    meta_attribution_source?: string | null;
  };
};

const money = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(n || 0);

function dt(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function BuyersTab({ siteId }: { siteId: number }) {
  const [rows, setRows] = useState<BuyerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<null | { externalId: string | null; buyerKey: string }>(null);
  const [detail, setDetail] = useState<BuyerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const canOpen = useMemo(() => !!selected, [selected]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/sites/${siteId}/buyers`, { params: { limit: 100 } });
      setRows((res.data?.buyers || []) as BuyerRow[]);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Erro ao carregar compradores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const res = selected.externalId
          ? await api.get(`/sites/${siteId}/buyers/${encodeURIComponent(selected.externalId)}`, { params: { lookback_days: 30 } })
          : await api.get(`/sites/${siteId}/buyers/by-key/${encodeURIComponent(selected.buyerKey)}`, { params: { lookback_days: 30 } });
        setDetail(res.data as BuyerDetail);
      } catch (e: any) {
        setDetail(null);
        setDetailError(e?.response?.data?.error || 'Erro ao carregar detalhes do comprador.');
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [siteId, selected]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Compradores</h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500 leading-relaxed">
            Lista de compradores do site/pixel com páginas acessadas e melhor atribuição possível (via UTMs/Meta quando existirem).
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40 disabled:opacity-40"
        >
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900/60">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Comprador</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Compras</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Receita</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-600 dark:text-zinc-500">
                    Nenhum comprador encontrado.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr
                  key={r.buyer_key}
                  className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-950/25 cursor-pointer"
                  onClick={() => setSelected({ externalId: r.external_id, buyerKey: r.buyer_key })}
                >
                  <td className="px-4 py-3">
                    <div className="text-zinc-900 dark:text-zinc-100 font-medium truncate max-w-[380px]">
                      {r.external_id || r.buyer_key}
                    </div>
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-500 truncate max-w-[380px]">{r.buyer_key}</div>
                    {!r.external_id ? (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">Sem external_id (abrindo por buyer_key)</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{r.purchases_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{money(Number(r.revenue || 0))}</td>
                  <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">{dt(r.last_purchase_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canOpen ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detalhes do comprador</div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">{selected?.externalId || selected?.buyerKey}</div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40"
            >
              Fechar
            </button>
          </div>

          {detailLoading ? (
            <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Carregando…</div>
          ) : detailError ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {detailError}
            </div>
          ) : detail ? (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Antes da última compra</div>
                <div className="text-sm text-zinc-900 dark:text-zinc-100">
                  Pageviews: <span className="font-semibold tabular-nums">{detail.behavior.pageviews_before_last_purchase}</span>
                </div>
                {detail.behavior.last_pageview_before_last_purchase ? (
                  <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Última página antes da compra: <span className="font-medium">{dt(detail.behavior.last_pageview_before_last_purchase.at)}</span>
                    <div className="mt-1 truncate" title={detail.behavior.last_pageview_before_last_purchase.url}>
                      {detail.behavior.last_pageview_before_last_purchase.url}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">Top páginas</div>
                <div className="mt-2 space-y-1">
                  {detail.behavior.top_pages_before_last_purchase.slice(0, 10).map((p) => (
                    <div key={p.url} className="flex items-center justify-between gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="truncate">{p.url}</span>
                      <span className="tabular-nums text-zinc-700 dark:text-zinc-200">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Atribuição (melhor esforço)</div>
                {detail.behavior.meta_attribution ? (
                  <div className="space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    <div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">Campanha:</span>{' '}
                      {detail.behavior.meta_attribution.campaign_name || detail.behavior.meta_attribution.campaign_id || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">Conjunto:</span>{' '}
                      {detail.behavior.meta_attribution.adset_name || detail.behavior.meta_attribution.adset_id || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">Anúncio:</span>{' '}
                      {detail.behavior.meta_attribution.ad_name || detail.behavior.meta_attribution.ad_id || '—'}
                    </div>
                    {detail.behavior.meta_attribution_source ? (
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                        Fonte: {detail.behavior.meta_attribution_source}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    Sem atribuição (faltando UTMs/ad_id).
                  </div>
                )}
                {detail.behavior.last_touch ? (
                  <>
                    <div className="mt-4 text-xs font-semibold text-zinc-600 dark:text-zinc-400">Último toque (UTMs)</div>
                    <pre className="mt-2 text-[11px] whitespace-pre-wrap rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/35 p-3 text-zinc-700 dark:text-zinc-200">
                      {JSON.stringify(detail.behavior.last_touch, null, 2)}
                    </pre>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

