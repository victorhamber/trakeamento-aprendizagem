/**
 * API client for Trajettu backend.
 * Set EXPO_PUBLIC_API_URL in .env or change default below.
 */
const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.trajettu.com';

export type LoginResponse = {
  token: string;
  user: { id: number; email: string };
  account: { id: number };
};

export type MobileSummary = {
  todaySales: number;
  todayRevenue: number;
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

let token: string | null = null;

export function setAuthToken(t: string | null) {
  token = t;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function getMobileSummary(): Promise<MobileSummary> {
  const res = await fetch(`${API_BASE}/dashboard/mobile-summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load summary');
  return data;
}

export async function registerPushToken(pushToken: string, platform: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mobile/register-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pushToken, platform }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to register push');
}

export async function unregisterPushToken(pushToken: string): Promise<void> {
  await fetch(`${API_BASE}/mobile/unregister-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pushToken }),
  });
}
