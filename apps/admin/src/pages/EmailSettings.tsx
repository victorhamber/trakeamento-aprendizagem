import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type EmailSettings = {
  from_email: string | null;
  from_name: string | null;
  welcome_subject: string | null;
  welcome_html: string | null;
  reset_subject: string | null;
  reset_html: string | null;
  has_api_key: boolean;
};

export const EmailSettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [welcomeSubject, setWelcomeSubject] = useState('');
  const [welcomeHtml, setWelcomeHtml] = useState('');
  const [resetSubject, setResetSubject] = useState('');
  const [resetHtml, setResetHtml] = useState('');

  const load = async () => {
    try {
      const res = await api.get<EmailSettings>('/admin/email-settings');
      const data = res.data;
      setHasApiKey(Boolean(data.has_api_key));
      setFromEmail(data.from_email || '');
      setFromName(data.from_name || '');
      setWelcomeSubject(data.welcome_subject || '');
      setWelcomeHtml(data.welcome_html || '');
      setResetSubject(data.reset_subject || '');
      setResetHtml(data.reset_html || '');
    } catch (err) {
      // silent, form já vem com defaults
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        api_key: apiKey || undefined,
        from_email: fromEmail || undefined,
        from_name: fromName || undefined,
        welcome_subject: welcomeSubject || undefined,
        welcome_html: welcomeHtml || undefined,
        reset_subject: resetSubject || undefined,
        reset_html: resetHtml || undefined,
      };

      const res = await api.put<EmailSettings>('/admin/email-settings', payload);
      setHasApiKey(Boolean(res.data.has_api_key));
      setApiKey('');
      alert('Configurações de email atualizadas com sucesso.');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="Configurações de E-mail">
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
        <div className="xl:col-span-3">
          <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-6 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-1">
              Provedor e Remetente
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              Configure aqui o token da API e o remetente usado para todos os emails transacionais
              (boas-vindas e recuperação de senha).
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Token da API Resend
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasApiKey ? '••••••••••••••••••••' : 're_...'}
                    className="flex-1 rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  {hasApiKey && (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Já configurado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400">
                  Este valor não é exibido por segurança. Para atualizar, cole um novo token e salve.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Nome do Remetente
                  </label>
                  <input
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    placeholder="Trajettu"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    E-mail do Remetente
                  </label>
                  <input
                    type="email"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    placeholder="contato@trajettu.com"
                  />
                </div>
              </div>

              <div className="border-t border-zinc-200 dark:border-white/10 pt-4 mt-2 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    Template: Boas-vindas
                  </h3>
                  <span className="text-[10px] text-zinc-400">
                    Placeholders: <code>{'{{name}}'}</code>, <code>{'{{app_url}}'}</code>
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={welcomeSubject}
                    onChange={(e) => setWelcomeSubject(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    placeholder="Assunto"
                  />
                  <textarea
                    value={welcomeHtml}
                    onChange={(e) => setWelcomeHtml(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="border-t border-zinc-200 dark:border-white/10 pt-4 mt-2 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    Template: Recuperação de Senha
                  </h3>
                  <span className="text-[10px] text-zinc-400">
                    Placeholder: <code>{'{{reset_link}}'}</code>
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={resetSubject}
                    onChange={(e) => setResetSubject(e.target.value)}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    placeholder="Assunto"
                  />
                  <textarea
                    value={resetHtml}
                    onChange={(e) => setResetHtml(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            </form>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-4 text-xs text-zinc-600 dark:text-zinc-400">
            <h3 className="text-sm font-semibold mb-2 text-zinc-800 dark:text-zinc-100">
              Como funciona
            </h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>Usamos o provedor <b>Resend</b> para envio de emails transacionais.</li>
              <li>O token é salvo no banco de dados e usado apenas no backend.</li>
              <li>
                Os templates aceitam placeholders que serão substituídos automaticamente, como{' '}
                <code>{'{{name}}'}</code>, <code>{'{{app_url}}'}</code> e{' '}
                <code>{'{{reset_link}}'}</code>.
              </li>
            </ul>
          </div>

          {loading && (
            <div className="text-xs text-zinc-500 bg-white dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/10 p-4">
              Carregando configurações atuais...
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

