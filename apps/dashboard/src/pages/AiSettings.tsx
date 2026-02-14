import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type Settings = {
  has_openai_key: boolean;
  openai_model: string;
};

export const AiSettingsPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    const res = await api.get('/ai/settings');
    setSettings(res.data);
    setOpenaiModel(res.data.openai_model || 'gpt-4o');
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFlash(null);
    try {
      await api.put('/ai/settings', { openai_api_key: openaiApiKey || undefined, openai_model: openaiModel });
      setOpenaiApiKey('');
      await load();
      setFlash('Chave salva com sucesso. A IA já pode gerar diagnósticos.');
    } catch (err: any) {
      setFlash(err?.response?.data?.error || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    setFlash(null);
    try {
      await api.delete('/ai/settings/openai_key');
      await load();
      setFlash('Chave removida.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Assistente IA">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="text-sm font-semibold">OpenAI (ChatGPT)</div>
          <div className="mt-1 text-xs text-zinc-500">
            Cada cliente usa a própria chave. Nós armazenamos de forma criptografada e não exibimos a chave completa.
          </div>

          {flash && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
              {flash}
            </div>
          )}

          <form onSubmit={save} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs text-zinc-400">Status</label>
              <div className="mt-1 text-sm">
                {settings?.has_openai_key ? (
                  <span className="text-emerald-400">Ativo (chave configurada)</span>
                ) : (
                  <span className="text-zinc-400">Inativo (adicione uma chave para ativar)</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400">Modelo</label>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                >
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400">Chave API</label>
                <input
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                  placeholder={settings?.has_openai_key ? '•••••••••••• (preencha para substituir)' : 'sk-...'}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              {settings?.has_openai_key && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={clearKey}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
                >
                  Remover chave
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="text-sm font-semibold">Como funciona</div>
          <div className="mt-3 space-y-3 text-sm text-zinc-300">
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">Diagnóstico IA</div>
              <div className="mt-1">O sistema substitui as métricas tradicionais por um relatório em linguagem natural.</div>
            </div>
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">Segurança</div>
              <div className="mt-1">A chave é criptografada no banco e nunca é retornada para o browser.</div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

