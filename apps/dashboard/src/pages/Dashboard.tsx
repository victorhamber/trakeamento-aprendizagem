import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card } from '../components/Card';
import { Layout } from '../components/Layout';

type Overview = {
  sites: number;
  events_today: number;
  purchases_today: number;
  reports_7d: number;
};

export const DashboardPage = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [hasOpenAiKey, setHasOpenAiKey] = useState<boolean | null>(null);
  const kpiIcon = (name: 'sites' | 'events' | 'money' | 'report') => {
    if (name === 'sites') {
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M4 8.5C4 7.1 4 6.4 4.34 5.87C4.64 5.4 5.05 5.03 5.54 4.81C6.08 4.57 6.8 4.57 8.25 4.57H15.75C17.2 4.57 17.93 4.57 18.46 4.81C18.95 5.03 19.36 5.4 19.66 5.87C20 6.4 20 7.1 20 8.5V15.5C20 16.9 20 17.6 19.66 18.13C19.36 18.6 18.95 18.97 18.46 19.19C17.92 19.43 17.2 19.43 15.75 19.43H8.25C6.8 19.43 6.07 19.43 5.54 19.19C5.05 18.97 4.64 18.6 4.34 18.13C4 17.6 4 16.9 4 15.5V8.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M8 8.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 15.5H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    }
    if (name === 'events') {
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M4 13.5C4 12.12 4 11.43 4.35 10.9C4.56 10.59 4.84 10.34 5.17 10.19C5.74 9.93 6.51 10.07 8.06 10.34C9.87 10.66 10.77 10.82 11.47 10.6C11.83 10.48 12.17 10.29 12.46 10.03C13.03 9.5 13.23 8.64 13.62 6.93C14.01 5.25 14.2 4.41 14.78 3.96C15.08 3.73 15.44 3.58 15.82 3.54C16.54 3.45 17.17 3.98 18.43 5.05L19.04 5.57C20.14 6.49 20.69 6.95 20.92 7.55C21 7.75 21.04 7.97 21.04 8.19C21.04 8.85 20.67 9.41 19.93 10.53C19.05 11.88 18.61 12.55 18.34 13.27C18.22 13.59 18.15 13.93 18.12 14.27C18.06 15.01 18.19 15.77 18.45 17.29C18.82 19.46 19.01 20.55 18.43 21.22C18.15 21.55 17.79 21.79 17.38 21.92C16.54 22.2 15.58 21.62 13.67 20.44L12.99 20.02C11.92 19.37 11.39 19.04 10.81 18.91C10.51 18.84 10.2 18.82 9.9 18.85C9.31 18.91 8.76 19.17 7.66 19.68C6.2 20.36 5.48 20.7 4.95 20.43C4.65 20.28 4.41 20.02 4.26 19.72C4 19.2 4 18.42 4 16.86V13.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    if (name === 'money') {
      return (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M7 7.5C7 6.12 8.12 5 9.5 5H15.5C16.88 5 18 6.12 18 7.5V16.5C18 17.88 16.88 19 15.5 19H9.5C8.12 19 7 17.88 7 16.5V7.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M10 9.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M10 12H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M10 14.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M7 4.5H15.5L19.5 8.5V19.5C19.5 20.33 18.83 21 18 21H7C6.17 21 5.5 20.33 5.5 19.5V6C5.5 5.17 6.17 4.5 7 4.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M15.5 4.5V8.5H19.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 12H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 15H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  };

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
          className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white text-sm rounded-xl px-4 py-2 shadow-[0_12px_30px_rgba(59,130,246,0.35)] transition-all"
        >
          Novo site
        </Link>
      }
    >
      <div className="rounded-3xl border border-white/5 bg-zinc-950/50 p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">Controle em tempo real, sem complicação</div>
            <div className="mt-1 text-sm text-zinc-400">
              Conecte seus sites, acompanhe eventos e receba diagnósticos claros sobre o que está travando suas vendas.
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
            <div className="text-xs text-zinc-300">Coleta ativa</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card
            title="Sites ativos"
            value={data ? data.sites : '—'}
            hint="Cada site tem snippet + integrações próprias"
            icon={kpiIcon('sites')}
            accent="violet"
          />
          <Card
            title="Eventos hoje"
            value={data ? data.events_today : '—'}
            hint="PageView + eventos customizados"
            icon={kpiIcon('events')}
            accent="blue"
          />
          <Card
            title="Compras hoje"
            value={data ? data.purchases_today : '—'}
            hint="Recebidas via webhook/integração"
            icon={kpiIcon('money')}
            accent="emerald"
          />
          <Card
            title="Diagnósticos (7d)"
            value={data ? data.reports_7d : '—'}
            hint="Relatórios gerados pela IA"
            icon={kpiIcon('report')}
            accent="amber"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-3xl border border-white/5 bg-zinc-950/50 p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">Ações rápidas</div>
              <div className="mt-1 text-xs text-zinc-500">O passo a passo completo vai ficar na área de Treinamentos.</div>
            </div>
            <div className="text-xs text-zinc-500 hidden sm:block">Foque no essencial: tráfego → evento → diagnóstico</div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link
              to="/sites"
              className="group rounded-2xl border border-white/5 bg-zinc-950/50 hover:bg-white/5 p-4 transition-all"
            >
              <div className="text-xs text-zinc-400">Sites</div>
              <div className="mt-1 text-sm font-semibold text-white">Criar ou gerenciar sites</div>
              <div className="mt-2 text-xs text-zinc-500">Centralize snippet, integrações, webhook e diagnóstico.</div>
              <div className="mt-3 text-xs text-blue-300 group-hover:text-blue-200">Abrir →</div>
            </Link>

            <Link
              to="/ai"
              className="group rounded-2xl border border-white/5 bg-zinc-950/50 hover:bg-white/5 p-4 transition-all"
            >
              <div className="text-xs text-zinc-400">Assistente IA</div>
              <div className="mt-1 text-sm font-semibold text-white">Configurar diagnósticos</div>
              <div className="mt-2 text-xs text-zinc-500">
                {hasOpenAiKey === true ? 'IA ativa. Você já pode gerar relatórios por site.' : 'Ative a IA para relatórios claros e acionáveis.'}
              </div>
              <div className="mt-3 text-xs text-blue-300 group-hover:text-blue-200">Configurar →</div>
            </Link>

            <div className="rounded-2xl border border-white/5 bg-zinc-950/50 p-4">
              <div className="text-xs text-zinc-400">Treinamentos</div>
              <div className="mt-1 text-sm font-semibold text-zinc-200">Conteúdo guiado (em breve)</div>
              <div className="mt-2 text-xs text-zinc-500">Aulas com o passo a passo completo, do zero até escala.</div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-zinc-950/50 p-4">
              <div className="text-xs text-zinc-400">Dica rápida</div>
              <div className="mt-1 text-sm font-semibold text-zinc-200">Diagnóstico funciona com dados</div>
              <div className="mt-2 text-xs text-zinc-500">
                Quanto mais PageView/Engagement + métricas do Meta, mais preciso fica o gargalo.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/5 bg-zinc-950/50 p-6 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold text-white">Status do sistema</div>
          <div className="mt-4 space-y-3 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">API</span>
              <span className="text-emerald-400">Online</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Coleta de eventos</span>
              <span className="text-emerald-400">Ativa</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Diagnóstico IA</span>
              {hasOpenAiKey === true ? (
                <span className="text-emerald-400">Ativo</span>
              ) : (
                <Link to="/ai" className="text-zinc-300 hover:text-zinc-100">
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
