import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Layout } from '../components/Layout';

type Overview = {
  sites: number;
  events_today: number;
  purchases_today: number;
  total_revenue: number;
  reports_7d: number;
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const IconSites = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="4.57" width="16" height="14.86" rx="2" />
    <path d="M8 8.5H16" strokeLinecap="round" />
    <path d="M8 12H14" strokeLinecap="round" />
    <path d="M8 15.5H12" strokeLinecap="round" />
  </svg>
);

const IconEvents = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
    <path
      d="M4 13.5C4 12.12 4 11.43 4.35 10.9C4.56 10.59 4.84 10.34 5.17 10.19C5.74 9.93 6.51 10.07 8.06 10.34C9.87 10.66 10.77 10.82 11.47 10.6C11.83 10.48 12.17 10.29 12.46 10.03C13.03 9.5 13.23 8.64 13.62 6.93C14.01 5.25 14.2 4.41 14.78 3.96C15.08 3.73 15.44 3.58 15.82 3.54C16.54 3.45 17.17 3.98 18.43 5.05L19.04 5.57C20.14 6.49 20.69 6.95 20.92 7.55C21 7.75 21.04 7.97 21.04 8.19C21.04 8.85 20.67 9.41 19.93 10.53C19.05 11.88 18.61 12.55 18.34 13.27C18.22 13.59 18.15 13.93 18.12 14.27C18.06 15.01 18.19 15.77 18.45 17.29C18.82 19.46 19.01 20.55 18.43 21.22C18.15 21.55 17.79 21.79 17.38 21.92C16.54 22.2 15.58 21.62 13.67 20.44L12.99 20.02C11.92 19.37 11.39 19.04 10.81 18.91C10.51 18.84 10.2 18.82 9.9 18.85C9.31 18.91 8.76 19.17 7.66 19.68C6.2 20.36 5.48 20.7 4.95 20.43C4.65 20.28 4.41 20.02 4.26 19.72C4 19.2 4 18.42 4 16.86V13.5Z"
      strokeLinejoin="round"
    />
  </svg>
);

const IconMoney = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" />
  </svg>
);

const IconReport = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
    <path
      d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconArrow = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className="h-3.5 w-3.5"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

// ─── KPI Card ─────────────────────────────────────────────────────────────────

type KpiProps = {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ReactNode;
  color: string; // tailwind text color class for the icon
  glow: string;  // tailwind bg color for glow
};

