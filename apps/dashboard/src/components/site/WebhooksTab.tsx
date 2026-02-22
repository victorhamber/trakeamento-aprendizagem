import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';

interface WebhooksTabProps {
  site: any;
  id: string;
  apiBaseUrl: string;
  webhookSecret: string;
  showFlash: (msg: string, type?: 'success' | 'error') => void;
}

const WebhooksTab: React.FC<WebhooksTabProps> = ({ site, id, apiBaseUrl, webhookSecret, showFlash }) => {

  const [customWebhooks, setCustomWebhooks] = useState<any[]>([]);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [mappingState, setMappingState] = useState<Record<string, string>>({});

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

  useEffect(() => {
    loadCustomWebhooks();
    loadCheckoutSimulator();
    loadCheckoutWebhookLogs();
  }, [loadCustomWebhooks]);

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
      const res = await api.get(`/sites/${id}/checkout-simulator/webhooks`);
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
      await api.put(`/sites/${id}/custom-webhooks/${hookId}`, {
        name: targetHook.name,
        is_active: true,
        mapping_config: mappingState[hookId] || targetHook.mapping_config
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Hotmart Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 space-y-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4">
              <span className="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Ativo
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#F04E23] flex items-center justify-center shadow-lg shadow-[#F04E23]/20">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.96 2.44c-1.8 0-3.53.5-5.06 1.45l1.62 2.8c1.05-.65 2.23-1 3.44-1 3.53 0 6.4 2.87 6.4 6.4s-2.87 6.4-6.4 6.4c-1.58 0-3.08-.58-4.23-1.63L5.4 19.1c1.78 1.63 4.1 2.53 6.56 2.53 5.37 0 9.74-4.37 9.74-9.74S17.33 2.44 11.96 2.44zM3.86 12.06c0-1.8.5-3.53 1.45-5.06l2.8 1.62c-.65 1.05-1 2.23-1 3.44 0 1.58.58 3.08 1.63 4.23l-2.24 2.24c-1.64-1.78-2.55-4.1-2.55-6.57v.1z" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Hotmart</h4>
                <p className="text-[10px] text-zinc-600 dark:text-zinc-500">Mapeamento automático de PII e UTMs</p>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">URL do Webhook (Copie e cole na Hotmart)</label>
              <div className="flex gap-2">
                <input
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

          {/* Kiwify Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                  <span className="font-bold text-white text-[10px]">Kiwify</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Kiwify</h4>
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-500">Mapeamento automático de PII e UTMs</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Ativo
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">URL do Webhook (Copie e cole na Kiwify)</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  className="flex-1 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 outline-none"
                  value={webhookSecret ? `${apiBaseUrl}/webhooks/kiwify?key=${site?.site_key}&token=${webhookSecret}` : 'Carregando…'}
                />
                <button
                  onClick={() => {
                    const url = `${apiBaseUrl}/webhooks/kiwify?key=${site?.site_key}&token=${webhookSecret}`;
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
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Link base do checkout</label>
              <input
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
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Email</label>
              <input
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                placeholder="lead@email.com"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Telefone</label>
              <input
                value={checkoutPhone}
                onChange={(e) => setCheckoutPhone(e.target.value)}
                placeholder="5511999999999"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Nome</label>
              <input
                value={checkoutFirstName}
                onChange={(e) => setCheckoutFirstName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Sobrenome</label>
              <input
                value={checkoutLastName}
                onChange={(e) => setCheckoutLastName(e.target.value)}
                placeholder="Sobrenome"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">External ID</label>
              <input
                value={checkoutExternalId}
                onChange={(e) => setCheckoutExternalId(e.target.value)}
                placeholder="lead_123"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">FBP</label>
              <input
                value={checkoutFbp}
                onChange={(e) => setCheckoutFbp(e.target.value)}
                placeholder="fb.1.1690000000.123456"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">FBC</label>
              <input
                value={checkoutFbc}
                onChange={(e) => setCheckoutFbc(e.target.value)}
                placeholder="fb.1.1690000000.123456"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">UTM Source</label>
              <input
                value={checkoutUtmSource}
                onChange={(e) => setCheckoutUtmSource(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">UTM Medium</label>
              <input
                value={checkoutUtmMedium}
                onChange={(e) => setCheckoutUtmMedium(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">UTM Campaign</label>
              <input
                value={checkoutUtmCampaign}
                onChange={(e) => setCheckoutUtmCampaign(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">UTM Content</label>
              <input
                value={checkoutUtmContent}
                onChange={(e) => setCheckoutUtmContent(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">UTM Term</label>
              <input
                value={checkoutUtmTerm}
                onChange={(e) => setCheckoutUtmTerm(e.target.value)}
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Valor</label>
              <input
                value={checkoutValue}
                onChange={(e) => setCheckoutValue(e.target.value)}
                placeholder="97.00"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Moeda</label>
              <input
                value={checkoutCurrency}
                onChange={(e) => setCheckoutCurrency(e.target.value)}
                placeholder="BRL"
                className="w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-zinc-600 dark:text-zinc-500 mb-1.5">Link gerado</label>
            <input
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
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Capturas do Webhook</h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">Mostra os últimos eventos de compra registrados.</p>
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
              {checkoutWebhookLogs.map((log, index) => (
                <div key={log.id || index} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{log.platform || 'checkout'}</span>
                    <span>Pedido: {log.order_id || '—'}</span>
                    <span>Status: {log.status || '—'}</span>
                    <span>Valor: {log.amount ? `${log.amount} ${log.currency || ''}` : '—'}</span>
                  </div>
                  <pre className="mt-2 text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words">
                    {JSON.stringify(log.raw_payload || {}, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── CUSTOM INTEGRATIONS ── */}
      <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Integrações Personalizadas</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">Gere webhooks para plataformas não listadas (ex: Braip, Ticto) e mapeie os dados manualmente.</p>
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

              // Funcao recursiva para varrer o JSON e gerar paths pontilhados -> { "buyer.email": "joao@...", "amount": 97 }
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

              const currentMap = mappingState[hook.id] || hook.mapping_config || {};

              const setFieldMap = (field: string, val: string) => {
                setMappingState(prev => ({
                  ...prev,
                  [hook.id]: { ...(prev[hook.id] || hook.mapping_config || {}), [field]: val }
                }));
              };

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
                          readOnly
                          className="flex-1 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 outline-none"
                          value={`${apiBaseUrl}/webhooks/custom/${hook.id}`}
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
                        onClick={() => setEditingWebhookId(isEditing ? null : hook.id)}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                      >
                        {isEditing ? 'Fechar Mapeamento' : (hasPayload ? 'Editar Mapeamento' : 'Configurar')}
                      </button>
                    </div>
                  </div>

                  {/* Builder Area */}
                  {isEditing && (
                    <div className="p-4 bg-white dark:bg-zinc-950">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Campos detectados no último envio</h5>
                          {availableKeys.length === 0 ? (
                            <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded text-center text-[10px] text-zinc-500">
                              Nenhum dado detectado. Envie um webhook de teste primeiro.
                            </div>
                          ) : (
                            <div className="space-y-1 max-h-[300px] overflow-y-auto">
                              {availableKeys.map(key => (
                                <div key={key} className="flex items-center justify-between text-[10px] p-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800">
                                  <code className="text-zinc-600 dark:text-zinc-400">{key}</code>
                                  <span className="text-zinc-400 truncate max-w-[120px]">{String(flatPayload[key])}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Mapeamento para API do Meta</h5>
                          <div className="space-y-3">
                            {[
                              { label: 'E-mail do Cliente', field: 'email' },
                              { label: 'Telefone', field: 'phone' },
                              { label: 'Nome', field: 'first_name' },
                              { label: 'Sobrenome', field: 'last_name' },
                              { label: 'Valor da Compra', field: 'value' },
                              { label: 'Moeda (BRL, USD...)', field: 'currency' },
                              { label: 'ID do Pedido', field: 'order_id' },
                              { label: 'Status da Compra', field: 'status' }
                            ].map(mapField => (
                              <div key={mapField.field}>
                                <label className="block text-[10px] font-medium text-zinc-500 mb-1">{mapField.label}</label>
                                <select
                                  value={currentMap[mapField.field] || ''}
                                  onChange={e => setFieldMap(mapField.field, e.target.value)}
                                  className="w-full rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] outline-none"
                                >
                                  <option value="">-- Selecione o campo --</option>
                                  {availableKeys.map(k => (
                                    <option key={k} value={k}>{k} (Ex: {String(flatPayload[k]).slice(0, 15)})</option>
                                  ))}
                                </select>
                              </div>
                            ))}
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
