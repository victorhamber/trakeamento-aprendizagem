import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type RedirectLinkRow = {
  id: number;
  host: string;
  name: string;
  slug: string;
  destination_url: string;
  event_name: string;
  parameters: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

const EVENT_OPTIONS = [
  { value: 'Purchase', label: 'Purchase (Compra)' },
  { value: 'Lead', label: 'Lead (Cadastro)' },
  { value: 'AddPaymentInfo', label: 'AddPaymentInfo' },
  { value: 'AddToCart', label: 'AddToCart' },
  { value: 'InitiateCheckout', label: 'InitiateCheckout' },
  { value: 'ViewContent', label: 'ViewContent' },
  { value: 'PageView', label: 'PageView' },
  { value: 'Contact', label: 'Contact' },
  { value: 'Custom', label: 'Personalizado...' },
];

export function RedirectLinksTab(props: {
  siteId: string;
  showFlash: (msg: string, type?: 'success' | 'error') => void;
}) {
  const siteIdNum = props.siteId;

  const inputCls =
    'w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/35 transition-all placeholder:text-zinc-500';
  const selectCls =
    'w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-200 outline-none focus:border-indigo-500 transition-colors';

  const [links, setLinks] = useState<RedirectLinkRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [eventType, setEventType] = useState<string>('Lead');
  const [customEventName, setCustomEventName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string>('');
  const [crmQualify, setCrmQualify] = useState(false);
  const [crmEventName, setCrmEventName] = useState('');
  const [crmTool, setCrmTool] = useState('');
  const [crmLabel, setCrmLabel] = useState('');

  const normalizedSlug = useMemo(() => {
    const s = (slug || '').trim().toLowerCase().replace(/^\/+/, '');
    return s;
  }, [slug]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/sites/${siteIdNum}/redirect-links`);
      setLinks(res.data?.links || []);
    } catch (e) {
      console.error(e);
      props.showFlash('Erro ao carregar links.', 'error');
    } finally {
      setLoading(false);
    }
  }, [props, siteIdNum]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSlug('');
    setDestinationUrl('');
    setEventType('Lead');
    setCustomEventName('');
    setIsActive(true);
    setCrmQualify(false);
    setCrmEventName('');
    setCrmTool('');
    setCrmLabel('');
  };

  const handleEdit = (row: RedirectLinkRow) => {
    setEditingId(row.id);
    setName(row.name || '');
    setSlug(row.slug || '');
    setDestinationUrl(row.destination_url || '');
    setEventType(row.event_name || 'Lead');
    setCustomEventName('');
    setIsActive(row.is_active !== false);
    const p =
      row.parameters && typeof row.parameters === 'object' && !Array.isArray(row.parameters)
        ? (row.parameters as Record<string, unknown>)
        : {};
    const q = p._crm_qualify === true || p._crm_qualify === 'true' || p._crm_qualify === 1 || p._crm_qualify === '1';
    setCrmQualify(Boolean(q));
    setCrmEventName(typeof p._crm_event_name === 'string' ? p._crm_event_name : '');
    setCrmTool(typeof p._crm_tool === 'string' ? p._crm_tool : '');
    setCrmLabel(typeof p._crm_label === 'string' ? p._crm_label : '');
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Excluir este link?')) return;
    try {
      await api.delete(`/sites/${siteIdNum}/redirect-links/${id}`);
      props.showFlash('Link removido.', 'success');
      await load();
    } catch (e) {
      console.error(e);
      props.showFlash('Erro ao remover link.', 'error');
    }
  };

  const handleSave = async () => {
    const resolvedEventName =
      eventType === 'Custom' ? (customEventName || '').trim() : (eventType || '').trim();
    if (eventType === 'Custom' && !resolvedEventName) {
      props.showFlash('Informe o nome do evento personalizado.', 'error');
      return;
    }
    const parameters: Record<string, unknown> = {};
    if (crmQualify) {
      parameters._crm_qualify = true;
      if (crmEventName.trim()) parameters._crm_event_name = crmEventName.trim();
      if (crmTool.trim()) parameters._crm_tool = crmTool.trim();
      if (crmLabel.trim()) parameters._crm_label = crmLabel.trim();
    }
    const payload = {
      name: (name || '').trim(),
      slug: normalizedSlug,
      destination_url: (destinationUrl || '').trim(),
      event_name: resolvedEventName,
      parameters,
      is_active: isActive,
    };

    try {
      if (editingId) {
        const res = await api.put(`/sites/${siteIdNum}/redirect-links/${editingId}`, payload);
        props.showFlash('Link atualizado.', 'success');
        const link = res?.data?.link as RedirectLinkRow | undefined;
        if (link?.host && link?.slug) setLastCreatedUrl(`https://${link.host}/${link.slug}`);
      } else {
        const res = await api.post(`/sites/${siteIdNum}/redirect-links`, payload);
        props.showFlash('Link criado.', 'success');
        const link = res?.data?.link as RedirectLinkRow | undefined;
        if (link?.host && link?.slug) setLastCreatedUrl(`https://${link.host}/${link.slug}`);
      }
      await load();
      resetForm();
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data?.error || 'Erro ao salvar link.';
      props.showFlash(msg, 'error');
    }
  };

  const generatedUrl = useMemo(() => {
    const row =
      normalizedSlug && links.length
        ? links.find((l) => String(l.slug || '').toLowerCase() === normalizedSlug.toLowerCase()) || null
        : null;
    const host = row?.host || (links[0]?.host || 'app.trajettu.com');
    if (!normalizedSlug) return '';
    return `https://${host}/${normalizedSlug}`;
  }, [links, normalizedSlug]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Links (Redirecionador + Evento)</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-500">
          Crie um link do tipo <code className="text-xs">https://trajettu.com/seu-slug</code> que dispara o evento escolhido e
          redireciona levando UTMs e IDs do pixel.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-zinc-50 dark:bg-zinc-900/30 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Nome (identificação)</label>
          <input
            aria-label="Nome do link"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Ex: Link Whats V1"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Slug</label>
          <input
            aria-label="Slug do link"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className={inputCls}
            placeholder="teste"
          />
        </div>
        <div className="md:col-span-5">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Destino final</label>
          <input
            aria-label="URL de destino"
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
            className={inputCls}
            placeholder="https://seusite.com/oferta"
          />
        </div>

        {/* Linha 2 */}
        <div className="md:col-span-4">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Evento ao clicar</label>
          <select
            aria-label="Evento ao clicar no link"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className={selectCls}
          >
            {EVENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {eventType === 'Custom' && (
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Nome do Evento</label>
            <input
              aria-label="Nome do evento personalizado"
              value={customEventName}
              onChange={(e) => setCustomEventName(e.target.value)}
              className={inputCls}
              placeholder="Ex: StartTrial"
            />
          </div>
        )}
        <div className={(eventType === 'Custom' ? 'md:col-span-2' : 'md:col-span-3') + ' flex flex-col justify-end'}>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Ativo</label>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              aria-label="Ativar link"
              title="Ativar link"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-500"
            />
            Link ativo
          </label>
        </div>
        <div className={(eventType === 'Custom' ? 'md:col-span-3' : 'md:col-span-5') + ' flex gap-2'}>
          <button
            type="button"
            disabled={loading}
            onClick={handleSave}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-60"
          >
            {editingId ? 'Atualizar' : 'Adicionar'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {generatedUrl && (
          <div className="md:col-span-12">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Link gerado</label>
            <div className="flex gap-2">
              <input
                aria-label="Link gerado"
                readOnly
                value={generatedUrl}
                className={inputCls + ' font-mono'}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(generatedUrl);
                  props.showFlash('Link copiado!', 'success');
                }}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-2.5 rounded-lg text-xs font-medium transition-colors shrink-0 border border-zinc-800"
              >
                Copiar
              </button>
            </div>
          </div>
        )}

        {/* CRM Meta (meio do funil) */}
        <div className="md:col-span-12 border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-1">
          <div className="flex items-start gap-3">
            <input
              id="dash-redirect-link-crm-qualify"
              type="checkbox"
              checked={crmQualify}
              onChange={(e) => setCrmQualify(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <label
                htmlFor="dash-redirect-link-crm-qualify"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer"
              >
                Marcar meio do funil nesta regra (Meta / CRM)
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20 align-middle">
                  opcional
                </span>
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Ao abrir este link, além do evento escolhido, o Trajettu também envia a etapa intermediária com os campos que a
                Meta pede. Abra “Avançado” só se quiser personalizar.
              </p>

              {crmQualify && (
                <details className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/40 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-200 list-none [&::-webkit-details-marker]:hidden">
                    Avançado — só preencha se sua conta/uso pedir nomes diferentes na Meta
                  </summary>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Nome da etapa no funil na Meta (<code className="text-[10px]">event_name</code>)
                      </label>
                      <input
                        aria-label="CRM event name"
                        value={crmEventName}
                        onChange={(e) => setCrmEventName(e.target.value)}
                        placeholder='Ex.: "Oportunidade" — vazio usa Qualificado'
                        maxLength={100}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Ferramenta de CRM (<code className="text-[10px]">lead_event_source</code>)
                      </label>
                      <input
                        aria-label="CRM tool"
                        value={crmTool}
                        onChange={(e) => setCrmTool(e.target.value)}
                        placeholder='Ex.: "HubSpot" — ou deixe em branco'
                        maxLength={120}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Rótulo / origem extra (<code className="text-[10px]">lead_event_source</code>)
                      </label>
                      <input
                        aria-label="CRM label"
                        value={crmLabel}
                        onChange={(e) => setCrmLabel(e.target.value)}
                        placeholder='Ex.: "Link página de vendas" — ou em branco'
                        maxLength={120}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      </div>

      {lastCreatedUrl && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Último link criado</div>
              <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 font-mono break-all">
                {lastCreatedUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(lastCreatedUrl);
                props.showFlash('Link copiado!', 'success');
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
            >
              Copiar link
            </button>
          </div>
        </div>
      )}

      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full table-fixed text-left text-sm text-zinc-600 dark:text-zinc-400">
          <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-xs uppercase font-medium text-zinc-600 dark:text-zinc-500">
            <tr>
              <th className="px-4 py-3 w-[220px]">Slug</th>
              <th className="px-4 py-3">Destino</th>
              <th className="px-4 py-3 w-[160px]">Evento</th>
              <th className="px-4 py-3 w-[110px]">Status</th>
              <th className="px-4 py-3 text-right w-[160px]">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {links.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  Nenhum link criado ainda.
                </td>
              </tr>
            ) : (
              links.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50 dark:bg-zinc-900/20">
                  <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">
                    <div className="truncate" title={`https://${row.host}/${row.slug}`}>
                      {row.slug}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                    <div className="truncate" title={row.destination_url}>
                      {row.destination_url}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                      {row.event_name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ' +
                        (row.is_active
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20')
                      }
                    >
                      {row.is_active ? 'Ativo' : 'Pausado'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const url = `https://${row.host}/${row.slug}`;
                          navigator.clipboard.writeText(url);
                          props.showFlash('Link copiado!', 'success');
                        }}
                        className="text-zinc-600 dark:text-zinc-400 hover:text-emerald-400 text-xs transition-colors"
                      >
                        Copiar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(row)}
                        className="text-zinc-600 dark:text-zinc-400 hover:text-blue-400 text-xs transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="text-red-400 hover:text-red-300 text-xs transition-colors"
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

