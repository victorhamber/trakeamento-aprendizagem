import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth';

export const LoginPage = () => {
  const auth = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await auth.login(email, password);
      nav('/');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden bg-[#05070a]">
      {/* Ambient gradient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-600/15 blur-[100px] animate-float" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-purple-600/15 blur-[100px] animate-float" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-blue-500/10 blur-[80px] animate-pulse-glow" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md animate-in fade-in" style={{ animationDuration: '400ms' }}>
        <div className="rounded-3xl border border-white/[0.08] bg-zinc-950/80 backdrop-blur-xl p-8 shadow-[0_25px_60px_rgba(0,0,0,0.5)]">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-4">
              <div className="h-3 w-3 rounded-full bg-white animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Trakeamento</h1>
            <p className="text-[11px] uppercase tracking-[0.25em] text-indigo-400 font-bold mt-1">AI Analytics</p>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold text-zinc-200">Bem-vindo de volta</h2>
            <p className="text-sm text-zinc-500 mt-1">Acesse seu painel</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>
                <input
                  className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 pl-10 pr-3 py-3 text-sm text-zinc-100 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-600"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <input
                  className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 pl-10 pr-3 py-3 text-sm text-zinc-100 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-600"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></svg>
                {error}
              </div>
            )}

            <button
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-500 hover:via-violet-500 hover:to-purple-500 text-white px-4 py-3 rounded-xl disabled:opacity-50 text-sm font-semibold shadow-[0_8px_30px_rgba(99,102,241,0.3)] hover:shadow-[0_8px_40px_rgba(99,102,241,0.45)] transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Entrando…
                </span>
              ) : 'Entrar'}
            </button>
          </form>

          <div className="text-sm text-zinc-500 mt-6 text-center">
            Não tem conta?{' '}
            <Link className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors" to="/register">
              Criar agora
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
