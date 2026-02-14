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

  return (
    <Layout title="Sites" right={<button onClick={() => nav('/sites')} className="hidden" />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
          <div className="text-sm font-semibold">Adicionar site</div>
          <div className="mt-1 text-xs text-zinc-500">Crie um site e configure integrações</div>
          <form className="mt-4 space-y-3" onSubmit={createSite}>
            <div>
              <label className="block text-xs text-zinc-400">Nome</label>
              <input
                className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">Domínio (opcional)</label>
              <input
                className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: loja.com"
              />
            </div>
            {error && <div className="text-sm text-red-400">{error}</div>}
            <button
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
            >
              {loading ? 'Criando…' : 'Criar'}
            </button>
          </form>
          {createdSecret && (
            <div className="mt-4 text-sm">
              <div className="text-xs text-zinc-400">Webhook secret (salve agora)</div>
              <div className="mt-2 font-mono text-xs bg-zinc-900 border border-zinc-800 p-3 rounded-lg break-all">
                {createdSecret}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Seus sites</div>
              <div className="mt-1 text-xs text-zinc-500">Clique para configurar integrações e diagnóstico</div>
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
                className="block rounded-xl border border-zinc-900 bg-zinc-950 hover:bg-zinc-900/40 p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-zinc-100">{s.name}</div>
                    <div className="text-sm text-zinc-500">{s.domain || '—'}</div>
                  </div>
                  <div className="text-xs font-mono text-zinc-500">{s.site_key}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

