import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';
import { Plus, ArrowRight, Globe } from 'lucide-react';

type Site = {
  id: number;
  name: string;
  domain: string | null;
  site_key: string;
  created_at: string;
};

export const SitesPage = () => {
  const nav = useNavigate();
  const location = useLocation();
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentTab = (location.state as { intentTab?: string } | null)?.intentTab;
  const validTabs = ['snippet', 'meta', 'campaigns', 'ga', 'matching', 'webhooks', 'reports'];
  const resolvedTab = intentTab && validTabs.includes(intentTab) ? intentTab : null;
  const tabLabels: Record<string, string> = {
    snippet: 'Tracking',
    meta: 'Integração Meta',
    campaigns: 'Campanhas',
    ga: 'Google Analytics',
    matching: 'Correspondência',
    webhooks: 'Webhook Vendas',
    reports: 'Recomendações',
  };
  const getSiteLink = (id: number) => (resolvedTab ? `/sites/${id}?tab=${resolvedTab}` : `/sites/${id}`);

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 glass-card p-6 h-fit">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Plus className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Adicionar site</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4 ml-10">
            Crie um site e depois conecte snippet, Meta/GA e webhook.
          </p>
          
          <form className="mt-4 space-y-4" onSubmit={createSite}>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Nome do site</label>
              <input
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meu Site"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Domínio (opcional)</label>
              <input
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: loja.com"
              />
            </div>
            
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {error}
              </div>
            )}
            
            <button
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-lg disabled:opacity-50 text-sm font-medium shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
            >
              {loading ? 'Criando…' : 'Criar Site'}
            </button>
          </form>

          {createdSecret && (
            <div className="mt-6 animate-in fade-in slide-in-from-top-2">
              <div className="text-xs font-medium text-amber-500 mb-2">Webhook secret (salve agora)</div>
              <div className="font-mono text-xs bg-background border border-amber-500/20 text-amber-500 p-3 rounded-lg break-all select-all">
                {createdSecret}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Globe className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Seus sites</h2>
                <p className="text-xs text-muted-foreground">Gerencie suas integrações</p>
              </div>
            </div>
            <Link to="/dashboard" className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
              Voltar ao dashboard <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {resolvedTab && (
              <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs text-primary sm:flex-row sm:items-center sm:justify-between">
                <span>Selecione um site para abrir {tabLabels[resolvedTab]}.</span>
                <button
                  type="button"
                  onClick={() => nav('/sites')}
                  className="self-start rounded-lg border border-primary/40 bg-primary/20 px-3 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/30 sm:self-auto"
                >
                  Selecionar site
                </button>
              </div>
            )}
            {sites.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-border rounded-xl">
                <Globe className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">Nenhum site configurado ainda.</p>
              </div>
            )}
            
            {sites.map((s) => (
              <Link
                key={s.id}
                to={getSiteLink(s.id)}
                className="group block rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 p-4 transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-200">
                      <span className="font-bold text-lg">{s.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{s.name}</div>
                      <div className="text-sm text-muted-foreground">{s.domain || '—'}</div>
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Site Key</div>
                    <div className="text-xs font-mono text-foreground bg-background px-2 py-1 rounded border border-border group-hover:border-primary/20 transition-colors">
                      {s.site_key}
                    </div>
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
