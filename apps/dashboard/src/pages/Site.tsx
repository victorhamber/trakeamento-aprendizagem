import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import { DDI_LIST } from '../lib/ddi';
import { Layout } from '../components/Layout';

type Site = {
  id: number;
  name: string;
  domain: string | null;
  tracking_domain: string | null;
  site_key: string;
};

type Tab = 'snippet' | 'meta' | 'utm' | 'campaigns' | 'ga' | 'matching' | 'webhooks' | 'reports';
interface MetaConfig {
  pixel_id?: string | null;
  ad_account_id?: string | null;
  enabled?: boolean | null;
  has_capi_token?: boolean;
  has_facebook_connection?: boolean;
  fb_user_id?: string | null;
  fb_token_expires_at?: string | null;
  capi_test_event_code?: string | null;
  last_capi_status?: string | null;
  last_capi_error?: string | null;
  last_capi_attempt_at?: string | null;
  last_ingest_at?: string | null;
  last_ingest_event_name?: string | null;
  last_ingest_event_id?: string | null;
  last_ingest_event_source_url?: string | null;
};
type GaConfig = {
  measurement_id?: string | null;
  enabled?: boolean | null;
  has_api_secret?: boolean;
};
type MetaBreakdownItem = {
  id?: string | null;
  name?: string | null;
  spend: number;
  impressions: number;
  reach?: number | null;
  clicks: number;
  unique_link_clicks: number;
  outbound_clicks: number;
  landing_page_views: number;
  leads: number;
  initiates_checkout: number;
  purchases: number;
  cpc_avg?: number | null;
  cpm_avg?: number | null;
  ctr_avg?: number | null;
  frequency_avg?: number | null;
  ctr_calc_pct?: number;
  lp_rate_pct?: number;
};
type DiagnosisReport = {
  analysis_text?: string;
  context?: {
    campaign_id?: string | null;
    date_preset?: string;
    since?: string;
    until?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    click_id?: string;
  };
  meta_breakdown?: {
    campaigns?: MetaBreakdownItem[];
    adsets?: MetaBreakdownItem[];
    ads?: MetaBreakdownItem[];
  };
  period?: { since?: string; until?: string; days?: number };
} & Record<string, unknown>;
type CampaignMetrics = {
  campaign_id: string;
  campaign_name?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  unique_clicks: number;
  unique_link_clicks: number;
  video_3s_views?: number;
  ctr: number;
  cpc: number;
  cpm: number;
  hook_rate?: number;
  outbound_clicks: number;
  landing_page_views: number;
  frequency?: number;
  contacts: number;
  leads: number;
  adds_to_cart: number;
  initiates_checkout: number;
  purchases: number;
  reach?: number;
  objective?: string | null;
  results?: number;
  custom_event_name?: string | null;
  custom_event_count?: number;
  objective_metric?: number;
  objective_metric_label?: string | null;
  optimization_goal?: string | null;
  promoted_object?: Record<string, unknown> | null;
};

// ─── Small UI primitives ────────────────────────────────────────────────────

