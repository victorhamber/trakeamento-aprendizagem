import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const nav = useNavigate();
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
    load().catch(() => {});
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

  const deleteSite = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este site?')) return;
    setLoading(true);
    try {
      await api.delete(`/sites/${id}`);
      await load();
    } catch (err: any) {
      alert('Erro ao excluir site');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Sites" right={<button onClick={() => nav('/sites')} className="hidden" />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-3xl border border-white/5 bg-zinc-950/50 p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold text-white">Adicionar site</div>
          <div className="mt-1 text-xs text-zinc-500">Crie um site e depois conecte snippet, Meta/GA e webhook.</div>
          <form className="mt-4 space-y-3" onSubmit={createSite}>
            <div>
              <label className="block text-xs text-zinc-400">Nome do site</label>
              <input
                className="mt-1 w-full rounded-xl bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm outline-none focus:border-blue-500/60 transition-colors"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">Domínio (opcional)</label>
              <input
                className="mt-1 w-full rounded-xl bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm outline-none focus:border-blue-500/60 transition-colors"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: loja.com"
              />
            </div>
            {error && <div className="text-sm text-red-400">{error}</div>}
            <button
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white px-4 py-2 rounded-xl disabled:opacity-50 text-sm shadow-[0_12px_30px_rgba(59,130,246,0.35)] transition-all"
            >
              {loading ? 'Criando…' : 'Criar'}
            </button>
          </form>
          {createdSecret && (
            <div className="mt-4 text-sm">
              <div className="text-xs text-amber-200/80">Webhook secret (salve agora)</div>
              <div className="mt-2 font-mono text-xs bg-zinc-950/60 border border-white/10 p-3 rounded-xl break-all">
                {createdSecret}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-3xl border border-white/5 bg-zinc-950/50 p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Seus sites</div>
              <div className="mt-1 text-xs text-zinc-500">Abra um site para configurar e acompanhar.</div>
            </div>
            <Link to="/dashboard" className="text-sm text-blue-400 hover:text-blue-300">
              Voltar ao dashboard
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {sites.length === 0 && <div className="text-sm text-zinc-400">Nenhum site ainda.</div>}
            {sites.map((s) => (
              <Link
                key={s.id}
                to={`/sites/${s.id}`}
                className="group block rounded-2xl border border-white/5 bg-zinc-950/50 hover:bg-white/5 p-4 transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-zinc-100">{s.name}</div>
                    <div className="text-sm text-zinc-500">{s.domain || '—'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-mono text-zinc-600 group-hover:text-zinc-500">{s.site_key}</div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        deleteSite(s.id);
                      }}
                      className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Excluir site"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
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

