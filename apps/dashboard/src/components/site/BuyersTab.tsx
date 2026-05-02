import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type BuyerRow = {
  buyer_key: string;
  external_id: string | null;
  group_tag?: string | null;
  /** Sequência de grupos do visitante (ordem de entrada); lista pode exibir todas as badges. */
  group_tags?: string[];
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
    group_tags?: string[];
  };
  purchases: Array<{
    id: number;
    order_id: string;
    platform: string | null;
    amount: number | null;
    currency: string | null;
    status: string;
    purchased_at: string;
    group_tag?: string | null;
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
      /** Quantidade de PageViews da mesma página (slug) antes da última compra; linha = visita mais recente. */
      visit_count?: number;
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
    /** Trilha cronológica (do mais antigo ao mais recente): passos iguais em sequência são agrupados. */
    meta_ad_touch_trail?: Array<{
      started_at: string;
      ended_at: string;
      pageview_hits: number;
      page_slugs: string[];
      kind: 'meta' | 'utm' | 'fbc_only' | 'organic';
      utm: Record<string, string> | null;
      meta_attribution: null | {
        campaign_id?: string | null;
        campaign_name?: string | null;
        adset_id?: string | null;
        adset_name?: string | null;
        ad_id?: string | null;
        ad_name?: string | null;
      };
      meta_attribution_source?: string | null;
    }>;
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
function trailSegmentKindLabel(kind: 'meta' | 'utm' | 'fbc_only' | 'organic'): string {
  switch (kind) {
    case 'meta':
      return 'Meta (insights)';
    case 'utm':
      return 'UTMs na URL';
    case 'fbc_only':
      return 'Clique Meta (fbc)';
    default:
      return 'Orgânico';
  }
}

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

function PageSlugTag({
  url,
  visitCount,
  className,
}: {
  url: string;
  /** Acima de 1, mostra “N×” no badge (ex.: oferta-liberada 2×). */
  visitCount?: number;
  className?: string;
}) {
  const label = pageSlugLabelFromUrl(url);
  const suffix = visitCount != null && visitCount > 1 ? ` ${visitCount}×` : '';
  return (
    <span
      className={
        className ||
        'inline-flex max-w-full items-center truncate rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/90 dark:bg-zinc-800/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-800 dark:text-zinc-100'
      }
      title={url}
    >
      {label}
      {suffix}
    </span>
  );
}

function GroupTagBadge({ value }: { value: string }) {
  const v = (value || '').trim();
  if (!v) return null;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200 border border-emerald-500/20 dark:border-emerald-400/20">
      {v}
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
  const [groupTagFilter, setGroupTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const buyersPerPage = 20;

  const [selected, setSelected] = useState<null | { externalId: string | null; buyerKey: string; title?: string | null }>(null);
  const [detail, setDetail] = useState<BuyerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [purchasesPage, setPurchasesPage] = useState(1);
  const purchasesPerPage = 10;

  const canOpen = useMemo(() => !!selected, [selected]);

  const load = async (opts?: { page?: number }) => {
    setLoading(true);
    setError(null);
    try {
      const nextPage = Math.max(1, Number(opts?.page || page || 1));
      const offset = (nextPage - 1) * buyersPerPage;
      const res = await api.get(`/sites/${siteId}/buyers`, {
        // +1 para saber se existe próxima página sem depender de total_count no backend
        params: {
          limit: buyersPerPage + 1,
          offset,
          purchase_status: purchaseListFilter,
          group_tag: groupTagFilter || undefined,
        },
      });
      const received = (res.data?.buyers || []) as BuyerRow[];
      setHasNextPage(received.length > buyersPerPage);
      setRows(received.slice(0, buyersPerPage));
      setPage(nextPage);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Erro ao carregar compradores.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    setPage(1);
    load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, purchaseListFilter, groupTagFilter]);

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
          <input
            value={groupTagFilter}
            onChange={(e) => {
              setSelected(null);
              setGroupTagFilter(e.target.value);
            }}
            placeholder="Filtrar por grupo…"
            className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 min-w-[220px]"
          />
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
              onClick={() => load({ page })}
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
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Grupo</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Compras</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Receita</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-600 dark:text-zinc-500">
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
                  <td className="px-4 py-3 max-w-[280px]">
                    {(() => {
                      const tags =
                        r.group_tags && r.group_tags.length ? r.group_tags : r.group_tag ? [String(r.group_tag)] : [];
                      if (!tags.length) return <span className="text-zinc-500 dark:text-zinc-500">—</span>;
                      return (
                        <div className="flex flex-wrap gap-1" title={tags.join(' → ')}>
                          {tags.map((t, i) => (
                            <GroupTagBadge key={`${t}-${i}`} value={t} />
                          ))}
                        </div>
                      );
                    })()}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-zinc-600 dark:text-zinc-500">
          Página <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{page}</span>
          <span className="text-zinc-500 dark:text-zinc-600"> · </span>
          Mostrando até <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{buyersPerPage}</span> compradores por página
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => load({ page: Math.max(1, page - 1) })}
            disabled={page <= 1 || loading}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => load({ page: page + 1 })}
            disabled={!hasNextPage || loading}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40 disabled:opacity-40"
          >
            Próxima
          </button>
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
                        {(detail.purchases?.[0]?.group_tag || '').trim() ? (
                          <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate" title={detail.purchases?.[0]?.group_tag || ''}>
                            Grupo (última compra): {detail.purchases?.[0]?.group_tag}
                          </div>
                        ) : null}
                        {detail.buyer.group_tags && detail.buyer.group_tags.length ? (
                          <div className="mt-2">
                            <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Grupos (sequência no site)</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {detail.buyer.group_tags.map((t, i) => (
                                <GroupTagBadge key={`${t}-${i}`} value={t} />
                              ))}
                            </div>
                          </div>
                        ) : null}
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

                    {(detail.behavior.meta_ad_touch_trail?.length ?? 0) > 0 ? (
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                          Trilha de toques (anúncios / UTMs / orgânico)
                        </div>
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-3 leading-snug">
                          Ordem cronológica até a última compra. Passos consecutivos com o mesmo anúncio, UTMs ou cookie{' '}
                          <span className="font-mono text-[10px]">fbc</span> aparecem agrupados (quantidade de PageViews).
                          Mudança de UTMs ou de <span className="font-mono text-[10px]">fbc</span> abre um novo passo — útil para ver captura +
                          remarketing mesmo quando o último toque difere da atribuição da Meta na compra.
                        </p>
                        <div className="space-y-2">
                          {(detail.behavior.meta_ad_touch_trail || []).map((seg, idx) => {
                            const metaLine = formatJourneyMetaAttribution(seg.meta_attribution);
                            const utmLine = formatPageviewAttributionSummary(seg.utm);
                            return (
                              <div
                                key={`${seg.started_at}-${seg.ended_at}-${idx}`}
                                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{idx + 1}.</span>
                                  <span
                                    className="rounded-md border border-indigo-200/70 dark:border-indigo-800/60 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800 dark:text-indigo-200"
                                    title={trailSegmentKindLabel(seg.kind)}
                                  >
                                    {trailSegmentKindLabel(seg.kind)}
                                  </span>
                                  <span className="text-zinc-600 dark:text-zinc-400 tabular-nums">
                                    {dt(seg.started_at)}
                                    {seg.ended_at !== seg.started_at ? (
                                      <>
                                        {' '}
                                        → {dt(seg.ended_at)}
                                      </>
                                    ) : null}
                                  </span>
                                  <span className="text-zinc-500 dark:text-zinc-500">
                                    · {seg.pageview_hits} PageView{seg.pageview_hits !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                {metaLine ? (
                                  <div
                                    className="mt-1.5 text-[10px] leading-snug text-indigo-700/95 dark:text-indigo-300/90"
                                    title={seg.meta_attribution_source ? `Fonte: ${seg.meta_attribution_source}` : undefined}
                                  >
                                    <span className="font-semibold text-zinc-600 dark:text-zinc-400">Meta: </span>
                                    {metaLine}
                                  </div>
                                ) : seg.kind === 'fbc_only' ? (
                                  <div className="mt-1.5 text-[10px] text-amber-800/95 dark:text-amber-200/90">
                                    Cookie de clique presente, mas sem cruzamento com insights importados (ou limite de buscas).
                                    {seg.meta_attribution_source === 'lookup_limit' ? ' (limite de lookups na trilha.)' : null}
                                  </div>
                                ) : seg.kind === 'utm' && utmLine ? (
                                  <div className="mt-1.5 text-[10px] text-zinc-700 dark:text-zinc-300">{utmLine}</div>
                                ) : seg.kind === 'organic' ? (
                                  <div className="mt-1.5 text-[10px] text-zinc-600 dark:text-zinc-400">
                                    Sem UTMs detectáveis na URL e sem <span className="font-mono">fbc</span> no evento (ex.: tráfego direto ou
                                    links sem parâmetros).
                                  </div>
                                ) : utmLine ? (
                                  <div className="mt-1.5 text-[10px] text-zinc-700 dark:text-zinc-300">{utmLine}</div>
                                ) : null}
                                {seg.page_slugs.length ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {seg.page_slugs.map((slug) => (
                                      <span
                                        key={slug}
                                        className="inline-flex rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-800 dark:text-zinc-100"
                                      >
                                        {slug}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Jornada (PageViews antes da compra)</div>
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          Total: <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{detail.behavior.pageviews_before_last_purchase}</span>
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {' '}
                            · Tag = slug da página (passe o mouse para ver a URL completa). Mesmo slug repetido vira uma linha com contagem (ex.: 2×). Com UTMs alinhados à Meta, mostramos campanha, conjunto e anúncio.
                          </span>
                        </div>
                        {(detail.behavior.pageviews_timeline_before_last_purchase || []).length === 0 ? (
                          <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-500">
                            Sem dados de navegação para esse comprador. Isso acontece quando não conseguimos ligar a compra a um `external_id` usado nos eventos do site.
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          {(detail.behavior.pageviews_timeline_before_last_purchase || []).slice(0, 120).map((pv, idx) => (
                            <div
                              key={`${pv.at}-${pageSlugLabelFromUrl(pv.url)}-${idx}`}
                              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 px-3 py-2"
                            >
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
                                <PageSlugTag url={pv.url} visitCount={pv.visit_count} />
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

