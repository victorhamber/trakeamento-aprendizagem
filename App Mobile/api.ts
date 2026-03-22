/**
 * Cliente da API Trajettu.
 * Defina EXPO_PUBLIC_API_URL no .env (ex.: https://api.seudominio.com)
 * EXPO_PUBLIC_DASHBOARD_URL — mesmo host do dashboard web (recuperação de senha), ex.: https://app.trajettu.com
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://api.trajettu.com').replace(/\/+$/, '');

export const DASHBOARD_BASE_URL = (process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://app.trajettu.com').replace(
  /\/+$/,
  ''
);

/** Página web de “esqueci a senha” (mesma rota do dashboard React). */
export const FORGOT_PASSWORD_URL = `${DASHBOARD_BASE_URL}/forgot-password`;

export type LoginResponse = {
  token: string;
  user: { id: number; email: string };
  account: { id: number };
};

export type ChartPoint = {
  date: string;
  revenue: number;
  sales: number;
};

export type MobileSummary = {
  period: string;
  periodSales: number;
  periodRevenue: number;
  sitesCount: number;
  chart: ChartPoint[];
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

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Garante números finitos mesmo com JSON antigo ou campos ausentes (evita NaN na UI). */
export function normalizeMobileSummary(raw: any): MobileSummary {
  const purchases = Array.isArray(raw?.recentPurchases) ? raw.recentPurchases : [];
  const chartRaw = Array.isArray(raw?.chart) ? raw.chart : [];
  const sitesCountRaw = raw?.sitesCount ?? raw?.sites_count ?? raw?.site_count;
  return {
    period: String(raw?.period ?? 'today'),
    periodSales: Math.round(num(raw?.periodSales ?? raw?.period_sales ?? raw?.todaySales)),
    periodRevenue: num(raw?.periodRevenue ?? raw?.period_revenue ?? raw?.todayRevenue),
    sitesCount: Math.round(num(sitesCountRaw)),
    chart: chartRaw.map((c: any) => ({
      date: String(c?.date ?? ''),
      revenue: num(c?.revenue),
      sales: Math.round(num(c?.sales)),
    })),
    recentPurchases: purchases.map((p: any) => ({
      id: Math.round(num(p?.id, 0)),
      orderId: String(p?.orderId ?? p?.order_id ?? ''),
      platform: p?.platform ?? null,
      amount: numOrNull(p?.amount),
      currency: p?.currency ?? null,
      createdAt: String(p?.createdAt ?? p?.created_at ?? ''),
      siteName: String(p?.siteName ?? p?.site_name ?? ''),
    })),
  };
}

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
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  };
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

export type MobileSummaryParams = {
  period?: string;
  siteIds?: number[];
};

export async function getMobileSummary(params?: MobileSummaryParams): Promise<MobileSummary> {
  const q = new URLSearchParams();
  q.set('period', params?.period || 'today');
  if (params?.siteIds?.length) q.set('sites', params.siteIds.join(','));
  const qs = q.toString();
  const url = `${API_BASE}/dashboard/mobile-summary?${qs}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  await requireOk(res);
  const raw = await res.json();
  return normalizeMobileSummary(raw);
}

export async function getSites(): Promise<SiteRow[]> {
  const res = await fetch(`${API_BASE}/sites`, { headers: authHeaders(), cache: 'no-store' });
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
