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
  const getErrorMessage = (err: unknown) => {
    if (typeof err === 'object' && err && 'response' in err) {
      const response = (err as { response?: { data?: { error?: string } } }).response;
      if (typeof response?.data?.error === 'string' && response.data.error.trim()) {
        return response.data.error;
      }
    }
    if (err instanceof Error && err.message.trim()) {
      return err.message;
    }
    return 'Falha ao criar conta';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await auth.register(email, password, accountName);
      nav('/');
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="relative w-full max-w-md">
        <div className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-transparent blur-2xl opacity-70" />
        <div className="relative glass-card p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center glow-primary">
              <div className="h-3 w-3 rounded-full bg-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
              <p className="text-sm text-muted-foreground">Crie seu workspace</p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground">Nome da empresa</label>
            <input
              className="mt-1 w-full rounded-lg bg-background/40 border border-border/60 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground">Email</label>
            <input
              className="mt-1 w-full rounded-lg bg-background/40 border border-border/60 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground">Senha (mín. 8)</label>
            <input
              className="mt-1 w-full rounded-lg bg-background/40 border border-border/60 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={8}
            />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <button
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg disabled:opacity-50 text-sm shadow-lg shadow-primary/20 transition-all"
          >
            {loading ? 'Criando…' : 'Criar'}
          </button>
          </form>

          <div className="text-sm text-muted-foreground mt-4">
            Já tem conta?{' '}
            <Link className="text-primary hover:underline" to="/login">
              Entrar
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

