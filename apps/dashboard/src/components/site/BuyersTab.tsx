import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  BarChart3,
  JourneyModalFrame,
  JourneyModalHeader,
  JourneyTimeline,
  LastAdPanel,
  Megaphone,
  MetricCard,
  MetricGrid4,
  OriginSaleCard,
  ShoppingBag,
  Smartphone,
  StatusPill,
  TechnicalAccordion,
  TopPagesGradientBars,
  initialsFromName,
  timelineIconFromPageSlug,
} from './VisitorJourneyModalLayout';

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

function buyerProbableSource(d: BuyerDetail): string {
  const lt = (d.buyer.last_traffic_source || '').trim();
  if (lt) return lt;
  if (d.behavior.meta_attribution) return 'Meta Ads';
  const u = d.behavior.last_touch;
  const src = (u?.utm_source || '').trim();
  const med = (u?.utm_medium || '').trim();
  if (src || med) return [src, med].filter(Boolean).join(' · ') || '—';
  return '—';
}

function buyerPathSteps(d: BuyerDetail): string[] {
  const timeline = d.behavior.pageviews_timeline_before_last_purchase || [];
  const slugs = timeline.map((pv) => pageSlugLabelFromUrl(pv.url));
  const out: string[] = [];
  for (const s of slugs) {
    if (out[out.length - 1] !== s) out.push(s);
  }
  out.push('Compra');
  return out;
}

