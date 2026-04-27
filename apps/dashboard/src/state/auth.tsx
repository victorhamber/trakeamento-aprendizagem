import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  const logoutRedirectedRef = useRef(false);

  const forceLogoutAndReload = (reason?: string) => {
    if (logoutRedirectedRef.current) return;
    logoutRedirectedRef.current = true;
    setToken(null);
    setUser(null);
    setAccount(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const isLogin = window.location.pathname.startsWith('/login');
    if (isLogin) {
      // Mesmo na tela de login, um refresh garante estado limpo.
      window.location.reload();
      return;
    }
    const next = `/login${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`;
    window.location.assign(next);
  };

  useEffect(() => {
    setAuthToken(token);
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }, [token]);

  useEffect(() => {
    // Se outra aba deslogar, esta aba também deve voltar ao login imediatamente.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = typeof e.newValue === 'string' ? e.newValue : null;
      if (!next) forceLogoutAndReload('session_expired');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Interceptor global: se backend responder 401/403, redireciona pro login com refresh.
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err?.response?.status;
        const url = String(err?.config?.url || '');
        // Evita loop em endpoints de autenticação.
        const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/me');
        if (!isAuthRoute && (status === 401 || status === 403)) {
          forceLogoutAndReload('unauthorized');
        }
        return Promise.reject(err);
      }
    );
    return () => {
      api.interceptors.response.eject(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      try {
        const res = await api.get('/auth/me');
        setUser(res.data.user);
        setAccount(res.data.account);
      } catch {
        forceLogoutAndReload('session_expired');
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

