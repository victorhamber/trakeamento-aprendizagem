import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth';

const Item = ({ to, label }: { to: string; label: string }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
        isActive ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
      }`
    }
  >
    <span className="h-2 w-2 rounded-full bg-zinc-600" />
    <span>{label}</span>
  </NavLink>
);

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:flex flex-col bg-zinc-950 border-r border-zinc-900 p-4">
        <Link to="/dashboard" className="flex items-center gap-3 px-2 py-3">
          <div className="h-9 w-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <div className="h-3 w-3 rounded-full bg-blue-500" />
          </div>
          <div>
            <div className="font-semibold tracking-tight">Trakeamento</div>
            <div className="text-xs text-zinc-400">Sistema Online</div>
          </div>
        </Link>

        <nav className="mt-4 space-y-1">
          <Item to="/dashboard" label="Dashboard" />
          <Item to="/sites" label="Sites" />
          <Item to="/ai" label="Assistente IA" />
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-900">
          <div className="text-xs text-zinc-400">Logado como</div>
          <div className="text-sm text-zinc-200 truncate">{auth.user?.email}</div>
          <button
            onClick={() => auth.logout()}
            className="mt-3 w-full text-sm bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg px-3 py-2"
          >
            Sair
          </button>
          <div className="mt-3 text-[11px] text-zinc-500 truncate">{location.pathname}</div>
        </div>
      </aside>

      <main className="bg-zinc-950">
        <header className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur border-b border-zinc-900">
          <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-zinc-400">Dashboard</div>
              <div className="text-xl font-semibold tracking-tight">{title}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-zinc-200">Sistema online</span>
              </div>
              {right}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-5 py-6">{children}</div>
      </main>
    </div>
  );
};