const KpiCard = ({ label, value, hint, icon, color, glow }: KpiProps) => (
  <div className="group relative rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5 hover:border-zinc-700/60 transition-all duration-200 overflow-hidden">
    {/* subtle glow on hover */}
    <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${glow}`} />

    <div className="relative flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-2">
          {label}
        </div>
        <div className="text-2xl font-semibold text-zinc-100 tabular-nums leading-none">
          {value ?? '—'}
        </div>
        <div className="mt-1.5 text-[11px] text-zinc-600">{hint}</div>
      </div>
      <div className={`shrink-0 rounded-xl p-2.5 bg-zinc-900/80 border border-zinc-800/60 ${color}`}>
        {icon}
      </div>
    </div>
  </div>
);

// ─── Shortcut Card ────────────────────────────────────────────────────────────

type ShortcutProps = {
  to: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
};

const ShortcutCard = ({ to, icon, iconColor, iconBg, title, description }: ShortcutProps) => (
  <Link
    to={to}
    className="group flex items-start gap-4 p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-zinc-700/60 transition-all duration-200"
  >
    <div
      className={`shrink-0 rounded-xl p-2.5 border border-zinc-800/60 ${iconBg} ${iconColor} group-hover:scale-105 transition-transform duration-200`}
    >
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
        {title}
      </div>
      <div className="mt-0.5 text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">
        {description}
      </div>
    </div>
    <div className="shrink-0 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-200 mt-1">
      <IconArrow />
    </div>
  </Link>
);

// ─── Status Row ───────────────────────────────────────────────────────────────

type StatusRowProps = {
  label: string;
  status: 'ok' | 'warn' | 'action';
  badge?: React.ReactNode;
};

const StatusRow = ({ label, status, badge }: StatusRowProps) => (
  <div className="flex items-center justify-between py-3 border-b border-zinc-800/40 last:border-0">
    <div className="flex items-center gap-2.5">
      <div
        className={`w-1.5 h-1.5 rounded-full ${status === 'ok'
          ? 'bg-emerald-400'
          : status === 'warn'
            ? 'bg-amber-400'
            : 'bg-zinc-600'
          } ${status === 'ok' ? 'shadow-[0_0_6px_1px_rgba(52,211,153,0.5)]' : ''}`}
      />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
    {badge}
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export const DashboardPage = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [hasOpenAiKey, setHasOpenAiKey] = useState<boolean | null>(null);
  const [period, setPeriod] = useState('today');
  const [currency, setCurrency] = useState('BRL');

  useEffect(() => {
    api
      .get('/stats/overview', { params: { period, currency } })
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }, [period, currency]);

  useEffect(() => {
    api
      .get('/ai/settings')
      .then((res) => setHasOpenAiKey(!!res.data?.has_openai_key))
      .catch(() => setHasOpenAiKey(null));
  }, []);

  const getPeriodLabel = (p: string) => {
    switch (p) {
      case 'today': return 'Hoje';
      case 'yesterday': return 'Ontem';
      case 'last_7d': return 'Últimos 7 dias';
      case 'last_14d': return 'Últimos 14 dias';
      case 'last_30d': return 'Últimos 30 dias';
      case 'maximum': return 'Período Máximo';
      default: return 'Hoje';
    }
  };

  return (
    <Layout
      title="Dashboard"
      right={
        <Link
          to="/sites"
          className="inline-flex items-center gap-2 bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-semibold rounded-xl px-4 py-2.5 transition-colors shadow-lg shadow-black/20"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-3.5 h-3.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo site
        </Link>
      }
    >
      {/* ── Hero banner ── */}
      <div className="relative rounded-2xl border border-zinc-800/60 bg-zinc-950/60 overflow-hidden px-6 py-7 mb-6">
        {/* ambient glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-16 -right-16 w-72 h-72 bg-blue-500/8 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-violet-500/6 rounded-full blur-3xl" />
        </div>

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">
              Bem-vindo de volta!
            </h2>
            <p className="mt-1 text-sm text-zinc-500 max-w-md leading-relaxed">
              Monitorando{' '}
              <span className="text-zinc-300 font-medium">{data?.sites ?? 0} sites</span>{' '}
              ativamente. Explore os dados abaixo ou gere um diagnóstico nas campanhas.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3 self-start sm:self-auto">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-zinc-900/60 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-2 outline-none focus:border-zinc-700 cursor-pointer"
            >
              <option value="today">Hoje</option>
              <option value="yesterday">Ontem</option>
              <option value="last_7d">Últimos 7 dias</option>
              <option value="last_14d">Últimos 14 dias</option>
              <option value="last_30d">Últimos 30 dias</option>
              <option value="maximum">Máximo</option>
            </select>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-zinc-900/60 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-2 outline-none focus:border-zinc-700 cursor-pointer"
            >
              <option value="BRL">BRL (R$)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
            <Link
              to="/sites"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 rounded-lg px-3.5 py-2 transition-all"
            >
              Ver sites
              <IconArrow />
            </Link>
          </div>
        </div>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard
          label="Sites"
          value={data?.sites ?? 0}
          hint="Propriedades ativas"
          icon={<IconSites />}
          color="text-violet-400"
          glow="bg-violet-500/20"
        />
        <KpiCard
          label="Tráfego"
          value={data?.events_today ?? 0}
          hint={`Eventos - ${getPeriodLabel(period)}`}
          icon={<IconEvents />}
          color="text-blue-400"
          glow="bg-blue-500/20"
        />
        <KpiCard
          label="Conversões"
          value={data?.purchases_today ?? 0}
          hint={`Vendas - ${getPeriodLabel(period)}`}
          icon={<IconMoney />}
          color="text-emerald-400"
          glow="bg-emerald-500/20"
        />
        <KpiCard
          label="Faturamento"
          value={new Intl.NumberFormat(currency === 'BRL' ? 'pt-BR' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(data?.total_revenue ?? 0)}
          hint={`Receita - ${getPeriodLabel(period)}`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" />
            </svg>
          }
          color="text-amber-400"
          glow="bg-amber-500/20"
        />
        <KpiCard
          label="Insights IA"
          value={data?.reports_7d ?? 0}
          hint={`Diagnósticos gerados`}
          icon={<IconReport />}
          color="text-rose-400"
          glow="bg-rose-500/20"
        />
      </div>

      {/* ── Bottom grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Shortcuts */}
        <div className="lg:col-span-2 rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-4">
            Atalhos
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <ShortcutCard
              to="/sites"
              icon={<IconSites />}
              iconColor="text-blue-400"
              iconBg="bg-blue-500/10"
              title="Gestão de Sites"
              description="Snippets, chaves de API e configurações"
            />
            <ShortcutCard
              to="/ai"
              icon={<IconReport />}
              iconColor="text-violet-400"
              iconBg="bg-violet-500/10"
              title="Inteligência Artificial"
              description="Configure como a IA analisa suas campanhas"
            />
            <ShortcutCard
              to="/sites"
              icon={<IconEvents />}
              iconColor="text-emerald-400"
              iconBg="bg-emerald-500/10"
              title="Ver Campanhas"
              description="Métricas de Meta Ads em tempo real"
            />
            <ShortcutCard
              to="/sites"
              icon={<IconMoney />}
              iconColor="text-amber-400"
              iconBg="bg-amber-500/10"
              title="Webhooks de Venda"
              description="Integre Hotmart, Kiwify, Eduzz e mais"
            />
          </div>
        </div>

        {/* Status */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/60 p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-zinc-600 mb-4">
            Status do sistema
          </div>

          <StatusRow
            label="Motor de análise"
            status="ok"
            badge={
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                Estável
              </span>
            }
          />
          <StatusRow
            label="Tracking Engine"
            status="ok"
            badge={
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                Ativo
              </span>
            }
          />
          <StatusRow
            label="Diagnóstico IA"
            status={hasOpenAiKey === true ? 'ok' : 'action'}
            badge={
              hasOpenAiKey === true ? (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
                  Pronto
                </span>
              ) : hasOpenAiKey === false ? (
                <Link
                  to="/ai"
                  className="text-[10px] font-semibold uppercase tracking-widest text-amber-400 hover:text-amber-300 transition-colors"
                >
                  Configurar →
                </Link>
              ) : (
                <span className="text-[10px] text-zinc-700">—</span>
              )
            }
          />

          {/* Separator */}
          <div className="mt-5 pt-5 border-t border-zinc-800/40">
            <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-700 mb-3">
              Hoje
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600">Eventos</span>
                <span className="text-xs font-medium text-zinc-400 tabular-nums">
                  {data?.events_today ?? '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600">Conversões</span>
                <span className="text-xs font-medium text-zinc-400 tabular-nums">
                  {data?.purchases_today ?? '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600">Diagnósticos (7d)</span>
                <span className="text-xs font-medium text-zinc-400 tabular-nums">
                  {data?.reports_7d ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
