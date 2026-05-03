import { useEffect, useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '../../lib/api';
import {
  BarChart3,
  JourneyModalFrame,
  JourneyModalHeader,
  JourneyTimeline,
  type TimelineItem,
  LastAdPanel,
  Megaphone,
  MetricCard,
  MetricGrid4,
  OriginSaleCard,
  Smartphone,
  StatusPill,
  TechnicalAccordion,
  TopPagesGradientBars,
  initialsFromName,
  timelineIconFromPageSlug,
} from './VisitorJourneyModalLayout';

type LeadRow = {
  id: number;
  event_id: string;
  event_time: string;
  event_source_url: string | null;
  external_id: string | null;
  group_tag: string | null;
  /** Histórico ordenado de grupos do visitante (sem substituir tag antiga). */
  group_tags?: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  utm: Record<string, string> | null;
  meta_attribution: null | {
    campaign_id?: string | null;
    campaign_name?: string | null;
    adset_id?: string | null;
    adset_name?: string | null;
    ad_id?: string | null;
    ad_name?: string | null;
  };
  meta_attribution_source: string | null;
  data: Record<string, unknown>;
  user_data?: Record<string, unknown>;
};

type LeadHistoryItem = {
  event_time: string;
  page_path?: string | null;
  page_title?: string | null;
  page_location?: string | null;
  event_url?: string | null;
};

type LeadDetail = {
  lead: LeadRow & {
    group_tags?: string[];
    user_data?: Record<string, unknown>;
    visitor?: { last_ip?: string | null; last_seen_at?: string | null } | null;
    history?: LeadHistoryItem[];
  };
};

function dt(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function timelineSortMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function deviceLabel(d: LeadRow['device']) {
  if (d === 'mobile') return 'Celular';
  if (d === 'tablet') return 'Tablet';
  if (d === 'desktop') return 'Desktop';
  return 'Indisponível';
}

function leadPrimaryName(data: Record<string, unknown>): string {
  const pick = (o: any, k: string) => (o && typeof o[k] === 'string' ? String(o[k]).trim() : '');
  const fields = (data as any)?.fields && typeof (data as any).fields === 'object' ? (data as any).fields : null;
  const fn =
    pick(data, 'fn') ||
    pick(data, 'first_name') ||
    pick(data, 'firstname') ||
    pick(fields, 'fn') ||
    pick(fields, 'first_name') ||
    pick(fields, 'firstname');
  const ln =
    pick(data, 'ln') ||
    pick(data, 'last_name') ||
    pick(data, 'lastname') ||
    pick(fields, 'ln') ||
    pick(fields, 'last_name') ||
    pick(fields, 'lastname');
  const name =
    pick(data, 'name') ||
    pick(data, 'nome') ||
    pick(data, 'full_name') ||
    pick(data, 'fullname') ||
    pick(fields, 'name') ||
    pick(fields, 'nome') ||
    pick(fields, 'full_name') ||
    pick(fields, 'fullname') ||
    [fn, ln].filter(Boolean).join(' ').trim();
  return name || '—';
}

function leadPrimaryEmail(data: Record<string, unknown>): string {
  const pick = (o: any, k: string) => (o && typeof o[k] === 'string' ? String(o[k]).trim() : '');
  const fields = (data as any)?.fields && typeof (data as any).fields === 'object' ? (data as any).fields : null;
  return (
    pick(data, 'email') ||
    pick(data, 'mail') ||
    pick(data, 'e_mail') ||
    pick(fields, 'email') ||
    pick(fields, 'mail') ||
    pick(fields, 'e_mail') ||
    '—'
  );
}

function leadPrimaryPhone(data: Record<string, unknown>): string {
  const pick = (o: any, k: string) => (o && typeof o[k] === 'string' ? String(o[k]).trim() : '');
  const fields = (data as any)?.fields && typeof (data as any).fields === 'object' ? (data as any).fields : null;
  return (
    pick(data, 'phone') ||
    pick(data, 'telefone') ||
    pick(data, 'celular') ||
    pick(data, 'whatsapp') ||
    pick(fields, 'phone') ||
    pick(fields, 'telefone') ||
    pick(fields, 'celular') ||
    pick(fields, 'whatsapp') ||
    '—'
  );
}

function pickString(data: Record<string, unknown> | null | undefined, key: string): string {
  const d = data || {};
  const v = (d as any)[key];
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    const s = v.find((x) => typeof x === 'string' && x.trim());
    return typeof s === 'string' ? s.trim() : '';
  }
  // Fallback: alguns campos podem estar dentro de `fields` (ex.: capturados do formulário)
  const fields = (d as any)?.fields && typeof (d as any).fields === 'object' ? (d as any).fields : null;
  if (fields && typeof fields === 'object') {
    const fv = (fields as any)[key];
    if (typeof fv === 'string') return fv.trim();
    if (Array.isArray(fv)) {
      const s2 = fv.find((x: any) => typeof x === 'string' && x.trim());
      return typeof s2 === 'string' ? s2.trim() : '';
    }
  }
  return '';
}

function pickStringAny(key: string, ...sources: Array<Record<string, unknown> | null | undefined>): string {
  for (const s of sources) {
    const v = pickString(s as any, key);
    if (v) return v;
  }
  return '';
}

function TagBadge({ value }: { value: string }) {
  const v = (value || '').trim();
  if (!v) return <span className="text-zinc-500 dark:text-zinc-500">—</span>;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200 border border-emerald-500/20 dark:border-emerald-400/20">
      {v}
    </span>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-zinc-500 dark:text-zinc-500">{label}</span>
      <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[70%]" title={value}>
        {value || '—'}
      </span>
    </div>
  );
}

