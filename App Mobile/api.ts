/**
 * Cliente da API Trajettu.
 * Defina EXPO_PUBLIC_API_URL no .env (ex.: https://api.seudominio.com)
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://api.trajettu.com').replace(/\/+$/, '');

export type LoginResponse = {
  token: string;
  user: { id: number; email: string };
  account: { id: number };
};

export type MobileSummary = {
  todaySales: number;
  todayRevenue: number;
  weekSales: number;
  weekRevenue: number;
  sitesCount: number;
  recentPurchases: Array<{
    id: number;
    orderId: string;
    platform: string | null;
    amount: number | null;
    currency: string | null;
    createdAt: string;
    siteName: string;
  }>;
};

export type SiteRow = {
  id: number;
  name: string;
  domain: string | null;
  site_key: string;
  created_at: string;
};

let token: string | null = null;

export function setAuthToken(t: string | null) {
  token = t;
}

function authHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Sessão expirada. Faça login novamente.');
    this.name = 'AuthExpiredError';
  }
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data.error || 'Falha no login');
  return data;
}

async function requireOk(res: Response): Promise<void> {
  if (res.status === 401) throw new AuthExpiredError();
  if (!res.ok) {
    const data = await parseJson(res);
    throw new Error(data.error || `Erro ${res.status}`);
  }
}

export async function getMobileSummary(): Promise<MobileSummary> {
  const res = await fetch(`${API_BASE}/dashboard/mobile-summary`, {
    headers: authHeaders(),
  });
  await requireOk(res);
  return res.json();
}

export async function getSites(): Promise<SiteRow[]> {
  const res = await fetch(`${API_BASE}/sites`, { headers: authHeaders() });
  await requireOk(res);
  const data = await res.json();
  return data.sites || [];
}

export async function registerPushToken(pushToken: string, platform: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mobile/register-push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pushToken, platform }),
  });
  await requireOk(res);
}

export async function unregisterPushToken(pushToken: string): Promise<void> {
  await fetch(`${API_BASE}/mobile/unregister-push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pushToken }),
  });
}
