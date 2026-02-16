import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { 
  LayoutDashboard, 
  BarChart3, 
  FileText, 
  Sparkles, 
  Activity, 
  Menu, 
  LogOut, 
  Zap
} from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Visão Geral" },
  { to: "/campaigns", icon: BarChart3, label: "Campanhas" },
  { to: "/sites", icon: FileText, label: "Páginas" },
  { to: "/recommendations", icon: Sparkles, label: "Recomendações" },
  { to: "/tracking", icon: Activity, label: "Tracking" },
];

const SidebarItem = ({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-sidebar-accent text-primary glow-primary"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )
    }
  >
    {({ isActive }) => (
      <>
        <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
        {label}
      </>
    )}
  </NavLink>
);

export const Layout = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => {
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar Desktop */}
      <aside className="fixed left-0 top-0 z-40 hidden lg:flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary glow-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-sidebar-accent-foreground">TrackPro</h1>
            <p className="text-[10px] text-sidebar-foreground">Meta Ads Analytics</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <SidebarItem key={item.to} {...item} />
          ))}

          <div className="pt-4">
            <div className="px-3 py-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-muted-foreground text-xs">
              Treinamentos <span className="opacity-70">(em breve)</span>
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3 space-y-1">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-sidebar-accent-foreground">Conta</span>
              <span className="truncate text-xs text-sidebar-foreground max-w-[120px]">{auth.user?.email}</span>
            </div>
            <button
              onClick={() => auth.logout()}
              className="rounded p-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header & Content */}
      <div className="lg:ml-64 min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden -ml-2 p-2 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          
          <div className="flex flex-1 items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <span className="text-xs font-medium text-success-foreground">Online</span>
              </div>
              {right}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 bg-sidebar border-r border-sidebar-border p-4 shadow-2xl animate-in slide-in-from-left duration-200">
             <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary glow-primary">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-sidebar-accent-foreground">TrackPro</h1>
                <p className="text-[10px] text-sidebar-foreground">Meta Ads Analytics</p>
              </div>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => (
                <SidebarItem key={item.to} {...item} />
              ))}
            </nav>

            <div className="mt-auto pt-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between px-2 py-2">
                <span className="truncate text-xs text-sidebar-foreground">{auth.user?.email}</span>
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    auth.logout();
                  }}
                  className="rounded p-1 text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
