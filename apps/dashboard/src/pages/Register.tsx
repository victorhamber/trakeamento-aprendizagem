import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth';

export const RegisterPage = () => {
  const auth = useAuth();
  const nav = useNavigate();
  const [accountName, setAccountName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await auth.register(email, password, accountName);
      nav('/');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Falha ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-900 bg-zinc-950 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <div className="h-3 w-3 rounded-full bg-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
            <p className="text-sm text-zinc-400">Crie seu workspace</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400">Nome da empresa</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400">Email</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400">Senha (mín. 8)</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500/60"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={8}
            />
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50 text-sm"
          >
            {loading ? 'Criando…' : 'Criar'}
          </button>
        </form>

        <div className="text-sm text-zinc-400 mt-4">
          Já tem conta?{' '}
          <Link className="text-blue-400 hover:text-blue-300" to="/login">
            Entrar
          </Link>
        </div>
      </div>
    </div>
  );
};

