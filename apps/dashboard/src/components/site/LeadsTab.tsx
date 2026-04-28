import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type LeadRow = {
  id: number;
  event_id: string;
  event_time: string;
  event_source_url: string | null;
  external_id: string | null;
  group_tag: string | null;
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
};

type LeadDetail = {
  lead: LeadRow & {
    user_data?: Record<string, unknown>;
    visitor?: { last_ip?: string | null; last_seen_at?: string | null } | null;
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

function deviceLabel(d: LeadRow['device']) {
  if (d === 'mobile') return 'Celular';
  if (d === 'tablet') return 'Tablet';
  if (d === 'desktop') return 'Desktop';
  return 'Indisponível';
}

function leadPrimaryName(data: Record<string, unknown>): string {
  const pick = (o: any, k: string) => (o && typeof o[k] === 'string' ? String(o[k]).trim() : '');
  const fields = (data as any)?.fields && typeof (data as any).fields === 'object' ? (data as any).fields : null;
  const name =
    pick(data, 'name') ||
    pick(data, 'nome') ||
    pick(data, 'full_name') ||
    pick(data, 'fullname') ||
    pick(fields, 'name') ||
    pick(fields, 'nome') ||
    pick(fields, 'full_name') ||
    pick(fields, 'fullname');
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
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200 truncate max-w-[220px]" title={r.group_tag || ''}>
                      {r.group_tag || '—'}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/60" onClick={() => setSelectedEventId(null)} aria-label="Fechar" />

          <div className="relative w-full max-w-5xl">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl overflow-hidden max-h-[calc(100vh-64px)] flex flex-col">
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {detail?.lead ? leadPrimaryName(detail.lead.data || {}) : 'Lead'}
                  </div>
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">event_id: {selectedEventId}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEventId(null)}
                  className="text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/25 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-950/40"
                >
                  Fechar
                </button>
              </div>

              <div className="p-4 overflow-auto flex-1">
                {detailLoading ? (
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Carregando…</div>
                ) : detailError ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{detailError}</div>
                ) : detail?.lead ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Contato</div>
                        <div className="mt-1 text-xs text-zinc-800 dark:text-zinc-200 truncate">{leadPrimaryEmail(detail.lead.data || {})}</div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">{leadPrimaryPhone(detail.lead.data || {})}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Origem (Meta/UTM)</div>
                        <div className="mt-1 text-[11px] text-zinc-700 dark:text-zinc-300">{attributionLine(detail.lead)}</div>
                        {detail.lead.meta_attribution_source ? (
                          <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">Fonte: {detail.lead.meta_attribution_source}</div>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-3">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Contexto</div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">Dispositivo: {deviceLabel(detail.lead.device)}</div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                          Localização: {[detail.lead.city, detail.lead.state, detail.lead.country].filter(Boolean).join(', ') || '—'}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">Tag: {detail.lead.group_tag || '—'}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/25 p-4">
                      <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Dados do cadastro (formatado)</div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 p-3">
                          <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-2">UTMs</div>
                          {([
                            ['utm_id', 'utm_id'],
                            ['utm_source', 'utm_source'],
                            ['utm_medium', 'utm_medium'],
                            ['utm_campaign', 'utm_campaign'],
                            ['utm_content', 'utm_content'],
                            ['utm_term', 'utm_term'],
                            ['click_id', 'click_id'],
                          ] as const).map(([k, label]) => (
                            <ValueRow key={k} label={label} value={pickString(detail.lead.data, k)} />
                          ))}
                        </div>

                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 p-3">
                          <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Página</div>
                          <ValueRow label="page_title" value={pickString(detail.lead.data, 'page_title')} />
                          <ValueRow label="page_path" value={pickString(detail.lead.data, 'page_path')} />
                          <ValueRow label="page_location" value={pickString(detail.lead.data, 'page_location')} />
                          <ValueRow label="event_url" value={pickString(detail.lead.data, 'event_url')} />
                        </div>

                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 p-3">
                          <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-2">IDs</div>
                          <ValueRow label="fbclid" value={pickString(detail.lead.data, 'fbclid')} />
                          <ValueRow label="fbc" value={pickString(detail.lead.data, 'fbc')} />
                          <ValueRow label="fbp" value={pickString(detail.lead.data, 'fbp')} />
                        </div>

                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/20 p-3">
                          <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Outros</div>
                          <ValueRow label="traffic_source" value={pickString(detail.lead.data, 'traffic_source')} />
                          <ValueRow label="device" value={deviceLabel(detail.lead.device)} />
                          <ValueRow label="tag" value={detail.lead.group_tag || '—'} />
                        </div>
                      </div>

                      <details className="mt-4">
                        <summary className="cursor-pointer text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200">
                          Ver JSON bruto
                        </summary>
                        <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3 text-[11px] text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap break-all">
                          {JSON.stringify(detail.lead.data || {}, null, 2)}
                        </pre>
                      </details>
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

