import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type Tab = 'snippet' | 'meta' | 'campaigns' | 'ga' | 'matching' | 'webhooks' | 'reports';
type MetaConfig = {
  pixel_id?: string | null;
  ad_account_id?: string | null;
  enabled?: boolean | null;
  has_capi_token?: boolean;
  has_marketing_token?: boolean;
  has_facebook_connection?: boolean;
  fb_user_id?: string | null;
};
type GaConfig = {
  measurement_id?: string | null;
  enabled?: boolean | null;
  has_api_secret?: boolean;
};
type DiagnosisReport = { analysis_text?: string } & Record<string, unknown>;
type CampaignMetrics = {
  campaign_id: string;
  campaign_name?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  unique_clicks: number;
  unique_link_clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  outbound_clicks: number;
  landing_page_views: number;
  contacts: number;
  leads: number;
  adds_to_cart: number;
  initiates_checkout: number;
  purchases: number;
  reach?: number;
};

export const SitePage = () => {
  const { siteId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = Number(siteId);
  const apiBaseUrl = (api.defaults.baseURL || '').replace(/\/+$/, '');
  const [site, setSite] = useState<Site | null>(null);
  const initialTab = (searchParams.get('tab') as Tab) || 'snippet';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [snippet, setSnippet] = useState<string>('');
  const [meta, setMeta] = useState<MetaConfig | null>(null);
  const [adAccounts, setAdAccounts] = useState<Array<{ id: string; name: string; account_id?: string; business?: { id: string; name: string } }>>([]);
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [ga, setGa] = useState<GaConfig | null>(null);
  const [matching, setMatching] = useState<Record<string, string>>({
    email: '',
    phone: '',
    fn: '',
    ln: '',
    ct: '',
    st: '',
    zp: '',
    db: '',
  });
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignMetrics, setCampaignMetrics] = useState<Record<string, any>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [metricsPreset, setMetricsPreset] = useState<
    'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'maximum' | 'custom'
  >('last_7d');
  const [metricsSince, setMetricsSince] = useState('');
  const [metricsUntil, setMetricsUntil] = useState('');
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  
  // Meta Level State
  const [metaLevel, setMetaLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign');
  const [metaParentId, setMetaParentId] = useState<string | null>(null);
  const [metaBreadcrumbs, setMetaBreadcrumbs] = useState<{ id: string | null; name: string; level: string }[]>([
    { id: null, name: 'Campanhas', level: 'campaign' },
  ]);

  const reportStorageKey = useMemo(() => `diagnosis:${id}`, [id]);
  const reportSections = useMemo(() => {
    const text = report?.analysis_text?.trim() || '';
    if (!text) return [];
    const parts = text.split(/\n##\s+/);
    const sections: Array<{ title: string; body: string }> = [];
    const hasLeading = !text.startsWith('## ') && parts[0]?.trim();
    if (hasLeading) {
      sections.push({ title: 'Resumo executivo', body: parts[0].trim() });
    }
    for (let i = 1; i < parts.length; i += 1) {
      const part = parts[i]?.trim();
      if (!part) continue;
      const lines = part.split('\n');
      const title = lines[0]?.trim() || 'Seção';
      const body = lines.slice(1).join('\n').trim();
      sections.push({ title, body });
    }
    if (!sections.length) {
      sections.push({ title: 'Diagnóstico', body: text });
    }
    return sections;
  }, [report?.analysis_text]);
  useEffect(() => {
    if (!site) return;
    if (report) return;
    const raw = localStorage.getItem(reportStorageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (saved?.report) {
        setReport(saved.report);
        if (saved.selectedCampaignId) setSelectedCampaignId(saved.selectedCampaignId);
        if (saved.metricsPreset) setMetricsPreset(saved.metricsPreset);
        if (saved.metricsSince) setMetricsSince(saved.metricsSince);
        if (saved.metricsUntil) setMetricsUntil(saved.metricsUntil);
      }
    } catch (err) {
      void err;
    }
  }, [site, report, reportStorageKey]);

  useEffect(() => {
    if (!site) return;
    if (!report) return;
    const payload = {
      report,
      selectedCampaignId,
      metricsPreset,
      metricsSince,
      metricsUntil,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(reportStorageKey, JSON.stringify(payload));
  }, [site, report, selectedCampaignId, metricsPreset, metricsSince, metricsUntil, reportStorageKey]);

  const loadSite = useCallback(async () => {
    const res = await api.get(`/sites/${id}`);
    setSite(res.data.site);
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    loadSite().catch(() => nav('/'));
  }, [id, loadSite, nav]);

  const tabs = useMemo(
    () => [
      { key: 'snippet' as const, label: 'Instalação' },
      { key: 'meta' as const, label: 'Meta' },
      { key: 'campaigns' as const, label: 'Campanhas' },
      { key: 'ga' as const, label: 'Google Analytics' },
      { key: 'matching' as const, label: 'Correspondência' },
      { key: 'webhooks' as const, label: 'Webhook Vendas' },
      { key: 'reports' as const, label: 'Diagnóstico' },
    ],
    []
  );

  const loadSnippet = useCallback(async () => {
    const res = await api.get(`/sites/${id}/snippet`);
    setSnippet(res.data.snippet);
  }, [id]);

  const loadMeta = useCallback(async () => {
    const res = await api.get(`/integrations/sites/${id}/meta`);
    setMeta(res.data.meta);
  }, [id]);

  const loadGa = useCallback(async () => {
    const res = await api.get(`/integrations/sites/${id}/ga`);
    setGa(res.data.ga);
  }, [id]);

  const loadWebhookSecret = useCallback(async () => {
    const res = await api.get(`/sites/${id}/secret`);
    setWebhookSecret(res.data.secret);
  }, [id]);

  const loadMatching = useCallback(async () => {
    const res = await api.get(`/sites/${id}/identify-mapping`);
    const m = res.data?.mapping || {};
    const asString = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');
    setMatching({
      email: asString(m.email),
      phone: asString(m.phone),
      fn: asString(m.fn),
      ln: asString(m.ln),
      ct: asString(m.ct),
      st: asString(m.st),
      zp: asString(m.zp),
      db: asString(m.db),
    });
  }, [id]);


  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.target as HTMLFormElement);
    const data: Record<string, any> = {
      site_id: id,
      ad_account_id: formData.get('ad_account_id'),
      pixel_id: formData.get('pixel_id'),
      enabled: formData.get('enabled') === 'true',
    };
    
    const capi = formData.get('capi_token');
    const marketing = formData.get('marketing_token');
    if (capi) data.capi_token = capi;
    if (marketing) data.marketing_token = marketing;

    try {
      await api.put(`/integrations/sites/${id}/meta`, data);
      setFlash('Configurações salvas!');
      await loadMeta();
    } catch (err) {
      console.error(err);
      setFlash('Erro ao salvar Meta.');
    } finally {
      setLoading(false);
    }
  };

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
    } catch (err: unknown) {
      const apiError =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
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

  const loadAdAccounts = useCallback(async () => {
    const res = await api.get(`/integrations/sites/${id}/meta/adaccounts`);
    setAdAccounts(res.data.ad_accounts || []);
  }, [id]);

  const loadPixels = useCallback(async (adAccountId: string) => {
    const res = await api.get(`/integrations/sites/${id}/meta/pixels`, { params: { ad_account_id: adAccountId } });
    setPixels(res.data.pixels || []);
  }, [id]);

  const loadCampaigns = useCallback(async () => {
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    
    setLoading(true);
    try {
      const params: any = { 
        site_id: id,
        level: metaLevel,
        parent_id: metaParentId
      };
      
      if (metricsPreset === 'custom') {
        params.since = metricsSince;
        params.until = metricsUntil;
      } else {
        params.date_preset = metricsPreset;
      }
      
      const res = await api.get('/meta/campaigns/metrics', { params });
      
      if (res.data?.meta_error) {
        setFlash(`Meta: ${res.data.meta_error}`);
      }
      
      setCampaigns(res.data.data || []);
      
      const map = (res.data.data || []).reduce((acc: Record<string, any>, row: any) => {
        acc[row.id] = row;
        return acc;
      }, {});
      setCampaignMetrics(map);
    } catch (err) {
      console.error(err);
      setFlash('Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, [id, metricsPreset, metricsSince, metricsUntil, metaLevel, metaParentId]);

  useEffect(() => {
    if (!site) return;
    if (tab === 'snippet') loadSnippet().catch(() => {});
    if (tab === 'meta') loadMeta().catch(() => {});
    if (tab === 'campaigns') {
      loadMeta().catch(() => {});
    }
    if (tab === 'ga') loadGa().catch(() => {});
    if (tab === 'matching') loadMatching().catch(() => {});
    if (tab === 'webhooks') loadWebhookSecret().catch(() => {});
    if (tab === 'reports') {
      setMetaLevel('campaign');
      setMetaParentId(null);
      setMetaBreadcrumbs([{ id: null, name: 'Campanhas', level: 'campaign' }]);
      loadMeta().catch(() => {});
    }
  }, [tab, site, loadSnippet, loadMeta, loadGa, loadMatching, loadWebhookSecret]);

  const handleMetaDrillDown = (item: any) => {
    if (metaLevel === 'campaign') {
      setMetaLevel('adset');
      setMetaParentId(item.id);
      setMetaBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name, level: 'adset' }]);
    } else if (metaLevel === 'adset') {
      setMetaLevel('ad');
      setMetaParentId(item.id);
      setMetaBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name, level: 'ad' }]);
    }
  };

  const handleMetaBreadcrumbClick = (index: number) => {
    const target = metaBreadcrumbs[index];
    setMetaLevel(target.level as any);
    setMetaParentId(target.id);
    setMetaBreadcrumbs(metaBreadcrumbs.slice(0, index + 1));
  };

  useEffect(() => {
    if (!site) return;
    if (tab !== 'campaigns' && tab !== 'reports') return;
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    loadCampaigns().catch(() => {});
  }, [site, tab, metricsPreset, metricsSince, metricsUntil, loadCampaigns]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      setFlash('Conexão atualizada com sucesso.');
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
      loadMeta().then(() => {
        loadAdAccounts().catch(() => {});
      });
    }
  }, [loadAdAccounts, loadMeta, searchParams, setSearchParams]);

  // Auto-load ad accounts if connected but no accounts loaded yet (and no ad account selected)
  useEffect(() => {
    if (tab === 'meta' && meta?.has_facebook_connection && !meta?.ad_account_id && adAccounts.length === 0) {
      loadAdAccounts().catch(() => {});
    }
  }, [tab, meta, adAccounts.length, loadAdAccounts]);

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

  const saveMatching = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const parse = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    const mapping = {
      email: parse(matching.email),
      phone: parse(matching.phone),
      fn: parse(matching.fn),
      ln: parse(matching.ln),
      ct: parse(matching.ct),
      st: parse(matching.st),
      zp: parse(matching.zp),
      db: parse(matching.db),
    };

    try {
      await api.put(`/sites/${id}/identify-mapping`, { mapping });
      await loadMatching();
      setFlash('Correspondência salva.');
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    if (!site) return;
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) {
      setFlash('Defina o período personalizado.');
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedCampaignId) params.campaign_id = selectedCampaignId;
      if (metricsPreset === 'custom') {
        params.since = metricsSince;
        params.until = metricsUntil;
      } else {
        params.date_preset = metricsPreset;
      }
      const res = await api.post(
        '/recommendations/generate',
        {},
        {
          headers: { 'x-site-key': site.site_key },
          params,
        }
      );
      setReport(res.data);
      setTab('reports');
    } catch (err: unknown) {
      console.error(err);
      const apiError =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setFlash(apiError || 'Erro ao gerar diagnóstico.');
      setTab('reports');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
  const formatMoney = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
  const formatPercent = (value: number) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const getResultValue = (
    item: { objective?: string | null } | null | undefined,
    metrics: CampaignMetrics | undefined
  ) => {
    if (!metrics) return 0;
    
    // Tenta usar o objetivo da campanha/conjunto se disponível
    // Se for nível de anúncio, pode herdar do pai se tivermos essa info, mas por enquanto usa heurística
    const objective = (item?.objective || '').toLowerCase();

    // Vendas/Conversão
    if (
      objective.includes('sale') ||
      objective.includes('purchase') ||
      objective.includes('conversion') ||
      objective.includes('catalog') ||
      objective.includes('outcome_sales')
    ) {
      if (metrics.purchases > 0) return metrics.purchases;
      if (metrics.initiates_checkout > 0) return metrics.initiates_checkout;
      if (metrics.adds_to_cart > 0) return metrics.adds_to_cart;
      return 0;
    }

    // Leads/Cadastros
    if (
      objective.includes('lead') ||
      objective.includes('contact') ||
      objective.includes('lead_generation') ||
      objective.includes('outcome_leads')
    ) {
      if (metrics.contacts > 0) return metrics.contacts;
      if (metrics.leads > 0) return metrics.leads;
      return 0;
    }

    // Tráfego
    if (
      objective.includes('traffic') ||
      objective.includes('link_click') ||
      objective.includes('outcome_traffic')
    ) {
      if (metrics.landing_page_views > 0) return metrics.landing_page_views;
      if (metrics.outbound_clicks > 0) return metrics.outbound_clicks;
      if (metrics.clicks > 0) return metrics.clicks;
      return 0;
    }

    // Engajamento
    if (
      objective.includes('engagement') ||
      objective.includes('post_engagement') ||
      objective.includes('page_likes') ||
      objective.includes('outcome_engagement')
    ) {
      // Engajamento pode ser muitas coisas, mas outbound clicks é um bom proxy se não houver post reactions específicas mapeadas
      if (metrics.outbound_clicks > 0) return metrics.outbound_clicks;
      if (metrics.clicks > 0) return metrics.clicks;
      return 0;
    }

    // Reconhecimento/Alcance
    if (
      objective.includes('aware') ||
      objective.includes('reach') ||
      objective.includes('brand') ||
      objective.includes('outcome_awareness')
    ) {
      return metrics.reach || metrics.impressions;
    }

    // Fallback genérico priorizando fundo de funil
    if (metrics.purchases > 0) return metrics.purchases;
    if (metrics.contacts > 0) return metrics.contacts;
    if (metrics.leads > 0) return metrics.leads;
    if (metrics.initiates_checkout > 0) return metrics.initiates_checkout;
    if (metrics.adds_to_cart > 0) return metrics.adds_to_cart;
    if (metrics.landing_page_views > 0) return metrics.landing_page_views;
    if (metrics.outbound_clicks > 0) return metrics.outbound_clicks;
    
    return 0;
  };
  const getConnectRate = (metrics: CampaignMetrics) => {
    const base = metrics.unique_link_clicks > 0 ? metrics.unique_link_clicks : metrics.unique_clicks;
    if (base <= 0) return 0;
    return (metrics.landing_page_views / base) * 100;
  };

  const canGenerate = !!site;
  const selectedCampaign = selectedCampaignId ? campaigns.find((c) => c.id === selectedCampaignId) : null;
  const periodSelector = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={metricsPreset}
        onChange={(e) => setMetricsPreset(e.target.value as typeof metricsPreset)}
        className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
      >
        <option value="today">Hoje</option>
        <option value="yesterday">Ontem</option>
        <option value="last_7d">7 dias</option>
        <option value="last_14d">14 dias</option>
        <option value="last_30d">30 dias</option>
        <option value="maximum">Máximo</option>
        <option value="custom">Personalizado</option>
      </select>
      {metricsPreset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={metricsSince}
            onChange={(e) => setMetricsSince(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
          <input
            type="date"
            value={metricsUntil}
            onChange={(e) => setMetricsUntil(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>
      )}
    </div>
  );

  return (
    <Layout
      title={site ? site.name : 'Site'}
      right={
        <button
          onClick={generateReport}
          disabled={loading || !canGenerate}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl px-4 py-2 disabled:opacity-50 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] transition-colors"
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
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          {flash}
        </div>
      )}

      <div className="mt-5 rounded-3xl border border-zinc-900/70 bg-zinc-950/40 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
        <div className="border-b border-zinc-900/70 flex flex-wrap gap-2 p-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                searchParams.set('tab', t.key);
                setSearchParams(searchParams, { replace: true });
              }}
              className={`px-3 py-2 rounded-2xl text-sm transition-colors ${
                tab === t.key
                  ? 'bg-zinc-900/70 text-white border border-zinc-800/70 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]'
                  : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-white border border-transparent'
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
              <div className="relative group overflow-x-hidden">
                <pre className="text-xs bg-zinc-900 border border-zinc-800 p-4 rounded-xl w-full max-w-full max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                  <code className="block w-full max-w-full whitespace-pre-wrap break-all">{snippet}</code>
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(snippet);
                    setFlash('Código copiado!');
                  }}
                  className="absolute top-2 right-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Copiar código"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
              </div>
            </div>
          )}

          {tab === 'meta' && (
            <form onSubmit={saveMeta} className="max-w-3xl space-y-8">
              <input type="hidden" name="enabled" value="false" />
              
              {/* Conexão */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-medium text-zinc-100">Conexão com Facebook</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Conecte sua conta para listar e selecionar contas de anúncio e pixels.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${meta?.has_facebook_connection ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                      <span className="text-sm font-medium text-zinc-300">
                        {meta?.has_facebook_connection ? 'Conectado' : 'Desconectado'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {!meta?.has_facebook_connection ? (
                      <button
                        type="button"
                        onClick={connectFacebook}
                        className="bg-[#1877F2] hover:bg-[#166fe5] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                      >
                        Conectar com Facebook
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={disconnectFacebook}
                        className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-5 py-2.5 rounded-lg disabled:opacity-50 text-sm font-medium transition-colors"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>

                {meta?.has_facebook_connection && (
                  <div className="mt-6 pt-6 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                       <label className="text-sm font-medium text-zinc-200">Contas de Anúncio</label>
                       <button
                          type="button"
                          onClick={() => loadAdAccounts().catch(() => {})}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 16h5v5"></path></svg>
                          Atualizar lista
                        </button>
                    </div>
                    
                    {adAccounts.length === 0 && (
                       <div className="text-sm text-zinc-500 italic py-2">
                          Nenhuma conta carregada. Clique em atualizar.
                       </div>
                    )}

                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                       {adAccounts.map(acc => {
                          const isSelected = meta?.ad_account_id === (acc.account_id || acc.id);
                          return (
                             <label 
                                key={acc.id} 
                                className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                                  isSelected 
                                    ? 'bg-blue-500/10 border-blue-500/50' 
                                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                                }`}
                             >
                                <div>
                                   <div className={`text-sm font-medium ${isSelected ? 'text-blue-200' : 'text-zinc-300'}`}>
                                      {acc.business ? `${acc.name} (${acc.business.name})` : acc.name}
                                   </div>
                                   <div className="text-xs text-zinc-500 font-mono mt-0.5">
                                      ID: {acc.account_id || acc.id}
                                   </div>
                                </div>
                                
                                <div className="relative">
                                   <input 
                                      type="radio" 
                                      name="ad_account_id" 
                                      className="sr-only peer"
                                      value={acc.account_id || acc.id}
                                      checked={isSelected}
                                      onChange={(e) => {
                                         const val = e.target.value;
                                        setMeta((prev) => ({ ...(prev || {}), ad_account_id: val }));
                                         loadPixels(val).catch(() => {});
                                      }}
                                   />
                                   <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-zinc-600'
                                   }`}>
                                      {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                                   </div>
                                </div>
                             </label>
                          );
                       })}
                    </div>
                    {/* Hidden input fallback */}
                    <input type="hidden" name="ad_account_id" value={meta?.ad_account_id || ''} />
                  </div>
                )}
              </div>

              {/* Configurações do Pixel */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-zinc-800">
                  <input
                    id="meta-enabled"
                    name="enabled"
                    type="checkbox"
                    value="true"
                    defaultChecked={meta?.enabled ?? true}
                    className="w-5 h-5 rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-blue-500/40"
                  />
                  <div>
                    <label htmlFor="meta-enabled" className="text-base font-medium text-zinc-200 block">
                      Ativar Rastreamento
                    </label>
                    <span className="text-xs text-zinc-500">Habilita o envio de eventos para o Pixel e API de Conversões</span>
                  </div>
                </div>

                <div className="grid gap-6">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">Pixel ID</label>
                    <input
                      name="pixel_id"
                      defaultValue={meta?.pixel_id || ''}
                      placeholder="Ex: 1234567890"
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600"
                    />
                    {pixels.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-xs text-zinc-500 py-1">Sugestões:</span>
                        {pixels.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => {
                              const input = document.querySelector<HTMLInputElement>('input[name="pixel_id"]');
                              if (input) input.value = p.id;
                            }}
                            className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded-md border border-zinc-700 transition-colors"
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        CAPI Token <span className="text-zinc-500 font-normal">(Opcional)</span>
                      </label>
                      <input
                        name="capi_token"
                        type="password"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600"
                        placeholder={meta?.has_capi_token ? '•••••••• (Configurado)' : 'Token de Acesso (EAA...)'}
                      />
                      <p className="mt-1.5 text-xs text-zinc-500">
                        Recomendado para rastreamento server-side (anti-adblock).
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">
                        Marketing Token <span className="text-zinc-500 font-normal">(Opcional)</span>
                      </label>
                      <input
                        name="marketing_token"
                        type="password"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-600"
                        placeholder={meta?.has_marketing_token ? '•••••••• (Configurado)' : 'Token de Leitura'}
                      />
                      <p className="mt-1.5 text-xs text-zinc-500">
                        Usado apenas se a conexão automática falhar.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  disabled={loading}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-2.5 rounded-lg disabled:opacity-50 text-sm font-medium transition-all shadow-lg shadow-blue-900/20"
                >
                  {loading ? 'Salvando...' : 'Salvar Configurações'}
                </button>
              </div>
            </form>
          )}

          {tab === 'ga' && (
            <form onSubmit={saveGa} className="space-y-4">
              <input type="hidden" name="enabled" value="false" />
              <div className="grid grid-cols-1 gap-4 max-w-xl">
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
              </div>
              <button
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
              >
                {loading ? 'Salvando…' : 'Salvar GA'}
              </button>
            </form>
          )}

          {tab === 'matching' && (
            <form onSubmit={saveMatching} className="space-y-4">
              <div className="text-sm text-zinc-400">
                Configure quais chaves o seu site usa. Separe por vírgula para múltiplos aliases.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                {[
                  { k: 'email', label: 'Email (email)' },
                  { k: 'phone', label: 'Telefone (phone)' },
                  { k: 'fn', label: 'Nome (fn)' },
                  { k: 'ln', label: 'Sobrenome (ln)' },
                  { k: 'ct', label: 'Cidade (ct)' },
                  { k: 'st', label: 'Estado (st)' },
                  { k: 'zp', label: 'CEP (zp)' },
                  { k: 'db', label: 'Nascimento (db)' },
                ].map((f) => (
                  <div key={f.k}>
                    <label className="block text-xs text-zinc-400">{f.label}</label>
                    <input
                      value={matching[f.k] || ''}
                      onChange={(e) => setMatching((prev) => ({ ...prev, [f.k]: e.target.value }))}
                      placeholder="Ex: email, e-mail, user_email"
                      className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                    />
                  </div>
                ))}
              </div>
              <button
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
              >
                {loading ? 'Salvando…' : 'Salvar Correspondência'}
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
                <div className="rounded-xl border border-zinc-900 bg-zinc-950 overflow-hidden flex flex-col h-full">
                  {/* Meta Breadcrumbs */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-900 bg-zinc-950/50">
                    {metaBreadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={idx}>
                        <button
                          onClick={() => handleMetaBreadcrumbClick(idx)}
                          className={`text-sm ${
                            idx === metaBreadcrumbs.length - 1 ? 'text-zinc-200 font-medium' : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {crumb.name}
                        </button>
                        {idx < metaBreadcrumbs.length - 1 && <span className="text-zinc-600">/</span>}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="flex-1 overflow-auto max-h-[520px] min-h-[300px]">
                    <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur border-b border-zinc-900 px-4 py-2 min-h-[44px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {periodSelector}
                        </div>
                        <button
                          onClick={() => loadCampaigns()}
                          className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-sm transition-colors"
                        >
                          Atualizar
                        </button>
                      </div>
                    </div>
                    
                    <div className="w-full overflow-x-auto">
                      <div className="min-w-[1200px] grid grid-cols-[minmax(250px,2fr)_100px_100px_100px_100px_80px_80px_80px_100px_100px_100px_100px_100px_100px_100px] gap-2 px-4 py-3 text-[11px] text-zinc-500 border-b border-zinc-900 sticky top-[52px] z-10 bg-zinc-950/95 whitespace-nowrap">
                        <div>Nome</div>
                        <div>Status</div>
                        <div>Valor usado</div>
                        <div>Resultados</div>
                        <div>Custo por res.</div>
                        <div>Impr.</div>
                        <div>Cliques</div>
                        <div>CTR</div>
                        <div>CPC</div>
                        <div>CPM</div>
                        <div>Finalização</div>
                        <div>Compra</div>
                        <div>Connect Rate</div>
                        <div className="text-right">Ação</div>
                      </div>

                      {campaigns.length === 0 && (
                        <div className="px-4 py-12 text-center text-sm text-zinc-500">
                          Nenhum item encontrado neste nível.
                        </div>
                      )}

                      {campaigns.map((c) => {
                        const metrics = campaignMetrics[c.id];
                        const resultVal = metrics ? getResultValue(c, metrics) : 0;
                        const cpr = resultVal > 0 && metrics?.spend ? metrics.spend / resultVal : 0;

                        return (
                          <div
                            key={c.id}
                            className="min-w-[1200px] grid grid-cols-[minmax(250px,2fr)_100px_100px_100px_100px_80px_80px_80px_100px_100px_100px_100px_100px_100px_100px] gap-2 px-4 py-3 text-sm border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900/30 transition-colors items-center"
                          >
                            <div className="overflow-hidden">
                              <button 
                                onClick={() => handleMetaDrillDown(c)}
                                className="text-left hover:text-blue-400 transition-colors truncate w-full block font-medium text-zinc-200"
                                disabled={metaLevel === 'ad'}
                              >
                                {c.name}
                              </button>
                              <div className="text-[10px] text-zinc-600 font-mono truncate">{c.id}</div>
                            </div>
                            
                            <div className="text-zinc-400 text-xs truncate">
                              {c.status || 'UNKNOWN'}
                            </div>

                            <div className="text-zinc-300 text-xs">
                              {metrics ? formatMoney(metrics.spend) : '—'}
                            </div>

                            <div className="text-zinc-200 text-xs font-medium">
                              {metrics ? formatNumber(resultVal) : '—'}
                            </div>

                            <div className="text-zinc-300 text-xs">
                               {metrics && resultVal > 0 ? formatMoney(cpr) : '—'}
                            </div>

                            <div className="text-zinc-400 text-xs">
                              {metrics ? formatNumber(metrics.impressions) : '—'}
                            </div>

                            <div className="text-zinc-400 text-xs">
                              {metrics ? formatNumber(metrics.clicks) : '—'}
                            </div>

                            <div className="text-zinc-400 text-xs">
                              {metrics ? `${formatPercent(metrics.ctr)}%` : '—'}
                            </div>

                            <div className="text-zinc-400 text-xs">
                              {metrics ? formatMoney(metrics.cpc) : '—'}
                            </div>
                            
                            <div className="text-zinc-400 text-xs">
                              {metrics ? formatMoney(metrics.cpm) : '—'}
                            </div>

                            <div className="text-zinc-300 text-xs">
                              {metrics ? formatNumber(metrics.initiates_checkout) : '—'}
                            </div>

                            <div className="text-zinc-300 text-xs">
                              {metrics ? formatNumber(metrics.purchases) : '—'}
                            </div>

                            <div className="text-zinc-300 text-xs">
                              {metrics ? `${formatPercent(getConnectRate(metrics))}%` : '—'}
                            </div>

                            <div className="flex justify-end">
                               <button className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded border border-zinc-700">
                                 Ver
                               </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
                      value={webhookSecret ? `${apiBaseUrl}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}` : 'Carregando...'}
                    />
                    <button 
                      onClick={() => {
                        const url = `${apiBaseUrl}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}`;
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
            <div className="max-w-none">
              {campaigns.length > 0 && (
                <div className="rounded-2xl border border-zinc-900/70 bg-zinc-950/40 p-5 text-sm text-zinc-300 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-white">Campanha do diagnóstico</div>
                    {selectedCampaign && (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          selectedCampaign.status === 'ACTIVE'
                            ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10'
                            : 'border-amber-500/40 text-amber-200 bg-amber-500/10'
                        }`}
                      >
                        {selectedCampaign.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Selecione a campanha</label>
                      <select
                        value={selectedCampaignId}
                        onChange={(e) => setSelectedCampaignId(e.target.value)}
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500/60"
                      >
                        <option value="">Escolha uma campanha</option>
                        {[...campaigns]
                          .sort((a, b) => {
                            const aActive = a.status === 'ACTIVE' ? 0 : 1;
                            const bActive = b.status === 'ACTIVE' ? 0 : 1;
                            if (aActive !== bActive) return aActive - bActive;
                            return a.name.localeCompare(b.name);
                          })
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.status === 'ACTIVE' ? '(Ativa)' : '(Pausada)'}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {selectedCampaignId ? 'Pronto para gerar o diagnóstico.' : 'Obrigatório selecionar antes de gerar.'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {periodSelector}
                    <button
                      onClick={() => loadCampaigns().catch(() => {})}
                      className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-sm"
                    >
                      Atualizar
                    </button>
                  </div>
                  {selectedCampaignId && campaignMetrics[selectedCampaignId] && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-xs text-zinc-300">
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Valor usado</div>
                        <div className="text-zinc-100 text-sm">
                          {formatMoney(campaignMetrics[selectedCampaignId].spend)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Impressões</div>
                        <div className="text-zinc-100 text-sm">
                          {formatNumber(campaignMetrics[selectedCampaignId].impressions)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Cliques</div>
                        <div className="text-zinc-100 text-sm">
                          {formatNumber(campaignMetrics[selectedCampaignId].clicks)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">CTR</div>
                        <div className="text-zinc-100 text-sm">
                          {formatPercent(campaignMetrics[selectedCampaignId].ctr)}%
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">CPM</div>
                        <div className="text-zinc-100 text-sm">
                          {formatMoney(campaignMetrics[selectedCampaignId].cpm)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Resultado</div>
                        <div className="text-zinc-100 text-sm">
                          {formatNumber(getResultValue(selectedCampaign, campaignMetrics[selectedCampaignId]))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Finalização</div>
                        <div className="text-zinc-100 text-sm">
                          {formatNumber(campaignMetrics[selectedCampaignId].initiates_checkout)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Compra</div>
                        <div className="text-zinc-100 text-sm">
                          {formatNumber(campaignMetrics[selectedCampaignId].purchases)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-900/70 bg-zinc-950/60 p-3">
                        <div className="text-zinc-500">Connect Rate</div>
                        <div className="text-zinc-100 text-sm">
                          {formatPercent(getConnectRate(campaignMetrics[selectedCampaignId]))}
                          %
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!report && (
                <div className="rounded-2xl border border-zinc-900/70 bg-zinc-950/40 p-5 text-sm text-zinc-300">
                  <div className="font-semibold text-white">Diagnóstico</div>
                  <div className="mt-1 text-sm text-zinc-400">
                    Clique em <span className="text-zinc-200">Gerar diagnóstico</span> para receber um relatório claro e acionável.
                  </div>
                </div>
              )}
              {report?.analysis_text && (
                <div className="grid gap-4">
                  {reportSections.map((section, index) => (
                    <div
                      key={`${section.title}-${index}`}
                      className="rounded-2xl border border-zinc-900/70 bg-zinc-950/40 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
                    >
                      <div className="text-sm font-semibold text-white">{section.title}</div>
                      {section.body && (
                        <div className="mt-3 prose prose-invert max-w-none prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:text-zinc-300 prose-strong:text-zinc-100 prose-a:text-blue-300 prose-a:no-underline hover:prose-a:text-blue-200">
                          <ReactMarkdown
                            components={{
                              table: ({ children }) => (
                                <div className="overflow-auto rounded-xl border border-zinc-800/80 bg-zinc-950/40">
                                  <table className="w-full border-collapse">{children}</table>
                                </div>
                              ),
                              thead: ({ children }) => <thead className="bg-zinc-900/40">{children}</thead>,
                              th: ({ children }) => (
                                <th className="text-left text-[11px] font-semibold text-zinc-200 px-3 py-2 border-b border-zinc-800/80">
                                  {children}
                                </th>
                              ),
                              td: ({ children }) => (
                                <td className="text-sm text-zinc-300 px-3 py-2 border-b border-zinc-900/70">{children}</td>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-blue-500/60 bg-blue-500/10 rounded-lg px-4 py-3 text-zinc-200">
                                  {children}
                                </blockquote>
                              ),
                              ul: ({ children }) => <ul className="list-disc list-inside space-y-1">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside space-y-1">{children}</ol>,
                              hr: () => <div className="my-5 h-px w-full bg-zinc-900/70" />,
                            }}
                          >
                            {section.body}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