function attributionLine(row: LeadRow): string {
  const m = row.meta_attribution;
  const camp = (m?.campaign_name || m?.campaign_id || '').trim();
  const adset = (m?.adset_name || m?.adset_id || '').trim();
  const ad = (m?.ad_name || m?.ad_id || '').trim();
  if (camp || adset || ad) {
    const parts = [camp && `Campanha: ${camp}`, adset && `Conjunto: ${adset}`, ad && `Anúncio: ${ad}`].filter(Boolean);
    return parts.join(' · ');
  }
  const u = row.utm || null;
  const uCamp = (u?.utm_campaign || '').trim();
  const uCont = (u?.utm_content || '').trim();
  const uSrc = (u?.utm_source || '').trim();
  const uMed = (u?.utm_medium || '').trim();
  if (uCamp || uCont) return [uCamp || '—', uCont].filter(Boolean).join(' · ');
  if (uSrc || uMed) return [uSrc, uMed].filter(Boolean).join(' · ');
  return '—';
}

function leadPathLabelFromPath(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return 'página principal';
  const clean = s.replace(/^\/+|\/+$/g, '');
  if (!clean) return 'página principal';
  const seg = clean.split('/').filter(Boolean)[0] || '';
  if (!seg) return 'página principal';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function leadHistoryStepLabel(h: LeadHistoryItem): string {
  const raw =
    String(h.page_path || '').trim() ||
    String(h.page_location || '').trim() ||
    String(h.event_url || '').trim() ||
    '';
  if (!raw) return 'página principal';
  if (/^https?:\/\//i.test(raw)) {
    try {
      return leadPathLabelFromPath(new URL(raw).pathname);
    } catch {
      return leadPathLabelFromPath(raw);
    }
  }
  return leadPathLabelFromPath(raw);
}

function leadProbableSource(row: LeadRow): string {
  if (row.meta_attribution) return 'Meta Ads';
  const u = row.utm;
  const src = (u?.utm_source || '').trim();
  const med = (u?.utm_medium || '').trim();
  if (src || med) return [src, med].filter(Boolean).join(' · ') || '—';
  return '—';
}

function LeadJourneyDetailView({ lead }: { lead: LeadDetail['lead'] }) {
  const history = Array.isArray(lead.history) ? lead.history : [];
  const historyChrono = [...history].sort(
    (a, b) => timelineSortMs(String(a.event_time || '')) - timelineSortMs(String(b.event_time || ''))
  );

  const slugSteps: string[] = [];
  for (const h of historyChrono) {
    const label = leadHistoryStepLabel(h);
    if (slugSteps[slugSteps.length - 1] !== label) slugSteps.push(label);
  }
  const pathSteps = [...slugSteps, 'Lead'];

  const counts = new Map<string, number>();
  for (const h of history) {
    const label = leadHistoryStepLabel(h);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const topRows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const recentHist = historyChrono.slice(-40);
  type MergedLead = { kind: 'h'; t: string; h: LeadHistoryItem } | { kind: 'lead'; t: string };
  const merged: MergedLead[] = [
    ...recentHist.map((h) => ({ kind: 'h' as const, t: String(h.event_time || ''), h })),
    { kind: 'lead' as const, t: String(lead.event_time || '') },
  ].sort((a, b) => timelineSortMs(a.t) - timelineSortMs(b.t));

  const leadEmail = leadPrimaryEmail(lead.data || {});
  let histOrdinal = 0;
  const timelineItems: TimelineItem[] = merged.map((row) => {
    if (row.kind === 'lead') {
      return {
        at: dt(row.t),
        title: 'Lead capturado',
        subtitle: leadEmail !== '—' ? leadEmail : undefined,
        highlight: true,
        icon: 'check',
      };
    }
    const idx = histOrdinal++;
    const slug = leadHistoryStepLabel(row.h);
    const title = idx === 0 ? `Entrou por ${slug}` : `Visitou ${slug}`;
    const subtitle = String(row.h.page_title || '').trim() || undefined;
    return {
      at: dt(String(row.h.event_time || '')),
      title,
      subtitle,
      highlight: false,
      icon: timelineIconFromPageSlug(slug, idx),
    };
  });

  const m = lead.meta_attribution;
  const u = lead.utm;
  const originStr =
    u?.utm_source || u?.utm_medium
      ? [u?.utm_source, u?.utm_medium].filter(Boolean).join(' / ')
      : pickStringAny('fbc', lead.data, lead.user_data)
        ? 'fb / paid_social (estimado)'
        : '—';

  return (
    <>
      <MetricGrid4>
        <MetricCard
          icon={Mail}
          iconClass="bg-violet-500/15 text-violet-300"
          label="Contato"
          value={leadPrimaryEmail(lead.data || {})}
        />
        <MetricCard
          icon={Megaphone}
          iconClass="bg-teal-500/15 text-teal-300"
          label="Origem provável"
          value={leadProbableSource(lead)}
        />
        <MetricCard
          icon={BarChart3}
          iconClass="bg-sky-500/15 text-sky-300"
          label="Jornada"
          value={`${history.length} interações`}
        />
        <MetricCard
          icon={Smartphone}
          iconClass="bg-emerald-500/15 text-emerald-300"
          label="Dispositivo"
          value={deviceLabel(lead.device)}
        />
      </MetricGrid4>

      <OriginSaleCard
        heading="Origem do cadastro"
        campaign={m?.campaign_name || m?.campaign_id || (u?.utm_campaign || '—')}
        adset={m?.adset_name || m?.adset_id || '—'}
        ad={m?.ad_name || m?.ad_id || (u?.utm_content || '—')}
        footerNote="Associado ao último toque registrado antes do envio do formulário."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <JourneyTimeline
          title="Linha do tempo da jornada"
          items={timelineItems}
          uniquePath={{
            steps: pathSteps,
            footer: `${history.length} interações antes do cadastro`,
            variant: 'lead',
          }}
        />
        <div className="space-y-4">
          <TopPagesGradientBars title="Top páginas antes do cadastro" rows={topRows} />
          <LastAdPanel
            platform={m ? 'Meta Ads' : '—'}
            origin={originStr}
            campaign={m?.campaign_name || m?.campaign_id || u?.utm_campaign || '—'}
            content={m?.ad_name || m?.ad_id || u?.utm_content || '—'}
            audience={m?.adset_name || m?.adset_id || '—'}
          />
        </div>
      </div>

      <TechnicalAccordion>
        <div className="space-y-4 pt-3">
          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">Cadastro</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
              <div>
                <span className="text-slate-500">Nome:</span> <span className="text-slate-200">{leadPrimaryName(lead.data || {})}</span>
              </div>
              <div>
                <span className="text-slate-500">Telefone:</span> <span className="text-slate-200">{leadPrimaryPhone(lead.data || {})}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Local:</span>{' '}
                <span className="text-slate-200">{[lead.city, lead.state, lead.country].filter(Boolean).join(', ') || '—'}</span>
              </div>
              {lead.meta_attribution_source ? (
                <div className="sm:col-span-2">
                  <span className="text-slate-500">Fonte da atribuição:</span>{' '}
                  <span className="text-slate-200">{lead.meta_attribution_source}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">UTMs (payload)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'] as const).map((k) => (
                <div key={k} className="flex justify-between gap-2 border-b border-slate-800/60 pb-1">
                  <span className="text-slate-500">{k}</span>
                  <span className="text-slate-200 truncate max-w-[55%]" title={pickString(lead.data, k)}>
                    {pickString(lead.data, k) || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">IDs</div>
            <div className="space-y-1 text-[11px]">
              <ValueRow label="fbclid" value={pickStringAny('fbclid', lead.data, lead.user_data)} />
              <ValueRow label="fbc" value={pickStringAny('fbc', lead.data, lead.user_data)} />
              <ValueRow label="fbp" value={pickStringAny('fbp', lead.data, lead.user_data)} />
            </div>
          </div>

          {history.length ? (
            <div className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">Histórico completo (tabela)</div>
              <div className="max-h-[240px] overflow-auto rounded-md border border-slate-800">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-slate-800">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 text-slate-400 w-[160px]">Quando</th>
                      <th className="text-left font-semibold px-3 py-2 text-slate-400">Página</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyChrono.slice(-40).map((h, idx) => {
                      const when = dt(String(h?.event_time || ''));
                      const page =
                        String(h?.page_path || '').trim() ||
                        String(h?.event_url || '').trim() ||
                        String(h?.page_location || '').trim() ||
                        '—';
                      const title = String(h?.page_title || '').trim();
                      return (
                        <tr key={idx} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{when}</td>
                          <td className="px-3 py-2 text-slate-200">
                            <div className="truncate max-w-[480px]" title={page}>
                              {page}
                            </div>
                            {title ? (
                              <div className="text-[10px] text-slate-500 truncate max-w-[480px]" title={title}>
                                {title}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <details className="rounded-lg border border-slate-800 bg-zinc-950 p-3">
            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">Ver JSON bruto</summary>
            <pre className="mt-2 max-h-[280px] overflow-auto rounded-md border border-slate-800 bg-slate-950/50 p-2 text-[10px] text-slate-400 whitespace-pre-wrap break-all">
              {JSON.stringify(lead.data || {}, null, 2)}
            </pre>
          </details>
        </div>
      </TechnicalAccordion>
    </>
  );
}

export function LeadsTab({ siteId }: { siteId: number }) {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupTagFilter, setGroupTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const leadsPerPage = 20;

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = async (opts?: { page?: number }) => {
    setLoading(true);
    setError(null);
    try {
      const nextPage = Math.max(1, Number(opts?.page || page || 1));
      const offset = (nextPage - 1) * leadsPerPage;
      const res = await api.get(`/sites/${siteId}/leads`, {
        params: {
          limit: leadsPerPage + 1,
          offset,
          group_tag: groupTagFilter || undefined,
        },
      });
      const received = (res.data?.leads || []) as LeadRow[];
      setHasNextPage(received.length > leadsPerPage);
      setRows(received.slice(0, leadsPerPage));
      setPage(nextPage);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Erro ao carregar leads.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedEventId(null);
    setPage(1);
    load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, groupTagFilter]);

  useEffect(() => {
    if (!selectedEventId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const res = await api.get(`/sites/${siteId}/leads/${encodeURIComponent(selectedEventId)}`);
        setDetail(res.data as LeadDetail);
      } catch (e: any) {
        setDetail(null);
        setDetailError(e?.response?.data?.error || 'Erro ao carregar detalhes do lead.');
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [siteId, selectedEventId]);

  const canOpen = useMemo(() => !!selectedEventId, [selectedEventId]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Leads</h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500 leading-relaxed">
            Leads aqui são apenas para auditoria (ver se o formulário e o rastreamento estão funcionando). Mantemos no máximo 20 por site; ao entrar um novo, os mais antigos são removidos.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            value={groupTagFilter}
            onChange={(e) => {
              setSelectedEventId(null);
              setGroupTagFilter(e.target.value);
            }}
            placeholder="Filtrar por tag…"
            className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 min-w-[220px]"
          />
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
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Lead</th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Tag</th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Origem (Meta/UTM)</th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Dispositivo</th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Localização</th>
                <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-600 dark:text-zinc-500">
                    Nenhum lead encontrado.
                  </td>
                </tr>
              ) : null}

              {rows.map((r) => {
                const name = leadPrimaryName(r.data || {});
                const email = leadPrimaryEmail(r.data || {});
                const phone = leadPrimaryPhone(r.data || {});
                const loc = [r.city, r.state, r.country].filter(Boolean).join(', ') || '—';
                const origin = attributionLine(r);
                return (
                  <tr
                    key={r.event_id}
                    className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-950/25 cursor-pointer"
                    onClick={() => setSelectedEventId(r.event_id)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-zinc-900 dark:text-zinc-100 font-semibold truncate max-w-[360px]">{name}</div>
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-500 truncate max-w-[360px]">{email}</div>
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-500 truncate max-w-[360px]">{phone}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      {(() => {
                        const tags =
                          r.group_tags && r.group_tags.length ? r.group_tags : r.group_tag ? [r.group_tag] : [];
                        if (!tags.length) return <TagBadge value="" />;
                        return (
                          <div className="flex flex-wrap gap-1" title={tags.join(' → ')}>
                            {tags.map((t, i) => (
                              <TagBadge key={`${t}-${i}`} value={t} />
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 truncate max-w-[420px]" title={origin}>
                      {origin}
                      {r.meta_attribution_source ? (
                        <span className="ml-2 text-[10px] text-zinc-500 dark:text-zinc-500">({r.meta_attribution_source})</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 whitespace-nowrap">{deviceLabel(r.device)}</td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 truncate max-w-[260px]" title={loc}>
                      {loc}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{dt(String(r.event_time || ''))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-zinc-600 dark:text-zinc-500">
          Página <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{page}</span>
          <span className="text-zinc-500 dark:text-zinc-600"> · </span>
          Mostrando até <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{leadsPerPage}</span> leads por página
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
          onClose={() => setSelectedEventId(null)}
          header={
            <JourneyModalHeader
              initials={initialsFromName(detail?.lead ? leadPrimaryName(detail.lead.data || {}) : 'Lead')}
              name={detail?.lead ? leadPrimaryName(detail.lead.data || {}) : 'Lead'}
              subtitle="Resumo do cadastro e jornada até a conversão"
              badge={<StatusPill variant="info">Lead capturado</StatusPill>}
              onClose={() => setSelectedEventId(null)}
            />
          }
        >
          {detailLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">Carregando…</div>
          ) : detailError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{detailError}</div>
          ) : detail?.lead ? (
            <LeadJourneyDetailView lead={detail.lead} />
          ) : null}
        </JourneyModalFrame>
      ) : null}
    </div>
  );
}

