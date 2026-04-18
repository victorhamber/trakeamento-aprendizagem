import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type BuyerRow = {
  buyer_key: string;
  external_id: string | null;
  display_name?: string | null;
  last_customer_name?: string | null;
  last_customer_email?: string | null;
  last_customer_phone?: string | null;
  last_order_id?: string | null;
  purchases_count: number;
  revenue: number;
  /** Só preenchida quando todas as compras do comprador compartilham a mesma moeda (evita somar BRL+USD como um único símbolo). */
  revenue_currency: string | null;
  last_purchase_at: string | null;
};

type BuyerDetail = {
  buyer: {
    buyer_key?: string;
    external_id: string | null;
    customer_name?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
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
    customer_name?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
  }>;
  purchases_total?: number;
  behavior: {
    lookback_days: number;
    pageviews_before_last_purchase: number;
    top_pages_before_last_purchase: Array<{ url: string; count: number }>;
    last_pageview_before_last_purchase?: null | { url: string; at: string };
    pageviews_timeline_before_last_purchase?: Array<{
      at: string;
      url: string;
      utm?: Record<string, string> | null;
      meta_attribution?: null | {
        campaign_id?: string | null;
        campaign_name?: string | null;
        adset_id?: string | null;
        adset_name?: string | null;
        ad_id?: string | null;
        ad_name?: string | null;
      };
      meta_attribution_source?: string | null;
    }>;
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
    user_agent?: {
      device_hint: 'mobile' | 'tablet' | 'desktop' | 'unknown';
      from_last_pageview_before_purchase: string | null;
      from_visitor_profile: string | null;
      effective_user_agent: string | null;
    } | null;
  };
};

const deviceHintLabel = (h: string | undefined) => {
  switch (h) {
    case 'mobile':
      return 'Celular';
    case 'tablet':
      return 'Tablet';
    case 'desktop':
      return 'Desktop';
    default:
      return 'Indisponível';
  }
};

/** Meta (insights) por PageView da jornada — campanha / conjunto / anúncio. */
function formatJourneyMetaAttribution(
  m: {
    campaign_id?: string | null;
    campaign_name?: string | null;
    adset_id?: string | null;
    adset_name?: string | null;
    ad_id?: string | null;
    ad_name?: string | null;
  } | null | undefined
): string | null {
  if (!m) return null;
  const parts: string[] = [];
  const camp = (m.campaign_name || m.campaign_id || '').trim();
  const adset = (m.adset_name || m.adset_id || '').trim();
  const ad = (m.ad_name || m.ad_id || '').trim();
  if (camp) parts.push(`Campanha: ${camp}`);
  if (adset) parts.push(`Conjunto: ${adset}`);
  if (ad) parts.push(`Anúncio: ${ad}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Resumo na linha da jornada (UTMs vêm da API: URL + custom_data). Campanha quando existir; senão origem/mídia/click. */
function formatPageviewAttributionSummary(utm: Record<string, string> | null | undefined): string | null {
  if (!utm) return null;
  const camp = (utm.utm_campaign || '').trim();
  const cont = (utm.utm_content || '').trim();
  if (camp || cont) {
    const left = camp || '—';
    return cont ? `${left} · ${cont}` : left;
  }
  const src = (utm.utm_source || '').trim();
  const med = (utm.utm_medium || '').trim();
  const cid = (utm.click_id || '').trim();
  if (src || med) {
    const parts = [src, med].filter(Boolean);
    if (cid) parts.push(cid.length > 28 ? `${cid.slice(0, 26)}…` : cid);
    return parts.join(' · ');
  }
  if (cid) return cid.length > 36 ? `${cid.slice(0, 34)}…` : cid;
  return null;
}

/** Primeiro segmento do path para tag visual; raiz ou vazio → "página principal". */
function pageSlugLabelFromUrl(rawUrl: string): string {
  const s = (rawUrl || '').trim();
  if (!s) return 'página principal';
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return 'página principal';
    const segment = path.split('/').filter(Boolean)[0] || '';
    if (!segment) return 'página principal';
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  } catch {
    const q = s.indexOf('?');
    const withoutQuery = q >= 0 ? s.slice(0, q) : s;
    const afterHost = withoutQuery.replace(/^[^:]+:\/\//, '').replace(/^[^/]+/, '');
    const path = afterHost.replace(/^\/+|\/+$/g, '');
    if (!path) return 'página principal';
    const segment = path.split('/').filter(Boolean)[0] || '';
    if (!segment) return 'página principal';
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }
}

function PageSlugTag({ url, className }: { url: string; className?: string }) {
  const label = pageSlugLabelFromUrl(url);
  return (
    <span
      className={
        className ||
        'inline-flex max-w-full items-center truncate rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/90 dark:bg-zinc-800/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-800 dark:text-zinc-100'
      }
      title={url}
    >
      {label}
    </span>
  );
}

function formatMoney(n: number, currencyCode: string | null | undefined): string {
  const raw = (currencyCode || '').trim().toUpperCase();
  const code = /^[A-Z]{3}$/.test(raw) ? raw : 'BRL';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(
      n || 0
    );
  } catch {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  }
}

/** Receita agregada: só formata como moeda ISO quando a API confirma uma única moeda no período. */
function formatRevenueCell(n: number, singleCurrency: string | null | undefined): string {
  if (singleCurrency) return formatMoney(n, singleCurrency);
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)} *`;
}

function purchaseStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toLowerCase().trim();
  if (['approved', 'paid', 'completed', 'active'].includes(s)) return 'Aprovada';
  if (
    ['pending_payment', 'waiting_payment', 'pending', 'billet_printed', 'purchase_billet_printed'].includes(s)
  ) {
    return 'Aguardando pagamento';
  }
  return status?.trim() || '—';
}

