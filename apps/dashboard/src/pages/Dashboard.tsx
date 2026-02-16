import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';
import { Globe, Activity, DollarSign, FileText } from 'lucide-react';

type Overview = {
  sites: number;
  events_today: number;
  purchases_today: number;
  reports_7d: number;
};

export const DashboardPage = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [hasOpenAiKey, setHasOpenAiKey] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get('/stats/overview')
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    api
      .get('/ai/settings')
      .then((res) => setHasOpenAiKey(!!res.data?.has_openai_key))
      .catch(() => setHasOpenAiKey(null));
  }, []);

  return (
    <Layout
      title="Visão geral"
      right={
        <Link
          to="/sites"
          className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded-lg px-4 py-2 shadow-lg shadow-primary/20 transition-all"
        >
          Novo site
        </Link>
      }
    >
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Controle em tempo real</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Conecte seus sites, acompanhe eventos e receba diagnósticos claros sobre o que está travando suas vendas.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
            <span className="text-xs font-medium text-success-foreground">Coleta ativa</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card
            title="Sites ativos"
            value={data ? data.sites : '—'}
            hint="Sites configurados"
            icon={<Globe className="h-5 w-5" />}
            accent="violet"
            delay={0.1}
          />
          <Card
            title="Eventos hoje"
            value={data ? data.events_today : '—'}
            hint="Total de eventos"
            icon={<Activity className="h-5 w-5" />}
            accent="blue"
            delay={0.2}
          />
          <Card
            title="Compras hoje"
            value={data ? data.purchases_today : '—'}
            hint="Vendas confirmadas"
            icon={<DollarSign className="h-5 w-5" />}
            accent="emerald"
            delay={0.3}
          />
          <Card
            title="Diagnósticos (7d)"
            value={data ? data.reports_7d : '—'}
            hint="Relatórios gerados"
            icon={<FileText className="h-5 w-5" />}
            accent="amber"
            delay={0.4}
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 glass-card p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h3 className="text-base font-semibold text-foreground">Ações rápidas</h3>
              <p className="mt-1 text-xs text-muted-foreground">O passo a passo completo vai ficar na área de Treinamentos.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              to="/sites"
              className="group relative overflow-hidden rounded-xl border border-border bg-card/50 p-4 hover:border-primary/50 transition-colors"
            >
              <div className="relative z-10">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sites</div>
                <div className="mt-1 text-sm font-semibold text-foreground">Criar ou gerenciar sites</div>
                <div className="mt-2 text-xs text-muted-foreground">Centralize snippet, integrações, webhook e diagnóstico.</div>
                <div className="mt-4 text-xs font-medium text-primary group-hover:underline">Acessar sites →</div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>

            <Link
              to="/ai"
              className="group relative overflow-hidden rounded-xl border border-border bg-card/50 p-4 hover:border-primary/50 transition-colors"
            >
              <div className="relative z-10">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assistente IA</div>
                <div className="mt-1 text-sm font-semibold text-foreground">Configurar diagnósticos</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {hasOpenAiKey === true ? 'IA ativa. Você já pode gerar relatórios.' : 'Ative a IA para relatórios claros.'}
                </div>
                <div className="mt-4 text-xs font-medium text-primary group-hover:underline">Configurar IA →</div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>

            <div className="rounded-xl border border-border bg-card/30 p-4 opacity-75">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Treinamentos</div>
              <div className="mt-1 text-sm font-semibold text-foreground">Conteúdo guiado (em breve)</div>
              <div className="mt-2 text-xs text-muted-foreground">Aulas com o passo a passo completo.</div>
            </div>

            <div className="rounded-xl border border-border bg-card/30 p-4 opacity-75">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dica rápida</div>
              <div className="mt-1 text-sm font-semibold text-foreground">Diagnóstico funciona com dados</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Quanto mais PageView + métricas do Meta, mais preciso fica.
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card p-6 h-fit">
          <h3 className="text-base font-semibold text-foreground mb-4">Status do sistema</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border">
              <span className="text-sm text-muted-foreground">API</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <span className="text-xs font-medium text-success-foreground">Online</span>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border">
              <span className="text-sm text-muted-foreground">Coleta</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <span className="text-xs font-medium text-success-foreground">Ativa</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border">
              <span className="text-sm text-muted-foreground">Diagnóstico IA</span>
              {hasOpenAiKey === true ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </span>
                  <span className="text-xs font-medium text-success-foreground">Ativo</span>
                </div>
              ) : (
                <Link to="/ai" className="text-xs font-medium text-primary hover:underline">
                  Configurar chave
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