const Badge = ({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'active' | 'paused' | 'archived';
}) => {
  const styles = {
    default: 'bg-zinc-800 text-zinc-400 border-zinc-700/60',
    active: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
    paused: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
    archived: 'bg-zinc-700/40 text-zinc-500 border-zinc-700/40',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border tracking-wide ${styles[variant]}`}
    >
      {variant === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      {children}
    </span>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3.5 hover:border-zinc-700/60 transition-colors">
    <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500 mb-1.5">{label}</div>
    <div className="text-sm font-semibold text-zinc-100 tabular-nums">{value}</div>
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────────────

export const SitePage = () => {
  const { siteId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = Number(siteId);
  const apiBaseUrl = (api.defaults.baseURL || '').replace(/\/+$/, '');
  const apiHost = apiBaseUrl.replace(/^https?:\/\//, '');
  const [site, setSite] = useState<Site | null>(null);
  const initialTab = (searchParams.get('tab') as Tab) || 'snippet';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [snippet, setSnippet] = useState<string>('');
  const [trackingDomainInput, setTrackingDomainInput] = useState('');
  const [savingTrackingDomain, setSavingTrackingDomain] = useState(false);
  const [meta, setMeta] = useState<MetaConfig | null>(null);
  const [adAccounts, setAdAccounts] = useState<
    Array<{ id: string; name: string; account_id?: string; business?: { id: string; name: string } }>
  >([]);
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [ga, setGa] = useState<GaConfig | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [dataQuality, setDataQuality] = useState<any>(null);
  const [webhookTestPlatform, setWebhookTestPlatform] = useState('hotmart');
  const [webhookTestLoading, setWebhookTestLoading] = useState(false);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [reportLoadedFromStorage, setReportLoadedFromStorage] = useState(false);
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
  const [flashType, setFlashType] = useState<'success' | 'error'>('success');

  const [metaLevel, setMetaLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign');
  const [metaParentId, setMetaParentId] = useState<string | null>(null);
  const [metaBreadcrumbs, setMetaBreadcrumbs] = useState<
    { id: string | null; name: string; level: string }[]
  >([{ id: null, name: 'Campanhas', level: 'campaign' }]);
  const [metaStatusFilter, setMetaStatusFilter] = useState<'active' | 'all'>('all');
  const [showAdAccountSelector, setShowAdAccountSelector] = useState(false);
  const [utmBaseUrl, setUtmBaseUrl] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');
  const [utmTerm, setUtmTerm] = useState('');
  const [utmClickId, setUtmClickId] = useState('');
  const [diagnosisUtmSource, setDiagnosisUtmSource] = useState('');
  const [diagnosisUtmMedium, setDiagnosisUtmMedium] = useState('');
  const [diagnosisUtmCampaign, setDiagnosisUtmCampaign] = useState('');
  const [diagnosisUtmContent, setDiagnosisUtmContent] = useState('');
  const [diagnosisUtmTerm, setDiagnosisUtmTerm] = useState('');
  const [diagnosisClickId, setDiagnosisClickId] = useState('');
  const [showUrlPaster, setShowUrlPaster] = useState(false);
  const [pastedUrl, setPastedUrl] = useState('');
  const [utmOptions, setUtmOptions] = useState<{
    sources: string[];
    mediums: string[];
    campaigns: string[];
    contents: string[];
    terms: string[];
  }>({
    sources: [],
    mediums: [],
    campaigns: [],
    contents: [],
    terms: [],
  });
  const [savedUtms, setSavedUtms] = useState<any[]>([]);
  const [saveUtmName, setSaveUtmName] = useState('');
  const [showSaveUtmModal, setShowSaveUtmModal] = useState(false);

  // Event Rules & Form Generator State
  const [eventRules, setEventRules] = useState<any[]>([]);
  const [urlRuleValue, setUrlRuleValue] = useState('');
  const [urlRuleEventType, setUrlRuleEventType] = useState('Purchase');
  const [urlRuleCustomName, setUrlRuleCustomName] = useState('');
  const [formFields, setFormFields] = useState({ name: true, email: true, phone: true });
  const [formButtonText, setFormButtonText] = useState('Quero me cadastrar');
  const [formEventType, setFormEventType] = useState('Lead');
  const [formCustomEventName, setFormCustomEventName] = useState('');
  const [formTheme, setFormTheme] = useState<'light' | 'dark'>('light');

  // New Form Builder State
  const [savedForms, setSavedForms] = useState<any[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [postSubmitAction, setPostSubmitAction] = useState<'message' | 'redirect'>('message');
  const [postSubmitMessage, setPostSubmitMessage] = useState('Obrigado! Seus dados foram enviados com sucesso.');
  const [postSubmitRedirectUrl, setPostSubmitRedirectUrl] = useState('');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');

  const loadSavedForms = useCallback(async () => {
    try {
      const res = await api.get(`/sites/${id}/forms`);
      setSavedForms(res.data.forms || []);
    } catch (err) {
      console.error('Failed to load forms', err);
    }
  }, [id]);

  const saveForm = async () => {
    if (!formName.trim()) {
      showFlash('Nome do formulário é obrigatório', 'error');
      return;
    }

    const config = {
      fields: formFields,
      theme: formTheme,
      button_text: formButtonText,
      event_type: formEventType,
      custom_event_name: formCustomEventName,
      post_submit_action: postSubmitAction,
      post_submit_message: postSubmitMessage,
      post_submit_redirect_url: postSubmitRedirectUrl,
      webhook_url: formWebhookUrl
    };

    try {
      if (selectedFormId) {
        await api.put(`/sites/${id}/forms/${selectedFormId}`, { name: formName, config });
        showFlash('Formulário atualizado com sucesso!');
      } else {
        await api.post(`/sites/${id}/forms`, { name: formName, config });
        showFlash('Formulário salvo com sucesso!');
      }
      setFormName('');
      setSelectedFormId(null);
      await loadSavedForms();
    } catch (err) {
      console.error(err);
      showFlash('Erro ao salvar formulário', 'error');
    }
  };

  const deleteForm = async (formId: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este formulário?')) return;
    try {
      await api.delete(`/sites/${id}/forms/${formId}`);
      showFlash('Formulário excluído!');
      await loadSavedForms();
      if (selectedFormId === formId) {
        setSelectedFormId(null);
        setFormName('');
      }
    } catch (err) {
      console.error(err);
      showFlash('Erro ao excluir formulário', 'error');
    }
  };

  const loadFormToEditor = (form: any) => {
    setSelectedFormId(form.id);
    setFormName(form.name);
    const cfg = form.config || {};
    setFormFields(cfg.fields || { name: true, email: true, phone: true });
    setFormTheme(cfg.theme || 'light');
    setFormButtonText(cfg.button_text || 'Quero me cadastrar');
    setFormEventType(cfg.event_type || 'Lead');
    setFormCustomEventName(cfg.custom_event_name || '');
    setPostSubmitAction(cfg.post_submit_action || 'message');
    setPostSubmitMessage(cfg.post_submit_message || 'Obrigado! Seus dados foram enviados com sucesso.');
    setPostSubmitRedirectUrl(cfg.post_submit_redirect_url || '');
    setFormWebhookUrl(cfg.webhook_url || '');
    showFlash(`Formulário "${form.name}" carregado!`);
  };

  const loadSavedUtms = useCallback(async () => {
    try {
      const res = await api.get(`/sites/${id}/saved-utms`);
      setSavedUtms(res.data.saved_utms || []);
    } catch (err) {
      console.error('Failed to load saved UTMs', err);
    }
  }, [id]);

  const saveCurrentUtm = async () => {
    if (!saveUtmName.trim()) {
      showFlash('Nome é obrigatório', 'error');
      return;
    }
    try {
      await api.post(`/sites/${id}/saved-utms`, {
        name: saveUtmName,
        url_base: utmBaseUrl,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
        click_id: utmClickId,
      });
      showFlash('UTM salva com sucesso!');
      setShowSaveUtmModal(false);
      setSaveUtmName('');
      loadSavedUtms();
    } catch (err) {
      console.error('Failed to save UTM', err);
      showFlash('Erro ao salvar UTM', 'error');
    }
  };

  const deleteSavedUtm = async (utmId: number) => {
    if (!window.confirm('Tem certeza que deseja excluir esta UTM salva?')) return;
    try {
      await api.delete(`/sites/${id}/saved-utms/${utmId}`);
      showFlash('UTM excluída com sucesso!');
      loadSavedUtms();
    } catch (err) {
      console.error('Failed to delete UTM', err);
      showFlash('Erro ao excluir UTM', 'error');
    }
  };

  const selectSavedUtm = (utm: any) => {
    setDiagnosisUtmSource(utm.utm_source || '');
    setDiagnosisUtmMedium(utm.utm_medium || '');
    setDiagnosisUtmCampaign(utm.utm_campaign || '');
    setDiagnosisUtmContent(utm.utm_content || '');
    setDiagnosisUtmTerm(utm.utm_term || '');
    setDiagnosisClickId(utm.click_id || '');
    showFlash('UTM carregada para análise', 'success');
  };

  const showFlash = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setFlash(msg);
    setFlashType(type);
    setTimeout(() => setFlash(null), 4000);
  }, []);

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
  const visibleReportSections = useMemo(
    () =>
      reportSections.filter(
        (section) => !section.title.toLowerCase().includes('tabela de métricas')
      ),
    [reportSections]
  );

  useEffect(() => {
    setReportLoadedFromStorage(false);
  }, [reportStorageKey]);

  useEffect(() => {
    if (!site || reportLoadedFromStorage) return;
    const raw = localStorage.getItem(reportStorageKey);
    if (!raw) {
      setReportLoadedFromStorage(true);
      return;
    }
    try {
      const saved = JSON.parse(raw);
      if (saved?.report) {
        setReport(saved.report);
        if (saved.selectedCampaignId) setSelectedCampaignId(saved.selectedCampaignId);
        if (saved.metricsPreset) setMetricsPreset(saved.metricsPreset);
        if (saved.metricsSince) setMetricsSince(saved.metricsSince);
        if (saved.metricsUntil) setMetricsUntil(saved.metricsUntil);
        if (saved.diagnosisUtmSource) setDiagnosisUtmSource(saved.diagnosisUtmSource);
        if (saved.diagnosisUtmMedium) setDiagnosisUtmMedium(saved.diagnosisUtmMedium);
        if (saved.diagnosisUtmCampaign) setDiagnosisUtmCampaign(saved.diagnosisUtmCampaign);
        if (saved.diagnosisUtmContent) setDiagnosisUtmContent(saved.diagnosisUtmContent);
        if (saved.diagnosisUtmTerm) setDiagnosisUtmTerm(saved.diagnosisUtmTerm);
        if (saved.diagnosisClickId) setDiagnosisClickId(saved.diagnosisClickId);
      }
    } catch (err) {
      void err;
    }
    setReportLoadedFromStorage(true);
  }, [site, reportLoadedFromStorage, reportStorageKey]);

  useEffect(() => {
    if (!report) return;
    const ctx = (report as { context?: Record<string, unknown> }).context || {};
    const reportCampaign = typeof ctx.campaign_id === 'string' ? ctx.campaign_id : null;
    const reportPreset = typeof ctx.date_preset === 'string' ? ctx.date_preset : null;
    const reportSince = typeof ctx.since === 'string' ? ctx.since : '';
    const reportUntil = typeof ctx.until === 'string' ? ctx.until : '';
    const reportUtmSource = typeof ctx.utm_source === 'string' ? ctx.utm_source : '';
    const reportUtmMedium = typeof ctx.utm_medium === 'string' ? ctx.utm_medium : '';
    const reportUtmCampaign = typeof ctx.utm_campaign === 'string' ? ctx.utm_campaign : '';
    const reportUtmContent = typeof ctx.utm_content === 'string' ? ctx.utm_content : '';
    const reportUtmTerm = typeof ctx.utm_term === 'string' ? ctx.utm_term : '';
    const reportClickId = typeof ctx.click_id === 'string' ? ctx.click_id : '';
    const currentCampaign = selectedCampaignId || null;
    const mismatchCampaign = reportCampaign !== currentCampaign;
    const mismatchPeriod =
      metricsPreset === 'custom'
        ? reportSince !== metricsSince || reportUntil !== metricsUntil
        : reportPreset !== metricsPreset;
    const mismatchUtm =
      reportUtmSource !== diagnosisUtmSource ||
      reportUtmMedium !== diagnosisUtmMedium ||
      reportUtmCampaign !== diagnosisUtmCampaign ||
      reportUtmContent !== diagnosisUtmContent ||
      reportUtmTerm !== diagnosisUtmTerm ||
      reportClickId !== diagnosisClickId;
    if (mismatchCampaign || mismatchPeriod || mismatchUtm) {
      setReport(null);
      localStorage.removeItem(reportStorageKey);
      showFlash('Campanha, período ou filtros UTM mudaram. Gere um novo diagnóstico.', 'error');
    }
  }, [
    report,
    selectedCampaignId,
    metricsPreset,
    metricsSince,
    metricsUntil,
    diagnosisUtmSource,
    diagnosisUtmMedium,
    diagnosisUtmCampaign,
    diagnosisUtmContent,
    diagnosisUtmTerm,
    diagnosisClickId,
    showFlash,
    reportStorageKey,
  ]);

  useEffect(() => {
    if (!meta) return;
    setShowAdAccountSelector(!meta.ad_account_id);
  }, [meta?.ad_account_id]);

  useEffect(() => {
    if (!site || !report) return;
    const payload = {
      report,
      selectedCampaignId,
      metricsPreset,
      metricsSince,
      metricsUntil,
      diagnosisUtmSource,
      diagnosisUtmMedium,
      diagnosisUtmCampaign,
      diagnosisUtmContent,
      diagnosisUtmTerm,
      diagnosisClickId,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(reportStorageKey, JSON.stringify(payload));
  }, [
    site,
    report,
    selectedCampaignId,
    metricsPreset,
    metricsSince,
    metricsUntil,
    diagnosisUtmSource,
    diagnosisUtmMedium,
    diagnosisUtmCampaign,
    diagnosisUtmContent,
    diagnosisUtmTerm,
    diagnosisClickId,
    reportStorageKey,
  ]);

  const loadSite = useCallback(async () => {
    const res = await api.get(`/sites/${id}`);
    setSite(res.data.site);
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    loadSite().catch(() => nav('/'));
  }, [id, loadSite, nav]);

  useEffect(() => {
    if (!site || utmBaseUrl) return;
    if (site.domain) {
      const normalized = site.domain.startsWith('http') ? site.domain : `https://${site.domain}`;
      setUtmBaseUrl(normalized);
    }
  }, [site, utmBaseUrl]);

  useEffect(() => {
    if (!site) return;
    setTrackingDomainInput(site.tracking_domain || '');
  }, [site]);

  const loadEventRules = useCallback(async () => {
    try {
      const res = await api.get(`/sites/${id}/event-rules`);
      setEventRules(res.data.rules || []);
    } catch (err) {
      console.error('Failed to load event rules', err);
    }
  }, [id]);

  const handleAddUrlRule = async () => {
    if (!urlRuleValue) {
      showFlash('Preencha o trecho da URL', 'error');
      return;
    }
    const evtName = urlRuleEventType === 'Custom' ? urlRuleCustomName : urlRuleEventType;
    if (!evtName) {
      showFlash('Defina o nome do evento', 'error');
      return;
    }

    try {
      await api.post(`/sites/${id}/event-rules`, {
        rule_type: 'url_contains',
        match_value: urlRuleValue,
        event_name: evtName,
        event_type: urlRuleEventType === 'Custom' ? 'custom' : 'standard'
      });
      setUrlRuleValue('');
      setUrlRuleCustomName('');
      await loadEventRules();
      showFlash('Regra de URL adicionada!');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao adicionar regra', 'error');
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!window.confirm('Excluir esta regra?')) return;
    try {
      await api.delete(`/sites/${id}/event-rules/${ruleId}`);
      await loadEventRules();
      showFlash('Regra removida!');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao remover regra', 'error');
    }
  };

  const copyFormHtml = (form?: any) => {
    let currentConfig = {
      fields: formFields,
      theme: formTheme,
      button_text: formButtonText,
      event_type: formEventType,
      custom_event_name: formCustomEventName,
      post_submit_action: postSubmitAction,
      post_submit_message: postSubmitMessage,
      post_submit_redirect_url: postSubmitRedirectUrl,
      webhook_url: formWebhookUrl
    };

    let publicId = '';

    if (form) {
      currentConfig = {
        fields: form.config.fields || { name: true, email: true, phone: true },
        theme: form.config.theme || 'light',
        button_text: form.config.button_text || 'Quero me cadastrar',
        event_type: form.config.event_type || 'Lead',
        custom_event_name: form.config.custom_event_name || '',
        post_submit_action: form.config.post_submit_action || 'message',
        post_submit_message: form.config.post_submit_message || 'Obrigado! Seus dados foram enviados com sucesso.',
        post_submit_redirect_url: form.config.post_submit_redirect_url || '',
        webhook_url: form.config.webhook_url || ''
      };
      publicId = form.public_id;
    } else if (selectedFormId) {
      const saved = savedForms.find((f) => f.id === selectedFormId);
      if (saved) publicId = saved.public_id;
    }

    const { fields, theme, button_text, event_type, custom_event_name, post_submit_action: action, webhook_url: webhook } = currentConfig;

    const evtName = event_type === 'Custom' ? custom_event_name : event_type;
    if (!evtName) {
      showFlash('Defina o nome do evento do formulário', 'error');
      return;
    }

    const needsBackend = !!webhook || action === 'redirect' || action === 'message';

    if (needsBackend && !publicId) {
      showFlash('Salve o formulário para ativar Webhook e Ações Pós-Cadastro!', 'error');
      // Continue to copy basic HTML
    }

    const isDark = theme === 'dark';
    const baseInputStyle = isDark
      ? 'padding:10px; border:1px solid #444; border-radius:4px; background:#222; color:#fff;'
      : 'padding:10px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#333;';
    const inputStyle = `display:block; width:100%; margin-bottom:10px; ${baseInputStyle}`;
    const phoneRowStyle = 'display:flex; gap:8px; margin-bottom:10px;';
    const ddiStyle = `width:90px; ${baseInputStyle}`;
    const phoneStyle = `flex:1; ${baseInputStyle}`;

    const fieldsHtml = [];
    if (fields.name) fieldsHtml.push(`  <input type="text" name="fn" placeholder="Nome" required style="${inputStyle}" />`);
    if (fields.email) fieldsHtml.push(`  <input type="email" name="email" placeholder="E-mail" required style="${inputStyle}" />`);
    if (fields.phone) {
      const ddiOptions = DDI_LIST.map(d => `<option value="${d.code}">${d.country} (${d.code})</option>`).join('');
      fieldsHtml.push(`  <div style="${phoneRowStyle}"><input type="tel" name="ddi" list="trk-ddi-list" value="+55" style="${ddiStyle}" placeholder="DDI" /><input type="tel" name="phone" placeholder="Telefone" required style="${phoneStyle}" /></div><datalist id="trk-ddi-list">${ddiOptions}</datalist>`);
    }

    const buttonStyle = 'padding:10px 20px; cursor:pointer; border:none; border-radius:4px; font-weight:bold; width:100%;';
    const buttonColor = isDark
      ? 'background:#fff; color:#000;'
      : 'background:#000; color:#fff;';

    const formId = `trk-form-${Date.now()}`;
    let scriptContent = '';

    if (publicId) {
      let baseUrl = apiBaseUrl;
      if (!baseUrl) {
        baseUrl = window.location.origin;
      } else if (baseUrl.startsWith('/')) {
        baseUrl = window.location.origin + baseUrl;
      }
      const endpoint = `${baseUrl}/public/forms/${publicId}/submit`;
      scriptContent = `
<script>
async function handleTrkSubmit(e) {
  e.preventDefault();
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Enviando...';

  var data = {};
  if (form.fn) data.fn = form.fn.value;
  if (form.email) data.email = form.email.value;
  var ddi = form.ddi ? form.ddi.value : '+55';
  var ddiDigits = (ddi || '').toString().replace(/[^0-9]/g, '');
  if (!ddiDigits) ddiDigits = '55';
  var phoneRaw = form.phone ? form.phone.value : '';
  var phoneDigits = (phoneRaw || '').toString().replace(/[^0-9]/g, '');
  if (phoneDigits) data.phone = '+' + ddiDigits + phoneDigits;

  // 1. Client-side tracking
  if (window.tracker) {
    window.tracker.identify(data);
    window.tracker.track('${evtName}');
  }

  // 2. Server-side submission
  try {
    var res = await fetch('${endpoint}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    var json = await res.json();

    if (json.action === 'redirect' && json.redirect_url) {
      window.location.href = json.redirect_url;
    } else if (json.message) {
      form.innerHTML = '<div style="padding:20px; text-align:center; color:${isDark ? '#fff' : '#000'};">' + json.message + '</div>';
    } else {
       form.reset();
       alert('Enviado com sucesso!');
       btn.disabled = false;
       btn.innerText = originalText;
    }
  } catch (err) {
    console.error(err);
    alert('Erro ao enviar. Tente novamente.');
    btn.disabled = false;
    btn.innerText = originalText;
  }
}
</script>
`;
    } else {
      scriptContent = `
<script>
function handleTrkSubmit(e) {
  e.preventDefault();
  var form = e.target;
  var data = {};
  if (form.fn) data.fn = form.fn.value;
  if (form.email) data.email = form.email.value;
  var ddi = form.ddi ? form.ddi.value : '+55';
  var ddiDigits = (ddi || '').toString().replace(/[^0-9]/g, '');
  if (!ddiDigits) ddiDigits = '55';
  var phoneRaw = form.phone ? form.phone.value : '';
  var phoneDigits = (phoneRaw || '').toString().replace(/[^0-9]/g, '');
  if (phoneDigits) data.phone = '+' + ddiDigits + phoneDigits;

  if (window.tracker) {
    window.tracker.identify(data);
    window.tracker.track('${evtName}');
  }
  
  form.reset();
  alert('Dados enviados!');
}
</script>
`;
    }

    const html = `
<!-- Início do Formulário de Captura (${isDark ? 'Tema Escuro' : 'Tema Claro'}) -->
<form id="${formId}" onsubmit="handleTrkSubmit(event)" style="max-width:400px; margin:0 auto; font-family:sans-serif;">
${fieldsHtml.join('\n')}
  <button type="submit" style="${buttonStyle} ${buttonColor}">${button_text}</button>
</form>
${scriptContent}
<!-- Fim do Formulário de Captura -->
    `.trim();

    navigator.clipboard.writeText(html);
    showFlash(publicId ? 'HTML com integração copiado!' : 'HTML simples copiado (Prévia)');
  };

  const tabs = useMemo(
    () => [
      { key: 'snippet' as const, label: 'Instalação' },
      { key: 'meta' as const, label: 'Meta Ads' },
      { key: 'utm' as const, label: 'URLs UTM' },
      { key: 'campaigns' as const, label: 'Campanhas' },
      { key: 'ga' as const, label: 'Google Analytics' },
      { key: 'matching' as const, label: 'Eventos' },
      { key: 'webhooks' as const, label: 'Webhooks' },
      { key: 'reports' as const, label: 'Diagnóstico IA' },
    ],
    []
  );

  const loadSnippet = useCallback(async () => {
    const res = await api.get(`/sites/${id}/snippet`);
    setSnippet(res.data.snippet);
  }, [id]);

  const saveTrackingDomain = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!site) return;
    setSavingTrackingDomain(true);
    try {
      await api.put(`/sites/${id}`, {
        tracking_domain: trackingDomainInput.trim() || null,
      });
      await loadSite();
      await loadSnippet();
      showFlash('Domínio de rastreamento atualizado!');
    } catch (err) {
      showFlash('Erro ao salvar domínio de rastreamento', 'error');
    } finally {
      setSavingTrackingDomain(false);
    }
  };

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

  const selectedAdAccountName = useMemo(() => {
    if (!meta?.ad_account_id) return '';
    const acc = adAccounts.find((a) => (a.account_id || a.id) === meta.ad_account_id);
    if (!acc) return meta.ad_account_id || '';
    if (acc.business) return `${acc.name} (${acc.business.name})`;
    return acc.name;
  }, [meta?.ad_account_id, adAccounts]);

  const loadMatching = useCallback(async () => {
    // Matching loading removed
  }, [id]);

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const enabledInput = form.elements.namedItem('enabled') as HTMLInputElement | null;
    const data: Record<string, any> = {
      site_id: id,
      ad_account_id: formData.get('ad_account_id'),
      pixel_id: formData.get('pixel_id'),
      enabled: enabledInput ? enabledInput.checked : true,
    };
    const capi = formData.get('capi_token') as string | null;
    if (capi && capi.trim().length >= 20) data.capi_token = capi;
    const testCode = formData.get('capi_test_event_code');
    data.capi_test_event_code = testCode;
    try {
      await api.put(`/integrations/sites/${id}/meta`, data);
      showFlash('Configurações salvas com sucesso!');
      await loadMeta();
    } catch (err) {
      console.error(err);
      showFlash('Erro ao salvar configurações Meta.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const testCapi = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/integrations/sites/${id}/meta/test-capi`);
      console.log('[CAPI Test]', JSON.stringify(res.data, null, 2));
      if (res.data?.ok) {
        showFlash('Evento do servidor enviado com sucesso!');
      } else {
        const diag = res.data?.diagnostic;
        let msg = res.data?.error || 'Falha ao enviar evento do servidor.';
        if (diag && !diag.decrypt_ok) msg += ` (Erro decrypt: ${diag.decrypt_error})`;
        else if (diag && !diag.token_passes_validation) msg += ` (Token descriptografado: ${diag.decrypted_token_length} chars)`;
        showFlash(msg, 'error');
      }
      await loadMeta();
    } catch (err) {
      console.error(err);
      showFlash('Erro ao testar evento do servidor.', 'error');
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
      showFlash('Não foi possível iniciar a conexão com o Facebook.', 'error');
    } catch (err: unknown) {
      const apiError =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      if (apiError === 'META_APP_ID is missing') {
        showFlash('Credenciais Meta não configuradas no servidor.', 'error');
      } else {
        showFlash(apiError || 'Não foi possível iniciar a conexão com o Facebook.', 'error');
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
      showFlash('Facebook desconectado.');
    } finally {
      setLoading(false);
    }
  };

  const loadAdAccounts = useCallback(async () => {
    const res = await api.get(`/integrations/sites/${id}/meta/adaccounts`);
    setAdAccounts(res.data.ad_accounts || []);
  }, [id]);

  const loadPixels = useCallback(
    async (adAccountId: string) => {
      const res = await api.get(`/integrations/sites/${id}/meta/pixels`, {
        params: { ad_account_id: adAccountId },
      });
      setPixels(res.data.pixels || []);
    },
    [id]
  );

  const loadCampaigns = useCallback(async (options?: { force?: boolean }) => {
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) return;
    setLoading(true);
    try {
      const params: any = { site_id: id, level: metaLevel, parent_id: metaParentId };
      if (options?.force) params.force = '1';
      if (metricsPreset === 'custom') {
        params.since = metricsSince;
        params.until = metricsUntil;
      } else {
        params.date_preset = metricsPreset;
      }
      const res = await api.get('/meta/campaigns/metrics', { params });
      if (res.data?.meta_error) showFlash(`Meta: ${res.data.meta_error}`, 'error');

      let rows: any[] = res.data?.data || [];

      if (metaLevel === 'campaign') {
        try {
          const metaRes = await api.get(`/integrations/sites/${id}/meta/campaigns`);
          const metaList: any[] = metaRes.data?.campaigns || [];
          const metaMap = metaList.reduce((acc: Record<string, any>, item: any) => {
            acc[item.id] = item;
            return acc;
          }, {});
          rows = rows.map((row: any) => {
            const metaInfo = metaMap[row.id] || {};
            const status = metaInfo.status || row.status || null;
            const effectiveStatus = metaInfo.effective_status || row.effective_status || status || null;
            const optimizationGoal = metaInfo.optimization_goal || row.optimization_goal || null;
            const promotedObject = metaInfo.promoted_object || row.promoted_object || null;
            return {
              ...row,
              name: row.name || metaInfo.name || row.campaign_name,
              status,
              effective_status: effectiveStatus,
              objective: metaInfo.objective || row.objective || null,
              optimization_goal: optimizationGoal,
              promoted_object: promotedObject,
            };
          });
          if (metaList.length) {
            rows = rows.filter((row) => Boolean(metaMap[row.id]));
          }
          if (metaList.length) {
            const rowMap = rows.reduce((acc: Record<string, any>, row: any) => {
              acc[row.id] = row;
              return acc;
            }, {});
            for (const item of metaList) {
              if (rowMap[item.id]) continue;
              const status = item.status || null;
              const effectiveStatus = item.effective_status || status || null;
              rows.push({
                id: item.id,
                name: item.name,
                objective: item.objective || null,
                status,
                effective_status: effectiveStatus,
                optimization_goal: item.optimization_goal || null,
                promoted_object: item.promoted_object || null,
                spend: 0,
                impressions: 0,
                clicks: 0,
                unique_clicks: 0,
                unique_link_clicks: 0,
                ctr: 0,
                cpc: 0,
                cpm: 0,
                outbound_clicks: 0,
                landing_page_views: 0,
                frequency: 0,
                reach: 0,
                contacts: 0,
                leads: 0,
                adds_to_cart: 0,
                initiates_checkout: 0,
                purchases: 0,
                results: 0,
                custom_event_name: null,
                custom_event_count: 0,
                objective_metric: 0,
                objective_metric_label: 'Objetivo',
                video_3s_views: 0,
                hook_rate: 0,
              });
            }
          }
          if (metaStatusFilter === 'active') {
            rows = rows.filter((row) => {
              const display = String(row.effective_status || row.status || '').toUpperCase();
              return display === 'ACTIVE';
            });
          }
        } catch (err) {
          console.error(err);
        }
      } else if (metaLevel === 'adset') {
        try {
          const metaRes = await api.get(`/integrations/sites/${id}/meta/adsets`, {
            params: { campaign_id: metaParentId },
          });
          const metaList: any[] = metaRes.data?.adsets || [];
          const metaMap = metaList.reduce((acc: Record<string, any>, item: any) => {
            acc[item.id] = item;
            return acc;
          }, {});
          rows = rows.map((row: any) => {
            const metaInfo = metaMap[row.id] || {};
            const status = metaInfo.status || row.status || null;
            const effectiveStatus = metaInfo.effective_status || row.effective_status || status || null;
            const optimizationGoal = metaInfo.optimization_goal || row.optimization_goal || null;
            const promotedObject = metaInfo.promoted_object || row.promoted_object || null;
            return {
              ...row,
              name: row.name || metaInfo.name || row.adset_name,
              status,
              effective_status: effectiveStatus,
              optimization_goal: optimizationGoal,
              promoted_object: promotedObject,
            };
          });
          if (metaList.length) {
            rows = rows.filter((row) => Boolean(metaMap[row.id]));
          }
          if (metaStatusFilter === 'active') {
            rows = rows.filter((row) => {
              const display = String(row.status || row.effective_status || '').toUpperCase();
              return display === 'ACTIVE';
            });
          }
        } catch (err) {
          console.error(err);
        }
      } else if (metaLevel === 'ad') {
        try {
          const metaRes = await api.get(`/integrations/sites/${id}/meta/ads`, {
            params: { adset_id: metaParentId },
          });
          const metaList: any[] = metaRes.data?.ads || [];
          const metaMap = metaList.reduce((acc: Record<string, any>, item: any) => {
            acc[item.id] = item;
            return acc;
          }, {});
          rows = rows.map((row: any) => {
            const metaInfo = metaMap[row.id] || {};
            const status = metaInfo.status || row.status || null;
            const effectiveStatus = metaInfo.effective_status || row.effective_status || status || null;
            return {
              ...row,
              name: row.name || metaInfo.name || row.ad_name,
              status,
              effective_status: effectiveStatus,
            };
          });
          if (metaList.length) {
            rows = rows.filter((row) => Boolean(metaMap[row.id]));
          }
          if (metaStatusFilter === 'active') {
            rows = rows.filter((row) => {
              const display = String(row.status || row.effective_status || '').toUpperCase();
              return display === 'ACTIVE';
            });
          }
        } catch (err) {
          console.error(err);
        }
      }

      setCampaigns(rows);
      const map = rows.reduce((acc: Record<string, any>, row: any) => {
        acc[row.id] = row;
        return acc;
      }, {});
      setCampaignMetrics(map);
    } catch (err) {
      console.error(err);
      showFlash('Erro ao carregar dados.', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, metricsPreset, metricsSince, metricsUntil, metaLevel, metaParentId, metaStatusFilter]);

  const loadUtmOptions = useCallback(async () => {
    try {
      const res = await api.get(`/sites/${id}/utms`);
      setUtmOptions(res.data);
    } catch (err) {
      console.error('Failed to load UTM options', err);
    }
  }, [id]);

  const loadDataQuality = useCallback(async () => {
    try {
      const res = await api.get(`/stats/sites/${id}/quality`);
      setDataQuality(res.data);
    } catch { setDataQuality(null); }
  }, [id]);

  const fireWebhookTest = async () => {
    setWebhookTestLoading(true);
    try {
      const res = await api.post(`/sites/${id}/webhooks/test`, { platform: webhookTestPlatform });
      if (res.data?.ok) showFlash(`Webhook de teste (${webhookTestPlatform}) disparado com sucesso!`);
      else showFlash(res.data?.error || 'Erro ao disparar teste', 'error');
    } catch { showFlash('Erro ao disparar webhook de teste', 'error'); }
    finally { setWebhookTestLoading(false); }
  };

  useEffect(() => {
    if (!site) return;
    if (tab === 'snippet') { loadSnippet().catch(() => { }); loadDataQuality().catch(() => { }); }
    if (tab === 'meta') loadMeta().catch(() => { });
    if (tab === 'campaigns') loadMeta().catch(() => { });
    if (tab === 'ga') loadGa().catch(() => { });
    if (tab === 'matching') {
      loadMatching().catch(() => { });
      loadEventRules().catch(() => { });
      loadSavedForms().catch(() => { });
    }
    if (tab === 'webhooks') loadWebhookSecret().catch(() => { });
    if (tab === 'utm') loadSavedUtms().catch(() => { });
    if (tab === 'reports') {
      loadUtmOptions().catch(() => { });
      loadSavedUtms().catch(() => { });
      setMetaLevel('campaign');
      setMetaParentId(null);
      setMetaBreadcrumbs([{ id: null, name: 'Campanhas', level: 'campaign' }]);
      loadMeta().catch(() => { });
    }
  }, [tab, site, loadSnippet, loadMeta, loadGa, loadMatching, loadWebhookSecret, loadUtmOptions, loadDataQuality]);

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

  const toggleMetaStatus = async (item: any) => {
    const current = resolveDisplayStatus(item);
    const nextStatus = current === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const label = metaLevel === 'campaign' ? 'campanha' : metaLevel === 'adset' ? 'conjunto' : 'anúncio';
    const path =
      metaLevel === 'campaign'
        ? `/integrations/sites/${id}/meta/campaigns/${item.id}`
        : metaLevel === 'adset'
          ? `/integrations/sites/${id}/meta/adsets/${item.id}`
          : `/integrations/sites/${id}/meta/ads/${item.id}`;
    try {
      await api.patch(path, { status: nextStatus });
      await loadCampaigns();
      showFlash(
        nextStatus === 'ACTIVE'
          ? `${label} ativada com sucesso.`
          : `${label} pausada com sucesso.`
      );
    } catch (err) {
      console.error(err);
      showFlash(`Erro ao atualizar status do ${label}.`, 'error');
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
    loadCampaigns().catch(() => { });
  }, [site, tab, metricsPreset, metricsSince, metricsUntil, loadCampaigns]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      showFlash('Conexão atualizada com sucesso.');
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
      loadMeta().then(() => loadAdAccounts().catch(() => { }));
    }
  }, [loadAdAccounts, loadMeta, searchParams, setSearchParams]);

  useEffect(() => {
    if (tab === 'meta' && meta?.has_facebook_connection && adAccounts.length === 0) {
      loadAdAccounts().catch(() => { });
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
      showFlash('Configuração Google Analytics salva.');
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    if (!site) return;
    if (!selectedCampaignId) {
      showFlash('Selecione uma campanha para gerar o diagnóstico.', 'error');
      setTab('reports');
      loadCampaigns({ force: true }).catch(() => { });
      return;
    }
    if (metricsPreset === 'custom' && (!metricsSince || !metricsUntil)) {
      showFlash('Defina o período personalizado.', 'error');
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string> = { campaign_id: selectedCampaignId };
      if (metricsPreset === 'custom') {
        params.since = metricsSince;
        params.until = metricsUntil;
      } else {
        params.date_preset = metricsPreset;
      }
      if (diagnosisUtmSource) params.utm_source = diagnosisUtmSource;
      if (diagnosisUtmMedium) params.utm_medium = diagnosisUtmMedium;
      if (diagnosisUtmCampaign) params.utm_campaign = diagnosisUtmCampaign;
      if (diagnosisUtmContent) params.utm_content = diagnosisUtmContent;
      if (diagnosisUtmTerm) params.utm_term = diagnosisUtmTerm;
      if (diagnosisClickId) params.click_id = diagnosisClickId;
      const res = await api.post(
        '/recommendations/generate',
        {},
        { headers: { 'x-site-key': site.site_key }, params }
      );
      setReport(res.data);
      setTab('reports');
    } catch (err: unknown) {
      console.error(err);
      const apiError =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      showFlash(apiError || 'Erro ao gerar diagnóstico.', 'error');
      setTab('reports');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
  const formatMoney = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    }).format(value);
  const formatPercent = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const utmUrl = useMemo(() => {
    if (!utmBaseUrl) return '';
    try {
      const url = new URL(utmBaseUrl);
      const params: Record<string, string> = {};
      if (utmSource) params.utm_source = utmSource;
      if (utmMedium) params.utm_medium = utmMedium;
      if (utmCampaign) params.utm_campaign = utmCampaign;
      if (utmContent) params.utm_content = utmContent;
      if (utmTerm) params.utm_term = utmTerm;
      if (utmClickId) params.click_id = utmClickId;
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      return url.toString();
    } catch {
      return '';
    }
  }, [utmBaseUrl, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, utmClickId]);
  const getBreakdownLpRate = (row: MetaBreakdownItem) => {
    const baseClicks = row.unique_link_clicks > 0 ? row.unique_link_clicks : row.clicks;
    return baseClicks > 0 ? (row.landing_page_views / baseClicks) * 100 : 0;
  };
  const getBreakdownCtr = (row: MetaBreakdownItem) =>
    row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
  const getBreakdownBottleneck = (row: MetaBreakdownItem) => {
    if (row.spend > 0 && row.impressions === 0) return 'Entrega';
    if (row.impressions > 0 && row.clicks === 0) return 'Criativo/Segmentação';
    const ctr = getBreakdownCtr(row);
    if (ctr > 0 && ctr < 0.8) return 'Criativo/Segmentação';
    const lpRate = getBreakdownLpRate(row);
    if (lpRate > 0 && lpRate < 55) return 'Landing/Promessa';
    if (row.landing_page_views > 0 && row.purchases === 0 && row.leads === 0) return 'Oferta/Checkout';
    return 'Sem sinal forte';
  };

  const resolveDisplayStatus = (item: any) => {
    const status = String(item?.status || '').toUpperCase();
    const effective = String(item?.effective_status || '').toUpperCase();
    if (metaLevel === 'adset' || metaLevel === 'ad') return status || effective;
    if (effective && effective !== 'ACTIVE' && effective !== 'PAUSED') return effective;
    return status || effective;
  };

  const getStatusLabel = (item: any) => {
    const eff = resolveDisplayStatus(item);
    if (!eff) return 'UNKNOWN';
    if (eff === 'ACTIVE') return 'Ativa';
    if (eff === 'PAUSED') return 'Pausada';
    if (eff === 'ARCHIVED') return 'Arquivada';
    if (eff === 'DELETED') return 'Excluída';
    return eff;
  };

  const getStatusVariant = (item: any): 'active' | 'paused' | 'archived' | 'default' => {
    const eff = resolveDisplayStatus(item);
    if (eff === 'ACTIVE') return 'active';
    if (eff === 'PAUSED') return 'paused';
    if (eff === 'ARCHIVED' || eff === 'DELETED') return 'archived';
    return 'default';
  };

  const resolveObjectiveMetric = (
    item: { objective?: string | null; optimization_goal?: string | null; promoted_object?: Record<string, unknown> | null } | null | undefined,
    metrics: CampaignMetrics | undefined
  ) => {
    if (!metrics) return null;

    const promoted = item?.promoted_object || null;
    const customEventName =
      promoted && typeof promoted.custom_event_str === 'string' ? promoted.custom_event_str : null;
    const customEventType =
      promoted && typeof promoted.custom_event_type === 'string' ? promoted.custom_event_type : null;

    if (customEventName) {
      return {
        value: metrics.custom_event_count ?? 0,
        label: `Evento ${customEventName}`,
      };
    }

    if (customEventType) {
      const t = customEventType.toLowerCase();
      if (t.includes('purchase')) return { value: metrics.purchases ?? 0, label: 'Compras' };
      if (t.includes('lead')) return { value: metrics.leads ?? 0, label: 'Leads' };
      if (t.includes('contact')) return { value: metrics.contacts ?? 0, label: 'Contatos' };
      if (t.includes('add_to_cart')) return { value: metrics.adds_to_cart ?? 0, label: 'Carrinhos' };
      if (t.includes('initiate_checkout')) {
        return { value: metrics.initiates_checkout ?? 0, label: 'Finalizações' };
      }
    }

    const opt = String(item?.optimization_goal || '').toLowerCase();
    if (opt) {
      if (opt.includes('lead')) return { value: metrics.leads ?? 0, label: 'Leads' };
      if (opt.includes('message') || opt.includes('conversation')) {
        return { value: metrics.contacts ?? 0, label: 'Contatos' };
      }
      if (opt.includes('purchase') || opt.includes('value') || opt.includes('conversion')) {
        return { value: metrics.purchases ?? 0, label: 'Compras' };
      }
      if (opt.includes('checkout')) {
        return { value: metrics.initiates_checkout ?? 0, label: 'Finalizações' };
      }
      if (opt.includes('landing_page_view')) {
        return { value: metrics.landing_page_views ?? 0, label: 'LP Views' };
      }
      if (opt.includes('link')) {
        const base = metrics.unique_link_clicks ?? 0;
        return { value: base > 0 ? base : metrics.clicks ?? 0, label: 'Cliques no link' };
      }
      if (opt.includes('reach') || opt.includes('impression')) {
        return { value: metrics.reach ?? 0, label: 'Alcance' };
      }
      if (opt.includes('engagement')) {
        return { value: metrics.clicks ?? 0, label: 'Engajamentos' };
      }
    }

    return null;
  };

  const getResultValue = (
    item:
      | {
        objective?: string | null;
        optimization_goal?: string | null;
        promoted_object?: Record<string, unknown> | null;
      }
      | null
      | undefined,
    metrics: CampaignMetrics | undefined
  ) => {
    if (!metrics) return 0;

    const resolved = resolveObjectiveMetric(item as any, metrics);
    if (resolved) return resolved.value;

    const objectiveMetric = metrics.objective_metric;
    if (objectiveMetric !== undefined && objectiveMetric !== null) return objectiveMetric;

    const results = metrics.results ?? 0;
    const purchases = metrics.purchases ?? 0;
    const leads = metrics.leads ?? 0;
    const contacts = metrics.contacts ?? 0;
    const uniqueLinkClicks = metrics.unique_link_clicks ?? 0;
    const clicks = metrics.clicks ?? 0;
    const reach = metrics.reach ?? 0;

    if (results > 0) return results;
    if (purchases > 0) return purchases;
    if (leads > 0) return leads;
    if (contacts > 0) return contacts;

    const objective = (item?.objective || '').toLowerCase();

    if (
      objective.includes('traffic') ||
      objective.includes('link_click') ||
      objective.includes('outcome_traffic')
    ) {
      return uniqueLinkClicks > 0 ? uniqueLinkClicks : clicks;
    }

    if (
      objective.includes('engagement') ||
      objective.includes('post_engagement') ||
      objective.includes('page_likes') ||
      objective.includes('outcome_engagement')
    ) {
      return clicks;
    }

    if (
      objective.includes('aware') ||
      objective.includes('reach') ||
      objective.includes('brand') ||
      objective.includes('outcome_awareness')
    ) {
      return reach;
    }

    // If no specific objective matched and no conversions found, return 0
    return 0;
  };

  const getObjectiveMetricLabel = (
    item:
      | {
        optimization_goal?: string | null;
        promoted_object?: Record<string, unknown> | null;
      }
      | null
      | undefined,
    metrics?: CampaignMetrics
  ) => {
    const resolved = resolveObjectiveMetric(item as any, metrics);
    if (resolved) return resolved.label;
    const label = metrics?.objective_metric_label;
    if (label) return label;
    if (metrics?.custom_event_name) return `Evento ${metrics.custom_event_name}`;
    return 'Objetivo';
  };

  const getLpViewRate = (metrics: CampaignMetrics) => {
    const base = metrics.unique_link_clicks > 0 ? metrics.unique_link_clicks : metrics.unique_clicks;
    if (base <= 0) return 0;
    return (metrics.landing_page_views / base) * 100;
  };

  const canGenerate =
    !!site &&
    !!selectedCampaignId &&
    !(metricsPreset === 'custom' && (!metricsSince || !metricsUntil));
  const selectedCampaign = selectedCampaignId ? campaigns.find((c) => c.id === selectedCampaignId) : null;

  const inputCls =
    'w-full rounded-lg bg-zinc-900/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/40 transition-all placeholder:text-zinc-600';
  const selectClsCompact =
    'rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-600 transition-colors';
  const selectCls =
    'w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-600 transition-colors';

  const periodSelector = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={metricsPreset}
        onChange={(e) => setMetricsPreset(e.target.value as typeof metricsPreset)}
        className={selectClsCompact}
      >
        <option value="today">Hoje</option>
        <option value="yesterday">Ontem</option>
        <option value="last_7d">Últimos 7 dias</option>
        <option value="last_14d">Últimos 14 dias</option>
        <option value="last_30d">Últimos 30 dias</option>
        <option value="maximum">Máximo</option>
        <option value="custom">Personalizado</option>
      </select>
      {metricsPreset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={metricsSince}
            onChange={(e) => setMetricsSince(e.target.value)}
            className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
          />
          <span className="text-zinc-600 text-xs">→</span>
          <input
            type="date"
            value={metricsUntil}
            onChange={(e) => setMetricsUntil(e.target.value)}
            className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
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
          className="relative inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium rounded-xl px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-900/30 transition-all duration-150"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processando…
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              </svg>
              Gerar diagnóstico
            </>
          )}
        </button>
      }
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <Link
            to="/sites"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
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
              <path d="m15 18-6-6 6-6" />
            </svg>
            Todos os sites
          </Link>
          {site?.domain && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              <span className="text-xs text-zinc-500 font-mono">{site.domain}</span>
            </div>
          )}
        </div>
        {site && (
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Key</span>
            <code className="text-[11px] text-zinc-400 font-mono">{site.site_key}</code>
          </div>
        )}
      </div>

      {/* ── Flash ── */}
      {flash && (
        <div
          className={`mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all ${flashType === 'error'
            ? 'border-red-500/25 bg-red-500/10 text-red-300'
            : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
            }`}
        >
          {flashType === 'error' ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" x2="9" y1="9" y2="15" />
              <line x1="9" x2="15" y1="9" y2="15" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <path d="m9 11 3 3L22 4" />
            </svg>
          )}
          {flash}
        </div>
      )}

      {/* ── Tab Panel ── */}
      <div className="mt-5 rounded-2xl border border-zinc-800/60 bg-zinc-950/60 overflow-hidden">
        {/* Tab bar */}
        <div className="border-b border-zinc-800/60 px-3 pt-3 pb-0 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                searchParams.set('tab', t.key);
                setSearchParams(searchParams, { replace: true });
              }}
              className={`relative px-3.5 py-2 text-[13px] font-medium rounded-t-lg transition-all ${tab === t.key
                ? 'text-zinc-100 bg-zinc-900/80'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: Instalação ── */}
        <div className="p-6">
          {tab === 'snippet' && (
            <div className="max-w-3xl">
              <p className="text-sm text-zinc-400 mb-4">
                Cole este snippet no seu site, antes do fechamento da tag{' '}
                <code className="text-zinc-300 bg-zinc-800/60 px-1.5 py-0.5 rounded text-xs">&lt;/head&gt;</code>.
              </p>
              <form
                onSubmit={saveTrackingDomain}
                className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="text-xs font-medium text-zinc-300">Domínio de rastreamento (CNAME)</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  Use um subdomínio do cliente para enviar eventos como first-party.
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    className="w-full rounded-xl bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm outline-none focus:border-blue-500/60 transition-colors"
                    value={trackingDomainInput}
                    onChange={(e) => setTrackingDomainInput(e.target.value)}
                    placeholder="ex: track.cliente.com"
                  />
                  <button
                    disabled={savingTrackingDomain}
                    className="whitespace-nowrap bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
                  >
                    {savingTrackingDomain ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
                <div className="mt-3 text-[11px] text-zinc-500">
                  Aponte um CNAME de <span className="text-zinc-300">{trackingDomainInput || 'track.cliente.com'}</span> para{' '}
                  <span className="text-zinc-300">{apiHost || 'seu-dominio-api.com'}</span>.
                </div>
              </form>
              <div className="relative group rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-900/80">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                    <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                    <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                  </div>
                  <span className="text-[10px] text-zinc-600 font-mono">snippet.js</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(snippet);
                      showFlash('Código copiado!');
                    }}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copiar
                  </button>
                </div>
                <pre className="text-xs p-5 max-h-72 overflow-y-auto overflow-x-hidden custom-scrollbar">
                  <code className="block whitespace-pre-wrap break-all text-zinc-300 leading-relaxed">{snippet}</code>
                </pre>
              </div>

              {snippet && (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-zinc-400">URL da API detectada:</span>
                    <code className="text-[11px] text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded">
                      {snippet.match(/apiUrl:"([^"]+)"/)?.[1] || 'Não detectada'}
                    </code>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Certifique-se de que esta URL é acessível publicamente (não localhost). Se estiver incorreta, configure a variável PUBLIC_API_BASE_URL no servidor.
                  </p>
                </div>
              )}

              {/* ── Data Quality Card ── */}
              {dataQuality && dataQuality.total_events > 0 && (
                <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <h3 className="text-sm font-semibold text-zinc-100 mb-1">Qualidade dos Dados (últimos 7 dias)</h3>
                  <p className="text-[11px] text-zinc-500 mb-4">{dataQuality.total_events.toLocaleString()} eventos rastreados</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'FBP / FBC', value: dataQuality.metrics.fbp_fbc_match_rate, desc: 'Cookies Meta' },
                      { label: 'Email / Tel', value: dataQuality.metrics.em_ph_match_rate, desc: 'PII Avançado' },
                      { label: 'External ID', value: dataQuality.metrics.external_id_match_rate, desc: 'ID Externo' },
                    ].map((m) => {
                      const pct = Math.round(m.value * 100);
                      const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
                      const bg = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={m.label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.label}</div>
                          <div className={`text-xl font-bold ${color} mt-1`}>{pct}%</div>
                          <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-[9px] text-zinc-600 mt-1">{m.desc}</div>
                        </div>
                      );
                    })}
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Score Geral</div>
                      {(() => {
                        const avg = Math.round(((dataQuality.metrics.fbp_fbc_match_rate + dataQuality.metrics.em_ph_match_rate + dataQuality.metrics.external_id_match_rate) / 3) * 100);
                        const color = avg >= 80 ? 'text-emerald-400' : avg >= 50 ? 'text-amber-400' : 'text-red-400';
                        const emoji = avg >= 80 ? '🟢' : avg >= 50 ? '🟡' : '🔴';
                        return <div className={`text-xl font-bold ${color} mt-1`}>{emoji} {avg}%</div>;
                      })()}
                      <div className="text-[9px] text-zinc-600 mt-3">Média dos indicadores</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Meta ── */}
          {tab === 'meta' && (
            <form onSubmit={saveMeta} className="max-w-2xl space-y-6">
              {/* Token Expiration Alert */}
              {meta?.fb_token_expires_at && (() => {
                const expiresAt = new Date(meta.fb_token_expires_at);
                const now = new Date();
                const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                if (daysLeft > 14) return null;
                const expired = daysLeft <= 0;
                return (
                  <div className={`rounded-xl border p-4 flex items-start gap-3 ${expired
                    ? 'border-red-500/40 bg-red-500/10'
                    : 'border-amber-500/30 bg-amber-500/8'
                    }`}>
                    <div className="text-2xl mt-0.5">{expired ? '🔴' : '⚠️'}</div>
                    <div>
                      <h4 className={`text-sm font-semibold ${expired ? 'text-red-300' : 'text-amber-300'}`}>
                        {expired ? 'Token do Facebook Expirado!' : `Token expira em ${daysLeft} dia${daysLeft > 1 ? 's' : ''}`}
                      </h4>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {expired
                          ? 'A API do servidor (CAPI) não conseguirá mais enviar eventos para o Meta. Reconecte sua conta do Facebook imediatamente.'
                          : 'Reconecte sua conta do Facebook em breve para evitar interrupção no envio de eventos CAPI.'}
                      </p>
                      {expired && (
                        <button type="button" onClick={connectFacebook}
                          className="mt-3 bg-[#1877F2] hover:bg-[#166fe5] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors">
                          Reconectar Facebook
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
              <input type="hidden" name="enabled" value="false" />

              {/* Facebook Connection */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-[#1877F2]/15 p-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="#1877F2"
                      >
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">Conexão com Facebook</h3>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Conecte para listar contas de anúncio e pixels automaticamente.
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${meta?.has_facebook_connection ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                        />
                        <span className="text-xs text-zinc-400">
                          {meta?.has_facebook_connection ? 'Conectado' : 'Não conectado'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {!meta?.has_facebook_connection ? (
                      <button
                        type="button"
                        onClick={connectFacebook}
                        className="bg-[#1877F2] hover:bg-[#166fe5] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                      >
                        Conectar
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={disconnectFacebook}
                        className="border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>

                {meta?.has_facebook_connection && (
                  <div className="mt-5 pt-5 border-t border-zinc-800/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-300">Conta de Anúncios</label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdAccountSelector(true);
                          loadAdAccounts().catch(() => { });
                        }}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                          <path d="M16 16h5v5" />
                        </svg>
                        Atualizar lista
                      </button>
                    </div>

                    {meta?.ad_account_id && !showAdAccountSelector && (
                      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-xs text-zinc-300">{selectedAdAccountName || meta.ad_account_id}</span>
                      </div>
                    )}

                    {showAdAccountSelector && (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                        {adAccounts.length === 0 && (
                          <div className="text-xs text-zinc-600 italic py-3 text-center">
                            Nenhuma conta carregada. Clique em atualizar.
                          </div>
                        )}
                        {adAccounts.map((acc) => {
                          const isSelected = meta?.ad_account_id === (acc.account_id || acc.id);
                          return (
                            <label
                              key={acc.id}
                              className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${isSelected
                                ? 'bg-blue-500/10 border-blue-500/40'
                                : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                                }`}
                              onClick={() => {
                                if (isSelected) setShowAdAccountSelector(false);
                              }}
                            >
                              <div>
                                <div
                                  className={`text-xs font-medium ${isSelected ? 'text-blue-200' : 'text-zinc-300'}`}
                                >
                                  {acc.business ? `${acc.name} (${acc.business.name})` : acc.name}
                                </div>
                                <div className="text-[10px] text-zinc-600 font-mono mt-0.5">
                                  {acc.account_id || acc.id}
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
                                    loadPixels(val).catch(() => { });
                                    setShowAdAccountSelector(false);
                                  }}
                                />
                                <div
                                  className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-zinc-600'
                                    }`}
                                >
                                  {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <input type="hidden" name="ad_account_id" value={meta?.ad_account_id || ''} />
                  </div>
                )}
              </div>

              {/* Pixel Settings */}
              <div className="space-y-5">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Status do CAPI</span>
                    {meta?.last_capi_status ? (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${meta.last_capi_status === 'ok'
                          ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25'
                          : 'bg-rose-500/12 text-rose-300 border-rose-500/25'
                          }`}
                      >
                        {meta.last_capi_status === 'ok' ? 'OK' : 'ERRO'}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-500">Sem tentativas</span>
                    )}
                  </div>
                  {meta?.last_capi_attempt_at && (
                    <div className="text-[11px] text-zinc-500">
                      Última tentativa: {new Date(meta.last_capi_attempt_at).toLocaleString()}
                    </div>
                  )}
                  {meta?.last_capi_error && (
                    <div className="text-[11px] text-rose-300 break-words">{meta.last_capi_error}</div>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2">
                  <div className="text-xs text-zinc-400">Último evento recebido do site</div>
                  {meta?.last_ingest_at ? (
                    <>
                      <div className="text-[11px] text-zinc-500">
                        {new Date(meta.last_ingest_at).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-zinc-300">
                        {meta.last_ingest_event_name || 'Evento'}
                      </div>
                      {meta.last_ingest_event_source_url && (
                        <div className="text-[11px] text-zinc-500 break-words">
                          {meta.last_ingest_event_source_url}
                        </div>
                      )}
                      {meta.last_ingest_event_id && (
                        <div className="text-[11px] text-zinc-500">
                          ID: {meta.last_ingest_event_id}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] text-zinc-500">Nenhum evento recebido</div>
                  )}
                </div>
                <div className="flex items-center gap-3 py-4 border-y border-zinc-800/60">
                  <input
                    id="meta-enabled"
                    name="enabled"
                    type="checkbox"
                    value="true"
                    defaultChecked={meta?.enabled ?? true}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <label htmlFor="meta-enabled" className="text-sm font-medium text-zinc-200 block cursor-pointer">
                      Rastreamento ativo
                    </label>
                    <span className="text-xs text-zinc-600">
                      Habilita o envio de eventos para o Pixel e API de Conversões
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">Pixel ID</label>
                  <input
                    name="pixel_id"
                    defaultValue={meta?.pixel_id || ''}
                    placeholder="Ex: 1234567890"
                    className={inputCls}
                  />
                  {pixels.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Sugestões:</span>
                      {pixels.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => {
                            const input = document.querySelector<HTMLInputElement>('input[name="pixel_id"]');
                            if (input) input.value = p.id;
                          }}
                          className="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">
                      CAPI Token <span className="text-zinc-600 font-normal">(Opcional)</span>
                    </label>
                    <input
                      name="capi_token"
                      type="password"
                      autoComplete="off"
                      className={inputCls}
                      placeholder={meta?.has_capi_token ? '•••••••• (configurado)' : 'Token de Acesso (EAA...)'}
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-600">Rastreamento server-side (anti-adblock)</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">
                      Código de teste do servidor <span className="text-zinc-600 font-normal">(Opcional)</span>
                    </label>
                    <input
                      name="capi_test_event_code"
                      defaultValue={meta?.capi_test_event_code || ''}
                      placeholder="Ex: TEST123"
                      className={inputCls}
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-600">
                      Use o código de teste do Event Manager para validar eventos server-side.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <button
                  disabled={loading}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-all shadow-lg shadow-blue-900/20"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Salvando…
                    </>
                  ) : (
                    'Salvar configurações'
                  )}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={testCapi}
                  className="inline-flex items-center gap-2 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-all"
                >
                  Testar evento do servidor
                </button>
              </div>
            </form>
          )}

          {tab === 'utm' && (
            <div className="max-w-3xl space-y-5">
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">Gerador de URL UTM</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Gere a URL com UTMs para usar nos parâmetros do anúncio do Meta.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUtmSource('facebook');
                        setUtmMedium('paid_social');
                        setUtmCampaign('{{campaign.name}}');
                        setUtmContent('{{ad.name}}');
                        setUtmTerm('{{adset.name}}');
                        setUtmClickId('{{ad.id}}');
                      }}
                      className="text-[11px] border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                    >
                      Usar placeholders Meta
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUtmSource('');
                        setUtmMedium('');
                        setUtmCampaign('');
                        setUtmContent('');
                        setUtmTerm('');
                        setUtmClickId('');
                      }}
                      className="text-[11px] border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">URL base</label>
                  <input
                    value={utmBaseUrl}
                    onChange={(e) => setUtmBaseUrl(e.target.value)}
                    placeholder="https://seusite.com/pagina"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">utm_source</label>
                    <input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">utm_medium</label>
                    <input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">utm_campaign</label>
                    <input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">utm_content</label>
                    <input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">utm_term</label>
                    <input value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">click_id</label>
                    <input value={utmClickId} onChange={(e) => setUtmClickId(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    URL final
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!utmUrl}
                      onClick={() => setShowSaveUtmModal(true)}
                      className="text-[11px] border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      disabled={!utmUrl}
                      onClick={() => {
                        if (!utmUrl) return;
                        navigator.clipboard.writeText(utmUrl);
                        showFlash('URL copiada!');
                      }}
                      className="text-[11px] border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                    >
                      Copiar URL
                    </button>
                  </div>
                </div>
                <div className="text-xs text-zinc-300 break-all">
                  {utmUrl || 'Preencha a URL base e UTMs para gerar o link.'}
                </div>

                {showSaveUtmModal && (
                  <div className="mt-4 pt-4 border-t border-zinc-700/50">
                    <label className="block text-xs font-medium text-zinc-400 mb-2">Nome para salvar</label>
                    <div className="flex gap-2">
                      <input
                        value={saveUtmName}
                        onChange={(e) => setSaveUtmName(e.target.value)}
                        placeholder="Ex: Campanha Black Friday"
                        className="flex-1 rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={saveCurrentUtm}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSaveUtmModal(false)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {savedUtms.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-100">UTMs Salvas</h3>
                  <div className="grid grid-cols-1 gap-3">
                    {savedUtms.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 hover:border-zinc-700 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-200">{u.name}</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {new Date(u.created_at).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-zinc-500 font-mono">
                            {u.utm_source && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800/50 border border-zinc-800">
                                src: {u.utm_source}
                              </span>
                            )}
                            {u.utm_campaign && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800/50 border border-zinc-800">
                                cmp: {u.utm_campaign}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setUtmBaseUrl(u.url_base || '');
                              setUtmSource(u.utm_source || '');
                              setUtmMedium(u.utm_medium || '');
                              setUtmCampaign(u.utm_campaign || '');
                              setUtmContent(u.utm_content || '');
                              setUtmTerm(u.utm_term || '');
                              setUtmClickId(u.click_id || '');
                              showFlash('Carregado no gerador!');
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            Carregar
                          </button>
                          <button
                            onClick={() => deleteSavedUtm(u.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Google Analytics ── */}
          {tab === 'ga' && (
            <form onSubmit={saveGa} className="max-w-sm space-y-5">
              <input type="hidden" name="enabled" value="false" />
              <div className="flex items-center gap-3 py-3.5 border-y border-zinc-800/60">
                <input
                  id="ga-enabled"
                  name="enabled"
                  type="checkbox"
                  value="true"
                  defaultChecked={ga?.enabled ?? true}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                />
                <label htmlFor="ga-enabled" className="text-sm text-zinc-300 cursor-pointer">
                  Integração GA ativa
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  Measurement ID
                </label>
                <input
                  name="measurement_id"
                  defaultValue={ga?.measurement_id || ''}
                  placeholder="G-XXXXXXXXXX"
                  className={inputCls}
                />
              </div>
              <button
                disabled={loading}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-all"
              >
                {loading ? 'Salvando…' : 'Salvar'}
              </button>
            </form>
          )}

          {/* ── Tab: Eventos ── */}
          {tab === 'matching' && (
            <div className="space-y-10 max-w-5xl">

              {/* Seção 1: Configuração de Eventos por URL */}
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">Configuração de Eventos por URL</h3>
                  <p className="text-sm text-zinc-500">
                    Dispare eventos automaticamente quando a URL contiver um trecho específico (ex: "obrigado").
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-zinc-900/30 p-5 rounded-xl border border-zinc-800/60">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-zinc-400 mb-2">Se a URL contém:</label>
                    <input
                      value={urlRuleValue}
                      onChange={(e) => setUrlRuleValue(e.target.value)}
                      placeholder="Ex: /obrigado-compra"
                      className={inputCls}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-zinc-400 mb-2">Disparar Evento:</label>
                    <select
                      value={urlRuleEventType}
                      onChange={(e) => setUrlRuleEventType(e.target.value)}
                      className={selectCls}
                    >
                      <option value="Purchase">Purchase (Compra)</option>
                      <option value="Lead">Lead (Cadastro)</option>
                      <option value="CompleteRegistration">CompleteRegistration</option>
                      <option value="AddToCart">AddToCart</option>
                      <option value="InitiateCheckout">InitiateCheckout</option>
                      <option value="ViewContent">ViewContent</option>
                      <option value="Contact">Contact</option>
                      <option value="Custom">Personalizado...</option>
                    </select>
                  </div>
                  {urlRuleEventType === 'Custom' && (
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-zinc-400 mb-2">Nome do Evento:</label>
                      <input
                        value={urlRuleCustomName}
                        onChange={(e) => setUrlRuleCustomName(e.target.value)}
                        placeholder="Ex: ClicouBotao"
                        className={inputCls}
                      />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <button
                      onClick={handleAddUrlRule}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>

                {eventRules.length > 0 && (
                  <div className="border border-zinc-800/60 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm text-zinc-400">
                      <thead className="bg-zinc-900/60 text-xs uppercase font-medium text-zinc-500">
                        <tr>
                          <th className="px-4 py-3">Regra</th>
                          <th className="px-4 py-3">Valor</th>
                          <th className="px-4 py-3">Evento Disparado</th>
                          <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60">
                        {eventRules.map((rule) => (
                          <tr key={rule.id} className="hover:bg-zinc-900/20">
                            <td className="px-4 py-3">URL Contém</td>
                            <td className="px-4 py-3 font-mono text-zinc-300">{rule.match_value}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                {rule.event_name}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleDeleteRule(rule.id)}
                                className="text-red-400 hover:text-red-300 text-xs"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <hr className="border-zinc-800/60" />

              {/* Seção 2: Gerador de Formulário */}
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-zinc-100">Gerador de Formulário de Captura</h3>
                  <p className="text-sm text-zinc-500">
                    Crie um formulário HTML pronto para instalar no seu site. Ele captura os dados (nome, email, telefone) e dispara o evento escolhido no clique do botão.
                  </p>
                </div>

                {/* Saved Forms List */}
                {savedForms.length > 0 && (
                  <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {savedForms.map(form => (
                      <div key={form.id} className={`relative p-4 rounded-xl border transition-all ${selectedFormId === form.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-zinc-900/30 border-zinc-800/60 hover:border-zinc-700'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-zinc-200 truncate pr-6">{form.name}</h4>
                          <button onClick={(e) => { e.stopPropagation(); deleteForm(form.id); }} className="text-zinc-500 hover:text-red-400 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                          </button>
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono mb-3">ID: {form.public_id}</div>
                        <div className="flex gap-2">
                          <button onClick={() => loadFormToEditor(form)} className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 rounded border border-zinc-700 transition-colors">
                            {selectedFormId === form.id ? 'Editando...' : 'Editar'}
                          </button>
                          <button onClick={() => copyFormHtml(form)} className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded border border-blue-500 transition-colors shadow-lg shadow-blue-900/20">
                            Copiar HTML
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="bg-zinc-900/30 p-5 rounded-xl border border-zinc-800/60 space-y-5">

                      {/* Form Name */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Nome do Formulário (para salvar)</label>
                        <div className="flex gap-2">
                          <input
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            placeholder="Ex: Captura Ebook V1"
                            className={inputCls}
                          />
                          <button onClick={saveForm} className="bg-zinc-100 hover:bg-white text-zinc-900 px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                            {selectedFormId ? 'Atualizar' : 'Salvar'}
                          </button>
                        </div>
                      </div>

                      <hr className="border-zinc-800/60" />

                      {/* Fields */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-3">Campos do Formulário</label>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formFields.name}
                              onChange={(e) => setFormFields(prev => ({ ...prev, name: e.target.checked }))}
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-500"
                            />
                            <span className="text-sm text-zinc-300">Nome</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formFields.email}
                              onChange={(e) => setFormFields(prev => ({ ...prev, email: e.target.checked }))}
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-500"
                            />
                            <span className="text-sm text-zinc-300">E-mail</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formFields.phone}
                              onChange={(e) => setFormFields(prev => ({ ...prev, phone: e.target.checked }))}
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-blue-500"
                            />
                            <span className="text-sm text-zinc-300">Telefone</span>
                          </label>
                        </div>
                      </div>

                      {/* Theme */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Tema do Formulário</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="formTheme"
                              value="light"
                              checked={formTheme === 'light'}
                              onChange={() => setFormTheme('light')}
                              className="w-4 h-4 text-blue-500 bg-zinc-800 border-zinc-700"
                            />
                            <span className="text-sm text-zinc-300">Claro</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="formTheme"
                              value="dark"
                              checked={formTheme === 'dark'}
                              onChange={() => setFormTheme('dark')}
                              className="w-4 h-4 text-blue-500 bg-zinc-800 border-zinc-700"
                            />
                            <span className="text-sm text-zinc-300">Escuro</span>
                          </label>
                        </div>
                      </div>

                      {/* Button Text */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Texto do Botão</label>
                        <input
                          value={formButtonText}
                          onChange={(e) => setFormButtonText(e.target.value)}
                          className={inputCls}
                        />
                      </div>

                      {/* Event Type */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Evento ao Enviar</label>
                        <select
                          value={formEventType}
                          onChange={(e) => setFormEventType(e.target.value)}
                          className={selectCls}
                        >
                          <option value="Lead">Lead</option>
                          <option value="Contact">Contact</option>
                          <option value="Purchase">Purchase</option>
                          <option value="CompleteRegistration">CompleteRegistration</option>
                          <option value="Custom">Personalizado...</option>
                        </select>
                      </div>

                      {formEventType === 'Custom' && (
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">Nome do Evento</label>
                          <input
                            value={formCustomEventName}
                            onChange={(e) => setFormCustomEventName(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      )}

                      <hr className="border-zinc-800/60" />

                      {/* Post Submit Action */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-3">Ação após o cadastro</label>
                        <div className="flex gap-4 mb-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="postSubmitAction" value="message" checked={postSubmitAction === 'message'} onChange={() => setPostSubmitAction('message')} className="w-4 h-4 text-blue-500 bg-zinc-800 border-zinc-700" />
                            <span className="text-sm text-zinc-300">Exibir Mensagem</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="postSubmitAction" value="redirect" checked={postSubmitAction === 'redirect'} onChange={() => setPostSubmitAction('redirect')} className="w-4 h-4 text-blue-500 bg-zinc-800 border-zinc-700" />
                            <span className="text-sm text-zinc-300">Redirecionar</span>
                          </label>
                        </div>
                        {postSubmitAction === 'message' ? (
                          <textarea value={postSubmitMessage} onChange={e => setPostSubmitMessage(e.target.value)} className={`${inputCls} min-h-[80px]`} placeholder="Digite a mensagem de agradecimento..." />
                        ) : (
                          <input value={postSubmitRedirectUrl} onChange={e => setPostSubmitRedirectUrl(e.target.value)} className={inputCls} placeholder="https://..." />
                        )}
                      </div>

                      {/* Webhook */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">Webhook URL (Opcional)</label>
                        <input value={formWebhookUrl} onChange={e => setFormWebhookUrl(e.target.value)} className={inputCls} placeholder="https://seu-crm.com/webhook..." />
                        <p className="text-[10px] text-zinc-500 mt-1">Enviaremos os dados do lead para esta URL via POST JSON.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider">Prévia Visual (Aproximada)</label>
                    <div className={`p-6 rounded-xl border border-zinc-800 flex flex-col items-center justify-center min-h-[300px] transition-colors ${formTheme === 'dark' ? 'bg-[#111]' : 'bg-[#f5f5f5]'}`}>
                      <div className={`w-full max-w-xs space-y-3 p-4 rounded shadow-sm transition-colors ${formTheme === 'dark' ? 'bg-black border border-zinc-800' : 'bg-white border border-gray-200'}`}>
                        {formFields.name && <div className={`h-10 rounded border px-3 flex items-center text-sm ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>Nome</div>}
                        {formFields.email && <div className={`h-10 rounded border px-3 flex items-center text-sm ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>E-mail</div>}
                        {formFields.phone && (
                          <div className="flex gap-2">
                            <div className={`h-10 rounded border px-3 flex items-center text-sm w-[70px] ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>+55</div>
                            <div className={`h-10 rounded border px-3 flex items-center text-sm flex-1 ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>Telefone</div>
                          </div>
                        )}
                        <div className={`h-10 rounded flex items-center justify-center font-bold text-sm ${formTheme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'}`}>
                          {formButtonText}
                        </div>
                      </div>
                      {postSubmitAction === 'message' && (
                        <div className="mt-4 p-3 bg-green-500/10 text-green-500 text-xs border border-green-500/20 rounded">
                          Simulação pós-envio: {postSubmitMessage}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Campanhas ── */}
          {tab === 'campaigns' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Campanhas Meta Ads</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Visualize métricas, ative ou pause campanhas. Use o Diagnóstico IA para recomendações detalhadas.
                </p>
              </div>

              {!meta?.has_facebook_connection && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 text-sm text-zinc-500">
                  Conecte o Facebook na aba{' '}
                  <button
                    className="text-zinc-300 underline underline-offset-2"
                    onClick={() => setTab('meta')}
                  >
                    Meta Ads
                  </button>{' '}
                  para listar campanhas.
                </div>
              )}

              {meta?.has_facebook_connection && !meta?.ad_account_id && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 text-sm text-zinc-500">
                  Defina a conta de anúncios na aba{' '}
                  <button
                    className="text-zinc-300 underline underline-offset-2"
                    onClick={() => setTab('meta')}
                  >
                    Meta Ads
                  </button>{' '}
                  para listar campanhas.
                </div>
              )}

              {meta?.has_facebook_connection && meta?.ad_account_id && (
                <div className="rounded-xl border border-zinc-800/60 overflow-hidden">
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/60">
                    {metaBreadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={idx}>
                        <button
                          onClick={() => handleMetaBreadcrumbClick(idx)}
                          className={`text-xs transition-colors ${idx === metaBreadcrumbs.length - 1
                            ? 'text-zinc-200 font-medium'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                          {crumb.name}
                        </button>
                        {idx < metaBreadcrumbs.length - 1 && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-zinc-700"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Toolbar */}
                  <div className="px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-950/60 flex flex-wrap items-center gap-2">
                    {periodSelector}
                    <select
                      value={metaStatusFilter}
                      onChange={(e) => setMetaStatusFilter(e.target.value as 'active' | 'all')}
                      className={selectClsCompact}
                    >
                      <option value="active">Somente ativos</option>
                      <option value="all">Todos</option>
                    </select>
                    <button
                      onClick={() => loadCampaigns({ force: true })}
                      disabled={loading}
                      className="flex items-center gap-1.5 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 px-3.5 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                    >
                      {loading ? (
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
                      Atualizar
                    </button>
                  </div>

                  {/* Table */}
                  <div className="max-h-[60vh] overflow-x-auto overflow-y-auto custom-scrollbar">
                    <table className="w-full min-w-[1100px] text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800/60 bg-zinc-950/80">
                          {[
                            'Nome',
                            'Status',
                            'Investido',
                            'Objetivo',
                            'Custo/res.',
                            'Alcance',
                            'Impressões',
                            'Cliques',
                            'CTR',
                            'Hook Rate',
                            'LP Views',
                            'Taxa LP View',
                            'Custo LP View',
                            'CPC',
                            'CPM',
                            'Frequência',
                            'Finalização',
                            'Compras',
                            '',
                          ].map((h, index) => (
                            <th
                              key={h}
                              className={`text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 px-4 py-3 whitespace-nowrap ${index === 0
                                ? 'sticky left-0 z-10 bg-zinc-950/95 border-r border-zinc-800/60'
                                : ''
                                }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.length === 0 && (
                          <tr>
                            <td
                              colSpan={18}
                              className="px-4 py-12 text-center text-sm text-zinc-600"
                            >
                              Nenhum item encontrado neste nível.
                            </td>
                          </tr>
                        )}
                        {campaigns.map((c) => {
                          const metrics = campaignMetrics[c.id];
                          const resultVal = metrics ? getResultValue(c, metrics) : 0;
                          const objectiveLabel = getObjectiveMetricLabel(c, metrics);
                          const cpr =
                            resultVal > 0 && metrics?.spend ? metrics.spend / resultVal : 0;
                          const statusVariant = getStatusVariant(c);

                          return (
                            <tr
                              key={c.id}
                              className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-900/40 transition-colors"
                            >
                              <td className="px-4 py-3 max-w-[220px] sticky left-0 z-10 bg-zinc-950/95 border-r border-zinc-800/60">
                                <button
                                  onClick={() => handleMetaDrillDown(c)}
                                  disabled={metaLevel === 'ad'}
                                  className="text-left hover:text-blue-400 transition-colors truncate w-full block font-medium text-zinc-200 text-xs"
                                >
                                  {c.name}
                                </button>
                                <div className="text-[10px] text-zinc-700 font-mono truncate mt-0.5">
                                  {c.id}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={statusVariant}>{getStatusLabel(c)}</Badge>
                              </td>
                              <td className="px-4 py-3 text-zinc-300 tabular-nums">
                                {metrics ? formatMoney(metrics.spend) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-200 font-semibold tabular-nums">
                                {metrics ? formatNumber(resultVal) : '—'}
                                <div className="text-[10px] text-zinc-600 font-normal">
                                  {objectiveLabel}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics && resultVal > 0 ? formatMoney(cpr) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-500 tabular-nums">
                                {metrics ? formatNumber(metrics.reach || 0) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-500 tabular-nums">
                                {metrics ? formatNumber(metrics.impressions) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatNumber(metrics.clicks) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? `${formatPercent(metrics.ctr)}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? `${formatPercent(metrics.hook_rate || 0)}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatNumber(metrics.landing_page_views) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? `${formatPercent(getLpViewRate(metrics))}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics && metrics.landing_page_views > 0
                                  ? formatMoney(metrics.spend / metrics.landing_page_views)
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatMoney(metrics.cpc) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatMoney(metrics.cpm) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatNumber(metrics.frequency || 0) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-400 tabular-nums">
                                {metrics ? formatNumber(metrics.initiates_checkout) : '—'}
                              </td>
                              <td className="px-4 py-3 text-zinc-300 tabular-nums">
                                {metrics ? formatNumber(metrics.purchases) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5 justify-end">
                                  <button
                                    onClick={() => toggleMetaStatus(c)}
                                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${resolveDisplayStatus(c) === 'ACTIVE'
                                      ? 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-500/40'
                                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/40'
                                      }`}
                                  >
                                    {resolveDisplayStatus(c) === 'ACTIVE' ? 'Pausar' : 'Ativar'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Webhooks ── */}
          {tab === 'webhooks' && (
            <div className="max-w-2xl space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Integração de Vendas</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Configure este webhook na sua plataforma (Hotmart, Kiwify, Eduzz, etc.) para receber
                  eventos de compra automaticamente.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">URL do Webhook</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    className="flex-1 rounded-lg bg-zinc-900/60 border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-zinc-400 outline-none"
                    value={
                      webhookSecret
                        ? `${apiBaseUrl}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}`
                        : 'Carregando…'
                    }
                  />
                  <button
                    onClick={() => {
                      const url = `${apiBaseUrl}/webhooks/purchase?key=${site?.site_key}&token=${webhookSecret}`;
                      navigator.clipboard.writeText(url);
                      showFlash('URL copiada!');
                    }}
                    className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-xs transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copiar
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/8 p-4 space-y-2">
                <div className="text-xs font-semibold text-blue-300 uppercase tracking-widest">
                  Eventos suportados
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: 'Compra Aprovada (Purchase)', available: true },
                    { label: 'Reembolso (Refund)', available: false },
                    { label: 'Carrinho Abandonado', available: false },
                  ].map((ev) => (
                    <div key={ev.label} className="flex items-center gap-2 text-xs">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${ev.available ? 'bg-emerald-400' : 'bg-zinc-700'
                          }`}
                      />
                      <span className={ev.available ? 'text-zinc-300' : 'text-zinc-600'}>
                        {ev.label}
                        {!ev.available && (
                          <span className="ml-1.5 text-[10px] text-zinc-600 italic">em breve</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Webhook Test ── */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Testar Webhook</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Dispare um evento de compra simulado para verificar se a integração está funcionando.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={webhookTestPlatform}
                    onChange={(e) => setWebhookTestPlatform(e.target.value)}
                    className="rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2.5 text-xs text-zinc-300 outline-none focus:border-blue-500/60"
                  >
                    <option value="hotmart">Hotmart</option>
                    <option value="kiwify">Kiwify</option>
                    <option value="eduzz">Eduzz</option>
                    <option value="generic">Genérico</option>
                  </select>
                  <button
                    type="button"
                    disabled={webhookTestLoading}
                    onClick={fireWebhookTest}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {webhookTestLoading ? (
                      <><svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Enviando...</>
                    ) : (
                      <><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg> Disparar Teste</>
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600">
                  O teste simula uma compra com dados fictícios e envia pela rota de ingestão para validar todo o fluxo.
                </p>
              </div>
            </div>
          )}

          {/* ── Tab: Diagnóstico ── */}
          {tab === 'reports' && (
            <div className="max-w-none space-y-4">
              {campaigns.length > 0 && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-zinc-100">Configurar diagnóstico</h3>
                    {selectedCampaign && (
                      <Badge variant={getStatusVariant(selectedCampaign)}>
                        {getStatusLabel(selectedCampaign)}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                        Campanha
                      </label>
                      <select
                        value={selectedCampaignId}
                        onChange={(e) => setSelectedCampaignId(e.target.value)}
                        className={selectCls}
                      >
                        <option value="">Selecione uma campanha…</option>
                        {[...campaigns]
                          .sort((a, b) => {
                            const aA = a.status === 'ACTIVE' ? 0 : 1;
                            const bA = b.status === 'ACTIVE' ? 0 : 1;
                            if (aA !== bA) return aA - bA;
                            return a.name.localeCompare(b.name);
                          })
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.status === 'ACTIVE' ? '(Ativa)' : '(Pausada)'}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      {periodSelector}
                      <button
                        onClick={() => loadCampaigns({ force: true }).catch(() => { })}
                        className="bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 px-3.5 py-2.5 rounded-lg text-xs transition-colors"
                      >
                        Atualizar
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-zinc-800/60 pt-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Filtros UTM (opcional)
                      </h4>
                      <div className="flex items-center gap-2">
                        {savedUtms.length > 0 && (
                          <select
                            className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600 max-w-[240px] truncate"
                            onChange={(e) => {
                              const utm = savedUtms.find((u) => u.id === Number(e.target.value));
                              if (utm) selectSavedUtm(utm);
                            }}
                            value=""
                          >
                            <option value="" disabled>
                              Carregar UTM salva...
                            </option>
                            {savedUtms.map((u) => (
                              <option key={u.id} value={u.id} title={u.name}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {showUrlPaster ? (
                          <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-4 duration-300">
                            <input
                              value={pastedUrl}
                              onChange={(e) => setPastedUrl(e.target.value)}
                              placeholder="https://..."
                              className="w-64 rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-600"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (!pastedUrl) return;
                                  try {
                                    const u = new URL(pastedUrl);
                                    const s = u.searchParams;
                                    if (s.get('utm_source')) setDiagnosisUtmSource(s.get('utm_source') || '');
                                    if (s.get('utm_medium')) setDiagnosisUtmMedium(s.get('utm_medium') || '');
                                    if (s.get('utm_campaign')) setDiagnosisUtmCampaign(s.get('utm_campaign') || '');
                                    if (s.get('utm_content')) setDiagnosisUtmContent(s.get('utm_content') || '');
                                    if (s.get('utm_term')) setDiagnosisUtmTerm(s.get('utm_term') || '');
                                    if (s.get('click_id')) setDiagnosisClickId(s.get('click_id') || '');
                                    showFlash('UTMs extraídos com sucesso!');
                                    setShowUrlPaster(false);
                                    setPastedUrl('');
                                  } catch {
                                    showFlash('URL inválida.', 'error');
                                  }
                                } else if (e.key === 'Escape') {
                                  setShowUrlPaster(false);
                                  setPastedUrl('');
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (!pastedUrl) return;
                                try {
                                  const u = new URL(pastedUrl);
                                  const s = u.searchParams;
                                  if (s.get('utm_source')) setDiagnosisUtmSource(s.get('utm_source') || '');
                                  if (s.get('utm_medium')) setDiagnosisUtmMedium(s.get('utm_medium') || '');
                                  if (s.get('utm_campaign')) setDiagnosisUtmCampaign(s.get('utm_campaign') || '');
                                  if (s.get('utm_content')) setDiagnosisUtmContent(s.get('utm_content') || '');
                                  if (s.get('utm_term')) setDiagnosisUtmTerm(s.get('utm_term') || '');
                                  if (s.get('click_id')) setDiagnosisClickId(s.get('click_id') || '');
                                  showFlash('UTMs extraídos com sucesso!');
                                  setShowUrlPaster(false);
                                  setPastedUrl('');
                                } catch {
                                  showFlash('URL inválida.', 'error');
                                }
                              }}
                              className="p-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                              title="Aplicar"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowUrlPaster(false);
                                setPastedUrl('');
                              }}
                              className="p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                              title="Cancelar"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setShowUrlPaster(true);
                              setPastedUrl('');
                            }}
                            className="text-[11px] border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                          >
                            Colar URL
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setDiagnosisUtmSource('');
                            setDiagnosisUtmMedium('');
                            setDiagnosisUtmCampaign('');
                            setDiagnosisUtmContent('');
                            setDiagnosisUtmTerm('');
                            setDiagnosisClickId('');
                          }}
                          className="text-[11px] border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                        >
                          Limpar filtros
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { label: 'utm_source', val: diagnosisUtmSource, set: setDiagnosisUtmSource, opts: utmOptions.sources },
                        { label: 'utm_medium', val: diagnosisUtmMedium, set: setDiagnosisUtmMedium, opts: utmOptions.mediums },
                        { label: 'utm_campaign', val: diagnosisUtmCampaign, set: setDiagnosisUtmCampaign, opts: utmOptions.campaigns },
                        { label: 'utm_content', val: diagnosisUtmContent, set: setDiagnosisUtmContent, opts: utmOptions.contents },
                        { label: 'utm_term', val: diagnosisUtmTerm, set: setDiagnosisUtmTerm, opts: utmOptions.terms },
                        { label: 'click_id', val: diagnosisClickId, set: setDiagnosisClickId, opts: [] },
                      ].map((field) => {
                        const listId = `list-${field.label}`;
                        return (
                          <div key={field.label}>
                            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                              {field.label}
                            </label>
                            <input
                              value={field.val}
                              onChange={(e) => field.set(e.target.value)}
                              className={inputCls}
                              list={field.opts && field.opts.length > 0 ? listId : undefined}
                              placeholder="Digite ou selecione..."
                              autoComplete="off"
                            />
                            {field.opts && field.opts.length > 0 && (
                              <datalist id={listId}>
                                {field.opts.map((opt) => (
                                  <option key={opt} value={opt} />
                                ))}
                              </datalist>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedCampaignId && campaignMetrics[selectedCampaignId] && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                      <StatCard
                        label="Investido"
                        value={formatMoney(campaignMetrics[selectedCampaignId].spend)}
                      />
                      <StatCard
                        label="Alcance"
                        value={formatNumber(campaignMetrics[selectedCampaignId].reach || 0)}
                      />
                      <StatCard
                        label="Impressões"
                        value={formatNumber(campaignMetrics[selectedCampaignId].impressions)}
                      />
                      <StatCard
                        label="Cliques"
                        value={formatNumber(campaignMetrics[selectedCampaignId].clicks)}
                      />
                      <StatCard
                        label="CTR"
                        value={`${formatPercent(campaignMetrics[selectedCampaignId].ctr)}%`}
                      />
                      <StatCard
                        label="LP Views"
                        value={formatNumber(campaignMetrics[selectedCampaignId].landing_page_views)}
                      />
                      <StatCard
                        label="Taxa LP View"
                        value={`${formatPercent(getLpViewRate(campaignMetrics[selectedCampaignId]))}%`}
                      />
                      <StatCard
                        label="Custo LP View"
                        value={
                          campaignMetrics[selectedCampaignId].landing_page_views > 0
                            ? formatMoney(
                              campaignMetrics[selectedCampaignId].spend /
                              campaignMetrics[selectedCampaignId].landing_page_views
                            )
                            : '—'
                        }
                      />
                      <StatCard
                        label="CPC"
                        value={formatMoney(campaignMetrics[selectedCampaignId].cpc)}
                      />
                      <StatCard
                        label="CPM"
                        value={formatMoney(campaignMetrics[selectedCampaignId].cpm)}
                      />
                      <StatCard
                        label="Frequência"
                        value={formatNumber(campaignMetrics[selectedCampaignId].frequency || 0)}
                      />
                      <StatCard
                        label="Hook Rate"
                        value={`${formatPercent(campaignMetrics[selectedCampaignId].hook_rate || 0)}%`}
                      />
                      <StatCard
                        label={`Objetivo (${getObjectiveMetricLabel(
                          selectedCampaign,
                          campaignMetrics[selectedCampaignId]
                        )})`}
                        value={formatNumber(
                          getResultValue(selectedCampaign, campaignMetrics[selectedCampaignId])
                        )}
                      />
                      <StatCard
                        label="Finalização"
                        value={formatNumber(campaignMetrics[selectedCampaignId].initiates_checkout)}
                      />
                      <StatCard
                        label="Compras"
                        value={formatNumber(campaignMetrics[selectedCampaignId].purchases)}
                      />
                    </div>
                  )}
                </div>
              )}

              {report?.meta_breakdown && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">Resumo por nível</h3>
                    <span className="text-[11px] text-zinc-600">Campanha · Conjunto · Anúncio</span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {([
                      { label: 'Campanhas', rows: report.meta_breakdown.campaigns || [] },
                      { label: 'Conjuntos', rows: report.meta_breakdown.adsets || [] },
                      { label: 'Anúncios', rows: report.meta_breakdown.ads || [] },
                    ] as Array<{ label: string; rows: MetaBreakdownItem[] }>).map((group) => (
                      <div key={group.label} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40">
                        <div className="px-3.5 py-2.5 border-b border-zinc-800/60 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          {group.label}
                        </div>
                        <div className="overflow-auto">
                          <table className="w-full text-[11px]">
                            <thead className="bg-zinc-900/60">
                              <tr>
                                <th className="text-left font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  Nome
                                </th>
                                <th className="text-right font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  Spend
                                </th>
                                <th className="text-right font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  CTR
                                </th>
                                <th className="text-right font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  LP%
                                </th>
                                <th className="text-right font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  Compras
                                </th>
                                <th className="text-left font-semibold uppercase tracking-wider text-zinc-500 px-3 py-2">
                                  Gargalo
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="px-3 py-3 text-center text-zinc-600">
                                    Sem dados neste nível.
                                  </td>
                                </tr>
                              )}
                              {group.rows.slice(0, 5).map((row) => (
                                <tr key={row.id} className="border-t border-zinc-800/60">
                                  <td className="px-3 py-2 text-zinc-300 max-w-[160px] truncate">
                                    {row.name || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">
                                    {formatMoney(row.spend)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                                    {formatPercent(getBreakdownCtr(row))}%
                                  </td>
                                  <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                                    {formatPercent(getBreakdownLpRate(row))}%
                                  </td>
                                  <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">
                                    {formatNumber(row.purchases || 0)}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-400">
                                    {getBreakdownBottleneck(row)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!report && (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
                  <div className="mx-auto w-10 h-10 rounded-full bg-zinc-800/60 flex items-center justify-center mb-3">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-zinc-600"
                    >
                      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-zinc-400">Nenhum diagnóstico gerado</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    Selecione uma campanha e clique em{' '}
                    <span className="text-zinc-400">Gerar diagnóstico</span> no canto superior.
                  </div>
                </div>
              )}

              {report?.analysis_text && (
                <div className="space-y-3">
                  {visibleReportSections.map((section, index) => (
                    <div
                      key={`${section.title}-${index}`}
                      className="rounded-xl border border-zinc-800/60 bg-zinc-950/50 overflow-hidden"
                    >
                      <div className="px-5 py-3.5 border-b border-zinc-800/40 bg-zinc-900/40">
                        <h3 className="text-sm font-semibold text-zinc-100">{section.title}</h3>
                      </div>
                      {section.body && (
                        <div className="px-5 py-4 prose prose-invert max-w-none text-sm prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-sm prose-p:text-zinc-400 prose-p:leading-relaxed prose-strong:text-zinc-200 prose-a:text-blue-400 prose-a:no-underline hover:prose-a:text-blue-300">
                          <ReactMarkdown
                            components={{
                              table: ({ children }) => (
                                <div className="overflow-auto rounded-xl border border-zinc-800/60 bg-zinc-950/40 my-4">
                                  <table className="w-full border-collapse">{children}</table>
                                </div>
                              ),
                              thead: ({ children }) => (
                                <thead className="bg-zinc-900/60">{children}</thead>
                              ),
                              th: ({ children }) => (
                                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400 px-4 py-2.5 border-b border-zinc-800/60">
                                  {children}
                                </th>
                              ),
                              td: ({ children }) => (
                                <td className="text-xs text-zinc-400 px-4 py-2.5 border-b border-zinc-900/60">
                                  {children}
                                </td>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-blue-500/50 bg-blue-500/8 rounded-r-lg px-4 py-3 text-zinc-300 not-italic my-4">
                                  {children}
                                </blockquote>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                                  {children}
                                </ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                                  {children}
                                </ol>
                              ),
                              hr: () => (
                                <div className="my-5 h-px w-full bg-zinc-800/60" />
                              ),
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