type PurchaseListFilter = 'approved' | 'pending';

function dt(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function BuyersTab({ siteId }: { siteId: number }) {
  const [purchaseListFilter, setPurchaseListFilter] = useState<PurchaseListFilter>('approved');
  const [rows, setRows] = useState<BuyerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<null | { externalId: string | null; buyerKey: string; title?: string | null }>(null);
  const [detail, setDetail] = useState<BuyerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [purchasesPage, setPurchasesPage] = useState(1);
  const purchasesPerPage = 10;

  const canOpen = useMemo(() => !!selected, [selected]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/sites/${siteId}/buyers`, {
        params: { limit: 100, purchase_status: purchaseListFilter },
      });
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
  }, [siteId, purchaseListFilter]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setPurchasesPage(1);
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const res = selected.externalId
          ? await api.get(`/sites/${siteId}/buyers/${encodeURIComponent(selected.externalId)}`, {
              params: {
                lookback_days: 30,
                purchases_limit: purchasesPerPage,
                purchases_offset: 0,
                purchase_status: purchaseListFilter,
              },
            })
          : await api.get(`/sites/${siteId}/buyers/by-key/${encodeURIComponent(selected.buyerKey)}`, {
              params: {
                lookback_days: 30,
                purchases_limit: purchasesPerPage,
                purchases_offset: 0,
                purchase_status: purchaseListFilter,
              },
            });
        setDetail(res.data as BuyerDetail);
      } catch (e: any) {
        setDetail(null);
        setDetailError(e?.response?.data?.error || 'Erro ao carregar detalhes do comprador.');
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [siteId, selected, purchaseListFilter]);

  useEffect(() => {
    if (!selected) return;
    if (purchasesPage === 1) return; // já carregado no primeiro request
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const offset = (purchasesPage - 1) * purchasesPerPage;
        const res = selected.externalId
          ? await api.get(`/sites/${siteId}/buyers/${encodeURIComponent(selected.externalId)}`, {
              params: {
                lookback_days: 30,
                purchases_limit: purchasesPerPage,
                purchases_offset: offset,
                purchase_status: purchaseListFilter,
              },
            })
          : await api.get(`/sites/${siteId}/buyers/by-key/${encodeURIComponent(selected.buyerKey)}`, {
              params: {
                lookback_days: 30,
                purchases_limit: purchasesPerPage,
                purchases_offset: offset,
                purchase_status: purchaseListFilter,
              },
            });
        setDetail(res.data as BuyerDetail);
      } catch (e: any) {
        setDetail(null);
        setDetailError(e?.response?.data?.error || 'Erro ao carregar detalhes do comprador.');
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [siteId, selected, purchasesPage, purchaseListFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Compradores</h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500 leading-relaxed">
            Lista de compradores do site/pixel com páginas acessadas e melhor atribuição possível (via UTMs/Meta quando existirem).
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 p-0.5"
            role="group"
            aria-label="Filtrar por status da compra"
          >
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setPurchaseListFilter('approved');
              }}
              className={
                purchaseListFilter === 'approved'
                  ? 'text-xs px-3 py-2 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium'
                  : 'text-xs px-3 py-2 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }
            >
              Aprovadas
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setPurchaseListFilter('pending');
              }}
              className={
                purchaseListFilter === 'pending'
                  ? 'text-xs px-3 py-2 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium'
                  : 'text-xs px-3 py-2 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }
            >
              Aguardando pagamento
            </button>
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
                  onClick={() => setSelected({ externalId: r.external_id, buyerKey: r.buyer_key, title: r.display_name || r.last_order_id || r.external_id || r.buyer_key })}
                >
                  <td className="px-4 py-3">
                    <div className="text-zinc-900 dark:text-zinc-100 font-semibold truncate max-w-[420px]">
                      {r.display_name || r.last_customer_name || r.external_id || r.buyer_key}
                    </div>
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-500 truncate max-w-[420px]">
                      ID: {r.external_id || r.buyer_key}
                    </div>
                    {!r.external_id ? (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">Sem external_id (abrindo por buyer_key)</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{r.purchases_count}</td>
                  <td
                    className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200"
                    title={
                      r.revenue_currency
                        ? undefined
                        : 'Soma numérica: há mais de uma moeda entre as compras ou moeda não informada. Abra o comprador para ver cada valor na moeda correta.'
                    }
                  >
                    {formatRevenueCell(Number(r.revenue || 0), r.revenue_currency ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">{dt(r.last_purchase_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSelected(null)}
            aria-label="Fechar"
          />

          <div className="relative w-full max-w-5xl">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl overflow-hidden max-h-[calc(100vh-64px)] flex flex-col">
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {detail?.buyer?.customer_name || detail?.buyer?.customer_email || selected?.title || selected?.externalId || selected?.buyerKey}
                  </div>
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                    {selected?.externalId ? `external_id: ${selected.externalId}` : `buyer_key: ${selected?.buyerKey}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40"
                >
                  Fechar
                </button>
              </div>

              <div className="p-4 overflow-auto flex-1">
                {detailLoading ? (
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Carregando…</div>
                ) : detailError ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {detailError}
                  </div>
                ) : detail ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Compra (última)</div>
                        <div className="mt-1 text-xs text-zinc-800 dark:text-zinc-200">
                          {detail.purchases?.[0]?.amount != null
                            ? formatMoney(Number(detail.purchases[0].amount), detail.purchases[0].currency)
                            : '—'}{' '}
                          · {dt(detail.purchases?.[0]?.purchased_at)}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                          Pedido: {detail.purchases?.[0]?.order_id || '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Contato (webhook)</div>
                        <div className="mt-1 text-xs text-zinc-800 dark:text-zinc-200 truncate">
                          {detail.buyer.customer_name || '—'}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                          {detail.buyer.customer_email || '—'}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                          {detail.buyer.customer_phone || '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Atribuição (melhor esforço)</div>
                        {detail.behavior.meta_attribution ? (
                          <div className="mt-1 space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                              Tentamos atribuir pela combinação de UTMs e dados da Meta (quando disponíveis).
                            </div>
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
                              <div className="text-[10px] text-zinc-500 dark:text-zinc-500">Fonte: {detail.behavior.meta_attribution_source}</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                              Atribuição aparece quando existe UTM (ex.: `utm_content`/`utm_campaign`) ou quando conseguimos casar com a Meta.
                            </div>
                            <div className="mt-1">Sem atribuição para essa compra.</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                      <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Dispositivo (User-Agent)</div>
                      <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">
                        Estimativa a partir do navegador no último PageView antes da compra (quando existir) ou do perfil do visitante no site.
                      </div>
                      {detail.behavior.user_agent?.effective_user_agent ? (
                        <>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                              {deviceHintLabel(detail.behavior.user_agent?.device_hint)}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
                              {detail.behavior.user_agent?.device_hint === 'unknown' ? 'UA vazio' : 'heurística'}
                            </span>
                          </div>
                          {detail.behavior.user_agent?.from_last_pageview_before_purchase ? (
                            <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">Fonte: último pageview antes da compra</div>
                          ) : detail.behavior.user_agent?.from_visitor_profile ? (
                            <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">Fonte: último evento registrado no perfil</div>
                          ) : null}
                          <pre className="mt-2 max-h-24 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-2 text-[10px] text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-all">
                            {detail.behavior.user_agent.effective_user_agent}
                          </pre>
                        </>
                      ) : (
                        <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                          Sem User-Agent nos dados ligados a este comprador. Verifique se o rastreador envia{' '}
                          <code className="text-[10px]">client_user_agent</code> nos eventos.
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Compras (todas)</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-500">
                          Total: <span className="font-semibold tabular-nums">{detail.purchases_total ?? 0}</span>
                        </div>
                      </div>

                      <div className="mt-3 overflow-auto">
                        <table className="w-full text-[11px]">
                          <thead className="text-zinc-500 dark:text-zinc-500">
                            <tr>
                              <th className="text-left py-2 pr-3">Data</th>
                              <th className="text-left py-2 pr-3">Pedido</th>
                              <th className="text-right py-2 pr-3">Valor</th>
                              <th className="text-left py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.purchases.map((p) => (
                              <tr key={p.id} className="border-t border-zinc-200 dark:border-zinc-800">
                                <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{dt(p.purchased_at)}</td>
                                <td className="py-2 pr-3 text-zinc-800 dark:text-zinc-200 truncate max-w-[360px]" title={p.order_id}>
                                  {p.order_id || '—'}
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                                  {p.amount != null ? formatMoney(Number(p.amount), p.currency) : '—'}
                                </td>
                                <td className="py-2 text-zinc-600 dark:text-zinc-400">{purchaseStatusLabel(p.status)}</td>
                              </tr>
                            ))}
                            {detail.purchases.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-4 text-center text-zinc-500 dark:text-zinc-500">
                                  Nenhuma compra encontrada.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>

                      {(() => {
                        const total = Number(detail.purchases_total ?? 0);
                        const pages = Math.max(1, Math.ceil(total / purchasesPerPage));
                        if (pages <= 1) return null;
                        const current = purchasesPage;
                        const start = Math.max(1, current - 3);
                        const end = Math.min(pages, start + 6);
                        const pageNums = [];
                        for (let i = start; i <= end; i++) pageNums.push(i);
                        return (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setPurchasesPage((p) => Math.max(1, p - 1))}
                                disabled={current <= 1 || detailLoading}
                                className="text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 disabled:opacity-40"
                              >
                                Anterior
                              </button>
                              {pageNums.map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => setPurchasesPage(n)}
                                  disabled={detailLoading}
                                  className={
                                    `text-[11px] px-2 py-1 rounded-lg border ${
                                      n === current
                                        ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                                        : 'border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200'
                                    } disabled:opacity-40`
                                  }
                                >
                                  {n}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => setPurchasesPage((p) => Math.min(pages, p + 1))}
                                disabled={current >= pages || detailLoading}
                                className="text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 disabled:opacity-40"
                              >
                                Próxima
                              </button>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-500">
                              Página <span className="font-semibold tabular-nums">{current}</span> de{' '}
                              <span className="font-semibold tabular-nums">{pages}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Jornada (PageViews antes da compra)</div>
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          Total: <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{detail.behavior.pageviews_before_last_purchase}</span>
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {' '}
                            · Tag = slug da página (passe o mouse para ver a URL completa). Com UTMs alinhados à Meta, mostramos campanha, conjunto e anúncio.
                          </span>
                        </div>
                        {(detail.behavior.pageviews_timeline_before_last_purchase || []).length === 0 ? (
                          <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-500">
                            Sem dados de navegação para esse comprador. Isso acontece quando não conseguimos ligar a compra a um `external_id` usado nos eventos do site.
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          {(detail.behavior.pageviews_timeline_before_last_purchase || []).slice(0, 120).map((pv, idx) => (
                            <div key={`${pv.at}-${idx}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 px-3 py-2">
                              <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                                <span className="font-medium text-zinc-800 dark:text-zinc-200">{dt(pv.at)}</span>
                                {(() => {
                                  const summary = formatPageviewAttributionSummary(pv.utm);
                                  return summary ? (
                                    <span className="truncate max-w-[50%]" title={summary}>
                                      {summary}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-500 dark:text-zinc-500">sem utm</span>
                                  );
                                })()}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <PageSlugTag url={pv.url} />
                              </div>
                              {(() => {
                                const metaLine = formatJourneyMetaAttribution(pv.meta_attribution);
                                return metaLine ? (
                                  <div
                                    className="mt-1.5 text-[10px] leading-snug text-indigo-700/95 dark:text-indigo-300/90"
                                    title={pv.meta_attribution_source ? `Fonte: ${pv.meta_attribution_source}` : undefined}
                                  >
                                    <span className="font-semibold text-zinc-600 dark:text-zinc-400">Meta: </span>
                                    {metaLine}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          ))}
                          {(detail.behavior.pageviews_timeline_before_last_purchase || []).length > 120 ? (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-500">
                              Mostrando 120 de {(detail.behavior.pageviews_timeline_before_last_purchase || []).length}.
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Top páginas (pré-compra)</div>
                        <div className="space-y-1">
                          {detail.behavior.top_pages_before_last_purchase.slice(0, 15).map((p) => (
                            <div key={p.url} className="flex items-center justify-between gap-3 text-[11px]">
                              <PageSlugTag
                                url={p.url}
                                className="inline-flex min-w-0 max-w-[calc(100%-2.5rem)] items-center truncate rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/90 dark:bg-zinc-800/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-800 dark:text-zinc-100"
                              />
                              <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-200">{p.count}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 text-xs font-semibold text-zinc-600 dark:text-zinc-400">Último toque (UTMs)</div>
                        {detail.behavior.last_touch ? (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            {([
                              ['utm_source', 'Origem'],
                              ['utm_medium', 'Mídia'],
                              ['utm_campaign', 'Campanha'],
                              ['utm_content', 'Conteúdo'],
                              ['utm_term', 'Termo'],
                              ['click_id', 'Click ID'],
                            ] as const).map(([k, label]) => (
                              <div
                                key={k}
                                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 px-3 py-2 flex items-center justify-between gap-3"
                              >
                                <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
                                <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[60%]" title={detail.behavior.last_touch?.[k] || ''}>
                                  {detail.behavior.last_touch?.[k] || '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">Sem UTMs detectáveis.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

