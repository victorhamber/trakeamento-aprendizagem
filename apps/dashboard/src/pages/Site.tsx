import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../lib/api';
import { formatDateTimeBrt } from '../lib/utils';
import { stripTrajettuAuxFromMatchPath } from '../lib/trajettuAuxPath';
import { DDI_LIST } from '../lib/ddi';
import { Layout } from '../components/Layout';
import WebhooksTab from '../components/site/WebhooksTab';
import { ReportWizard } from '../components/site/ReportWizard';
import { CampaignFunnelPanel, type FunnelCampaignOption } from '../components/site/CampaignFunnelPanel';
import { BuyersTab } from '../components/site/BuyersTab';
type Site = {
  id: number;
  name: string;
  domain: string | null;
  site_key: string;
  inject_head_html?: string | null;
  inject_body_html?: string | null;
};

type Tab = 'snippet' | 'meta' | 'utm' | 'campaigns' | 'buyers' | 'ga' | 'matching' | 'webhooks' | 'reports';
type InstallSubTab = 'snippet' | 'extras';

type InjectedSnippet = {
  id: number;
  site_id: number;
  name: string;
  position: 'head' | 'body';
  html: string;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};
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
  cost_per_purchase?: number | null;
  cost_per_lead?: number | null;
  results?: number | null;
  cost_per_result?: number | null;
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

function splitMarkdownH2Sections(text: string): Array<{ title: string; body: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\n##\s+/);
  const sections: Array<{ title: string; body: string }> = [];
  const hasLeading = !trimmed.startsWith('## ') && parts[0]?.trim();
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
    sections.push({ title: 'Conteúdo', body: trimmed });
  }
  return sections;
}

const reportMarkdownComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 my-4">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-zinc-50 dark:bg-zinc-900/60">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="text-xs text-zinc-600 dark:text-zinc-400 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
      {children}
    </td>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-8 mb-4 flex items-center gap-2">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-6 mb-3 bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-md inline-flex items-center gap-2">
      {children}
    </h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3 leading-relaxed">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{children}</strong>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-amber-500/50 bg-gradient-to-r from-amber-500/10 to-transparent rounded-r-lg px-4 py-3 my-5 text-zinc-700 dark:text-zinc-300 not-italic">
      {children}
    </blockquote>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-none space-y-2 my-3 text-zinc-600 dark:text-zinc-400">{children}</ul>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex gap-2">
      <span className="text-amber-500 mt-0.5">•</span>
      <span>{children}</span>
    </li>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-2 my-3 text-zinc-600 dark:text-zinc-400">{children}</ol>
  ),
  hr: () => <div className="my-8 h-px w-full bg-zinc-200 dark:bg-zinc-800/80" />,
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
    default: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700/60',
    active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 dark:border-emerald-500/25',
    paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 dark:border-amber-500/25',
    archived: 'bg-zinc-200/60 dark:bg-zinc-700/40 text-zinc-500 dark:text-zinc-500 border-zinc-300 dark:border-zinc-700/40',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border tracking-wide ${styles[variant]}`}
    >
      {variant === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />}
      {children}
    </span>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700/60 transition-colors">
    <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 dark:text-zinc-500 mb-1.5">{label}</div>
    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">{value}</div>
  </div>
);

function MetricQualityBarFill({ pct, toneClass }: { pct: number; toneClass: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty('--metric-quality-pct', `${pct}%`);
  }, [pct]);
  return <div ref={ref} className={`h-full rounded-full ${toneClass} transition-all metric-quality-bar-fill`} />;
}

function FormPreviewSubmitChip({
  bg,
  fg,
  children,
}: {
  bg: string;
  fg: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--form-preview-bg', bg);
    el.style.setProperty('--form-preview-fg', fg);
  }, [bg, fg]);
  return (
    <div
      ref={ref}
      className="h-10 rounded flex items-center justify-center font-bold text-sm form-preview-submit-appearance"
    >
      {children}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const SitePage = () => {
  const { siteId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = Number(siteId);
  const apiBaseUrl = (api.defaults.baseURL || '').replace(/\/+$/, '');
  const [site, setSite] = useState<Site | null>(null);
  const initialTab = (searchParams.get('tab') as Tab) || 'snippet';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [installSnippets, setInstallSnippets] = useState<{ performance: string; immediate: string }>({
    performance: '',
    immediate: '',
  });
  const [installSubTab, setInstallSubTab] = useState<InstallSubTab>('snippet');
  const [injectedSnippets, setInjectedSnippets] = useState<InjectedSnippet[]>([]);
  const [injectListLoading, setInjectListLoading] = useState(false);
  const [injectEditId, setInjectEditId] = useState<number | null>(null);
  const [injectName, setInjectName] = useState('');
  const [injectPosition, setInjectPosition] = useState<'head' | 'body'>('head');
  const [injectEnabled, setInjectEnabled] = useState(true);
  const [injectHtml, setInjectHtml] = useState('');
  const [savingInject, setSavingInject] = useState(false);
  const [meta, setMeta] = useState<MetaConfig | null>(null);
  const [adAccounts, setAdAccounts] = useState<
    Array<{ id: string; name: string; account_id?: string; business?: { id: string; name: string } }>
  >([]);
  const [pixels, setPixels] = useState<Array<{ id: string; name: string }>>([]);
  const [ga, setGa] = useState<GaConfig | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [dataQuality, setDataQuality] = useState<any>(null);
  const [qualityPeriod, setQualityPeriod] = useState('last_7d');
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [reportLoadedFromStorage, setReportLoadedFromStorage] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [funnelCampaignPicklist, setFunnelCampaignPicklist] = useState<FunnelCampaignOption[]>([]);
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
  const [showAdAccountSelector, setShowAdAccountSelector] = useState(false);
  const [utmBaseUrl, setUtmBaseUrl] = useState('');
  const [utmSource, setUtmSource] = useState('{{site_source_name}}');
  const [utmMedium, setUtmMedium] = useState('paid_social');
  const [utmCampaign, setUtmCampaign] = useState('{{campaign.name}}');
  const [utmContent, setUtmContent] = useState('{{ad.name}}');
  const [utmTerm, setUtmTerm] = useState('{{adset.name}}');
  const [utmClickId, setUtmClickId] = useState('{{ad.id}}');
  const [diagnosisUtmSource, setDiagnosisUtmSource] = useState('{{site_source_name}}');
  const [diagnosisUtmMedium, setDiagnosisUtmMedium] = useState('paid_social');
  const [diagnosisUtmCampaign, setDiagnosisUtmCampaign] = useState('{{campaign.name}}');
  const [diagnosisUtmContent, setDiagnosisUtmContent] = useState('{{ad.name}}');
  const [diagnosisUtmTerm, setDiagnosisUtmTerm] = useState('{{adset.name}}');
  const [diagnosisClickId, setDiagnosisClickId] = useState('{{ad.id}}');
  const [showUrlPaster, setShowUrlPaster] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardAds] = useState<any[]>([]);
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
  const [urlRuleEventValue, setUrlRuleEventValue] = useState('');
  const [urlRuleEventCurrency, setUrlRuleEventCurrency] = useState('BRL');

  const [buttonRuleUrl, setButtonRuleUrl] = useState('');
  /** URL completa para abrir seletor/teste na página (independente do “Se a URL contém” da regra). */
  const [buttonSelectorPageUrl, setButtonSelectorPageUrl] = useState('');
  const [buttonRuleText, setButtonRuleText] = useState('');
  const [buttonRuleHrefContains, setButtonRuleHrefContains] = useState('');
  const [buttonRuleClassContains, setButtonRuleClassContains] = useState('');
  const [buttonRuleCss, setButtonRuleCss] = useState('');
  const [buttonRuleEventType, setButtonRuleEventType] = useState('Purchase');
  const [buttonRuleCustomName, setButtonRuleCustomName] = useState('');
  const [buttonRuleEventValue, setButtonRuleEventValue] = useState('');
  const [buttonRuleEventCurrency, setButtonRuleEventCurrency] = useState('BRL');

  const [eventSubTab, setEventSubTab] = useState<'url' | 'button' | 'form'>('url');
  const [formFields, setFormFields] = useState({ name: true, email: true, phone: true });
  const [formButtonText, setFormButtonText] = useState('Quero me cadastrar');
  const [formButtonBgColor, setFormButtonBgColor] = useState('#2563EB'); // blue-600 default
  const [formButtonTextColor, setFormButtonTextColor] = useState('#FFFFFF'); // white default
  const [formEventType, setFormEventType] = useState('Lead');
  const [formCustomEventName, setFormCustomEventName] = useState('');
  const [formEventValue, setFormEventValue] = useState('');
  const [formEventCurrency, setFormEventCurrency] = useState('BRL');
  const [formTheme, setFormTheme] = useState<'light' | 'dark'>('light');

  const eventSupportsValueAndCurrency = (t: string) => {
    // Eventos padrão do Meta que aceitam value/currency (útil para otimização e relatórios).
    // Purchase exige, os demais são opcionais.
    return (
      t === 'Purchase' ||
      t === 'InitiateCheckout' ||
      t === 'AddToCart' ||
      t === 'AddPaymentInfo' ||
      t === 'Donate' ||
      t === 'StartTrial' ||
      t === 'Subscribe' ||
      t === 'Custom'
    );
  };

  const currencyOptions = ['BRL', 'USD', 'MXN', 'EUR', 'GBP', 'COP', 'ARS', 'CLP', 'PEN'] as const;

  // New Form Builder State
  const [savedForms, setSavedForms] = useState<any[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [postSubmitAction, setPostSubmitAction] = useState<'message' | 'redirect'>('message');
  const [postSubmitMessage, setPostSubmitMessage] = useState('Obrigado! Seus dados foram enviados com sucesso.');
  const [postSubmitRedirectUrl, setPostSubmitRedirectUrl] = useState('');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');




















  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);

  const pickerWinRef = useRef<Window | null>(null);
  const TA_AUX_WINDOW_FEATURES = 'width=1280,height=900,scrollbars=yes,resizable=yes';

  const pickerOpenUrl = useMemo(() => {
    const dashOrigin = window.location.origin;
    const explicit = buttonSelectorPageUrl.trim();
    if (explicit) {
      try {
        const raw = /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
        const url = new URL(raw);
        url.searchParams.set('ta_pick', '1');
        url.searchParams.set('ta_origin', dashOrigin);
        return url.toString();
      } catch {
        return null;
      }
    }
    if (!utmBaseUrl) return null;
    const base = utmBaseUrl.replace(/\/+$/, '');
    const path = (buttonRuleUrl || '/').trim() || '/';
    const full =
      path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    try {
      const url = new URL(full);
      url.searchParams.set('ta_pick', '1');
      url.searchParams.set('ta_origin', dashOrigin);
      return url.toString();
    } catch {
      return null;
    }
  }, [buttonSelectorPageUrl, utmBaseUrl, buttonRuleUrl]);

  const testOpenUrl = useMemo(() => {
    const dashOrigin = window.location.origin;
    const rule = {
      match_text: buttonRuleText?.trim() || '',
      match_href_contains: buttonRuleHrefContains?.trim() || '',
      match_class_contains: buttonRuleClassContains?.trim() || '',
      match_css: buttonRuleCss?.trim() || '',
    };
    const json = JSON.stringify(rule);
    const b64 = btoa(unescape(encodeURIComponent(json)));

    const explicit = buttonSelectorPageUrl.trim();
    if (explicit) {
      try {
        const raw = /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
        const url = new URL(raw);
        url.searchParams.set('ta_test', '1');
        url.searchParams.set('ta_origin', dashOrigin);
        url.searchParams.set('ta_rule', b64);
        return url.toString();
      } catch {
        return null;
      }
    }
    if (!utmBaseUrl) return null;
    const base = utmBaseUrl.replace(/\/+$/, '');
    const path = (buttonRuleUrl || '/').trim() || '/';
    const full =
      path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `${base}${path.startsWith('/') ? '' : '/'}${path}`;

    try {
      const url = new URL(full);
      url.searchParams.set('ta_test', '1');
      url.searchParams.set('ta_origin', dashOrigin);
      url.searchParams.set('ta_rule', b64);
      return url.toString();
    } catch {
      return null;
    }
  }, [
    buttonSelectorPageUrl,
    utmBaseUrl,
    buttonRuleUrl,
    buttonRuleText,
    buttonRuleHrefContains,
    buttonRuleClassContains,
    buttonRuleCss,
  ]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      try {
        const data = (ev as any)?.data;
        if (!data || typeof data !== 'object') return;
        if (pickerWinRef.current && ev.source !== pickerWinRef.current) return;
        if (data.type !== 'TA_BUTTON_PICK') return;
        const payload = data.payload || {};

        if (typeof payload.page_path === 'string' && payload.page_path.trim()) {
          setButtonRuleUrl(stripTrajettuAuxFromMatchPath(payload.page_path));
        }
        const sug = payload.suggested || {};
        if (typeof sug.match_text === 'string') setButtonRuleText(sug.match_text);
        if (typeof sug.match_href_contains === 'string') setButtonRuleHrefContains(sug.match_href_contains);
        if (typeof sug.match_class_contains === 'string') setButtonRuleClassContains(sug.match_class_contains);
        if (typeof sug.match_css === 'string') setButtonRuleCss(sug.match_css);

        showFlash(
          'Botão capturado. A aba do seletor será fechada; escolha o evento e clique em Adicionar aqui no painel.',
          'success'
        );
        try {
          const w = pickerWinRef.current;
          if (w && !w.closed) w.close();
        } catch {
          /* ignore */
        }
        pickerWinRef.current = null;
      } catch {
        // ignore
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
      button_bg_color: formButtonBgColor,
      button_text_color: formButtonTextColor,
      event_type: formEventType,
      custom_event_name: formCustomEventName,
      event_value: formEventValue,
      event_currency: formEventCurrency,
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
    setFormButtonBgColor(cfg.button_bg_color || (cfg.theme === 'dark' ? '#FFFFFF' : '#000000'));
    setFormButtonTextColor(cfg.button_text_color || (cfg.theme === 'dark' ? '#000000' : '#FFFFFF'));
    setFormEventType(cfg.event_type || 'Lead');
    setFormCustomEventName(cfg.custom_event_name || '');
    setFormEventValue(cfg.event_value || '');
    setFormEventCurrency(cfg.event_currency || 'BRL');
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
  const reportSections = useMemo(
    () => splitMarkdownH2Sections(report?.analysis_text || ''),
    [report?.analysis_text]
  );
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
        if (saved.diagnosisUtmSource) {
          setDiagnosisUtmSource(saved.diagnosisUtmSource === 'facebook' ? '{{site_source_name}}' : saved.diagnosisUtmSource);
        }
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

  // (Bloco legado removido do painel)

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

    if (evtName === 'Purchase') {
      const v = parseFloat(String(urlRuleEventValue).trim());
      const cur = String(urlRuleEventCurrency).trim();
      if (!String(urlRuleEventValue).trim() || !Number.isFinite(v) || v < 0) {
        showFlash('Purchase exige valor numérico (≥ 0) e moeda (ex.: BRL).', 'error');
        return;
      }
      if (!/^[A-Za-z]{3}$/.test(cur)) {
        showFlash('Moeda deve ser código ISO de 3 letras (ex.: BRL, USD).', 'error');
        return;
      }
    }

    try {
      const payload: any = {
        rule_type: 'url_contains',
        match_value: urlRuleValue,
        event_name: evtName,
        event_type: urlRuleEventType === 'Custom' ? 'custom' : 'standard',
        parameters: {}
      };

      if (evtName === 'Purchase') {
        payload.parameters.value = parseFloat(String(urlRuleEventValue).trim());
        payload.parameters.currency = String(urlRuleEventCurrency).trim().toUpperCase();
      } else if (urlRuleEventType === 'Custom') {
        if (urlRuleEventValue) {
          payload.parameters.value = parseFloat(urlRuleEventValue);
          payload.parameters.currency = urlRuleEventCurrency;
        }
      }

      if (selectedRuleId) {
        await api.put(`/sites/${id}/event-rules/${selectedRuleId}`, payload);
        showFlash('Regra de URL atualizada!');
      } else {
        await api.post(`/sites/${id}/event-rules`, payload);
        showFlash('Regra de URL adicionada!');
      }

      setUrlRuleValue('');
      setUrlRuleCustomName('');
      setUrlRuleEventValue('');
      setUrlRuleEventCurrency('BRL');
      setSelectedRuleId(null);
      await loadEventRules();
    } catch (err: unknown) {
      console.error(err);
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      showFlash(msg || 'Erro ao salvar regra', 'error');
    }
  };

  const handleAddButtonRule = async () => {
    const hasText = !!buttonRuleText.trim();
    const hasHref = !!buttonRuleHrefContains.trim();
    const hasClass = !!buttonRuleClassContains.trim();
    const hasCss = !!buttonRuleCss.trim();
    if (!buttonRuleUrl || (!hasText && !hasHref && !hasClass && !hasCss)) {
      showFlash(
        'Preencha a URL da página e pelo menos um critério: texto do botão, destino (href), classe ou seletor CSS.',
        'error'
      );
      return;
    }
    const evtName = buttonRuleEventType === 'Custom' ? buttonRuleCustomName : buttonRuleEventType;
    if (!evtName) {
      showFlash('Defina o nome do evento', 'error');
      return;
    }

    if (evtName === 'Purchase') {
      const v = parseFloat(String(buttonRuleEventValue).trim());
      const cur = String(buttonRuleEventCurrency).trim();
      if (!String(buttonRuleEventValue).trim() || !Number.isFinite(v) || v < 0) {
        showFlash('Purchase exige valor numérico (≥ 0) e moeda (ex.: BRL).', 'error');
        return;
      }
      if (!/^[A-Za-z]{3}$/.test(cur)) {
        showFlash('Moeda deve ser código ISO de 3 letras (ex.: BRL, USD).', 'error');
        return;
      }
    }

    try {
      const payload: any = {
        rule_type: 'button_click',
        match_value: buttonRuleUrl,
        match_text: hasText ? buttonRuleText.trim() : '',
        event_name: evtName,
        event_type: buttonRuleEventType === 'Custom' ? 'custom' : 'standard',
        parameters: {} as Record<string, string>
      };
      if (hasHref) payload.parameters.match_href_contains = buttonRuleHrefContains.trim();
      if (hasClass) payload.parameters.match_class_contains = buttonRuleClassContains.trim();
      if (hasCss) payload.parameters.match_css = buttonRuleCss.trim();

      if (evtName === 'Purchase') {
        payload.parameters.value = parseFloat(String(buttonRuleEventValue).trim());
        payload.parameters.currency = String(buttonRuleEventCurrency).trim().toUpperCase();
      } else if (buttonRuleEventType === 'Custom') {
        if (buttonRuleEventValue) {
          payload.parameters.value = parseFloat(buttonRuleEventValue);
          payload.parameters.currency = buttonRuleEventCurrency;
        }
      }

      if (selectedRuleId) {
        await api.put(`/sites/${id}/event-rules/${selectedRuleId}`, payload);
        showFlash('Regra de botão atualizada!');
      } else {
        await api.post(`/sites/${id}/event-rules`, payload);
        showFlash('Regra de botão adicionada!');
      }

      // Mantém URL + critérios para permitir testar imediatamente após salvar.
      setButtonRuleCustomName('');
      setButtonRuleEventValue('');
      setButtonRuleEventCurrency('BRL');
      setSelectedRuleId(null);
      await loadEventRules();
    } catch (err: unknown) {
      console.error(err);
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      showFlash(msg || 'Erro ao salvar regra de botão', 'error');
    }
  };

  const handleEditRule = (rule: any) => {
    setSelectedRuleId(rule.id);
    if (rule.rule_type === 'url_contains') {
      setUrlRuleValue(rule.match_value);
      const isCustom = rule.event_type === 'custom';
      setUrlRuleEventType(isCustom ? 'Custom' : rule.event_name);
      setUrlRuleCustomName(isCustom ? rule.event_name : '');
      setUrlRuleEventValue(rule.parameters?.value?.toString() || '');
      setUrlRuleEventCurrency(rule.parameters?.currency || 'BRL');
      setEventSubTab('url');
    } else if (rule.rule_type === 'button_click') {
      setButtonRuleUrl(rule.match_value);
      setButtonRuleText(rule.match_text || '');
      setButtonRuleHrefContains(rule.parameters?.match_href_contains || '');
      setButtonRuleClassContains(rule.parameters?.match_class_contains || '');
      setButtonRuleCss(rule.parameters?.match_css || '');
      const isCustom = rule.event_type === 'custom';
      setButtonRuleEventType(isCustom ? 'Custom' : rule.event_name);
      setButtonRuleCustomName(isCustom ? rule.event_name : '');
      setButtonRuleEventValue(rule.parameters?.value?.toString() || '');
      setButtonRuleEventCurrency(rule.parameters?.currency || 'BRL');
      setEventSubTab('button');
    }
    showFlash('Regra carregada para edição');
  };

  const handleCancelEditRule = () => {
    setSelectedRuleId(null);
    setUrlRuleValue('');
    setUrlRuleCustomName('');
    setUrlRuleEventValue('');
    setUrlRuleEventCurrency('BRL');
    setButtonRuleUrl('');
    setButtonSelectorPageUrl('');
    setButtonRuleText('');
    setButtonRuleHrefContains('');
    setButtonRuleClassContains('');
    setButtonRuleCss('');
    setButtonRuleCustomName('');
    setButtonRuleEventValue('');
    setButtonRuleEventCurrency('BRL');
    showFlash('Edição cancelada');
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!window.confirm('Excluir esta regra?')) return;
    try {
      await api.delete(`/sites/${id}/event-rules/${ruleId}`);
      await loadEventRules();
      if (selectedRuleId === ruleId) handleCancelEditRule();
      showFlash('Regra removida!');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao remover regra', 'error');
    }
  };

  const copyFormHtml = (form?: any) => {
    let currentConfig: any = {
      fields: formFields,
      theme: formTheme,
      button_text: formButtonText,
      button_bg_color: formButtonBgColor,
      button_text_color: formButtonTextColor,
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
        button_bg_color: form.config.button_bg_color || (form.config.theme === 'dark' ? '#FFFFFF' : '#000000'),
        button_text_color: form.config.button_text_color || (form.config.theme === 'dark' ? '#000000' : '#FFFFFF'),
        event_type: form.config.event_type || 'Lead',
        custom_event_name: form.config.custom_event_name || '',
        event_value: form.config.event_value || '',
        event_currency: form.config.event_currency || 'BRL',
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

    const { fields, theme, button_text, button_bg_color, button_text_color, event_type, custom_event_name, event_value, event_currency, post_submit_action: action, webhook_url: webhook } = currentConfig;

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
    if (fields.name) fieldsHtml.push(`  <input type="text" name="fullname" placeholder="Nome Completo" required style="${inputStyle}" />`);
    if (fields.email) fieldsHtml.push(`  <input type="email" name="email" placeholder="E-mail" required style="${inputStyle}" />`);
    if (fields.phone) {
      const ddiOptions = DDI_LIST.map(d => `<option value="${d.code}"${d.code === '+55' ? ' selected' : ''}>${d.code} ${d.country}</option>`).join('');
      fieldsHtml.push(`  <div style="${phoneRowStyle}"><select name="ddi" style="${ddiStyle}">${ddiOptions}</select><input type="tel" name="phone" placeholder="Telefone" required style="${phoneStyle}" /></div>`);
    }

    const buttonStyle = 'padding:10px 20px; cursor:pointer; border:none; border-radius:4px; font-weight:bold; width:100%;';
    const buttonColor = (button_bg_color && button_text_color)
      ? `background-color:${button_bg_color} !important; color:${button_text_color} !important;`
      : (isDark ? 'background:#fff; color:#000;' : 'background:#000; color:#fff;');

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
  // Meta CAPI requer: fn (first_name) e ln (last_name) em lowercase
  var nameInput = form.fullname || form.name || form.fn;
  if (nameInput && nameInput.value) {
    var fullName = nameInput.value.trim().toLowerCase();
    var parts = fullName.split(/\s+/);
    data.fn = parts[0];
    if (parts.length > 1) data.ln = parts.slice(1).join(' ');
  }
  // Meta CAPI requer: em (email) em lowercase
  if (form.email && form.email.value) data.email = form.email.value.trim().toLowerCase();
  var ddi = form.ddi ? form.ddi.value : '+55';
  var ddiDigits = (ddi || '').toString().replace(/[^0-9]/g, '');
  if (!ddiDigits) ddiDigits = '55';
  var phoneRaw = form.phone ? form.phone.value : '';
  var phoneDigits = (phoneRaw || '').toString().replace(/[^0-9]/g, '');
  if (phoneDigits) data.phone = '+' + ddiDigits + phoneDigits;

  // Prevent duplicates by generating a single event ID for both Tracker (browser) and API (server)
  var eventId = 'evt_' + Math.floor(Date.now() / 1000) + '_' + Math.random().toString(36).slice(2);
  data.event_id = eventId;
  data.tracked_by_frontend = !!window.tracker;

  // 1. Identify client
  if (window.tracker) {
    window.tracker.identify(data);
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
      if (window.tracker) {
        var evtData = { event_id: eventId };
        ${(event_value && !isNaN(parseFloat(event_value))) ? `evtData.value = ${parseFloat(event_value)};` : ''}
        ${(event_currency) ? `evtData.currency = '${event_currency}';` : ''}
        window.tracker.track('${evtName}', evtData);
      }
      setTimeout(function() {
        if (window.taDecorateUrl) {
          window.location.href = window.taDecorateUrl(json.redirect_url);
        } else {
          window.location.href = json.redirect_url;
        }
      }, 400); // Dá tempo (400ms) para o Meta Pixel/FBQ disparar antes de matar a página atual
    } else if (json.message) {
      form.innerHTML = '<div style="padding:20px; text-align:center; color:${isDark ? '#fff' : '#000'};">' + json.message + '</div>';
    } else {
       if (window.tracker) {
         var evtData = { event_id: eventId };
         ${(event_value && !isNaN(parseFloat(event_value))) ? `evtData.value = ${parseFloat(event_value)};` : ''}
         ${(event_currency) ? `evtData.currency = '${event_currency}';` : ''}
         window.tracker.track('${evtName}', evtData);
       }
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
  // Meta CAPI requer: fn (first_name) e ln (last_name) em lowercase
  var nameInput = form.fullname || form.name || form.fn;
  if (nameInput && nameInput.value) {
    var fullName = nameInput.value.trim().toLowerCase();
    var parts = fullName.split(/\s+/);
    data.fn = parts[0];
    if (parts.length > 1) data.ln = parts.slice(1).join(' ');
  }
  // Meta CAPI requer: em (email) em lowercase
  if (form.email && form.email.value) data.email = form.email.value.trim().toLowerCase();
  var ddi = form.ddi ? form.ddi.value : '+55';
  var ddiDigits = (ddi || '').toString().replace(/[^0-9]/g, '');
  if (!ddiDigits) ddiDigits = '55';
  var phoneRaw = form.phone ? form.phone.value : '';
  var phoneDigits = (phoneRaw || '').toString().replace(/[^0-9]/g, '');
  if (phoneDigits) data.phone = '+' + ddiDigits + phoneDigits;

  if (window.tracker) {
    window.tracker.identify(data);
  }
  
  // Como não há 'fetch' backend na versão manual do form, 
  // assume-se sucesso ao clicar no submit se houvesse lógica manual acoplada.
  if (window.tracker) {
    var evtData = {};
    ${(event_value && !isNaN(parseFloat(event_value))) ? `evtData.value = ${parseFloat(event_value)};` : ''}
    ${(event_currency) ? `evtData.currency = '${event_currency}';` : ''}
    window.tracker.track('${evtName}', evtData);
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
      { key: 'buyers' as const, label: 'Compradores' },
      { key: 'ga' as const, label: 'Google Analytics' },
      { key: 'matching' as const, label: 'Eventos' },
      { key: 'webhooks' as const, label: 'Webhooks' },
    ],
    []
  );

  const loadSnippet = useCallback(async () => {
    const res = await api.get(`/sites/${id}/snippet`);
    setInstallSnippets({
      performance: res.data.snippet_performance ?? res.data.snippet ?? '',
      immediate: res.data.snippet_immediate ?? '',
    });
  }, [id]);

  const loadInjectedSnippets = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setInjectListLoading(true);
    try {
      const res = await api.get(`/sites/${id}/injected-snippets`);
      setInjectedSnippets(res.data.snippets || []);
    } catch (err) {
      console.error('Failed to load injected snippets', err);
      setInjectedSnippets([]);
    } finally {
      setInjectListLoading(false);
    }
  }, [id]);

  const resetInjectForm = () => {
    setInjectEditId(null);
    setInjectName('');
    setInjectPosition('head');
    setInjectEnabled(true);
    setInjectHtml('');
  };

  const beginEditInject = (sn: InjectedSnippet) => {
    setInjectEditId(sn.id);
    setInjectName(sn.name || '');
    setInjectPosition(sn.position || 'head');
    setInjectEnabled(!!sn.enabled);
    setInjectHtml(sn.html || '');
  };

  const saveInjectedSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(id)) return;
    setSavingInject(true);
    try {
      const payload = { name: injectName, position: injectPosition, enabled: injectEnabled, html: injectHtml, sort_order: 0 };
      if (injectEditId) await api.put(`/sites/${id}/injected-snippets/${injectEditId}`, payload);
      else await api.post(`/sites/${id}/injected-snippets`, payload);
      await loadInjectedSnippets();
      resetInjectForm();
      showFlash('Código salvo.');
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error;
      showFlash(typeof msg === 'string' && msg ? msg : 'Não foi possível salvar.', 'error');
    } finally {
      setSavingInject(false);
    }
  };

  const removeInjectedSnippet = async (snippetId: number) => {
    if (!Number.isFinite(id)) return;
    if (!window.confirm('Excluir este código extra?')) return;
    setSavingInject(true);
    try {
      await api.delete(`/sites/${id}/injected-snippets/${snippetId}`);
      await loadInjectedSnippets();
      if (injectEditId === snippetId) resetInjectForm();
      showFlash('Código excluído.');
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error;
      showFlash(typeof msg === 'string' && msg ? msg : 'Não foi possível excluir.', 'error');
    } finally {
      setSavingInject(false);
    }
  };

  useEffect(() => {
    if (tab !== 'snippet') return;
    if (installSubTab !== 'extras') return;
    loadInjectedSnippets().catch(() => {});
  }, [tab, installSubTab, loadInjectedSnippets]);

  // (Bloco legado removido do painel)

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
      if (res.data?.ok) {
        showFlash('Evento do servidor enviado com sucesso!');
      } else {
        showFlash(res.data?.error || 'Falha ao enviar evento do servidor.', 'error');
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
          setFunnelCampaignPicklist(
            rows.map((c: any) => ({
              id: String(c.id),
              name: String(c.name || c.id || ''),
              is_active: String(c.effective_status || c.status || '').toUpperCase() === 'ACTIVE',
            }))
          );
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
            const optimizationGoal = metaInfo.optimization_goal || row.optimization_goal || null;
            const promotedObject = metaInfo.promoted_object || row.promoted_object || null;
            return {
              ...row,
              name: row.name || metaInfo.name || row.ad_name,
              status,
              effective_status: effectiveStatus,
              optimization_goal: optimizationGoal,
              promoted_object: promotedObject,
            };
          });
          if (metaList.length) {
            rows = rows.filter((row) => Boolean(metaMap[row.id]));
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
  }, [id, metricsPreset, metricsSince, metricsUntil, metaLevel, metaParentId]);

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
      const res = await api.get(`/stats/sites/${id}/quality?period=${qualityPeriod}`);
      setDataQuality(res.data);
    } catch { setDataQuality(null); }
  }, [id, qualityPeriod]);

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
    if (tab === 'webhooks') {
      loadWebhookSecret().catch(() => { });
    }
    if (tab === 'utm') loadSavedUtms().catch(() => { });
    if (tab === 'reports') {
      loadUtmOptions().catch(() => { });
      loadSavedUtms().catch(() => { });
      setMetaLevel('campaign');
      setMetaParentId(null);
      loadMeta().catch(() => { });
    }
  }, [tab, site, loadSnippet, loadMeta, loadGa, loadMatching, loadWebhookSecret, loadUtmOptions, loadDataQuality]);

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

  // Relatórios foram movidos para a aba Campanhas (Assistente IA).
  const handleWizardGenerate = async (context: {
    objective: string;
    landing_page_url: string;
    selected_ad_ids?: string[];
  }) => {
    if (!site) return;
    setShowWizard(false);
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
        {
          objective: context.objective,
          landing_page_url: context.landing_page_url,
          selected_ad_ids: context.selected_ad_ids,
        },
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

  const getBreakdownCtr = (row: MetaBreakdownItem) => {
    if (row.ctr_calc_pct !== undefined) return row.ctr_calc_pct;
    const clicks = row.clicks || 0;
    const impressions = row.impressions || 0;
    if (!impressions) return 0;
    return (clicks / impressions) * 100;
  };

  const getBreakdownLpRate = (row: MetaBreakdownItem) => {
    if (row.lp_rate_pct !== undefined) return row.lp_rate_pct;
    const clicks = row.unique_link_clicks || row.clicks || 0;
    const views = row.landing_page_views || 0;
    if (!clicks) return 0;
    return (views / clicks) * 100;
  };

  const getBreakdownResults = (row: MetaBreakdownItem) => {
    return row.results || 0;
  };
  const getBreakdownCpr = (row: MetaBreakdownItem) => {
    return row.cost_per_result || 0;
  };

  const getBreakdownBottleneck = (row: MetaBreakdownItem) => {
    const ctr = getBreakdownCtr(row);
    const lp = getBreakdownLpRate(row);
    const results = getBreakdownResults(row);

    if (results > 0) return <span className="text-emerald-400">Convertendo</span>;
    if (ctr > 0 && ctr < 0.8) return <span className="text-red-400">Criativo (CTR baixo)</span>;
    if (lp > 0 && lp < 55) return <span className="text-amber-400">Landing (Load/Connect)</span>;
    if (row.landing_page_views > 0 && results === 0) return <span className="text-zinc-500">Oferta/Checkout</span>;
    return <span className="text-zinc-500">Sem sinal forte</span>;
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
        value: (metrics.results ?? 0) > 0 ? (metrics.results ?? 0) : metrics.custom_event_count ?? 0,
        label: `Evento ${customEventName}`,
      };
    }

    if (customEventType) {
      const t = customEventType.toLowerCase();
      if (t.includes('purchase')) return { value: metrics.results ?? metrics.purchases ?? 0, label: 'Compras' };
      if (t.includes('lead')) return { value: metrics.results ?? metrics.leads ?? 0, label: 'Leads' };
      if (t.includes('contact')) return { value: metrics.results ?? metrics.contacts ?? 0, label: 'Contatos' };
      if (t.includes('add_to_cart')) return { value: metrics.results ?? metrics.adds_to_cart ?? 0, label: 'Carrinhos' };
      if (t.includes('initiate_checkout')) {
        return { value: metrics.results ?? metrics.initiates_checkout ?? 0, label: 'Finalizações' };
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

  const selectedCampaign = selectedCampaignId ? campaigns.find((c) => c.id === selectedCampaignId) : null;

  const inputCls =
    'w-full rounded-lg bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/40 transition-all placeholder:text-zinc-600';
  const selectClsCompact =
    'rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-600 transition-colors';
  const selectCls =
    'w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-600 transition-colors';

  const periodSelector = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Intervalo de tempo das métricas"
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
            aria-label="Data inicial do período personalizado"
            value={metricsSince}
            onChange={(e) => setMetricsSince(e.target.value)}
            className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-600"
          />
          <span className="text-zinc-600 dark:text-zinc-500 text-xs" aria-hidden>
            →
          </span>
          <input
            type="date"
            aria-label="Data final do período personalizado"
            value={metricsUntil}
            onChange={(e) => setMetricsUntil(e.target.value)}
            className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-600"
          />
        </div>
      )}
    </div>
  );

  return (
    <Layout
      title={site ? site.name : 'Site'}
      right={null}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <Link
            to="/sites"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-300 transition-colors"
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
              <span className="text-xs text-zinc-600 dark:text-zinc-500 font-mono">{site.domain}</span>
            </div>
          )}
        </div>
        {site && (
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-3 py-1.5">
            <span className="text-[10px] text-zinc-600 dark:text-zinc-500 uppercase tracking-widest">Key</span>
            <code className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">{site.site_key}</code>
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
      <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-white dark:bg-zinc-950/60 overflow-hidden">
        {/* Tab bar */}
        <div className="border-b border-zinc-200 dark:border-zinc-800 px-3 pt-3 pb-0 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                searchParams.set('tab', t.key);
                setSearchParams(searchParams, { replace: true });
              }}
              className={`relative px-3.5 py-2 text-[13px] font-medium rounded-t-lg transition-all ${tab === t.key
                ? 'text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-900/80'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
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
            <div className="max-w-3xl space-y-6">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInstallSubTab('snippet')}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    installSubTab === 'snippet'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Snippet
                </button>
                <button
                  type="button"
                  onClick={() => setInstallSubTab('extras')}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    installSubTab === 'extras'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  Códigos extras
                </button>
              </div>

              {installSubTab === 'snippet' && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Escolha <strong className="text-zinc-700 dark:text-zinc-300 font-medium">uma</strong> das opções abaixo e cole no seu site, antes do fechamento da tag{' '}
                    <code className="text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-800/60 px-1.5 py-0.5 rounded text-xs">&lt;/head&gt;</code>. O Trajettu não exibe
                    banner de cookies neste script.
                  </p>

                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Performance (recomendado)</h3>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded">
                        loader.js
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      Primeiro carrega só um script pequeno. Depois que a página termina de carregar, o tracker inicia e já carrega o{' '}
                      <strong className="text-zinc-700 dark:text-zinc-300">Meta Pixel (web) + eventos server</strong> para não perder amostragem.
                      Os <strong className="text-zinc-700 dark:text-zinc-300">códigos extras</strong> (GTM, Clarity etc.) só são injetados na{' '}
                      <strong className="text-zinc-700 dark:text-zinc-300">primeira interação</strong> (clique, toque, tecla ou scroll).
                      O modo seletor de botão no painel (
                      <code className="text-[11px] bg-zinc-200 dark:bg-zinc-800/60 px-1 rounded">ta_pick</code> /{' '}
                      <code className="text-[11px] bg-zinc-200 dark:bg-zinc-800/60 px-1 rounded">ta_test</code>) carrega o tracker logo após o load, sem precisar clicar na página.
                    </p>
                    <div className="relative rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 overflow-hidden">
                      <div className="flex items-center justify-end px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(installSnippets.performance);
                            showFlash('Código copiado!');
                          }}
                          className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-300 transition-colors"
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
                      <pre className="text-xs p-4 m-0">
                        <code className="block break-all text-zinc-700 dark:text-zinc-300 leading-relaxed">{installSnippets.performance}</code>
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Imediato</h3>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-500 bg-zinc-200/80 dark:bg-zinc-800/80 px-2 py-0.5 rounded">
                        tracker.js
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      O tracker completo é carregado assim que o navegador processa o script (com <code className="text-[11px]">defer</code>, em geral após o HTML da página). Útil se
                      você precisa rastrear também quem não interage (ex.: bounce) ou quer comportamento clássico de pixel o mais cedo possível.
                    </p>
                    <div className="relative rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 overflow-hidden">
                      <div className="flex items-center justify-end px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(installSnippets.immediate);
                            showFlash('Código copiado!');
                          }}
                          className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-300 transition-colors"
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
                      <pre className="text-xs p-4 m-0">
                        <code className="block break-all text-zinc-700 dark:text-zinc-300 leading-relaxed">{installSnippets.immediate}</code>
                      </pre>
                    </div>
                  </div>
                </>
              )}

              {installSubTab === 'extras' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 p-4">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Lista de códigos</h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                      Adicione códigos (Clarity, GTM etc.) que serão injetados quando o tracker Trajettu rodar. Com <code className="text-[11px] bg-zinc-200 dark:bg-zinc-800/60 px-1 rounded">loader.js</code>,
                      isso acontece só após load + primeira interação (ou <code className="text-[11px] bg-zinc-200 dark:bg-zinc-800/60 px-1 rounded">ta_pick</code>/<code className="text-[11px] bg-zinc-200 dark:bg-zinc-800/60 px-1 rounded">ta_test</code>).
                    </p>
                    <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] bg-zinc-100 dark:bg-zinc-900/70 text-zinc-600 dark:text-zinc-400">
                        <div className="col-span-5">Nome</div>
                        <div className="col-span-2">Posição</div>
                        <div className="col-span-2">Status</div>
                        <div className="col-span-3 text-right">Ações</div>
                      </div>
                      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950/40">
                        {injectListLoading && (
                          <div className="px-3 py-3 text-xs text-zinc-500">Carregando…</div>
                        )}
                        {!injectListLoading && injectedSnippets.length === 0 && (
                          <div className="px-3 py-3 text-xs text-zinc-500">Nenhum código cadastrado.</div>
                        )}
                        {!injectListLoading &&
                          injectedSnippets.map((sn) => (
                            <div key={sn.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center">
                              <div className="col-span-5 text-zinc-800 dark:text-zinc-200 truncate">{sn.name}</div>
                              <div className="col-span-2 text-zinc-600 dark:text-zinc-400">{sn.position}</div>
                              <div className="col-span-2">
                                <span className={`text-[11px] px-2 py-0.5 rounded ${sn.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                                  {sn.enabled ? 'ativo' : 'pausado'}
                                </span>
                              </div>
                              <div className="col-span-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => beginEditInject(sn)}
                                  className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900/50"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeInjectedSnippet(sn.id)}
                                  className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                  Excluir
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

                  <form onSubmit={saveInjectedSnippet} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{injectEditId ? 'Editar código' : 'Novo código'}</h3>
                      {injectEditId && (
                        <button type="button" onClick={resetInjectForm} className="text-xs text-zinc-500 hover:text-zinc-300">
                          Cancelar edição
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Nome</label>
                        <input
                          value={injectName}
                          onChange={(e) => setInjectName(e.target.value)}
                          className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 px-3 py-2 outline-none focus:border-emerald-500/50"
                          placeholder="Ex.: Microsoft Clarity"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Posição</label>
                        <select
                          aria-label="Posição do código extra"
                          value={injectPosition}
                          onChange={(e) => setInjectPosition(e.target.value === 'body' ? 'body' : 'head')}
                          className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 px-3 py-2 outline-none focus:border-emerald-500/50"
                        >
                          <option value="head">head</option>
                          <option value="body">body</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input id="inject-enabled" type="checkbox" checked={injectEnabled} onChange={(e) => setInjectEnabled(e.target.checked)} />
                      <label htmlFor="inject-enabled" className="text-xs text-zinc-600 dark:text-zinc-400">
                        Ativo
                      </label>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">HTML/JS</label>
                      <textarea
                        value={injectHtml}
                        onChange={(e) => setInjectHtml(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        className="w-full text-xs font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 px-3 py-2 outline-none focus:border-emerald-500/50"
                        placeholder={'Ex.: <script async src=\"https://www.clarity.ms/tag/...\"></script>'}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={savingInject}
                        className="text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2"
                      >
                        {savingInject ? 'Salvando…' : 'Salvar'}
                      </button>
                      <span className="text-[11px] text-zinc-500">Limite ~200 mil caracteres por código.</span>
                    </div>
                  </form>

                </div>
              )}

              {/* ── Data Quality Card ── */}
              {dataQuality && dataQuality.total_events > 0 && (
                <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-zinc-100">Qualidade dos Dados</h3>
                    <select
                      aria-label="Período dos dados de qualidade"
                      value={qualityPeriod}
                      onChange={(e) => setQualityPeriod(e.target.value)}
                      className="text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded px-2 py-1 outline-none focus:border-emerald-500/50"
                    >
                      <option value="today">Hoje</option>
                      <option value="last_7d">Últimos 7 dias</option>
                      <option value="last_30d">Últimos 30 dias</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-500 mb-4">{dataQuality.total_events.toLocaleString()} eventos rastreados</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'FBP / FBC', value: dataQuality.metrics.fbp_fbc_match_rate, desc: 'Cookies Meta' },
                      { label: 'Nome / Email / Tel', value: dataQuality.metrics.pii_match_rate, desc: 'PII Avançado' },
                      { label: 'External ID', value: dataQuality.metrics.external_id_match_rate, desc: 'ID Externo' },
                    ].map((m) => {
                      const pct = Math.round(m.value * 100);
                      const color = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
                      const bg = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
                      return (
                        <div key={m.label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 p-3">
                          <div className="text-[10px] text-zinc-600 dark:text-zinc-500 uppercase tracking-wider">{m.label}</div>
                          <div className={`text-xl font-bold ${color} mt-1`}>{pct}%</div>
                          <div className="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                            <MetricQualityBarFill pct={pct} toneClass={bg} />
                          </div>
                          <div className="text-[9px] text-zinc-600 dark:text-zinc-500 mt-1">{m.desc}</div>
                        </div>
                      );
                    })}
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 p-3">
                      <div className="text-[10px] text-zinc-600 dark:text-zinc-500 uppercase tracking-wider">Score Geral</div>
                      {(() => {
                        const avg = Math.round(((dataQuality.metrics.fbp_fbc_match_rate + dataQuality.metrics.pii_match_rate + dataQuality.metrics.external_id_match_rate) / 3) * 100);
                        const color = avg >= 80 ? 'text-emerald-400' : avg >= 50 ? 'text-amber-400' : 'text-red-400';
                        const emoji = avg >= 80 ? '🟢' : avg >= 50 ? '🟡' : '🔴';
                        return <div className={`text-xl font-bold ${color} mt-1`}>{emoji} {avg}%</div>;
                      })()}
                      <div className="text-[9px] text-zinc-600 dark:text-zinc-500 mt-3">Média dos indicadores</div>
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
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
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
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5">
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
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conexão com Facebook</h3>
                      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500">
                        Conecte para listar contas de anúncio e pixels automaticamente.
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${meta?.has_facebook_connection ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                        />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
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
                        className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 px-4 py-2 rounded-lg text-xs transition-colors disabled:opacity-40"
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>

                {meta?.has_facebook_connection && (
                  <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Conta de Anúncios</label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdAccountSelector(true);
                          loadAdAccounts().catch(() => { });
                        }}
                        className="text-[11px] text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-300 flex items-center gap-1 transition-colors"
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
                      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-xs text-zinc-700 dark:text-zinc-300">{selectedAdAccountName || meta.ad_account_id}</span>
                      </div>
                    )}

                    {showAdAccountSelector && (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                        {adAccounts.length === 0 && (
                          <div className="text-xs text-zinc-600 dark:text-zinc-500 italic py-3 text-center">
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
                                : 'bg-zinc-100 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 hover:border-zinc-700'
                                }`}
                              onClick={() => {
                                if (isSelected) setShowAdAccountSelector(false);
                              }}
                            >
                              <div>
                                <div
                                  className={`text-xs font-medium ${isSelected ? 'text-blue-200' : 'text-zinc-700 dark:text-zinc-300'}`}
                                >
                                  {acc.business ? `${acc.name} (${acc.business.name})` : acc.name}
                                </div>
                                <div className="text-[10px] text-zinc-600 dark:text-zinc-500 font-mono mt-0.5">
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
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">Status do CAPI</span>
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
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500">Sem tentativas</span>
                    )}
                  </div>
                  {meta?.last_capi_attempt_at && (
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-500">
                      Última tentativa: {formatDateTimeBrt(meta.last_capi_attempt_at)}
                    </div>
                  )}
                  {meta?.last_capi_error && (
                    <div className="text-[11px] text-rose-300 break-words">{meta.last_capi_error}</div>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-4 flex flex-col gap-2">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">Último evento recebido do site</div>
                  {meta?.last_ingest_at ? (
                    <>
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-500">
                        {formatDateTimeBrt(meta.last_ingest_at)}
                      </div>
                      <div className="text-[11px] text-zinc-700 dark:text-zinc-300">
                        {meta.last_ingest_event_name || 'Evento'}
                      </div>
                      {meta.last_ingest_event_source_url && (
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-500 break-words">
                          {meta.last_ingest_event_source_url}
                        </div>
                      )}
                      {meta.last_ingest_event_id && (
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-500">
                          ID: {meta.last_ingest_event_id}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-500">Nenhum evento recebido</div>
                  )}
                </div>
                <div className="flex items-center gap-3 py-4 border-y border-zinc-200 dark:border-zinc-800">
                  <input
                    id="meta-enabled"
                    name="enabled"
                    type="checkbox"
                    value="true"
                    defaultChecked={meta?.enabled ?? true}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <label htmlFor="meta-enabled" className="text-sm font-medium text-zinc-800 dark:text-zinc-200 block cursor-pointer">
                      Rastreamento ativo
                    </label>
                    <span className="text-xs text-zinc-600 dark:text-zinc-500">
                      Habilita o envio de eventos para o Pixel e API de Conversões
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Pixel ID</label>
                  <input
                    name="pixel_id"
                    defaultValue={meta?.pixel_id || ''}
                    placeholder="Ex: 1234567890"
                    className={inputCls}
                  />
                  {pixels.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 uppercase tracking-wider">Sugestões:</span>
                      {pixels.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => {
                            const input = document.querySelector<HTMLInputElement>('input[name="pixel_id"]');
                            if (input) input.value = p.id;
                          }}
                          className="text-[11px] bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:text-zinc-200 px-2.5 py-1 rounded-md border border-zinc-700/60 transition-colors"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      CAPI Token <span className="text-zinc-600 dark:text-zinc-500 font-normal">(Opcional)</span>
                    </label>
                    <input
                      name="capi_token"
                      type="password"
                      autoComplete="off"
                      className={inputCls}
                      placeholder={meta?.has_capi_token ? '•••••••• (configurado)' : 'Token de Acesso (EAA...)'}
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-500">Rastreamento server-side (anti-adblock)</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      Código de teste do servidor <span className="text-zinc-600 dark:text-zinc-500 font-normal">(Opcional)</span>
                    </label>
                    <input
                      name="capi_test_event_code"
                      defaultValue={meta?.capi_test_event_code || ''}
                      placeholder="Ex: TEST123"
                      className={inputCls}
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-500">
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
                  className="inline-flex items-center gap-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-all"
                >
                  Testar evento do servidor
                </button>
              </div>
            </form>
          )}

          {tab === 'utm' && (
            <div className="max-w-3xl space-y-5">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Gerador de URL UTM</h3>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                      Gere a URL com UTMs para usar nos parâmetros do anúncio do Meta.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUtmSource('{{site_source_name}}');
                        setUtmMedium('paid_social');
                        setUtmCampaign('{{campaign.name}}');
                        setUtmContent('{{ad.name}}');
                        setUtmTerm('{{adset.name}}');
                        setUtmClickId('{{ad.id}}');
                      }}
                      className="text-[11px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
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
                      className="text-[11px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="dash-site-utm-base-url" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                    URL base
                  </label>
                  <input
                    id="dash-site-utm-base-url"
                    value={utmBaseUrl}
                    onChange={(e) => setUtmBaseUrl(e.target.value)}
                    placeholder="https://seusite.com/pagina"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="dash-site-utm-source" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      utm_source
                    </label>
                    <input id="dash-site-utm-source" value={utmSource} onChange={(e) => setUtmSource(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dash-site-utm-medium" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      utm_medium
                    </label>
                    <input id="dash-site-utm-medium" value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dash-site-utm-campaign" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      utm_campaign
                    </label>
                    <input id="dash-site-utm-campaign" value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dash-site-utm-content" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      utm_content
                    </label>
                    <input id="dash-site-utm-content" value={utmContent} onChange={(e) => setUtmContent(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dash-site-utm-term" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      utm_term
                    </label>
                    <input id="dash-site-utm-term" value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="dash-site-utm-click-id" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                      click_id
                    </label>
                    <input id="dash-site-utm-click-id" value={utmClickId} onChange={(e) => setUtmClickId(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-5">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Parâmetros da URL (Meta Ads)
                      <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">Use este no Meta</span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!utmUrl || utmUrl.indexOf('?') === -1}
                        onClick={() => {
                          if (!utmUrl || utmUrl.indexOf('?') === -1) return;
                          const queryOnly = utmUrl.substring(utmUrl.indexOf('?') + 1);
                          navigator.clipboard.writeText(queryOnly);
                          showFlash('Parâmetros copiados!');
                        }}
                        className="text-[11px] border border-blue-500/30 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                      >
                        Copiar Parâmetros
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-800 dark:text-zinc-200 break-all font-mono bg-white dark:bg-black/20 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    {utmUrl && utmUrl.indexOf('?') !== -1 ? utmUrl.substring(utmUrl.indexOf('?') + 1) : 'Preencha as UTMs para gerar os parâmetros.'}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-5 opacity-75 hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
                      URL Final Completa
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!utmUrl}
                        onClick={() => setShowSaveUtmModal(true)}
                        className="text-[11px] border border-zinc-700 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-300 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
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
                        className="text-[11px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                      >
                        Copiar URL
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 break-all bg-white dark:bg-black/20 p-2 rounded border border-zinc-200 dark:border-zinc-800/50">
                    {utmUrl || 'Preencha a URL base e UTMs para gerar o link.'}
                  </div>
                </div>
              </div>

              {showSaveUtmModal && (
                <div className="mt-4 pt-4 border-t border-zinc-700/50">
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Nome para salvar</label>
                  <div className="flex gap-2">
                    <input
                      value={saveUtmName}
                      onChange={(e) => setSaveUtmName(e.target.value)}
                      placeholder="Ex: Campanha Black Friday"
                      className="flex-1 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-600"
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
                      className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-300 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {savedUtms.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">UTMs Salvas</h3>
                  <div className="grid grid-cols-1 gap-3">
                    {savedUtms.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-4 hover:border-zinc-300 dark:border-zinc-700 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{u.name}</span>
                            <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-mono">
                              {new Date(u.created_at).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-zinc-600 dark:text-zinc-500 font-mono">
                            {u.utm_source && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800">
                                src: {u.utm_source}
                              </span>
                            )}
                            {u.utm_campaign && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800">
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
              <div className="flex items-center gap-3 py-3.5 border-y border-zinc-200 dark:border-zinc-800">
                <input
                  id="ga-enabled"
                  name="enabled"
                  type="checkbox"
                  value="true"
                  defaultChecked={ga?.enabled ?? true}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
                />
                <label htmlFor="ga-enabled" className="text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  Integração GA ativa
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Measurement ID
                </label>
                <input
                  name="measurement_id"
                  defaultValue={ga?.measurement_id || ''}
                  placeholder="G-XXXXXXXXXX"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  API Secret (Measurement Protocol)
                </label>
                <input
                  name="api_secret"
                  type="password"
                  placeholder="Opcional: Para envio server-side"
                  className={inputCls}
                />
                {ga?.has_api_secret && (
                  <p className="text-xs text-emerald-600 mt-1">
                    ✓ API Secret configurado
                  </p>
                )}
                <p className="text-xs text-zinc-500 mt-1">
                  Gere em: Admin &gt; Fluxos de dados &gt; Segredos da API do Measurement Protocol.
                </p>
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

              <div className="flex border-b border-zinc-200 dark:border-zinc-800">
                <button type="button" onClick={() => setEventSubTab('url')} className={`px-4 py-2 font-medium text-sm transition-colors ${eventSubTab === 'url' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>Eventos por URL</button>
                <button type="button" onClick={() => setEventSubTab('button')} className={`px-4 py-2 font-medium text-sm transition-colors ${eventSubTab === 'button' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>Eventos por Botão</button>
                <button type="button" onClick={() => setEventSubTab('form')} className={`px-4 py-2 font-medium text-sm transition-colors ${eventSubTab === 'form' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>Formulários</button>
              </div>

              {/* Seção 1: Configuração de Eventos por URL */}
              {eventSubTab === 'url' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Configuração de Eventos por URL</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-500">
                      Dispare eventos automaticamente quando a URL contiver um trecho específico (ex: "obrigado").
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-zinc-50 dark:bg-zinc-900/30 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="md:col-span-4">
                      <label htmlFor="dash-site-url-rule-contains" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Se a URL contém:
                      </label>
                      <input
                        id="dash-site-url-rule-contains"
                        value={urlRuleValue}
                        onChange={(e) => setUrlRuleValue(e.target.value)}
                        placeholder="Ex: /obrigado-compra"
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label htmlFor="dash-site-url-rule-event-type" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Disparar Evento:
                      </label>
                      <select
                        id="dash-site-url-rule-event-type"
                        value={urlRuleEventType}
                        onChange={(e) => setUrlRuleEventType(e.target.value)}
                        className={selectCls}
                      >
                        <option value="Purchase">Purchase (Compra)</option>
                        <option value="Lead">Lead (Cadastro)</option>
                        <option value="AddPaymentInfo">AddPaymentInfo</option>
                        <option value="AddToCart">AddToCart</option>
                        <option value="AddToWishlist">AddToWishlist</option>
                        <option value="CompleteRegistration">CompleteRegistration</option>
                        <option value="Contact">Contact</option>
                        <option value="CustomizeProduct">CustomizeProduct</option>
                        <option value="Donate">Donate</option>
                        <option value="FindLocation">FindLocation</option>
                        <option value="InitiateCheckout">InitiateCheckout</option>
                        <option value="PageView">PageView</option>
                        <option value="Schedule">Schedule</option>
                        <option value="Search">Search</option>
                        <option value="StartTrial">StartTrial</option>
                        <option value="SubmitApplication">SubmitApplication</option>
                        <option value="Subscribe">Subscribe</option>
                        <option value="ViewContent">ViewContent</option>
                        <option value="Custom">Personalizado...</option>
                      </select>
                    </div>
                    {urlRuleEventType === 'Custom' && (
                      <div className="md:col-span-3">
                        <label htmlFor="dash-site-url-rule-custom-name" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                          Nome do Evento:
                        </label>
                        <input
                          id="dash-site-url-rule-custom-name"
                          value={urlRuleCustomName}
                          onChange={(e) => setUrlRuleCustomName(e.target.value)}
                          placeholder="Ex: StartTrial"
                          className={inputCls}
                        />
                      </div>
                    )}
                    {eventSupportsValueAndCurrency(urlRuleEventType) && (
                      <div className="md:col-span-3 grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="dash-site-url-rule-event-value" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Valor{urlRuleEventType === 'Purchase' ? ' (obrigatório para Purchase)' : ' (opcional)'}:
                          </label>
                          <input
                            id="dash-site-url-rule-event-value"
                            type="number"
                            step="0.01"
                            value={urlRuleEventValue}
                            onChange={(e) => setUrlRuleEventValue(e.target.value)}
                            placeholder="0.00"
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label htmlFor="dash-site-url-rule-event-currency" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Moeda{urlRuleEventType === 'Purchase' ? ' (obrigatório)' : ' (opcional)'}:
                          </label>
                          <select
                            id="dash-site-url-rule-event-currency"
                            value={urlRuleEventCurrency}
                            onChange={(e) => setUrlRuleEventCurrency(e.target.value)}
                            className={selectCls}
                          >
                            {currencyOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="md:col-span-2 flex gap-2">
                      <button
                        onClick={handleAddUrlRule}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                      >
                        {selectedRuleId ? 'Atualizar' : 'Adicionar'}
                      </button>
                      {selectedRuleId && (
                        <button
                          type="button"
                          onClick={handleCancelEditRule}
                          aria-label="Cancelar edição da regra"
                          className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {eventRules.length > 0 && (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm text-zinc-600 dark:text-zinc-400">
                        <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-xs uppercase font-medium text-zinc-600 dark:text-zinc-500 dark:text-zinc-400">
                          <tr>
                            <th className="px-4 py-3">Regra</th>
                            <th className="px-4 py-3">Valor</th>
                            <th className="px-4 py-3">Evento Disparado</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {eventRules.filter(r => r.rule_type === 'url_contains' || r.rule_type === 'url_equals' || !r.rule_type).map((rule) => (
                            <tr key={rule.id} className="hover:bg-zinc-50 dark:bg-zinc-900/20">
                              <td className="px-4 py-3">URL Contém</td>
                              <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">{rule.match_value}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                  {rule.event_name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right flex justify-end gap-3">
                                <button
                                  onClick={() => handleEditRule(rule)}
                                  className="text-zinc-600 dark:text-zinc-400 hover:text-blue-400 text-xs transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="text-red-400 hover:text-red-300 text-xs transition-colors"
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
              )}

              <hr className="border-zinc-200 dark:border-zinc-800" />

              {eventSubTab === 'button' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Configuração de Eventos por Botão</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-500">
                      Dispare eventos ao clicar em CTAs. Use texto estável, ou critérios estilo Meta (destino do link, classe{' '}
                      <code className="text-xs">btn-cta</code>, seletor CSS). Percentuais dinâmicos no texto (ex.: 75% vs 0%) são
                      tratados como equivalentes no match por texto.
                    </p>
                    <div className="mt-4 space-y-2">
                      <label htmlFor="dash-site-btn-selector-page-url" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        URL da página para abrir o seletor / teste (recomendado)
                      </label>
                      <input
                        id="dash-site-btn-selector-page-url"
                        value={buttonSelectorPageUrl}
                        onChange={(e) => setButtonSelectorPageUrl(e.target.value)}
                        placeholder="https://readlyme.com/higado-vital/"
                        className={inputCls}
                      />
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Cole a URL completa da landing. Se ficar vazio, usamos o <strong>domínio do site</strong> + o campo{' '}
                        <strong>Se a URL contém</strong> abaixo. O seletor precisa de pop-up permitido (sem isso o painel não recebe o clique).
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!pickerOpenUrl}
                        onClick={() => {
                          if (!pickerOpenUrl) return;
                          const w = window.open(pickerOpenUrl, 'ta_trk_pick', TA_AUX_WINDOW_FEATURES);
                          if (!w) {
                            showFlash('Pop-up bloqueado. Permita pop-ups para este painel e tente de novo.', 'error');
                            return;
                          }
                          pickerWinRef.current = w;
                          showFlash('Na janela que abriu, clique no botão. Depois volte aqui e clique em Adicionar.', 'success');
                        }}
                        className={
                          'px-3 py-2 rounded-lg text-xs font-medium border transition-colors ' +
                          (pickerOpenUrl
                            ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                            : 'bg-zinc-200 text-zinc-500 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-500 dark:border-zinc-800')
                        }
                      >
                        Abrir seletor na página (estilo Meta)
                      </button>
                      <button
                        type="button"
                        disabled={!testOpenUrl}
                        onClick={() => {
                          if (!testOpenUrl) return;
                          const w = window.open(testOpenUrl, 'ta_trk_test', TA_AUX_WINDOW_FEATURES);
                          if (!w) {
                            showFlash('Pop-up bloqueado. Permita pop-ups para este painel e tente de novo.', 'error');
                            return;
                          }
                          showFlash('Na janela que abriu, clique no CTA para ver PASSOU/NÃO PASSOU.', 'success');
                        }}
                        className={
                          'px-3 py-2 rounded-lg text-xs font-medium border transition-colors ' +
                          (testOpenUrl
                            ? 'bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950/30 dark:text-zinc-100 dark:border-zinc-800'
                            : 'bg-zinc-200 text-zinc-500 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-500 dark:border-zinc-800')
                        }
                      >
                        Testar regra na página
                      </button>
                      {!pickerOpenUrl && (
                        <span className="text-xs text-zinc-500">
                          Preencha a URL da página acima ou defina o domínio do site + “Se a URL contém”.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-zinc-50 dark:bg-zinc-900/30 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="md:col-span-3">
                      <label htmlFor="dash-site-btn-rule-url" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Se a URL contém:
                      </label>
                      <input
                        id="dash-site-btn-rule-url"
                        value={buttonRuleUrl}
                        onChange={(e) => setButtonRuleUrl(e.target.value)}
                        placeholder="Ex: /higado-vital/ (trecho do caminho, não a URL inteira)"
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label htmlFor="dash-site-btn-rule-text" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Texto do botão contém (opcional):
                      </label>
                      <input
                        id="dash-site-btn-rule-text"
                        value={buttonRuleText}
                        onChange={(e) => setButtonRuleText(e.target.value)}
                        placeholder="Ex: Quiero mis Recetas"
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label htmlFor="dash-site-btn-rule-event-type" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Evento:
                      </label>
                      <select
                        id="dash-site-btn-rule-event-type"
                        value={buttonRuleEventType}
                        onChange={(e) => setButtonRuleEventType(e.target.value)}
                        className={selectCls}
                      >
                        <option value="Purchase">Purchase (Compra)</option>
                        <option value="Lead">Lead (Cadastro)</option>
                        <option value="AddPaymentInfo">AddPaymentInfo</option>
                        <option value="AddToCart">AddToCart</option>
                        <option value="AddToWishlist">AddToWishlist</option>
                        <option value="CompleteRegistration">CompleteRegistration</option>
                        <option value="Contact">Contact</option>
                        <option value="CustomizeProduct">CustomizeProduct</option>
                        <option value="Donate">Donate</option>
                        <option value="FindLocation">FindLocation</option>
                        <option value="InitiateCheckout">InitiateCheckout</option>
                        <option value="PageView">PageView</option>
                        <option value="Schedule">Schedule</option>
                        <option value="Search">Search</option>
                        <option value="StartTrial">StartTrial</option>
                        <option value="SubmitApplication">SubmitApplication</option>
                        <option value="Subscribe">Subscribe</option>
                        <option value="ViewContent">ViewContent</option>
                        <option value="Custom">Personalizado...</option>
                      </select>
                    </div>
                    {buttonRuleEventType === 'Custom' && (
                      <div className="md:col-span-3">
                        <label htmlFor="dash-site-btn-rule-custom-name" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                          Personalizado:
                        </label>
                        <input
                          id="dash-site-btn-rule-custom-name"
                          value={buttonRuleCustomName}
                          onChange={(e) => setButtonRuleCustomName(e.target.value)}
                          placeholder="Ex: Zap"
                          className={inputCls}
                        />
                      </div>
                    )}
                    {eventSupportsValueAndCurrency(buttonRuleEventType) && (
                      <div className="md:col-span-3 grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="dash-site-btn-rule-event-value" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Valor{buttonRuleEventType === 'Purchase' ? ' (obrigatório para Purchase)' : ' (opcional)'}:
                          </label>
                          <input
                            id="dash-site-btn-rule-event-value"
                            type="number"
                            step="0.01"
                            value={buttonRuleEventValue}
                            onChange={(e) => setButtonRuleEventValue(e.target.value)}
                            placeholder="0.00"
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label htmlFor="dash-site-btn-rule-event-currency" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Moeda{buttonRuleEventType === 'Purchase' ? ' (obrigatório)' : ' (opcional)'}:
                          </label>
                          <select
                            id="dash-site-btn-rule-event-currency"
                            value={buttonRuleEventCurrency}
                            onChange={(e) => setButtonRuleEventCurrency(e.target.value)}
                            className={selectCls}
                          >
                            {currencyOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="md:col-span-12 border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-1">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                        Critérios extras (opcionais). Cada campo que você preencher precisa coincidir com o clique (combinação por{' '}
                        <strong>E</strong>). Deixe em branco o que não quiser usar — evita disparar em todos os botões por critério
                        genérico (ex.: só o hostname do site).
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-4">
                          <label htmlFor="dash-site-btn-rule-href" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Link destino contém (href):
                          </label>
                          <input
                            id="dash-site-btn-rule-href"
                            value={buttonRuleHrefContains}
                            onChange={(e) => setButtonRuleHrefContains(e.target.value)}
                            placeholder="Ex: pay.hotmart.com"
                            className={inputCls}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <label htmlFor="dash-site-btn-rule-class" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Classe CSS contém:
                          </label>
                          <input
                            id="dash-site-btn-rule-class"
                            value={buttonRuleClassContains}
                            onChange={(e) => setButtonRuleClassContains(e.target.value)}
                            placeholder="Ex: btn-cta"
                            className={inputCls}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <label htmlFor="dash-site-btn-rule-css" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Seletor CSS (closest):
                          </label>
                          <input
                            id="dash-site-btn-rule-css"
                            value={buttonRuleCss}
                            onChange={(e) => setButtonRuleCss(e.target.value)}
                            placeholder="Ex: a.btn-cta"
                            className={inputCls}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="md:col-span-3 md:col-start-1 flex gap-2">
                      <button
                        onClick={handleAddButtonRule}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                      >
                        {selectedRuleId ? 'Atualizar' : 'Adicionar'}
                      </button>
                      {selectedRuleId && (
                        <button
                          type="button"
                          onClick={handleCancelEditRule}
                          aria-label="Cancelar edição da regra"
                          className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {eventRules.filter(r => r.rule_type === 'button_click').length > 0 && (
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm text-zinc-600 dark:text-zinc-400">
                        <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-xs uppercase font-medium text-zinc-600 dark:text-zinc-500 dark:text-zinc-400">
                          <tr>
                            <th className="px-4 py-3">Página (URL)</th>
                            <th className="px-4 py-3">Critérios</th>
                            <th className="px-4 py-3">Evento Disparado</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {eventRules.filter(r => r.rule_type === 'button_click').map((rule) => (
                            <tr key={rule.id} className="hover:bg-zinc-50 dark:bg-zinc-900/20">
                              <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">{rule.match_value}</td>
                              <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 text-xs">
                                {[
                                  rule.match_text ? `texto: ${rule.match_text}` : null,
                                  rule.parameters?.match_href_contains
                                    ? `href: ${rule.parameters.match_href_contains}`
                                    : null,
                                  rule.parameters?.match_class_contains
                                    ? `classe: ${rule.parameters.match_class_contains}`
                                    : null,
                                  rule.parameters?.match_css ? `css: ${rule.parameters.match_css}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                  {rule.event_name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right flex justify-end gap-3">
                                <button
                                  onClick={() => handleEditRule(rule)}
                                  className="text-zinc-600 dark:text-zinc-400 hover:text-blue-400 text-xs transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="text-red-400 hover:text-red-300 text-xs transition-colors"
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
              )}

              {/* Seção 2: Gerador de Formulário */}
              {eventSubTab === 'form' && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Gerador de Formulário de Captura</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-500">
                      Crie um formulário HTML pronto para instalar no seu site. Ele captura os dados (nome, email, telefone) e dispara o evento escolhido no clique do botão.
                    </p>
                  </div>

                  {/* Saved Forms List */}
                  {savedForms.length > 0 && (
                    <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {savedForms.map(form => (
                        <div key={form.id} className={`relative p-4 rounded-xl border transition-all ${selectedFormId === form.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 hover:border-zinc-700'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-zinc-800 dark:text-zinc-200 truncate pr-6">{form.name}</h4>
                            <button
                              type="button"
                              aria-label={`Excluir formulário ${form.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteForm(form.id);
                              }}
                              className="text-zinc-600 dark:text-zinc-500 hover:text-red-400 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                            </button>
                          </div>
                          <div className="text-[10px] text-zinc-600 dark:text-zinc-500 font-mono mb-3">ID: {form.public_id}</div>
                          <div className="flex gap-2">
                            <button onClick={() => loadFormToEditor(form)} className="flex-1 text-xs bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-300 py-1.5 rounded border border-zinc-700 transition-colors">
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
                      <div className="bg-zinc-50 dark:bg-zinc-900/30 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-5">

                        {/* Form Name */}
                        <div>
                          <label htmlFor="dash-site-form-name" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Nome do Formulário (para salvar)
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="dash-site-form-name"
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

                        <hr className="border-zinc-200 dark:border-zinc-800" />

                        {/* Fields */}
                        <div>
                          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">Campos do Formulário</label>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formFields.name}
                                onChange={(e) => setFormFields(prev => ({ ...prev, name: e.target.checked }))}
                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-blue-500"
                              />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Nome</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formFields.email}
                                onChange={(e) => setFormFields(prev => ({ ...prev, email: e.target.checked }))}
                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-blue-500"
                              />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">E-mail</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formFields.phone}
                                onChange={(e) => setFormFields(prev => ({ ...prev, phone: e.target.checked }))}
                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-blue-500"
                              />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Telefone</span>
                            </label>
                          </div>
                        </div>

                        {/* Theme */}
                        <div>
                          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Tema do Formulário</label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="formTheme"
                                value="light"
                                checked={formTheme === 'light'}
                                onChange={() => setFormTheme('light')}
                                className="w-4 h-4 text-blue-500 bg-zinc-200 dark:bg-zinc-800 border-zinc-700"
                              />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Claro</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="formTheme"
                                value="dark"
                                checked={formTheme === 'dark'}
                                onChange={() => setFormTheme('dark')}
                                className="w-4 h-4 text-blue-500 bg-zinc-200 dark:bg-zinc-800 border-zinc-700"
                              />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Escuro</span>
                            </label>
                          </div>
                        </div>

                        {/* Button Text */}
                        <div>
                          <label htmlFor="dash-site-form-button-text" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Texto do Botão
                          </label>
                          <input
                            id="dash-site-form-button-text"
                            value={formButtonText}
                            onChange={(e) => setFormButtonText(e.target.value)}
                            className={inputCls}
                          />
                        </div>

                        {/* Button Colors */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span id="dash-site-form-btn-bg-label" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                              Cor do Botão
                            </span>
                            <div className="flex gap-2 items-center">
                              <input
                                type="color"
                                aria-labelledby="dash-site-form-btn-bg-label"
                                value={formButtonBgColor}
                                onChange={(e) => setFormButtonBgColor(e.target.value)}
                                className="h-9 w-12 p-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-pointer"
                              />
                              <input
                                id="dash-site-form-btn-bg-hex"
                                aria-labelledby="dash-site-form-btn-bg-label"
                                value={formButtonBgColor}
                                onChange={(e) => setFormButtonBgColor(e.target.value)}
                                className={inputCls}
                                placeholder="#000000"
                              />
                            </div>
                          </div>
                          <div>
                            <span id="dash-site-form-btn-fg-label" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                              Cor do Texto
                            </span>
                            <div className="flex gap-2 items-center">
                              <input
                                type="color"
                                aria-labelledby="dash-site-form-btn-fg-label"
                                value={formButtonTextColor}
                                onChange={(e) => setFormButtonTextColor(e.target.value)}
                                className="h-9 w-12 p-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-pointer"
                              />
                              <input
                                id="dash-site-form-btn-fg-hex"
                                aria-labelledby="dash-site-form-btn-fg-label"
                                value={formButtonTextColor}
                                onChange={(e) => setFormButtonTextColor(e.target.value)}
                                className={inputCls}
                                placeholder="#FFFFFF"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Event Type */}
                        <div>
                          <label htmlFor="dash-site-form-event-type" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Evento ao Enviar
                          </label>
                          <select
                            id="dash-site-form-event-type"
                            value={formEventType}
                            onChange={(e) => setFormEventType(e.target.value)}
                            className={selectCls}
                          >
                            <option value="Purchase">Purchase (Compra)</option>
                            <option value="Lead">Lead (Cadastro)</option>
                            <option value="AddPaymentInfo">AddPaymentInfo</option>
                            <option value="AddToCart">AddToCart</option>
                            <option value="AddToWishlist">AddToWishlist</option>
                            <option value="CompleteRegistration">CompleteRegistration</option>
                            <option value="Contact">Contact</option>
                            <option value="CustomizeProduct">CustomizeProduct</option>
                            <option value="Donate">Donate</option>
                            <option value="FindLocation">FindLocation</option>
                            <option value="InitiateCheckout">InitiateCheckout</option>
                            <option value="PageView">PageView</option>
                            <option value="Schedule">Schedule</option>
                            <option value="Search">Search</option>
                            <option value="StartTrial">StartTrial</option>
                            <option value="SubmitApplication">SubmitApplication</option>
                            <option value="Subscribe">Subscribe</option>
                            <option value="ViewContent">ViewContent</option>
                            <option value="Custom">Personalizado...</option>
                          </select>
                        </div>

                        {formEventType === 'Custom' && (
                          <div>
                            <label htmlFor="dash-site-form-custom-event-name" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                              Nome do Evento
                            </label>
                            <input
                              id="dash-site-form-custom-event-name"
                              value={formCustomEventName}
                              onChange={(e) => setFormCustomEventName(e.target.value)}
                              className={inputCls}
                            />
                          </div>
                        )}

                        {eventSupportsValueAndCurrency(formEventType) && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label htmlFor="dash-site-form-event-value" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                                Valor{formEventType === 'Purchase' ? ' (obrigatório)' : ' (opcional)'}
                              </label>
                              <input
                                id="dash-site-form-event-value"
                                type="number"
                                step="0.01"
                                value={formEventValue}
                                onChange={(e) => setFormEventValue(e.target.value)}
                                placeholder="0.00"
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <label htmlFor="dash-site-form-event-currency" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                                Moeda{formEventType === 'Purchase' ? ' (obrigatório)' : ' (opcional)'}
                              </label>
                              <select
                                id="dash-site-form-event-currency"
                                value={formEventCurrency}
                                onChange={(e) => setFormEventCurrency(e.target.value)}
                                className={selectCls}
                              >
                                {currencyOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}

                        <hr className="border-zinc-200 dark:border-zinc-800" />

                        {/* Post Submit Action */}
                        <div>
                          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">Ação após o cadastro</label>
                          <div className="flex gap-4 mb-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="postSubmitAction" value="message" checked={postSubmitAction === 'message'} onChange={() => setPostSubmitAction('message')} className="w-4 h-4 text-blue-500 bg-zinc-200 dark:bg-zinc-800 border-zinc-700" />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Exibir Mensagem</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="postSubmitAction" value="redirect" checked={postSubmitAction === 'redirect'} onChange={() => setPostSubmitAction('redirect')} className="w-4 h-4 text-blue-500 bg-zinc-200 dark:bg-zinc-800 border-zinc-700" />
                              <span className="text-sm text-zinc-700 dark:text-zinc-300">Redirecionar</span>
                            </label>
                          </div>
                          {postSubmitAction === 'message' ? (
                            <>
                              <label htmlFor="dash-site-form-post-message" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                                Mensagem de agradecimento
                              </label>
                              <textarea
                                id="dash-site-form-post-message"
                                value={postSubmitMessage}
                                onChange={e => setPostSubmitMessage(e.target.value)}
                                className={`${inputCls} min-h-[80px]`}
                                placeholder="Digite a mensagem de agradecimento..."
                              />
                            </>
                          ) : (
                            <>
                              <label htmlFor="dash-site-form-redirect-url" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                                URL de redirecionamento
                              </label>
                              <input
                                id="dash-site-form-redirect-url"
                                value={postSubmitRedirectUrl}
                                onChange={e => setPostSubmitRedirectUrl(e.target.value)}
                                className={inputCls}
                                placeholder="https://..."
                              />
                            </>
                          )}
                        </div>

                        {/* Webhook */}
                        <div>
                          <label htmlFor="dash-site-form-webhook-url" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                            Webhook URL (Opcional)
                          </label>
                          <input
                            id="dash-site-form-webhook-url"
                            value={formWebhookUrl}
                            onChange={e => setFormWebhookUrl(e.target.value)}
                            className={inputCls}
                            placeholder="https://seu-crm.com/webhook..."
                          />
                          <p className="text-[10px] text-zinc-600 dark:text-zinc-500 mt-1">Enviaremos os dados do lead para esta URL via POST JSON.</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-500 uppercase tracking-wider">Prévia Visual (Aproximada)</label>
                      <div className={`p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center min-h-[300px] transition-colors ${formTheme === 'dark' ? 'bg-[#111]' : 'bg-[#f5f5f5]'}`}>
                        <div className={`w-full max-w-xs space-y-3 p-4 rounded shadow-sm transition-colors ${formTheme === 'dark' ? 'bg-black border border-zinc-200 dark:border-zinc-800' : 'bg-white border border-gray-200'}`}>
                          {formFields.name && <div className={`h-10 rounded border px-3 flex items-center text-sm ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>Nome</div>}
                          {formFields.email && <div className={`h-10 rounded border px-3 flex items-center text-sm ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>E-mail</div>}
                          {formFields.phone && (
                            <div className="flex gap-2">
                              <div className={`h-10 rounded border px-3 flex items-center text-sm w-[70px] ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>+55</div>
                              <div className={`h-10 rounded border px-3 flex items-center text-sm flex-1 ${formTheme === 'dark' ? 'bg-[#222] border-[#444] text-white' : 'bg-white border-gray-300 text-gray-500'}`}>Telefone</div>
                            </div>
                          )}
                          <FormPreviewSubmitChip bg={formButtonBgColor} fg={formButtonTextColor}>
                            {formButtonText}
                          </FormPreviewSubmitChip>
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
              )}
            </div>
          )
          }

          {/* ── Tab: Campanhas ── */}
          {
            tab === 'campaigns' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Campanhas</h2>
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500 leading-relaxed">
                    Funil com os mesmos números da Meta. Se acabou de criar a campanha ou mudou o período, use{' '}
                    <strong>Atualizar funil</strong> — os dados são puxados e guardados automaticamente quando precisam.
                  </p>
                </div>

                <CampaignFunnelPanel
                  siteId={id}
                  siteKey={site?.site_key || ''}
                  campaigns={funnelCampaignPicklist}
                  hasMetaConnection={!!meta?.has_facebook_connection}
                  hasAdAccount={!!meta?.ad_account_id}
                  metricsPreset={metricsPreset}
                  metricsSince={metricsSince}
                  metricsUntil={metricsUntil}
                  periodSelector={periodSelector}
                  selectClsCompact={selectClsCompact}
                />

                {!meta?.has_facebook_connection && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-4 text-sm text-zinc-600 dark:text-zinc-500 dark:text-zinc-400">
                    Conecte o Facebook na aba{' '}
                    <button
                      className="text-zinc-700 dark:text-zinc-300 underline underline-offset-2"
                      onClick={() => setTab('meta')}
                    >
                      Meta Ads
                    </button>{' '}
                    para listar campanhas.
                  </div>
                )}

                {meta?.has_facebook_connection && !meta?.ad_account_id && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-4 text-sm text-zinc-600 dark:text-zinc-500 dark:text-zinc-400">
                    Defina a conta de anúncios na aba{' '}
                    <button
                      className="text-zinc-700 dark:text-zinc-300 underline underline-offset-2"
                      onClick={() => setTab('meta')}
                    >
                      Meta Ads
                    </button>{' '}
                    para listar campanhas.
                  </div>
                )}
              </div>
            )
          }

          {/* ── Tab: Compradores ── */}
          {
            tab === 'buyers' && (
              <BuyersTab siteId={id} />
            )
          }

          {/* ── Tab: Webhooks ── */}
          {
            tab === 'webhooks' && (
              <WebhooksTab
                site={site}
                id={String(id)}
                apiBaseUrl={apiBaseUrl}
                webhookSecret={webhookSecret || ''}
                showFlash={showFlash}
              />
            )
          }

          {/* ── Tab: Diagnóstico ── */}
          {
            tab === 'reports' && (
              <div className="max-w-none space-y-4">
                <div className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3">
                  <span className="text-xs font-semibold px-3.5 py-2 rounded-lg border bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100">
                    Análise de campanha
                  </span>
                </div>

                <>
                {campaigns.length > 0 && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Configurar diagnóstico</h3>
                      {selectedCampaign && (
                        <Badge variant={getStatusVariant(selectedCampaign)}>
                          {getStatusLabel(selectedCampaign)}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                      <div>
                        <label htmlFor="dash-site-report-campaign" className="block text-xs font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                          Campanha
                        </label>
                        <select
                          id="dash-site-report-campaign"
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
                          className="bg-zinc-50 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 px-3.5 py-2.5 rounded-lg text-xs transition-colors"
                        >
                          Atualizar
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
                          Filtros UTM (opcional)
                        </h4>
                        <div className="flex items-center gap-2">
                          {savedUtms.length > 0 && (
                            <select
                              aria-label="Carregar configuração UTM salva"
                              className="rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-600 max-w-[240px] truncate"
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
                                aria-label="URL para extrair parâmetros UTM"
                                value={pastedUrl}
                                onChange={(e) => setPastedUrl(e.target.value)}
                                placeholder="https://..."
                                className="w-64 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-600"
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
                                className="p-1.5 rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:text-zinc-200 transition-colors"
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
                              className="text-[11px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
                            >
                              Colar URL
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setDiagnosisUtmSource('{{site_source_name}}');
                              setDiagnosisUtmMedium('paid_social');
                              setDiagnosisUtmCampaign('{{campaign.name}}');
                              setDiagnosisUtmContent('{{ad.name}}');
                              setDiagnosisUtmTerm('{{adset.name}}');
                              setDiagnosisClickId('{{ad.id}}');
                            }}
                            className="text-[11px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2 rounded-lg transition-colors"
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
                              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
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
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Resumo por nível</h3>
                      <span className="text-[11px] text-zinc-600 dark:text-zinc-500">Campanha · Conjunto · Anúncio</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {([
                        { label: 'Campanhas', rows: report.meta_breakdown.campaigns || [] },
                        { label: 'Conjuntos', rows: report.meta_breakdown.adsets || [] },
                        { label: 'Anúncios', rows: report.meta_breakdown.ads || [] },
                      ] as Array<{ label: string; rows: MetaBreakdownItem[] }>).map((group) => (
                        <div key={group.label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40">
                          <div className="px-3.5 py-2.5 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
                            {group.label}
                          </div>
                          <div className="overflow-auto">
                            <table className="w-full text-[11px]">
                              <thead className="bg-zinc-50 dark:bg-zinc-900/60">
                                <tr>
                                  <th className="text-left font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    Nome
                                  </th>
                                  <th className="text-right font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    Spend
                                  </th>
                                  <th className="text-right font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    CTR
                                  </th>
                                  <th className="text-right font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    LP%
                                  </th>
                                  <th className="text-right font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    Res.
                                  </th>
                                  <th className="text-right font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    Custo
                                  </th>
                                  <th className="text-left font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 px-3 py-2">
                                    Gargalo
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.rows.length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="px-3 py-3 text-center text-zinc-600 dark:text-zinc-500">
                                      Sem dados neste nível.
                                    </td>
                                  </tr>
                                )}
                                {group.rows.slice(0, 5).map((row) => (
                                  <tr key={row.id} className="border-t border-zinc-200 dark:border-zinc-800">
                                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[160px] truncate">
                                      {row.name || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                                      {formatMoney(row.spend)}
                                    </td>
                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                                      {formatPercent(getBreakdownCtr(row))}%
                                    </td>
                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                                      {formatPercent(getBreakdownLpRate(row))}%
                                    </td>
                                    <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-300 tabular-nums font-medium">
                                      {formatNumber(getBreakdownResults(row))}
                                    </td>
                                    <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                                      {getBreakdownCpr(row) > 0 ? formatMoney(getBreakdownCpr(row)) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-[10px]">
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
                  <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/20 px-6 py-10 text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800/60 flex items-center justify-center mb-3">
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
                        className="text-zinc-600 dark:text-zinc-500"
                      >
                        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                      </svg>
                    </div>
                    <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Nenhum diagnóstico gerado</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                      Selecione uma campanha e clique em{' '}
                      <span className="text-zinc-600 dark:text-zinc-400">Gerar diagnóstico</span> no canto superior.
                    </div>
                  </div>
                )}

                {report?.analysis_text && (
                  <div className="space-y-3">
                    {visibleReportSections.map((section, index) => (
                      <div
                        key={`${section.title}-${index}`}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 overflow-hidden"
                      >
                        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/40 bg-zinc-50 dark:bg-zinc-900/40">
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</h3>
                        </div>
                        {section.body && (
                          <div className="px-5 py-4 prose prose-invert max-w-none text-sm prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-sm prose-p:text-zinc-600 dark:text-zinc-400 prose-p:leading-relaxed prose-strong:text-zinc-800 dark:text-zinc-200 prose-a:text-blue-400 prose-a:no-underline hover:prose-a:text-blue-300">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={reportMarkdownComponents}>
                              {section.body}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </>
              </div>
            )
          }
        </div >
      </div >
      {showWizard && site && (
        <ReportWizard
          open={showWizard}
          onClose={() => setShowWizard(false)}
          onGenerate={handleWizardGenerate}
          ads={wizardAds.map((a: any) => ({ id: a.id, name: a.name || a.id }))}
          loading={loading}
        />
      )}
    </Layout >
  );
};