function BuyerJourneyDetailView({
  detail,
  purchasesPage,
  setPurchasesPage,
  purchasesPerPage,
  detailLoading,
}: {
  detail: BuyerDetail;
  purchasesPage: number;
  setPurchasesPage: (n: number | ((p: number) => number)) => void;
  purchasesPerPage: number;
  detailLoading: boolean;
}) {
  const last = detail.purchases?.[0];
  const st = String(last?.status || '').toLowerCase();
  const approved = ['approved', 'paid', 'completed', 'active'].includes(st);

  const timelineItems = (detail.behavior.pageviews_timeline_before_last_purchase || []).slice(0, 50).map((pv, idx) => {
    const slug = pageSlugLabelFromUrl(pv.url);
    const utmS = formatPageviewAttributionSummary(pv.utm);
    const metaL = formatJourneyMetaAttribution(pv.meta_attribution);
    const subtitle = metaL ? metaL : utmS || undefined;
    const title = idx === 0 ? `Entrou por ${slug}` : `Visitou ${slug}`;
    return {
      at: dt(pv.at),
      title,
      subtitle,
      highlight: false,
      icon: timelineIconFromPageSlug(slug, idx),
    };
  });
  if (last) {
    timelineItems.push({
      at: dt(last.purchased_at),
      title: approved ? 'Compra aprovada' : `Compra · ${purchaseStatusLabel(last.status)}`,
      subtitle: last.order_id ? `Pedido ${last.order_id}` : undefined,
      highlight: true,
      icon: 'check',
    });
  }

  const topRows = detail.behavior.top_pages_before_last_purchase.slice(0, 8).map((p) => ({
    label: pageSlugLabelFromUrl(p.url),
    count: p.count,
  }));

  const m = detail.behavior.meta_attribution;
  const lt = detail.behavior.last_touch;
  const originStr =
    lt?.utm_source || lt?.utm_medium
      ? [lt?.utm_source, lt?.utm_medium].filter(Boolean).join(' / ')
      : detail.buyer.fbc
        ? 'fb / paid_social (estimado)'
        : '—';

  const pathSteps = buyerPathSteps(detail);
  const interactions = detail.behavior.pageviews_before_last_purchase;

  return (
    <>
      <MetricGrid4>
        <MetricCard
          icon={ShoppingBag}
          iconClass="bg-violet-500/15 text-violet-300"
          label="Valor da compra"
          value={last?.amount != null ? formatMoney(Number(last.amount), last.currency) : '—'}
        />
        <MetricCard
          icon={Megaphone}
          iconClass="bg-teal-500/15 text-teal-300"
          label="Origem provável"
          value={buyerProbableSource(detail)}
        />
        <MetricCard
          icon={BarChart3}
          iconClass="bg-sky-500/15 text-sky-300"
          label="Jornada"
          value={`${interactions} interações`}
        />
        <MetricCard
          icon={Smartphone}
          iconClass="bg-emerald-500/15 text-emerald-300"
          label="Dispositivo"
          value={deviceHintLabel(detail.behavior.user_agent?.device_hint)}
        />
      </MetricGrid4>

      <OriginSaleCard
        campaign={m?.campaign_name || m?.campaign_id || '—'}
        adset={m?.adset_name || m?.adset_id || '—'}
        ad={m?.ad_name || m?.ad_id || '—'}
        footerNote="Associado ao último toque detectado antes da compra."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <JourneyTimeline
          title="Linha do tempo da jornada"
          items={timelineItems}
          uniquePath={{
            steps: pathSteps,
            footer: `${interactions} interações antes da compra`,
            variant: 'purchase',
          }}
        />
        <div className="space-y-4">
          <TopPagesGradientBars title="Top páginas pré-compra" rows={topRows} />
          <LastAdPanel
            platform={m ? 'Meta Ads' : '—'}
            origin={originStr}
            campaign={m?.campaign_name || m?.campaign_id || '—'}
            content={m?.ad_name || m?.ad_id || '—'}
            audience={m?.adset_name || m?.adset_id || '—'}
          />
        </div>
      </div>

      <TechnicalAccordion>
        <div className="space-y-4 pt-3">
          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">Identificação</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
              <div>
                <span className="text-slate-500">external_id:</span>{' '}
                <span className="text-slate-200 font-mono break-all">{detail.buyer.external_id || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">buyer_key:</span>{' '}
                <span className="text-slate-200 font-mono break-all">{detail.buyer.buyer_key || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">fbp:</span>{' '}
                <span className="text-slate-200 font-mono break-all">{detail.buyer.fbp || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">fbc:</span>{' '}
                <span className="text-slate-200 font-mono break-all">{detail.buyer.fbc || '—'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">Contato (webhook)</div>
            <div className="text-[11px] text-slate-300 space-y-1">
              <div>{detail.buyer.customer_name || '—'}</div>
              <div className="text-slate-400">{detail.buyer.customer_email || '—'}</div>
              <div className="text-slate-400">{detail.buyer.customer_phone || '—'}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">User-Agent</div>
            {detail.behavior.user_agent?.effective_user_agent ? (
              <pre className="max-h-32 overflow-auto rounded-md border border-slate-800 bg-slate-950/50 p-2 text-[10px] text-slate-400 whitespace-pre-wrap break-all">
                {detail.behavior.user_agent.effective_user_agent}
              </pre>
            ) : (
              <div className="text-[11px] text-slate-500">Sem UA nos eventos ligados.</div>
            )}
          </div>

          {detail.behavior.last_touch ? (
            <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">Último toque (UTMs)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const).map((k) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-slate-800/60 pb-1">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-200 truncate max-w-[55%]" title={detail.behavior.last_touch?.[k] || ''}>
                      {detail.behavior.last_touch?.[k] || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(detail.behavior.meta_ad_touch_trail?.length ?? 0) > 0 ? (
            <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">Trilha de toques (detalhe)</div>
              <div className="space-y-2 max-h-48 overflow-y-auto text-[10px] text-slate-400">
                {(detail.behavior.meta_ad_touch_trail || []).map((seg, idx) => (
                  <div key={`${seg.started_at}-${idx}`} className="rounded border border-slate-800/80 p-2">
                    <div className="font-semibold text-slate-300">
                      {idx + 1}. {trailSegmentKindLabel(seg.kind)} · {seg.pageview_hits} PV
                    </div>
                    <div className="text-slate-500">{dt(seg.started_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold text-slate-300">Compras (todas)</div>
              <div className="text-[10px] text-slate-500">
                Total: <span className="font-semibold tabular-nums text-slate-300">{detail.purchases_total ?? 0}</span>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-2 pr-3">Data</th>
                    <th className="text-left py-2 pr-3">Pedido</th>
                    <th className="text-right py-2 pr-3">Valor</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.purchases.map((p) => (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{dt(p.purchased_at)}</td>
                      <td className="py-2 pr-3 text-slate-200 truncate max-w-[200px]" title={p.order_id}>
                        {p.order_id || '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-200 whitespace-nowrap">
                        {p.amount != null ? formatMoney(Number(p.amount), p.currency) : '—'}
                      </td>
                      <td className="py-2 text-slate-400">{purchaseStatusLabel(p.status)}</td>
                    </tr>
                  ))}
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
                      className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900/50 text-slate-200 disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    {pageNums.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPurchasesPage(n)}
                        disabled={detailLoading}
                        className={`text-[11px] px-2 py-1 rounded-lg border ${
                          n === current
                            ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
                            : 'border-slate-700 bg-slate-900/50 text-slate-200'
                        } disabled:opacity-40`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPurchasesPage((p) => Math.min(pages, p + 1))}
                      disabled={current >= pages || detailLoading}
                      className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 bg-slate-900/50 text-slate-200 disabled:opacity-40"
                    >
                      Próxima
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Página <span className="font-semibold tabular-nums">{current}</span> de{' '}
                    <span className="font-semibold tabular-nums">{pages}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </TechnicalAccordion>
    </>
  );
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
        <JourneyModalFrame
          onClose={() => setSelected(null)}
          header={
            <JourneyModalHeader
              initials={initialsFromName(
                detail?.buyer?.customer_name ||
                  detail?.buyer?.customer_email ||
                  selected?.title ||
                  selected?.externalId ||
                  selected?.buyerKey ||
                  ''
              )}
              name={
                detail?.buyer?.customer_name ||
                detail?.buyer?.customer_email ||
                selected?.title ||
                selected?.externalId ||
                selected?.buyerKey ||
                'Comprador'
              }
              subtitle="Resumo da compra e jornada até a conversão"
              badge={
                detail?.purchases?.[0] ? (
                  ['approved', 'paid', 'completed', 'active'].includes(String(detail.purchases[0].status || '').toLowerCase()) ? (
                    <StatusPill variant="success">Compra aprovada</StatusPill>
                  ) : (
                    <StatusPill variant="warning">{purchaseStatusLabel(detail.purchases[0].status)}</StatusPill>
                  )
                ) : null
              }
              onClose={() => setSelected(null)}
            />
          }
        >
          {detailLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">Carregando…</div>
          ) : detailError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{detailError}</div>
          ) : detail ? (
            <BuyerJourneyDetailView
              detail={detail}
              purchasesPage={purchasesPage}
              setPurchasesPage={setPurchasesPage}
              purchasesPerPage={purchasesPerPage}
              detailLoading={detailLoading}
            />
          ) : null}
        </JourneyModalFrame>
      ) : null}
    </div>
  );
}

