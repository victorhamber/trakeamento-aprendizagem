import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken } from '../lib/api';

type AuthState = {
  token: string | null;
  user: { id: number; email: string } | null;
  account: { id: number } | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, accountName: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'ta_token';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    const t = localStorage.getItem(STORAGE_KEY);
    setAuthToken(t);
    return t;
  });
  const [user, setUser] = useState<AuthState['user']>(null);
  const [account, setAccount] = useState<AuthState['account']>(null);

  useEffect(() => {
    setAuthToken(token);
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }, [token]);

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      try {
        const res = await api.get('/auth/me');
        setUser(res.data.user);
        setAccount(res.data.account);
      } catch {
        setToken(null);
        setUser(null);
        setAccount(null);
      }
    };
    run();
  }, [token]);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      account,
      login: async (email, password) => {
        const res = await api.post('/auth/login', { email, password });
        setToken(res.data.token);
        setUser(res.data.user);
        setAccount(res.data.account);
      },
      register: async (email, password, accountName) => {
        const res = await api.post('/auth/register', { email, password, account_name: accountName });
        setToken(res.data.token);
        setUser(res.data.user);
        setAccount(res.data.account);
      },
      logout: () => {
        setToken(null);
        setUser(null);
        setAccount(null);
      },
    }),
    [token, user, account]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
};

