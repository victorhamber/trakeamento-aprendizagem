import axios from 'axios';

const sanitizeBaseUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^`|`$/g, '').replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
};

const envBaseUrl = sanitizeBaseUrl(import.meta.env.VITE_API_URL);

export const apiBaseUrl = envBaseUrl;

export const api = axios.create({
  baseURL: envBaseUrl || '',
});

export const setAuthToken = (token: string | null) => {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};

