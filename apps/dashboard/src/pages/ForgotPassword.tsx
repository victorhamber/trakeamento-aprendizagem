import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api';

export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: any) {
      // Mesmo com erro, às vezes é melhor mostrar sucesso para não revelar e-mails cadastrados,
      // mas aqui vamos mostrar o erro genérico ou específico dependendo da política.
      // O backend retorna 200 mesmo se não achar o email, então se cair aqui é erro de servidor/rede.
      setError(err?.response?.data?.error || 'Falha ao enviar email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden bg-[#05070a] select-none">
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
          <div className="flex flex-col items-center mb-2">
            <img 
              src="/logo-full.png" 
              alt="Trajettu AI Analytics" 
              className="h-80 w-auto object-contain animate-in fade-in zoom-in duration-500 pointer-events-none select-none outline-none" 
              draggable={false}
            />
          </div>

          <div className="text-center mb-6 select-none">
            <h2 className="text-lg font-semibold text-zinc-200">Recuperar senha</h2>
            <p className="text-sm text-zinc-500 mt-1">Digite seu email para receber o link</p>
          </div>

          {sent ? (
            <div className="text-center animate-in fade-in slide-in-from-bottom-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-zinc-200 font-medium mb-2">Email enviado!</h3>
              <p className="text-sm text-zinc-500 mb-6">
                Verifique sua caixa de entrada e spam para redefinir sua senha.
              </p>
              <Link
                to="/login"
                className="block w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
              >
                Voltar para o login
              </Link>
            </div>
          ) : (
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
                    Enviando...
                  </span>
                ) : 'Enviar link de recuperação'}
              </button>

              <div className="text-sm text-zinc-500 mt-6 text-center">
                Lembrou a senha?{' '}
                <Link className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors" to="/login">
                  Entrar
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
