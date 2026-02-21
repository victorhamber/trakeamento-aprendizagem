import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type Site = {
  id: number;
  name: string;
  domain: string | null;
  site_key: string;
  created_at: string;
};

export const SitesPage = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api.get('/sites');
    setSites(res.data.sites);
  };

  useEffect(() => {
    load().catch(() => { });
  }, []);

  const createSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const res = await api.post('/sites', { name, domain });
      setCreatedSecret(res.data.webhook_secret);
      setName('');
      setDomain('');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Falha ao criar site');
    } finally {
      setLoading(false);
    }
  };

  const deleteSite = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Tem certeza que deseja excluir este site? Todos os dados serão perdidos.')) return;
    try {
      await api.delete(`/sites/${id}`);
      await load();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Erro ao excluir site.';
      alert(msg);
    }
  };

  return (
    <Layout title="Sites">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Create site form */}
        <div className="lg:col-span-1 rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5 sm:p-6">
          <div className="text-sm font-semibold text-white">Adicionar site</div>
          <div className="mt-1 text-xs text-zinc-500">Crie um site e depois conecte snippet, Meta/GA e webhook.</div>
          <form className="mt-4 space-y-3" onSubmit={createSite}>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Nome do site</label>
              <input
                className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-600"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Landing Page"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Domínio (opcional)</label>
              <input
                className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2.5 text-sm outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-600"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: loja.com"
              />
            </div>
            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}
            <button
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white px-4 py-2.5 rounded-xl disabled:opacity-50 text-sm font-semibold shadow-[0_8px_25px_rgba(59,130,246,0.25)] hover:shadow-[0_8px_35px_rgba(59,130,246,0.4)] transition-all"
            >
              {loading ? 'Criando…' : 'Criar site'}
            </button>
          </form>
          {createdSecret && (
            <div className="mt-4 text-sm animate-in fade-in" style={{ animationDuration: '300ms' }}>
              <div className="text-xs text-amber-300 font-medium">⚠ Webhook secret (salve agora)</div>
              <div className="mt-2 font-mono text-xs bg-zinc-900/60 border border-amber-500/20 p-3 rounded-xl break-all text-zinc-300">
                {createdSecret}
              </div>
            </div>
          )}
        </div>

        {/* Sites list */}
        <div className="lg:col-span-2 rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-white">Seus sites</div>
              <div className="mt-1 text-xs text-zinc-500">Abra um site para configurar e acompanhar.</div>
            </div>
          </div>

          <div className="space-y-2.5">
            {sites.length === 0 && (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center animate-in fade-in" style={{ animationDuration: '400ms' }}>
                <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10 mx-auto mb-3 text-zinc-700" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <div className="text-sm text-zinc-400 font-medium">Nenhum site ainda</div>
                <div className="text-xs text-zinc-600 mt-1">Crie seu primeiro site usando o formulário ao lado.</div>
              </div>
            )}
            {sites.map((s, i) => (
              <Link
                key={s.id}
                to={`/sites/${s.id}`}
                className="group block rounded-2xl border border-zinc-800/60 bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-zinc-700/60 p-4 transition-all duration-200 animate-in fade-in"
                style={{ animationDelay: `${i * 60}ms`, animationDuration: '300ms' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-white/5 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors truncate">{s.name}</div>
                      <div className="text-xs text-zinc-500 truncate">{s.domain || '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="hidden sm:block text-[10px] font-mono text-zinc-600 group-hover:text-zinc-500 transition-colors">{s.site_key}</div>
                    <button
                      onClick={(e) => deleteSite(e, s.id)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                      title="Excluir site"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};
