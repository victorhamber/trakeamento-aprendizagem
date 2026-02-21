import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { useTheme } from '../state/theme';
import { api } from '../lib/api';

// ─── Icons ───────────────────────────────────────────────────────────────────

const IconDashboard = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

const IconSites = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
);

const IconBrain = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

// ─── Nav Item ─────────────────────────────────────────────────────────────────

const NavItem = ({ to, label, icon: IconComp }: { to: string; label: string; icon: React.FC<{ className?: string }> }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${isActive
        ? 'bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white font-medium border border-transparent dark:border-white/10 shadow-sm dark:shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 border border-transparent'
      }`
    }
  >
    {({ isActive }) => (
      <>
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1.5 w-1 h-5 rounded-full bg-gradient-to-b from-blue-400 to-violet-500" />
        )}
        <IconComp className="h-[18px] w-[18px] shrink-0" />
        <span>{label}</span>
      </>
    )}
  </NavLink>
);

// ─── Notification Type ────────────────────────────────────────────────────────

type Notification = {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

// ─── Layout ───────────────────────────────────────────────────────────────────

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.notifications || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAsRead = async (id: number) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch { /* silent */ }
  };

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-[#05070a] text-zinc-900 dark:text-zinc-100 grid grid-cols-1 lg:grid-cols-[260px_1fr]">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden lg:flex flex-col bg-white dark:bg-[#080a0f] border-r border-zinc-200/60 dark:border-white/5 p-5 transition-colors duration-300">
        <Link to="/dashboard" className="flex items-center gap-3 px-2 mb-7">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-base tracking-tight text-zinc-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-white dark:to-zinc-400">Trajettu</div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400 font-bold">AI Analytics</div>
          </div>
        </Link>

        <nav className="space-y-1.5 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] font-bold px-3 mb-2 text-zinc-400 dark:text-zinc-600">Menu Principal</div>
          <NavItem to="/dashboard" label="Dashboard" icon={IconDashboard} />
          <NavItem to="/sites" label="Meus Sites" icon={IconSites} />
          <NavItem to="/ai" label="Inteligência IA" icon={IconBrain} />

          <div className="pt-5">
            <div className="text-[9px] uppercase tracking-[0.2em] font-bold px-3 mb-2 text-zinc-400 dark:text-zinc-600">Recursos</div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-not-allowed border border-transparent text-zinc-400 dark:text-zinc-600">
              <div className="h-5 w-5 rounded-md flex items-center justify-center text-[8px] font-bold bg-zinc-200 dark:bg-zinc-800/50">SOON</div>
              <span>Treinamentos</span>
            </div>
          </div>
        </nav>

        <div className={`pt-5 border-t ${isDark ? 'border-white/5' : 'border-zinc-200'}`}>
          <div className={`flex items-center gap-3 px-3 py-3 rounded-2xl ${isDark ? 'bg-white/[0.02] border border-white/5' : 'bg-zinc-50 border border-zinc-200'}`}>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">
              {auth.user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium truncate ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{auth.user?.email}</div>
              <div className={`text-[10px] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Plano Pro</div>
            </div>
          </div>
          <button
            onClick={() => auth.logout()}
            className={`mt-3 w-full text-xs font-semibold rounded-xl px-3 py-2.5 transition-all ${isDark
              ? 'text-zinc-400 hover:text-white hover:bg-white/5 border border-white/5'
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 border border-zinc-200'
              }`}
          >
            Sair da conta
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-col min-w-0">
        <header className={`sticky top-0 z-10 backdrop-blur-xl border-b ${isDark ? 'bg-[#05070a]/80 border-white/5' : 'bg-white/80 border-zinc-200/60'}`}>
          <div className="w-full px-4 sm:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className={`lg:hidden h-9 w-9 rounded-xl border flex items-center justify-center ${isDark ? 'border-white/10 bg-white/5' : 'border-zinc-200 bg-zinc-50'}`}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <h1 className={`text-base sm:text-lg font-bold tracking-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}>{title}</h1>
            </div>

            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all hover:scale-105 ${isDark
                  ? 'border-white/10 bg-white/5 text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:text-indigo-500 hover:bg-indigo-50'
                  }`}
                title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              >
                {isDark ? <IconSun /> : <IconMoon />}
              </button>

              {/* Notification bell */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all hover:scale-105 ${isDark
                    ? 'border-white/10 bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                    }`}
                  title="Notificações"
                >
                  <IconBell />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg shadow-red-500/30">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <button className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                    <div className={`absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border shadow-2xl z-40 ${isDark
                      ? 'bg-zinc-900 border-zinc-800 shadow-black/50'
                      : 'bg-white border-zinc-200 shadow-zinc-300/40'
                      }`}>
                      <div className={`px-4 py-3 border-b text-sm font-semibold ${isDark ? 'text-zinc-200 border-zinc-800' : 'text-zinc-800 border-zinc-100'}`}>
                        Notificações
                      </div>
                      {notifications.length === 0 ? (
                        <div className={`px-4 py-8 text-center text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                          Nenhuma notificação
                        </div>
                      ) : (
                        <div>
                          {notifications.map(n => (
                            <button
                              key={n.id}
                              onClick={() => { markAsRead(n.id); }}
                              className={`w-full text-left px-4 py-3 border-b transition-colors ${isDark
                                ? `border-zinc-800/50 ${n.is_read ? 'opacity-50' : 'hover:bg-white/5'}`
                                : `border-zinc-50 ${n.is_read ? 'opacity-50' : 'hover:bg-zinc-50'}`
                                }`}
                            >
                              <div className="flex items-start gap-2">
                                {!n.is_read && <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                                <div className="min-w-0">
                                  <div className={`text-xs font-semibold ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{n.title}</div>
                                  <div className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>{n.message}</div>
                                  <div className={`text-[10px] mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>{new Date(n.created_at).toLocaleDateString('pt-BR')}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {right}
            </div>
          </div>
        </header>

        <div className="flex-1 w-full px-4 sm:px-8 py-6 sm:py-8 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </main>

      {/* ── Mobile Sidebar ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button type="button" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/70" />
          <div className={`absolute inset-y-0 left-0 w-72 max-w-full p-4 flex flex-col ${isDark ? 'bg-[#0b0f17] border-r border-white/10' : 'bg-white border-r border-zinc-200'}`}>
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-3 rounded-2xl border ${isDark ? 'bg-white/[0.02] border-white/5' : 'bg-zinc-50 border-zinc-200'}`}
            >
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
              </div>
              <div className="leading-tight">
                <div className={`font-semibold tracking-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}>Trajettu</div>
                <div className="text-[10px] text-indigo-400 font-bold">AI Analytics</div>
              </div>
            </Link>

            <nav className="mt-4 space-y-1">
              <NavItem to="/dashboard" label="Dashboard" icon={IconDashboard} />
              <NavItem to="/sites" label="Meus Sites" icon={IconSites} />
              <NavItem to="/ai" label="Inteligência IA" icon={IconBrain} />
            </nav>

            <div className={`mt-auto pt-4 border-t ${isDark ? 'border-white/5' : 'border-zinc-200'}`}>
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Conta</div>
              <div className={`text-sm truncate ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{auth.user?.email}</div>
              <button
                onClick={() => { setMobileOpen(false); auth.logout(); }}
                className={`mt-3 w-full text-sm rounded-xl px-3 py-2 transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 border border-white/10' : 'bg-zinc-100 hover:bg-zinc-200 border border-zinc-200'}`}
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
