import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
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
      `group flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
        isActive
          ? 'bg-zinc-900/70 text-white border border-zinc-800/70 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]'
          : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-white'
      }`
    }
  >
    <Icon name={icon} className="h-5 w-5 text-zinc-400 group-hover:text-zinc-200" />
    <span>{label}</span>
  </NavLink>
);

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 grid grid-cols-1 lg:grid-cols-[288px_1fr]">
      <aside className="hidden lg:flex flex-col bg-gradient-to-b from-zinc-950 via-zinc-950 to-black border-r border-zinc-900/70 p-4">
        <Link to="/dashboard" className="flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-zinc-900/40 transition-colors">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-600/30 to-violet-600/20 border border-white/10 flex items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
            <div className="h-3 w-3 rounded-full bg-blue-500 shadow-[0_0_18px_rgba(59,130,246,0.55)]" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Trakeamento</div>
            <div className="text-xs text-zinc-400">Tracking + Diagnóstico</div>
          </div>
        </Link>

        <nav className="mt-4 space-y-1">
          <Item to="/dashboard" label="Visão geral" icon="dashboard" />
          <Item to="/sites" label="Sites" icon="sites" />
          <Item to="/ai" label="Assistente IA" icon="ai" />
          <div className="pt-2">
            <div className="px-3 py-2 rounded-xl border border-zinc-900/70 bg-zinc-950/40 text-zinc-500 text-sm">
              Treinamentos <span className="text-xs">(em breve)</span>
            </div>
          </div>
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-900/70">
          <div className="text-xs text-zinc-500">Conta</div>
          <div className="text-sm text-zinc-200 truncate">{auth.user?.email}</div>
          <button
            onClick={() => auth.logout()}
            className="mt-3 w-full text-sm bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 rounded-xl px-3 py-2 transition-colors"
          >
            Sair
          </button>
          <div className="mt-3 text-[11px] text-zinc-600 truncate">{location.pathname}</div>
        </div>
      </aside>

      <main className="bg-gradient-to-b from-zinc-950 via-zinc-950 to-black">
        <header className="sticky top-0 z-10 bg-zinc-950/70 backdrop-blur border-b border-zinc-900/70">
          <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className="inline-flex lg:hidden items-center justify-center h-9 w-9 rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-200"
              >
                <span className="sr-only">Abrir menu</span>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <div>
                <div className="text-xs text-zinc-500">Dashboard</div>
                <div className="text-xl font-semibold tracking-tight text-white">{title}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <nav className="lg:hidden hidden sm:flex items-center gap-2">
                <NavLink
                  to="/dashboard"
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-xl text-xs border transition-colors ${
                      isActive ? 'border-zinc-700 bg-zinc-900/70 text-white' : 'border-transparent text-zinc-400 hover:text-white'
                    }`
                  }
                >
                  Visão geral
                </NavLink>
                <NavLink
                  to="/sites"
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-xl text-xs border transition-colors ${
                      isActive ? 'border-zinc-700 bg-zinc-900/70 text-white' : 'border-transparent text-zinc-400 hover:text-white'
                    }`
                  }
                >
                  Sites
                </NavLink>
                <NavLink
                  to="/ai"
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-xl text-xs border transition-colors ${
                      isActive ? 'border-zinc-700 bg-zinc-900/70 text-white' : 'border-transparent text-zinc-400 hover:text-white'
                    }`
                  }
                >
                  IA
                </NavLink>
              </nav>
              <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.55)]" />
                <span className="text-xs text-zinc-200">Sistema online</span>
              </div>
              {right}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-5 py-6">{children}</div>
      </main>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-full bg-zinc-950 border-r border-zinc-900/80 p-4 flex flex-col">
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-2 py-3 rounded-2xl hover:bg-zinc-900/40 transition-colors"
            >
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-blue-600/30 to-violet-600/20 border border-white/10 flex items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
                <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_14px_rgba(59,130,246,0.55)]" />
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
                <div className="px-3 py-2 rounded-xl border border-zinc-900/70 bg-zinc-950/40 text-zinc-500 text-sm">
                  Treinamentos <span className="text-xs">(em breve)</span>
                </div>
              </div>
            </nav>

            <div className="mt-auto pt-4 border-t border-zinc-900/70">
              <div className="text-xs text-zinc-500">Conta</div>
              <div className="text-sm text-zinc-200 truncate">{auth.user?.email}</div>
              <button
                onClick={() => {
                  setMobileOpen(false);
                  auth.logout();
                }}
                className="mt-3 w-full text-sm bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 rounded-xl px-3 py-2 transition-colors"
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
