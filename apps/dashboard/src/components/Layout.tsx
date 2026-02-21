import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../state/auth';

const Icon = ({
  name,
  className,
}: {
  name: 'dashboard' | 'sites' | 'ai';
  className?: string;
}) => {
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    );
  }

  if (name === 'sites') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
};

const Item = ({ to, label, icon }: { to: string; label: string; icon: 'dashboard' | 'sites' | 'ai' }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${isActive
        ? 'bg-white/10 text-white border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
        : 'text-zinc-300/80 hover:text-white hover:bg-white/5 border border-transparent'
      }`
    }
  >
    <Icon name={icon} className="h-5 w-5 text-zinc-400/80 group-hover:text-white" />
    <span>{label}</span>
  </NavLink>
);

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#05070a] text-zinc-100 grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:flex flex-col bg-[#080a0f] border-r border-white/5 p-6">
        <Link
          to="/dashboard"
          className="flex items-center gap-3 px-2 mb-8"
        >
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">Trakeamento</div>
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold">AI Analytics</div>
          </div>
        </Link>

        <nav className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold px-3 mb-2">Menu Principal</div>
          <Item to="/dashboard" label="Dashboard" icon="dashboard" />
          <Item to="/sites" label="Meus Sites" icon="sites" />
          <Item to="/ai" label="Inteligência IA" icon="ai" />

          <div className="pt-6">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold px-3 mb-2">Recursos</div>
            <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 cursor-not-allowed border border-transparent">
              <div className="h-5 w-5 rounded-md bg-zinc-800/50 flex items-center justify-center text-[10px] font-bold">SOON</div>
              <span>Treinamentos</span>
            </div>
          </div>
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="h-8 w-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-medium text-zinc-400">
              {auth.user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-200 truncate">{auth.user?.email}</div>
              <div className="text-[10px] text-zinc-500">Plano Pro</div>
            </div>
          </div>
          <button
            onClick={() => auth.logout()}
            className="mt-4 w-full text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/5 border border-white/5 rounded-xl px-3 py-2.5 transition-all"
          >
            Sair da conta
          </button>
        </div>
      </aside>

      <main className="flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-[#05070a]/80 backdrop-blur-xl border-b border-white/5">
          <div className="w-full px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className="lg:hidden h-10 w-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">{title}</h1>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Live</span>
              </div>
              {right}
            </div>
          </div>
        </header>

        <div className="flex-1 w-full px-8 py-8 overflow-y-auto">
          {children}
        </div>
      </main>


      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button type="button" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/70" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-full bg-[#0b0f17] border-r border-white/10 p-4 flex flex-col">
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-colors"
            >
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-blue-500/30 via-indigo-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                <div className="h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_14px_rgba(96,165,250,0.6)]" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold tracking-tight">Trakeamento</div>
                <div className="text-[11px] text-zinc-400">Tracking + Diagnóstico</div>
              </div>
            </Link>

            <nav className="mt-4 space-y-1">
              <Item
                to="/dashboard"
                label="Visão geral"
                icon="dashboard"
              />
              <Item
                to="/sites"
                label="Sites"
                icon="sites"
              />
              <Item
                to="/ai"
                label="Assistente IA"
                icon="ai"
              />
              <div className="pt-2">
                <div className="px-3 py-2 rounded-xl border border-white/5 bg-white/[0.02] text-zinc-400 text-sm">
                  Treinamentos <span className="text-xs">(em breve)</span>
                </div>
              </div>
            </nav>

            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="text-xs text-zinc-500">Conta</div>
              <div className="text-sm text-zinc-200 truncate">{auth.user?.email}</div>
              <button
                onClick={() => {
                  setMobileOpen(false);
                  auth.logout();
                }}
                className="mt-3 w-full text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2 transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
