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
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2"
        >
          Novo site
        </Link>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="Sites ativos" value={data ? data.sites : '—'} hint="Conecte integrações por site" />
        <Card title="Eventos hoje" value={data ? data.events_today : '—'} hint="PageView + eventos customizados" />
        <Card title="Compras hoje" value={data ? data.purchases_today : '—'} hint="Recebidas via webhook/integração" />
        <Card title="Diagnósticos (7d)" value={data ? data.reports_7d : '—'} hint="Relatórios gerados pela IA" />
      </div>

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
          <div className="text-sm font-semibold">Próximos passos</div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">1) Instale o snippet</div>
              <div className="mt-1 text-sm text-zinc-200">Cole o snippet no seu site para começar a capturar eventos.</div>
            </div>
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">2) Conecte o Meta</div>
              <div className="mt-1 text-sm text-zinc-200">Faça login com Facebook e selecione Conta de Anúncio e Pixel.</div>
            </div>
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">3) Ative a IA</div>
              <div className="mt-1 text-sm text-zinc-200">Adicione sua chave da OpenAI para liberar diagnósticos automáticos.</div>
              <div className="mt-3">
                <Link to="/ai" className="text-sm text-blue-400 hover:text-blue-300">
                  Configurar Assistente IA →
                </Link>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-400">4) Gere diagnósticos</div>
              <div className="mt-1 text-sm text-zinc-200">Use o relatório IA por site, no lugar de CTR/CPM padrão.</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
          <div className="text-sm font-semibold">Status do sistema</div>
          <div className="mt-3 space-y-3 text-sm text-zinc-200">
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
