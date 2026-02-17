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
      title="Panorama Geral"
      right={
        <Link
          to="/sites"
          className="bg-white text-black font-bold text-xs uppercase tracking-wider rounded-full px-6 py-3 shadow-xl hover:scale-105 transition-all"
        >
          Cadastrar Site
        </Link>
      }
    >
      <div className="mb-8 p-8 rounded-[32px] border border-white/5 bg-[#0a0d14] relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] -mr-32 -mt-32 rounded-full group-hover:bg-indigo-500/20 transition-all duration-700" />
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-white tracking-tight">Bem-vindo de volta!</h2>
          <p className="mt-2 text-zinc-400 max-w-xl leading-relaxed">
            Sua IA está analisando <span className="text-indigo-400 font-semibold">{data?.sites || 0} sites</span> ativamente. 
            Identificamos oportunidades de otimização em suas campanhas recentes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card
          title="Sites Monitorados"
          value={data ? data.sites : '0'}
          hint="Total de propriedades ativas"
          icon={kpiIcon('sites')}
          accent="violet"
        />
        <Card
          title="Tráfego (Hoje)"
          value={data ? data.events_today : '0'}
          hint="Eventos únicos capturados"
          icon={kpiIcon('events')}
          accent="blue"
        />
        <Card
          title="Conversões"
          value={data ? data.purchases_today : '0'}
          hint="Vendas confirmadas hoje"
          icon={kpiIcon('money')}
          accent="emerald"
        />
        <Card
          title="Insights IA"
          value={data ? data.reports_7d : '0'}
          hint="Diagnósticos na última semana"
          icon={kpiIcon('report')}
          accent="amber"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="p-8 rounded-[32px] border border-white/5 bg-[#0a0d14]">
            <h3 className="text-lg font-bold text-white mb-6">Atalhos Estratégicos</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link
                to="/sites"
                className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
              >
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 mb-4 group-hover:scale-110 transition-transform">
                  {kpiIcon('sites')}
                </div>
                <div className="font-bold text-white">Gestão de Sites</div>
                <div className="mt-1 text-sm text-zinc-500">Acesse seus snippets e chaves de API.</div>
              </Link>

              <Link
                to="/ai"
                className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all group"
              >
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 mb-4 group-hover:scale-110 transition-transform">
                  {kpiIcon('report')}
                </div>
                <div className="font-bold text-white">Configurar Inteligência</div>
                <div className="mt-1 text-sm text-zinc-500">Personalize como a IA analisa seus dados.</div>
              </Link>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-8 rounded-[32px] border border-white/5 bg-[#0a0d14]">
            <h3 className="text-lg font-bold text-white mb-6">Status da Rede</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
                <span className="text-sm text-zinc-400">Motor de Análise</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider">Estável</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
                <span className="text-sm text-zinc-400">Tracking Engine</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider">Ativo</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
                <span className="text-sm text-zinc-400">Diagnóstico IA</span>
                {hasOpenAiKey === true ? (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 text-[10px] font-bold uppercase tracking-wider">Pronto</span>
                ) : (
                  <Link to="/ai" className="text-[10px] font-bold uppercase tracking-wider text-amber-500 hover:underline">Configurar</Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>

  );
};
