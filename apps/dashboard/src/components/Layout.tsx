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
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M4 13.5C4 12.12 4 11.43 4.35 10.9C4.56 10.59 4.84 10.34 5.17 10.19C5.74 9.93 6.51 10.07 8.06 10.34C9.87 10.66 10.77 10.82 11.47 10.6C11.83 10.48 12.17 10.29 12.46 10.03C13.03 9.5 13.23 8.64 13.62 6.93C14.01 5.25 14.2 4.41 14.78 3.96C15.08 3.73 15.44 3.58 15.82 3.54C16.54 3.45 17.17 3.98 18.43 5.05L19.04 5.57C20.14 6.49 20.69 6.95 20.92 7.55C21 7.75 21.04 7.97 21.04 8.19C21.04 8.85 20.67 9.41 19.93 10.53C19.05 11.88 18.61 12.55 18.34 13.27C18.22 13.59 18.15 13.93 18.12 14.27C18.06 15.01 18.19 15.77 18.45 17.29C18.82 19.46 19.01 20.55 18.43 21.22C18.15 21.55 17.79 21.79 17.38 21.92C16.54 22.2 15.58 21.62 13.67 20.44L12.99 20.02C11.92 19.37 11.39 19.04 10.81 18.91C10.51 18.84 10.2 18.82 9.9 18.85C9.31 18.91 8.76 19.17 7.66 19.68C6.2 20.36 5.48 20.7 4.95 20.43C4.65 20.28 4.41 20.02 4.26 19.72C4 19.2 4 18.42 4 16.86V13.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === 'sites') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
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

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3C7.03 3 3 7.03 3 12C3 16.97 7.03 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 12C8 10.34 9.34 9 11 9H13C14.66 9 16 10.34 16 12C16 13.66 14.66 15 13 15H12.5C11.12 15 10 16.12 10 17.5V18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

const Item = ({ to, label, icon }: { to: string; label: string; icon: 'dashboard' | 'sites' | 'ai' }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
        isActive
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
