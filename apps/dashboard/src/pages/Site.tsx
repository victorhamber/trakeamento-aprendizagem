import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type Site = {
  id: number;
  name: string;
  domain: string | null;
  site_key: string;
};

type Tab = 'snippet' | 'meta' | 'campaigns' | 'ga' | 'webhooks' | 'reports';

export const SitePage = () => {
  const { siteId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = Number(siteId);
  const [site, setSite] = useState<Site | null>(null);
  const initialTab = (searchParams.get('tab') as Tab) || 'snippet';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [snippet, setSnippet] = useState<string>('');
  const [meta, setMeta] = useState<any>(null);
  const [adAccounts, setAdAccounts] = useState<Array<{ id: string; name: string; account_id?: string; business?: { id: string; name: string } }>>([]);
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [ga, setGa] = useState<any>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; status: string; effective_status?: string }>>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const loadSite = async () => {
    const res = await api.get(`/sites/${id}`);
    setSite(res.data.site);
  };

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    loadSite().catch(() => nav('/'));
  }, [id]);

  const tabs = useMemo(
    () => [
      { key: 'snippet' as const, label: 'Instalação' },
      { key: 'meta' as const, label: 'Meta' },
      { key: 'campaigns' as const, label: 'Campanhas' },
      { key: 'ga' as const, label: 'Google Analytics' },
      { key: 'webhooks' as const, label: 'Webhook Vendas' },
      { key: 'reports' as const, label: 'Diagnóstico' },
    ],
    []
  );

  const loadSnippet = async () => {
    const res = await api.get(`/sites/${id}/snippet`);
    setSnippet(res.data.snippet);
  };

  const loadMeta = async () => {
    const res = await api.get(`/integrations/sites/${id}/meta`);
    setMeta(res.data.meta);
  };

  const loadGa = async () => {
    const res = await api.get(`/integrations/sites/${id}/ga`);
    setGa(res.data.ga);
  };

  const loadWebhookSecret = async () => {
    const res = await api.get(`/sites/${id}/secret`);
    setWebhookSecret(res.data.secret);
  };

  useEffect(() => {
    if (!site) return;
    if (tab === 'snippet') loadSnippet().catch(() => {});
    if (tab === 'meta') loadMeta().catch(() => {});
    if (tab === 'campaigns') {
      loadMeta()
        .then(() => loadCampaigns().catch(() => {}))
        .catch(() => {});
    }
    if (tab === 'ga') loadGa().catch(() => {});
    if (tab === 'webhooks') loadWebhookSecret().catch(() => {});
  }, [tab, site?.id]);

  const connectFacebook = async () => {
    setLoading(true);
    try {
      const res = await api.get('/oauth/meta/start', { params: { site_id: id, json: 1 } });
      const url = res.data?.url;
      if (url) {
        window.location.href = url;
        return;
      }
      setFlash('Não foi possível iniciar a conexão com o Facebook.');
    } catch (err: any) {
      const apiError = err?.response?.data?.error;
      if (apiError === 'META_APP_ID is missing') {
        setFlash('Credenciais Meta não configuradas no servidor.');
      } else {
        setFlash(apiError || 'Não foi possível iniciar a conexão com o Facebook.');
      }
    } finally {
      setLoading(false);
    }
  };

  const disconnectFacebook = async () => {
    setLoading(true);
    try {
      await api.delete(`/integrations/sites/${id}/meta/facebook`);
      setAdAccounts([]);
      setPixels([]);
      await loadMeta();
      setFlash('Facebook desconectado.');
    } finally {
      setLoading(false);
    }
  };

  const loadAdAccounts = async () => {
    const res = await api.get(`/integrations/sites/${id}/meta/adaccounts`);
    setAdAccounts(res.data.ad_accounts || []);
  };

  const loadPixels = async (adAccountId: string) => {
    const res = await api.get(`/integrations/sites/${id}/meta/pixels`, { params: { ad_account_id: adAccountId } });
    setPixels(res.data.pixels || []);
  };

  const loadCampaigns = async () => {
    const res = await api.get(`/integrations/sites/${id}/meta/campaigns`);
    setCampaigns(res.data.campaigns || []);
  };

  const setCampaignStatus = async (campaignId: string, status: 'ACTIVE' | 'PAUSED') => {
    setLoading(true);
    try {
      await api.patch(`/integrations/sites/${id}/meta/campaigns/${campaignId}`, { status });
      await loadCampaigns();
      setFlash('Campanha atualizada.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      setFlash('Conexão atualizada com sucesso.');
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
      // Reload meta and then load ad accounts automatically
      loadMeta().then(() => {
        loadAdAccounts().catch(() => {});
      });
    }
  }, []);

  // Auto-load ad accounts if connected but no accounts loaded yet (and no ad account selected)
  useEffect(() => {
    if (tab === 'meta' && meta?.has_facebook_connection && !meta?.ad_account_id && adAccounts.length === 0) {
       loadAdAccounts().catch(() => {});
    }
  }, [tab, meta, adAccounts.length]);

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const form = e.target as HTMLFormElement;
      const payload = Object.fromEntries(new FormData(form).entries());
      await api.put(`/integrations/sites/${id}/meta`, payload);
      await loadMeta();
      setFlash('Configuração Meta salva.');
    } finally {
      setLoading(false);
    }
  };

  const saveGa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const form = e.target as HTMLFormElement;
      const payload = Object.fromEntries(new FormData(form).entries());
      await api.put(`/integrations/sites/${id}/ga`, payload);
      await loadGa();
      setFlash('Configuração Google Analytics salva.');
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    if (!site) return;
    setLoading(true);
    try {
      const res = await api.post('/recommendations/generate', {}, { headers: { 'x-site-key': site.site_key } });
      setReport(res.data);
      setTab('reports');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout
      title={site ? site.name : 'Site'}
      right={
        <button
          onClick={generateReport}
          disabled={loading || !site}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {loading ? 'Processando…' : 'Gerar diagnóstico'}
        </button>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link to="/sites" className="text-sm text-blue-400 hover:text-blue-300">
            ← Voltar
          </Link>
          <div className="mt-2 text-sm text-zinc-400">{site?.domain || '—'}</div>
        </div>
        {site && <div className="text-xs text-zinc-500 font-mono">site_key: {site.site_key}</div>}
      </div>

      {flash && (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm">
          {flash}
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-zinc-900 bg-zinc-950">
        <div className="border-b border-zinc-900 flex flex-wrap gap-2 p-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                searchParams.set('tab', t.key);
                setSearchParams(searchParams, { replace: true });
              }}
              className={`px-3 py-2 rounded-lg text-sm ${
                tab === t.key ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'snippet' && (
            <div>
              <div className="text-sm text-zinc-300 mb-3">
                Cole este snippet no seu site (antes do fechamento do &lt;/head&gt;).
              </div>
              <pre className="text-xs bg-zinc-900 border border-zinc-800 p-4 rounded-xl overflow-auto">
                <code>{snippet}</code>
              </pre>
            </div>
          )}

          {tab === 'meta' && (
            <form onSubmit={saveMeta} className="space-y-4">
              <input type="hidden" name="enabled" value="false" />
              <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Conexão com Facebook</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Faça login para selecionar Conta de Anúncio e Pixel diretamente no painel.
                    </div>
                    <div className="mt-2 text-xs">
                      {meta?.has_facebook_connection ? (
                        <span className="text-emerald-400">Conectado</span>
                      ) : (
                        <span className="text-zinc-400">Desconectado</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!meta?.has_facebook_connection ? (
                      <button
                        type="button"
                        onClick={connectFacebook}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm"
                      >
                        Conectar
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={disconnectFacebook}
                        className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>
                {meta?.has_facebook_connection && (
                  <div className="mt-4 flex flex-wrap gap-3 items-end">
                    <button
                      type="button"
                      onClick={() => loadAdAccounts().catch(() => {})}
                      className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-sm"
                    >
                      Carregar contas
                    </button>
                    <div className="text-xs text-zinc-500">
                      Selecione uma conta e carregue pixels para preencher automaticamente.
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    id="meta-enabled"
                    name="enabled"
                    type="checkbox"
                    value="true"
                    defaultChecked={meta?.enabled ?? true}
                    className="h-4 w-4"
                  />
                  <label htmlFor="meta-enabled" className="text-sm text-zinc-200">
                    Integração Meta ativa
                  </label>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400">Pixel ID</label>
                  <input
                    name="pixel_id"
                    defaultValue={meta?.pixel_id || ''}
                    className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                  />
                  {pixels.length > 0 && (
                    <div className="mt-2">
                      <label className="block text-xs text-zinc-500">Sugestões</label>
                      <select
                        className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                        onChange={(e) => {
                          const el = e.target.value;
                          const input = document.querySelector<HTMLInputElement>('input[name="pixel_id"]');
                          if (input) input.value = el;
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Selecionar Pixel
                        </option>
                        {pixels.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-300 mb-3">Contas de Anúncio (Meta)</label>
                  
                  {meta?.has_facebook_connection && adAccounts.length === 0 && (
                     <div className="text-sm text-zinc-500 italic mb-2">
                        Nenhuma conta encontrada. Clique em "Carregar contas" acima.
                     </div>
                  )}

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                     {adAccounts.map(acc => {
                        const isSelected = meta?.ad_account_id === (acc.account_id || acc.id);
                        return (
                           <div key={acc.id} className={`flex items-center justify-between p-3 rounded-lg border ${isSelected ? 'bg-blue-900/20 border-blue-500/50' : 'bg-zinc-900 border-zinc-800'}`}>
                              <div>
                                 <div className="text-sm font-medium text-zinc-200">
                                    {acc.business ? `${acc.name} (${acc.business.name})` : acc.name}
                                 </div>
                                 <div className="text-xs text-zinc-500 font-mono">
                                    {acc.account_id || acc.id}
                                 </div>
                              </div>
                              
                              <label className="relative inline-flex items-center cursor-pointer">
                                 <input 
                                    type="radio" 
                                    name="ad_account_id" 
                                    className="sr-only peer"
                                    value={acc.account_id || acc.id}
                                    checked={isSelected}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       // Update local state immediately for visual feedback
                                       setMeta((prev: any) => ({ ...prev, ad_account_id: val }));
                                       loadPixels(val).catch(() => {});
                                    }}
                                 />
                                 <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                              </label>
                           </div>
                        );
                     })}
                  </div>
                  
                  {/* Hidden input to ensure form submission works */}
                  <input type="hidden" name="ad_account_id" value={meta?.ad_account_id || ''} />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400">CAPI Token</label>
                  <input
                    name="capi_token"
                    className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                    placeholder={meta?.has_capi_token ? 'Já configurado (preencha para substituir)' : ''}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400">Marketing Token</label>
                  <input
                    name="marketing_token"
                    className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                    placeholder={meta?.has_marketing_token ? 'Já configurado (preencha para substituir)' : ''}
                  />
                </div>
              </div>
              <button
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
              >
                {loading ? 'Salvando…' : 'Salvar Meta'}
              </button>
            </form>
          )}

          {tab === 'ga' && (
            <form onSubmit={saveGa} className="space-y-4">
              <input type="hidden" name="enabled" value="false" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    id="ga-enabled"
                    name="enabled"
                    type="checkbox"
                    value="true"
                    defaultChecked={ga?.enabled ?? true}
                    className="h-4 w-4"
                  />
                  <label htmlFor="ga-enabled" className="text-sm text-zinc-200">
                    Integração GA ativa
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400">Measurement ID (G-...)</label>
                  <input
                    name="measurement_id"
                    defaultValue={ga?.measurement_id || ''}
                    className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400">API Secret</label>
                  <input
                    name="api_secret"
                    className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                    placeholder={ga?.has_api_secret ? 'Já configurado (preencha para substituir)' : ''}
                  />
                </div>
              </div>
              <button
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
              >
                {loading ? 'Salvando…' : 'Salvar GA'}
              </button>
            </form>
          )}

          {tab === 'campaigns' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Campanhas (Meta Ads)</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Ative/pausa campanhas pelo painel. Depois, use o Diagnóstico IA para recomendações.
                  </div>
                </div>
                <button
                  onClick={() => loadCampaigns().catch(() => {})}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-sm"
                >
                  Atualizar
                </button>
              </div>

              {!meta?.has_facebook_connection && (
                <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4 text-sm text-zinc-300">
                  Conecte o Facebook na aba Meta para listar campanhas.
                </div>
              )}

              {meta?.has_facebook_connection && !meta?.ad_account_id && (
                <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4 text-sm text-zinc-300">
                  Defina o Ad Account ID na aba Meta para listar campanhas.
                </div>
              )}

              {meta?.has_facebook_connection && meta?.ad_account_id && (
                <div className="rounded-xl border border-zinc-900 bg-zinc-950 overflow-hidden">
                  <div className="grid grid-cols-[1fr_160px_140px] gap-2 px-4 py-3 text-xs text-zinc-500 border-b border-zinc-900">
                    <div>Campanha</div>
                    <div>Status</div>
                    <div>Ação</div>
                  </div>
                  {campaigns.length === 0 && (
                    <div className="px-4 py-6 text-sm text-zinc-400">Nenhuma campanha encontrada.</div>
                  )}
                  {campaigns.map((c) => (
                    <div
                      key={c.id}
                      className="grid grid-cols-[1fr_160px_140px] gap-2 px-4 py-3 text-sm border-b border-zinc-900 last:border-b-0"
                    >
                      <div>
                        <div className="text-zinc-100">{c.name}</div>
                        <div className="text-xs text-zinc-500 font-mono">{c.id}</div>
                      </div>
                      <div className="text-zinc-300">{c.status}</div>
                      <div className="flex justify-end">
                        {c.status === 'ACTIVE' ? (
                          <button
                            disabled={loading}
                            onClick={() => setCampaignStatus(c.id, 'PAUSED')}
                            className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-3 py-1.5 rounded-lg disabled:opacity-50 text-sm"
                          >
                            Pausar
                          </button>
                        ) : (
                          <button
                            disabled={loading}
                            onClick={() => setCampaignStatus(c.id, 'ACTIVE')}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 text-sm"
                          >
                            Ativar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'webhooks' && (
            <div>
              <div className="text-sm font-semibold mb-2">Integração com Plataformas de Vendas</div>
              <div className="text-sm text-zinc-400 mb-4">
                Configure este webhook na sua plataforma (Hotmart, Kiwify, Eduzz, etc) para receber eventos de compra automaticamente.
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">URL do Webhook</label>
                  <div className="flex gap-2">
                    <input 
                      readOnly
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 outline-none"
                      value={webhookSecret ? `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}` : 'Carregando...'}
                    />
                    <button 
                      onClick={() => {
                        const url = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}`;
                        navigator.clipboard.writeText(url);
                        setFlash('URL copiada para a área de transferência!');
                      }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg text-xs"
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4">
                  <div className="text-sm font-medium text-blue-200 mb-2">Eventos Suportados</div>
                  <ul className="list-disc list-inside text-xs text-blue-200/70 space-y-1">
                    <li>Compra Aprovada (Purchase)</li>
                    <li>Reembolso (Refund) - <i>Em breve</i></li>
                    <li>Carrinho Abandonado - <i>Em breve</i></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === 'reports' && (
            <div className="prose prose-invert max-w-none">
              {!report && <div className="text-sm text-zinc-400">Gere um diagnóstico para visualizar aqui.</div>}
              {report && <ReactMarkdown>{report.analysis_text}</ReactMarkdown>}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

