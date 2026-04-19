import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { formatDateTimeBrt } from '../../lib/utils';

interface WebhooksTabProps {
  site: any;
  id: string;
  apiBaseUrl: string;
  webhookSecret: string;
  showFlash: (msg: string, type?: 'success' | 'error') => void;
}

/** Exemplo com estrutura aninhada (PIX/boleto pendente) para mapear sem esperar o evento real. */
const CUSTOM_WEBHOOK_SAMPLE_JSON = `{
  "customer": {
    "email": "comprador@exemplo.com",
    "phone": "5511999999999",
    "first_name": "Ana",
    "last_name": "Costa"
  },
  "order": {
    "id": "ord-pix-001",
    "status": "waiting_payment",
    "total": 149.9,
    "currency": "BRL",
    "payment": {
      "method": "PIX"
    }
  }
}`;

const WebhooksTab: React.FC<WebhooksTabProps> = ({ site, id, apiBaseUrl, webhookSecret, showFlash }) => {

  const [customWebhooks, setCustomWebhooks] = useState<any[]>([]);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  /** Por hook id: caminhos JSON → campos Meta (email, value, …). */
  const [mappingState, setMappingState] = useState<Record<string, Record<string, string>>>({});
  const [samplePayloadDraft, setSamplePayloadDraft] = useState<Record<string, string>>({});
  const [samplePayloadLoadingId, setSamplePayloadLoadingId] = useState<string | null>(null);
  /** Padrões quando o webhook (ex.: só boleto) não traz todos os campos — salvos em `mapping_config.defaults`. */
  const [mappingDefaultsState, setMappingDefaultsState] = useState<
    Record<string, Partial<Record<'currency' | 'status' | 'payment_method' | 'phone' | 'first_name' | 'last_name', string>>>
  >({});

  // Checkout Simulator State
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [checkoutGeneratedUrl, setCheckoutGeneratedUrl] = useState('');
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutFirstName, setCheckoutFirstName] = useState('');
  const [checkoutLastName, setCheckoutLastName] = useState('');
  const [checkoutExternalId, setCheckoutExternalId] = useState('');
  const [checkoutFbp, setCheckoutFbp] = useState('');
  const [checkoutFbc, setCheckoutFbc] = useState('');
  const [checkoutUtmSource, setCheckoutUtmSource] = useState('');
  const [checkoutUtmMedium, setCheckoutUtmMedium] = useState('');
  const [checkoutUtmCampaign, setCheckoutUtmCampaign] = useState('');
  const [checkoutUtmContent, setCheckoutUtmContent] = useState('');
  const [checkoutUtmTerm, setCheckoutUtmTerm] = useState('');
  const [checkoutValue, setCheckoutValue] = useState('');
  const [checkoutCurrency, setCheckoutCurrency] = useState('BRL');
  const [checkoutWebhookLogs, setCheckoutWebhookLogs] = useState<any[]>([]);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutLogsBusy, setCheckoutLogsBusy] = useState(false);

  const loadCustomWebhooks = useCallback(async () => {
    try {
      const res = await api.get(`/sites/${id}/custom-webhooks`);
      setCustomWebhooks(res.data.webhooks || []);
    } catch (err) {
      console.error('Failed to load custom webhooks', err);
    }
  }, [id]);

  const fillDummyData = useCallback(() => {
    const ts = Date.now();
    const random = Math.floor(Math.random() * 1000);
    setCheckoutEmail(`teste.${random}@exemplo.com`);
    setCheckoutPhone('5511999999999');
    setCheckoutFirstName('João');
    setCheckoutLastName('Silva');
    setCheckoutExternalId(`lead_${ts}`);
    setCheckoutFbp(`fb.1.${Math.floor(ts / 1000)}.${random}`);
    setCheckoutFbc(`fb.1.${Math.floor(ts / 1000)}.${random}`);
    setCheckoutUtmSource('{{site_source_name}}');
    setCheckoutUtmMedium('cpc');
    setCheckoutUtmCampaign('verao_2024');
    setCheckoutUtmContent('video_review');
    setCheckoutUtmTerm('lookalike_1');
    setCheckoutValue('97.00');
    setCheckoutCurrency('BRL');
  }, []);

  useEffect(() => {
    loadCustomWebhooks();
    loadCheckoutSimulator();
    loadCheckoutWebhookLogs();
    fillDummyData();
  }, [loadCustomWebhooks, fillDummyData]);

  const loadCheckoutSimulator = async () => {
    try {
      const res = await api.get(`/sites/${id}/checkout-simulator`);
      setCheckoutUrl(res.data.checkout_url || '');
    } catch (err) {
      console.error('Failed to load checkout simulator', err);
    }
  };

  const loadCheckoutWebhookLogs = async () => {
    setCheckoutLogsBusy(true);
    try {
      const res = await api.get(`/sites/${id}/checkout-simulator/webhooks`, { params: { limit: 1 } });
      setCheckoutWebhookLogs(res.data.logs || []);
    } catch (err) {
      console.error('Failed to load checkout simulator logs', err);
    } finally {
      setCheckoutLogsBusy(false);
    }
  };

  const saveCheckoutUrl = async () => {
    setCheckoutBusy(true);
    try {
      const res = await api.put(`/sites/${id}/checkout-simulator`, { checkout_url: checkoutUrl.trim() || null });
      setCheckoutUrl(res.data.checkout_url || '');
      showFlash('Link base salvo com sucesso.');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao salvar o link de checkout.', 'error');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const generateCheckoutUrl = async () => {
    setCheckoutBusy(true);
    try {
      const res = await api.post(`/sites/${id}/checkout-simulator/generate`, {
        checkout_url: checkoutUrl.trim() || null,
        email: checkoutEmail || null,
        phone: checkoutPhone || null,
        first_name: checkoutFirstName || null,
        last_name: checkoutLastName || null,
        external_id: checkoutExternalId || null,
        fbp: checkoutFbp || null,
        fbc: checkoutFbc || null,
        utm_source: checkoutUtmSource || null,
        utm_medium: checkoutUtmMedium || null,
        utm_campaign: checkoutUtmCampaign || null,
        utm_content: checkoutUtmContent || null,
        utm_term: checkoutUtmTerm || null,
      });
      setCheckoutGeneratedUrl(res.data.generated_url || '');
      if (res.data.fbp && !checkoutFbp) setCheckoutFbp(res.data.fbp);
      if (res.data.fbc && !checkoutFbc) setCheckoutFbc(res.data.fbc);
      if (res.data.external_id && !checkoutExternalId) setCheckoutExternalId(res.data.external_id);
      showFlash('Link gerado com sucesso.');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao gerar link.', 'error');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const sendCheckoutLead = async () => {
    setCheckoutBusy(true);
    try {
      await api.post(`/sites/${id}/checkout-simulator/lead`, {
        email: checkoutEmail || null,
        phone: checkoutPhone || null,
        first_name: checkoutFirstName || null,
        last_name: checkoutLastName || null,
        external_id: checkoutExternalId || null,
        fbp: checkoutFbp || null,
        fbc: checkoutFbc || null,
        event_source_url: checkoutGeneratedUrl || checkoutUrl || null,
        value: checkoutValue || null,
        currency: checkoutCurrency || null,
      });
      showFlash('Lead enviado para teste via CAPI.');
      loadCheckoutWebhookLogs().catch(() => { });
    } catch (err) {
      console.error(err);
      showFlash('Erro ao disparar lead de teste.', 'error');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCreateCustomWebhook = async () => {
    try {
      const res = await api.post(`/sites/${id}/custom-webhooks`, { name: `Webhook Personalizado ${customWebhooks.length + 1}` });
      setCustomWebhooks([res.data.webhook, ...customWebhooks]);
      showFlash('Webhook criado. Envie um payload de teste para a URL acima!');
    } catch (err) {
      console.error(err);
      showFlash('Erro ao criar webhook', 'error');
    }
  };

  const handleSaveWebhookMapping = async (hookId: string) => {
    try {
      const targetHook = customWebhooks.find(h => h.id === hookId);
      if (!targetHook) return;
      const rawCfg = targetHook.mapping_config;
      const cfgObj =
        rawCfg && typeof rawCfg === 'object' && !Array.isArray(rawCfg)
          ? (rawCfg as Record<string, unknown>)
          : {};
      const { defaults: _oldDef, ...pathKeysFromDb } = cfgObj;
      const merged = { ...pathKeysFromDb, ...(mappingState[hookId] || {}) } as Record<string, unknown>;
      const paths: Record<string, string> = {};
      for (const [k, v] of Object.entries(merged)) {
        if (k === 'defaults' || typeof v !== 'string') continue;
        const t = v.trim();
        if (t) paths[k] = t;
      }
      const def = mappingDefaultsState[hookId] || {};
      const defaults: Record<string, string> = {};
      (['currency', 'status', 'payment_method', 'phone', 'first_name', 'last_name'] as const).forEach(k => {
        const v = def[k]?.trim();
        if (v) defaults[k] = v;
      });
      const mapping_config =
        Object.keys(defaults).length > 0 ? { ...paths, defaults } : { ...paths };
      await api.put(`/sites/${id}/custom-webhooks/${hookId}`, {
        name: targetHook.name,
        is_active: true,
        mapping_config
      });
      showFlash('Mapeamento salvo e ativado!');
      loadCustomWebhooks();
      setEditingWebhookId(null);
    } catch (err) {
      console.error(err);
      showFlash('Erro ao salvar mapeamento', 'error');
    }
  };

  const handleDeleteWebhook = async (hookId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este webhook? Isso interromperá o envio de eventos.')) return;
    try {
      await api.delete(`/sites/${id}/custom-webhooks/${hookId}`);
      showFlash('Webhook excluído com sucesso!');
      loadCustomWebhooks();
      if (editingWebhookId === hookId) setEditingWebhookId(null);
    } catch (err) {
      console.error(err);
      showFlash('Erro ao excluir webhook', 'error');
    }
  };

  const handleLoadSamplePayload = async (hookId: string) => {
    const text = samplePayloadDraft[hookId] ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      showFlash('JSON inválido. Confira vírgulas, aspas e chaves.', 'error');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      showFlash('A raiz precisa ser um objeto JSON { ... }, não array ou texto.', 'error');
      return;
    }
    setSamplePayloadLoadingId(hookId);
    try {
      await api.post(`/sites/${id}/custom-webhooks/${hookId}/sample-payload`, { payload: parsed });
      showFlash('Payload de exemplo carregado. Ajuste o mapeamento à direita.');
      await loadCustomWebhooks();
    } catch (err) {
      console.error(err);
      showFlash('Erro ao carregar o exemplo.', 'error');
    } finally {
      setSamplePayloadLoadingId(null);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Hub de Integrações (Webhooks)</h2>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-500">
          Conecte suas plataformas de vendas para enviar os eventos de compra (Purchase) direto para a API de Conversões do Meta.
        </p>
      </div>

      {/* ── NATIVE INTEGRATIONS ── */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Integrações Nativas</h3>
        <div className="grid grid-cols-1 gap-4">

          {/* Hotmart Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 space-y-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4">
              <span className="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Ativo
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden shadow-lg shadow-[#F04E23]/20">
                <img src="/hotmart.jpg" alt="Hotmart" className="w-full h-full object-cover" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Hotmart</h4>
                <p className="text-[10px] text-zinc-600 dark:text-zinc-500">Mapeamento automático de PII e UTMs</p>
              </div>
            </div>

            <div>
              <label htmlFor="dash-webhook-hotmart-url" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                URL do Webhook (Copie e cole na Hotmart)
              </label>
              <div className="flex gap-2">
                <input
                  id="dash-webhook-hotmart-url"
                  readOnly
                  className="flex-1 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 outline-none"
                  value={webhookSecret ? `${apiBaseUrl}/webhooks/hotmart?key=${site?.site_key}&token=${webhookSecret}` : 'Carregando…'}
                />
                <button
                  onClick={() => {
                    const url = `${apiBaseUrl}/webhooks/hotmart?key=${site?.site_key}&token=${webhookSecret}`;
                    navigator.clipboard.writeText(url);
                    showFlash('URL copiada!');
                  }}
                  className="flex items-center gap-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-300 px-3 py-2 rounded-lg text-xs transition-colors shrink-0"
                >
                  Copiar
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <div>
          <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Simulador de Checkout</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">
            Gere um link personalizado com UTMs/PII e valide o fluxo Pixel → CAPI → Webhook.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label htmlFor="dash-checkout-sim-base-url" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Link base do checkout
              </label>
              <input
                id="dash-checkout-sim-base-url"
                value={checkoutUrl}
                onChange={(e) => setCheckoutUrl(e.target.value)}
                placeholder="https://plataforma.com/checkout/123"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={saveCheckoutUrl}
                disabled={checkoutBusy}
                className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
              >
                Salvar URL
              </button>
              <button
                onClick={fillDummyData}
                disabled={checkoutBusy}
                className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                Preencher
              </button>
              <button
                onClick={generateCheckoutUrl}
                disabled={checkoutBusy}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
              >
                Gerar link
              </button>
              <button
                onClick={sendCheckoutLead}
                disabled={checkoutBusy}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
              >
                Disparar Lead
              </button>
              {checkoutGeneratedUrl && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(checkoutGeneratedUrl);
                    showFlash('Link copiado!');
                  }}
                  className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  Copiar link
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="dash-checkout-sim-email" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Email
              </label>
              <input
                id="dash-checkout-sim-email"
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                placeholder="lead@email.com"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-phone" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Telefone
              </label>
              <input
                id="dash-checkout-sim-phone"
                value={checkoutPhone}
                onChange={(e) => setCheckoutPhone(e.target.value)}
                placeholder="5511999999999"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-first-name" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Nome
              </label>
              <input
                id="dash-checkout-sim-first-name"
                value={checkoutFirstName}
                onChange={(e) => setCheckoutFirstName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-last-name" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Sobrenome
              </label>
              <input
                id="dash-checkout-sim-last-name"
                value={checkoutLastName}
                onChange={(e) => setCheckoutLastName(e.target.value)}
                placeholder="Sobrenome"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="dash-checkout-sim-external-id" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                External ID
              </label>
              <input
                id="dash-checkout-sim-external-id"
                value={checkoutExternalId}
                onChange={(e) => setCheckoutExternalId(e.target.value)}
                placeholder="lead_123"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-fbp" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                FBP
              </label>
              <input
                id="dash-checkout-sim-fbp"
                value={checkoutFbp}
                onChange={(e) => setCheckoutFbp(e.target.value)}
                placeholder="fb.1.1690000000.123456"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-fbc" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                FBC
              </label>
              <input
                id="dash-checkout-sim-fbc"
                value={checkoutFbc}
                onChange={(e) => setCheckoutFbc(e.target.value)}
                placeholder="fb.1.1690000000.123456"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label htmlFor="dash-checkout-sim-utm-source" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                UTM Source
              </label>
              <input
                id="dash-checkout-sim-utm-source"
                value={checkoutUtmSource}
                onChange={(e) => setCheckoutUtmSource(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-utm-medium" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                UTM Medium
              </label>
              <input
                id="dash-checkout-sim-utm-medium"
                value={checkoutUtmMedium}
                onChange={(e) => setCheckoutUtmMedium(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-utm-campaign" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                UTM Campaign
              </label>
              <input
                id="dash-checkout-sim-utm-campaign"
                value={checkoutUtmCampaign}
                onChange={(e) => setCheckoutUtmCampaign(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-utm-content" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                UTM Content
              </label>
              <input
                id="dash-checkout-sim-utm-content"
                value={checkoutUtmContent}
                onChange={(e) => setCheckoutUtmContent(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-utm-term" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                UTM Term
              </label>
              <input
                id="dash-checkout-sim-utm-term"
                value={checkoutUtmTerm}
                onChange={(e) => setCheckoutUtmTerm(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="dash-checkout-sim-value" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Valor
              </label>
              <input
                id="dash-checkout-sim-value"
                value={checkoutValue}
                onChange={(e) => setCheckoutValue(e.target.value)}
                placeholder="97.00"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label htmlFor="dash-checkout-sim-currency" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
                Moeda
              </label>
              <input
                id="dash-checkout-sim-currency"
                value={checkoutCurrency}
                onChange={(e) => setCheckoutCurrency(e.target.value)}
                placeholder="BRL"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="dash-checkout-sim-generated-url" className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">
              Link gerado
            </label>
            <input
              id="dash-checkout-sim-generated-url"
              readOnly
              value={checkoutGeneratedUrl || ''}
              className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 outline-none"
              placeholder="Clique em gerar para ver o link personalizado"
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Última Captura do Webhook</h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">
                Ordena pelo último POST recebido — um segundo webhook do mesmo pedido (ex.: boleto e depois aprovado) atualiza este registro e sobe para o topo.
              </p>
            </div>
            <button
              onClick={loadCheckoutWebhookLogs}
              disabled={checkoutLogsBusy}
              className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
            >
              Atualizar
            </button>
          </div>

          {checkoutWebhookLogs.length === 0 ? (
            <div className="text-xs text-zinc-600 dark:text-zinc-500">
              Nenhuma compra capturada ainda.
            </div>
          ) : (
            <div className="space-y-3">
              {checkoutWebhookLogs.map((log, index) => {
                const capi = log.raw_payload?._capi_debug;
                const hasUser = !!(log.buyer_email_hash || log.customer_email || (capi?.user_data?.em && capi.user_data.em.length > 0));
                const hasPixel = !!(log.fbp || log.fbc || capi?.user_data?.fbp || capi?.user_data?.fbc);
                let statusColor = 'bg-red-500';
                let statusTitle = 'Dados insuficientes (Falta Email e FBP/FBC)';

                if (hasUser && hasPixel) {
                  statusColor = 'bg-emerald-500';
                  statusTitle = 'Dados completos (Email + FBP/FBC)';
                } else if (hasUser || hasPixel) {
                  statusColor = 'bg-amber-500';
                  statusTitle = 'Dados parciais (Falta Email ou FBP/FBC)';
                }

                return (
                  <details key={log.id || index} className="group rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden" open>
                    <summary className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-600 dark:text-zinc-400">
                        <div className="flex items-center gap-2" title={statusTitle}>
                          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                          <span className="font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">{log.platform || 'checkout'}</span>
                        </div>
                        <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
                        <span>Pedido: <span className="font-medium text-zinc-700 dark:text-zinc-300">{log.order_id || '—'}</span></span>
                        <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
                        <span>Valor: <span className="font-medium text-zinc-700 dark:text-zinc-300">{log.amount ? `${log.amount} ${log.currency || ''}` : '—'}</span></span>
                        <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
                        <span className="text-zinc-500 uppercase text-[9px] font-bold border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-900">
                          {log.status === 'approved' ? 'Aprovado' : (log.status === 'refunded' ? 'Reembolso' : (log.status || 'Pendente'))}
                        </span>
                        <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
                        <span
                          className="text-zinc-400"
                          title={log.updated_at ? 'Horário do último POST (mesmo pedido pode atualizar)' : undefined}
                        >
                          {formatDateTimeBrt(log.updated_at || log.created_at)}
                        </span>
                      </div>
                      <svg className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </summary>
                    <div className="border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/30 p-4">

                      {/* CAPI Debug Visualization */}
                      {capi && (
                        <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/30 dark:bg-indigo-900/10">
                          <div className="mb-3 flex items-center gap-2">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                            </div>
                            <h5 className="text-xs font-semibold text-indigo-900 dark:text-indigo-300">
                              Dados Mapeados para Meta CAPI
                            </h5>
                          </div>

                          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                            {/* User Data Section */}
                            <div>
                              <h6 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-400 dark:text-indigo-500">Dados do Usuário (Advanced Matching)</h6>
                              <div className="space-y-1.5">
                                {[
                                  { label: 'Email (Hash)', val: capi.user_data?.em },
                                  { label: 'Telefone (Hash)', val: capi.user_data?.ph },
                                  { label: 'Nome (Hash)', val: capi.user_data?.fn },
                                  { label: 'Sobrenome (Hash)', val: capi.user_data?.ln },
                                  { label: 'External ID', val: capi.user_data?.external_id, isHash: true }, // Usually hashed too
                                  { label: 'FBP (Browser ID)', val: capi.user_data?.fbp, raw: true },
                                  { label: 'FBC (Click ID)', val: capi.user_data?.fbc, raw: true },
                                  { label: 'IP do Cliente', val: capi.user_data?.client_ip_address, raw: true },
                                  { label: 'User Agent', val: capi.user_data?.client_user_agent, raw: true, truncate: true },
                                ].map((field, i) => (
                                  <div key={i} className="flex items-center justify-between text-[10px]">
                                    <span className="text-zinc-500 dark:text-zinc-400">{field.label}:</span>
                                    <span className={`font-mono max-w-[150px] truncate ${field.val ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-zinc-300 dark:text-zinc-700'}`}>
                                      {field.val ? (field.raw ? (field.truncate ? field.val.substring(0, 20) + '...' : field.val) : '✓ Mapeado') : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Event Data Section */}
                            <div>
                              <h6 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-400 dark:text-indigo-500">Dados do Evento</h6>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-zinc-500 dark:text-zinc-400">Evento:</span>
                                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-medium">{capi.event_name}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-zinc-500 dark:text-zinc-400">Valor:</span>
                                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{capi.custom_data?.value}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-zinc-500 dark:text-zinc-400">Moeda:</span>
                                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{capi.custom_data?.currency}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="text-zinc-500 dark:text-zinc-400">URL Origem:</span>
                                  <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate max-w-[150px]" title={capi.event_source_url}>{capi.event_source_url || '—'}</span>
                                </div>
                                <div className="pt-2 mt-2 border-t border-indigo-100 dark:border-indigo-900/30">
                                  <span className="block text-[9px] font-medium text-indigo-400 mb-1">Parâmetros UTM:</span>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                    {['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map(utm => (
                                      <div key={utm} className="flex justify-between text-[9px]">
                                        <span className="text-zinc-400 shrink-0 mr-2">{utm.replace('utm_', '')}:</span>
                                        <span
                                          className={`font-mono truncate ${capi.custom_data?.[utm] ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-300 dark:text-zinc-700'}`}
                                          title={String(capi.custom_data?.[utm] || '')}
                                        >
                                          {capi.custom_data?.[utm] || '-'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Payload Original (JSON)</span>
                      </div>
                      <pre className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words font-mono bg-white dark:bg-zinc-950 p-3 rounded border border-zinc-200 dark:border-zinc-800">
                        {JSON.stringify(log.raw_payload || {}, null, 2)}
                      </pre>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── CUSTOM INTEGRATIONS ── */}
      <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Integrações Personalizadas</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">
              Para Monetizze, Kiwify, Ticto, Caketo, Braip e outras: a URL grava o <strong className="text-zinc-600 dark:text-zinc-400">JSON inteiro</strong> do último POST. Use o corpo bruto para achar as chaves e preencher o mapeamento à direita.
            </p>
          </div>
          <button
            onClick={handleCreateCustomWebhook}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Criar Webhook
          </button>
        </div>

        {customWebhooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-600 dark:text-zinc-500 text-xs">
            Nenhum webhook personalizado criado ainda.
          </div>
        ) : (
          <div className="space-y-4">
            {customWebhooks.map(hook => {
              const isEditing = editingWebhookId === hook.id;
              const hasPayload = hook.last_payload && Object.keys(hook.last_payload).length > 0;

              const flattenObject = (obj: any, prefix = ''): Record<string, any> => {
                return Object.keys(obj || {}).reduce((acc: any, k: string) => {
                  const pre = prefix.length ? prefix + '.' : '';
                  if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
                    Object.assign(acc, flattenObject(obj[k], pre + k));
                  } else {
                    acc[pre + k] = obj[k];
                  }
                  return acc;
                }, {});
              };
              const flatPayload = hasPayload ? flattenObject(hook.last_payload) : {};
              const availableKeys = Object.keys(flatPayload).sort();

              const cfgFromHook = hook.mapping_config;
              const normalizedHookCfg =
                cfgFromHook && typeof cfgFromHook === 'object' && !Array.isArray(cfgFromHook)
                  ? (cfgFromHook as Record<string, unknown>)
                  : {};
              const rawStored: Record<string, unknown> = {
                ...normalizedHookCfg,
                ...(mappingState[hook.id] || {}),
              };
              const { defaults: _omitDef, ...currentMapUnknown } = rawStored;
              const currentMap = currentMapUnknown as Record<string, string>;

              const mappingDefaultsRow =
                mappingDefaultsState[hook.id] ??
                (() => {
                  const d = (hook.mapping_config as { defaults?: Record<string, string> } | undefined)?.defaults;
                  return {
                    currency: d?.currency?.trim() || 'BRL',
                    status: d?.status?.trim() || '',
                    payment_method: d?.payment_method?.trim() || '',
                    phone: d?.phone?.trim() || '',
                    first_name: d?.first_name?.trim() || '',
                    last_name: d?.last_name?.trim() || '',
                  };
                })();

              const setFieldMap = (field: string, val: string) => {
                setMappingState(prev => {
                  const cfg = hook.mapping_config || {};
                  const { defaults: _, ...restFromHook } = cfg as Record<string, unknown>;
                  const prevPaths = (prev[hook.id] || {}) as Record<string, unknown>;
                  const { defaults: __, ...restFromPrev } = prevPaths;
                  return { ...prev, [hook.id]: { ...restFromHook, ...restFromPrev, [field]: val } as Record<string, string> };
                });
              };

              const setDefaultField = (key: keyof typeof mappingDefaultsRow, val: string) => {
                setMappingDefaultsState(prev => ({
                  ...prev,
                  [hook.id]: { ...mappingDefaultsRow, ...prev[hook.id], [key]: val },
                }));
              };

              const fullPayloadJson = hasPayload ? JSON.stringify(hook.last_payload, null, 2) : '';

              return (
                <div key={hook.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
                  {/* Header do Webhook */}
                  <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${hook.is_active ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <div>
                        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{hook.name}</h4>
                        <p className="text-[10px] text-zinc-600 dark:text-zinc-500">{hook.is_active ? 'Ativo e processando' : 'Aguardando mapeamento / Teste'}</p>
                      </div>
                    </div>

                    <div className="flex-1 max-w-lg">
                      <div className="flex gap-2">
                        <input
                          id={`dash-custom-webhook-url-${hook.id}`}
                          readOnly
                          className="flex-1 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 outline-none"
                          value={`${apiBaseUrl}/webhooks/custom/${hook.id}`}
                          aria-label={`URL do webhook personalizado ${hook.name}`}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${apiBaseUrl}/webhooks/custom/${hook.id}`);
                            showFlash('URL copiada!');
                          }}
                          className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-300 px-3 py-1.5 rounded-md text-xs transition-colors shrink-0"
                        >
                          Copiar URL
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleDeleteWebhook(hook.id)}
                        className="text-zinc-600 dark:text-zinc-500 hover:text-red-400 p-1"
                        title="Excluir Webhook"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6L17.14 19.89A2 2 0 0 1 15.15 21H8.85a2 2 0 0 1-1.99-1.11L5 6m4 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></svg>
                      </button>
                      <button
                        onClick={() => {
                          if (isEditing) {
                            setEditingWebhookId(null);
                          } else {
                            setEditingWebhookId(hook.id);
                            const cfg = hook.mapping_config || {};
                            const { defaults, ...pathsOnly } = cfg as Record<string, unknown> & {
                              defaults?: Partial<
                                Record<'currency' | 'status' | 'payment_method' | 'phone' | 'first_name' | 'last_name', string>
                              >;
                            };
                            setMappingState(prev => ({ ...prev, [hook.id]: pathsOnly as Record<string, string> }));
                            setMappingDefaultsState(prev => ({
                              ...prev,
                              [hook.id]: {
                                currency: defaults?.currency?.trim() || 'BRL',
                                status: defaults?.status?.trim() || '',
                                payment_method: defaults?.payment_method?.trim() || '',
                                phone: defaults?.phone?.trim() || '',
                                first_name: defaults?.first_name?.trim() || '',
                                last_name: defaults?.last_name?.trim() || '',
                              },
                            }));
                            setSamplePayloadDraft(prev => ({
                              ...prev,
                              [hook.id]:
                                hook.last_payload && Object.keys(hook.last_payload).length > 0
                                  ? JSON.stringify(hook.last_payload, null, 2)
                                  : CUSTOM_WEBHOOK_SAMPLE_JSON,
                            }));
                          }
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                      >
                        {isEditing ? 'Fechar Mapeamento' : (hasPayload ? 'Editar Mapeamento' : 'Configurar')}
                      </button>
                    </div>
                  </div>

                  {/* Builder Area */}
                  {isEditing && (
                    <div className="p-4 bg-white dark:bg-zinc-950">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                        <div className="flex flex-col min-h-0 md:min-h-[min(72vh,780px)]">
                          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-1 shrink-0">JSON bruto (último POST)</h5>
                          <p className="text-[10px] text-zinc-500 mb-2 shrink-0">
                            Única referência do corpo recebido na URL do webhook. Copie para o ChatGPT se quiser; à direita, escolha na lista ou digite o caminho (ex.:{' '}
                            <code className="text-zinc-600 dark:text-zinc-400">data.customer.email</code>).
                          </p>
                          {!hasPayload ? (
                            <div className="space-y-3">
                              <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded text-[10px] text-zinc-500 space-y-2">
                                <p>Ainda não há POST gravado. Envie um teste pela plataforma para esta URL ou cole abaixo um JSON de exemplo (log da Monetizze, Ticto, etc.) e carregue.</p>
                              </div>
                              <label htmlFor={`dash-sample-json-${hook.id}`} className="block text-[10px] font-medium text-zinc-500 mb-1">
                                Colar JSON bruto e carregar
                              </label>
                              <textarea
                                id={`dash-sample-json-${hook.id}`}
                                rows={10}
                                value={samplePayloadDraft[hook.id] ?? ''}
                                onChange={e => setSamplePayloadDraft(prev => ({ ...prev, [hook.id]: e.target.value }))}
                                className="w-full rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[10px] font-mono text-zinc-700 dark:text-zinc-300 outline-none resize-y min-h-[120px]"
                                spellCheck={false}
                              />
                              <button
                                type="button"
                                disabled={samplePayloadLoadingId === hook.id}
                                onClick={() => handleLoadSamplePayload(hook.id)}
                                className="w-full bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50 text-zinc-800 dark:text-zinc-200 py-2 rounded-lg text-xs font-medium transition-colors"
                              >
                                {samplePayloadLoadingId === hook.id ? 'Carregando…' : 'Carregar JSON bruto'}
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-2 mb-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(fullPayloadJson);
                                    showFlash('JSON completo copiado.');
                                  }}
                                  className="text-[10px] px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                >
                                  Copiar JSON inteiro
                                </button>
                              </div>
                              <pre className="flex-1 min-h-0 text-[10px] leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words font-mono bg-zinc-50 dark:bg-zinc-950 p-3 rounded border border-zinc-200 dark:border-zinc-800 overflow-auto">
                                {fullPayloadJson}
                              </pre>
                            </>
                          )}
                        </div>

                        <div className="flex flex-col min-h-0 md:min-h-[min(72vh,780px)]">
                          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3 shrink-0">Mapeamento para API do Meta</h5>
                          <p className="text-[10px] text-zinc-500 mb-3 shrink-0">
                            Em cada campo: use o menu <strong className="text-zinc-600 dark:text-zinc-400">Escolher na lista</strong> (caminhos detectados no JSON) ou digite/ajuste no campo de texto (ex.: valor do ChatGPT). Ctrl+F no JSON à esquerda ajuda a achar trechos. Deixe vazio se for opcional. Onde o POST não trouxer dado, use os{' '}
                            <strong className="text-zinc-600 dark:text-zinc-400">padrões</strong> abaixo.
                          </p>
                          <div className="space-y-3 shrink-0">
                            {[
                              { label: 'E-mail do Cliente', field: 'email' },
                              { label: 'Telefone', field: 'phone' },
                              { label: 'Nome', field: 'first_name' },
                              { label: 'Sobrenome', field: 'last_name' },
                              { label: 'Valor da Compra', field: 'value' },
                              { label: 'Moeda (BRL, USD...)', field: 'currency' },
                              { label: 'ID do Pedido', field: 'order_id' },
                              { label: 'Status da Compra', field: 'status' },
                              { label: 'Método de pagamento (PIX / boleto — título do push)', field: 'payment_method' }
                            ].map(mapField => {
                              const pathVal =
                                typeof currentMap[mapField.field] === 'string' ? currentMap[mapField.field] : '';
                              const listMatch = hasPayload && availableKeys.includes(pathVal);
                              return (
                                <div key={mapField.field}>
                                  <span className="block text-[10px] font-medium text-zinc-500 mb-1">{mapField.label}</span>
                                  {hasPayload && availableKeys.length > 0 ? (
                                    <select
                                      id={`dash-webhook-pick-${hook.id}-${mapField.field}`}
                                      value={listMatch ? pathVal : ''}
                                      onChange={e => setFieldMap(mapField.field, e.target.value)}
                                      className="w-full rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-[11px] outline-none mb-1"
                                      aria-label={`${mapField.label} — escolher caminho na lista`}
                                    >
                                      <option value="">— Escolher na lista (opcional) —</option>
                                      {availableKeys.map(k => (
                                        <option key={k} value={k}>
                                          {k}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                  <label htmlFor={`dash-webhook-map-${hook.id}-${mapField.field}`} className="sr-only">
                                    {mapField.label} — caminho (editar)
                                  </label>
                                  <input
                                    type="text"
                                    id={`dash-webhook-map-${hook.id}-${mapField.field}`}
                                    value={pathVal}
                                    onChange={e => setFieldMap(mapField.field, e.target.value)}
                                    placeholder="Digite o caminho (ex.: data.customer.email)"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] outline-none font-mono text-zinc-800 dark:text-zinc-200"
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/50 space-y-2">
                            <h6 className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                              Padrões se o JSON não trouxer o campo
                            </h6>
                            <p className="text-[9px] text-zinc-500">
                              Útil em webhooks só de boleto/PIX gerado. E-mail não tem padrão (Meta precisa de dado real ou hash alternativo).
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-cur-${hook.id}`}>Moeda</label>
                                <input
                                  id={`dash-def-cur-${hook.id}`}
                                  value={mappingDefaultsRow.currency}
                                  onChange={e => setDefaultField('currency', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                  placeholder="BRL"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-st-${hook.id}`}>Status</label>
                                <input
                                  id={`dash-def-st-${hook.id}`}
                                  value={mappingDefaultsRow.status}
                                  onChange={e => setDefaultField('status', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                  placeholder="waiting_payment"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-pm-${hook.id}`}>Método de pagamento</label>
                                <input
                                  id={`dash-def-pm-${hook.id}`}
                                  value={mappingDefaultsRow.payment_method}
                                  onChange={e => setDefaultField('payment_method', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                  placeholder="BOLETO"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-ph-${hook.id}`}>Telefone</label>
                                <input
                                  id={`dash-def-ph-${hook.id}`}
                                  value={mappingDefaultsRow.phone}
                                  onChange={e => setDefaultField('phone', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                  placeholder="5511999999999"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-fn-${hook.id}`}>Nome</label>
                                <input
                                  id={`dash-def-fn-${hook.id}`}
                                  value={mappingDefaultsRow.first_name}
                                  onChange={e => setDefaultField('first_name', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-zinc-500 mb-0.5" htmlFor={`dash-def-ln-${hook.id}`}>Sobrenome</label>
                                <input
                                  id={`dash-def-ln-${hook.id}`}
                                  value={mappingDefaultsRow.last_name}
                                  onChange={e => setDefaultField('last_name', e.target.value)}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px]"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                              onClick={() => handleSaveWebhookMapping(hook.id)}
                              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-medium transition-colors"
                            >
                              Salvar e Ativar Mapeamento
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WebhooksTab;
