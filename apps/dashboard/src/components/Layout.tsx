import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { api } from '../lib/api';
import { SalePushToggle } from './SalePushToggle';

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

const IconTraining = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <path d="M9 10h6" />
    <path d="M9 14h4" />
  </svg>
);

const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

// ─── Nav Item ─────────────────────────────────────────────────────────────────

const NavItem = ({ to, label, icon: IconComp, onNavigate }: { to: string; label: string; icon: React.FC<{ className?: string }>; onNavigate?: () => void }) => (
  <NavLink
    to={to}
    onClick={() => onNavigate?.()}
    className={({ isActive }) =>
      `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${isActive
        ? 'bg-white/10 text-white font-medium border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
        : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
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
  id: string | number;
  title: string;
  message: string;
  image_url?: string;
  image_link?: string;
  action_text?: string;
  action_url?: string;
  is_read: boolean;
  created_at: string;
};

// ─── Layout ───────────────────────────────────────────────────────────────────

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!auth?.token) return;
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.notifications || []);
    } catch { /* silent */ }
  }, [auth?.token]);

  useEffect(() => {
    if (!auth?.token) return;
    loadNotifications();
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  }, [loadNotifications, auth?.token]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAsRead = async (id: string | number) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch { /* silent */ }
  };

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 lg:grid-cols-[260px_1fr]">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden lg:flex flex-col bg-background border-r border-border p-5 select-none">
        <Link to="/dashboard" className="flex items-center gap-3 px-2 mb-7 select-none">
          <img src="/logo-icon.png?v=2" alt="Trajettu" className="h-12 w-12 object-contain pointer-events-none" />
          <div className="leading-tight">
            <div className="font-bold text-xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">Trajettu</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-400 font-bold">AI Analytics</div>
          </div>
        </Link>

        <nav className="space-y-1.5 flex-1">
          <div className="text-[9px] uppercase tracking-[0.2em] font-bold px-3 mb-2 text-zinc-500">Menu Principal</div>
          <NavItem to="/dashboard" label="Dashboard" icon={IconDashboard} />
          <NavItem to="/sites" label="Meus Sites" icon={IconSites} />
          <NavItem to="/ai" label="Inteligência IA" icon={IconBrain} />

          <div className="pt-5">
            <div className="text-[9px] uppercase tracking-[0.2em] font-bold px-3 mb-2 text-zinc-500">Recursos</div>
            <NavItem to="/treinamentos" label="Treinamentos" icon={IconTraining} />
          </div>
        </nav>

        <div className="pt-5 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-sm">
              {auth.user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate text-zinc-200">{auth.user?.email}</div>
              <div className="text-[10px] text-zinc-500">Plano Pro</div>
            </div>
          </div>
          <button
            onClick={() => auth.logout()}
            className="mt-3 w-full text-xs font-semibold rounded-xl px-3 py-2.5 transition-all text-zinc-400 hover:text-white hover:bg-white/5 border border-white/5"
          >
            Sair da conta
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-col min-w-0 bg-background">
        <header className="sticky top-0 z-10 backdrop-blur-xl border-b border-border bg-background/90 select-none">
          <div className="w-full px-4 sm:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className="lg:hidden h-9 w-9 rounded-xl border flex items-center justify-center border-white/10 bg-white/5"
                aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
                title={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">{title}</h1>
            </div>

            <div className="flex items-center gap-2">
              {auth.token ? <SalePushToggle /> : null}

              <div className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="h-9 w-9 rounded-xl border flex items-center justify-center transition-all hover:scale-105 border-white/10 bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
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
                    <button
                      type="button"
                      className="fixed inset-0 z-30"
                      onClick={() => setNotifOpen(false)}
                      aria-label="Fechar lista de notificações"
                      title="Fechar"
                    />
                    <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border shadow-2xl z-40 bg-card border-border shadow-black/50">
                      <div className="px-4 py-3 border-b text-sm font-semibold text-zinc-200 border-border">
                        Notificações
                      </div>
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-xs text-zinc-500">
                          Nenhuma notificação
                        </div>
                      ) : (
                        <div>
                          {notifications.map(n => (
                            <button
                              key={n.id}
                              onClick={() => {
                                markAsRead(n.id);
                                setSelectedNotification(n);
                                setNotifOpen(false);
                              }}
                              className={`w-full text-left px-4 py-3 border-b transition-colors border-border/80 ${n.is_read ? 'opacity-50' : 'hover:bg-white/5'}`}
                            >
                              <div className="flex items-start gap-2">
                                {!n.is_read && <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white">{n.title}</div>
                                  <div className="text-xs mt-1 leading-snug text-zinc-300">{n.message}</div>
                                  <div className="text-[11px] mt-2 font-medium text-zinc-500">{new Date(n.created_at).toLocaleDateString('pt-BR')}</div>
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
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/70"
            aria-label="Fechar menu"
            title="Fechar"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-full p-4 flex flex-col bg-background border-r border-white/10 select-none">
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-3 rounded-2xl border bg-white/[0.02] border-white/5"
            >
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold tracking-tight text-white">Trajettu</div>
                <div className="text-[10px] text-indigo-400 font-bold">AI Analytics</div>
              </div>
            </Link>

            <nav className="mt-4 space-y-1">
              <NavItem to="/dashboard" label="Dashboard" icon={IconDashboard} onNavigate={() => setMobileOpen(false)} />
              <NavItem to="/sites" label="Meus Sites" icon={IconSites} onNavigate={() => setMobileOpen(false)} />
              <NavItem to="/ai" label="Inteligência IA" icon={IconBrain} onNavigate={() => setMobileOpen(false)} />
              <div className="pt-4">
                <div className="text-[9px] uppercase tracking-[0.2em] font-bold px-3 mb-2 text-zinc-500">Recursos</div>
                <NavItem to="/treinamentos" label="Treinamentos" icon={IconTraining} onNavigate={() => setMobileOpen(false)} />
              </div>
            </nav>

            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="text-xs text-zinc-500">Conta</div>
              <div className="text-sm truncate text-zinc-200">{auth.user?.email}</div>
              <button
                onClick={() => { setMobileOpen(false); auth.logout(); }}
                className="mt-3 w-full text-sm rounded-xl px-3 py-2 transition-colors bg-white/5 hover:bg-white/10 border border-white/10"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Notification Detail Modal ── */}
      {selectedNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
            onClick={() => setSelectedNotification(null)}
            aria-label="Fechar notificação"
            title="Fechar"
          />
          <div className="relative w-full max-w-lg rounded-3xl shadow-2xl p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200 bg-card border border-border">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold tracking-wider mb-2 text-indigo-400">
                  {new Date(selectedNotification.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                <h3 className="text-xl sm:text-2xl font-bold leading-tight text-white">
                  {selectedNotification.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedNotification(null)}
                className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl transition-colors bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white"
                aria-label="Fechar notificação"
                title="Fechar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className={`-mt-2 ${selectedNotification.image_url ? 'mb-6' : 'mb-6'}`}>
              {selectedNotification.image_url && (
                <div className="mb-6 -mx-6 sm:-mx-8 overflow-hidden rounded-none border-y border-border">
                  {selectedNotification.image_link ? (
                    <a href={selectedNotification.image_link} target="_blank" rel="noopener noreferrer" className="block w-full bg-black/5">
                      <img src={selectedNotification.image_url} alt="Cover" className="w-full h-auto max-h-[250px] object-cover" />
                    </a>
                  ) : (
                    <div className="w-full bg-black/5">
                      <img src={selectedNotification.image_url} alt="Cover" className="w-full h-auto max-h-[250px] object-cover" />
                    </div>
                  )}
                </div>
              )}

              <div className="prose prose-sm sm:prose-base max-w-none prose-invert text-zinc-300">
                {selectedNotification.message.split('\n').map((paragraph, idx) => (
                  <p key={idx} className="mb-4 last:mb-0 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>

              {selectedNotification.action_url && (
                <div className="mt-8">
                  <a
                    href={selectedNotification.action_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-3.5 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_8px_25px_rgba(79,70,229,0.25)] transition-all"
                  >
                    {selectedNotification.action_text || 'Acessar Link'}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
