import axios from 'axios';

export const api = axios.create({
  baseURL: 'https://meta-ads-tracking-api.u0oe83.easypanel.host',
});

export const setAuthToken = (token: string | null) => {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};

