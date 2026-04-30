import type { Request } from 'express';
import axios from 'axios';
import geoip from 'geoip-lite';
import { getClientIp } from './ip';

export type ServerGeoHint = {
  city?: string;
  region?: string;
  country?: string;
};

function pickHeader(req: Request, key: string): string {
  const v = req.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/** País/cidade/estado a partir de headers de CDN (Cloudflare, Vercel, etc.). */
export function geoFromProxyHeaders(req: Request): ServerGeoHint {
  const country =
    pickHeader(req, 'cf-ipcountry') ||
    pickHeader(req, 'x-vercel-ip-country') ||
    pickHeader(req, 'x-country-code') ||
    pickHeader(req, 'cloudfront-viewer-country') ||
    '';

  const city =
    pickHeader(req, 'cf-ipcity') ||
    pickHeader(req, 'x-vercel-ip-city') ||
    pickHeader(req, 'x-geo-city') ||
    '';

  const region =
    pickHeader(req, 'cf-region') ||
    pickHeader(req, 'x-vercel-ip-country-region') ||
    pickHeader(req, 'x-geo-region') ||
    '';

  const out: ServerGeoHint = {};
  if (country && /^[A-Za-z]{2}$/.test(country)) out.country = country.toUpperCase();
  if (city) out.city = city;
  if (region) out.region = region;
  return out;
}

/** geoip-lite (IPv4). IPv6 puro não resolve — retorna vazio. */
export function geoFromGeoipLite(clientIp: string): ServerGeoHint {
  const cleanIp = clientIp.replace(/^::ffff:/, '');
  if (!cleanIp || cleanIp.length <= 6) return {};
  if (cleanIp.includes(':')) return {};
  const geo = geoip.lookup(cleanIp);
  if (!geo) return {};
  return {
    city: geo.city || undefined,
    region: geo.region || undefined,
    country: geo.country || undefined,
  };
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * GEO_IP_LOOKUP_URL com placeholder {ip} (ex.: https://ipapi.co/{ip}/json/).
 * Resposta JSON comum: city, region/state, country_code/country.
 */
export async function geoFromHttpLookup(clientIp: string): Promise<ServerGeoHint> {
  const tpl = (process.env.GEO_IP_LOOKUP_URL || '').trim();
  if (!tpl || !clientIp) return {};
  const cleanIp = clientIp.replace(/^::ffff:/, '');
  if (!cleanIp || cleanIp.includes(':')) return {};

  const url = tpl.includes('{ip}') ? tpl.split('{ip}').join(encodeURIComponent(cleanIp)) : `${tpl}${tpl.includes('?') ? '&' : '?'}ip=${encodeURIComponent(cleanIp)}`;

  const res = await axios.get(url, {
    timeout: 2500,
    validateStatus: (s) => s >= 200 && s < 300,
    headers: { Accept: 'application/json' },
  });
  const j = res.data;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};

  const rec = j as Record<string, unknown>;
  const city = pickStr(rec, ['city', 'town', 'city_name']);
  const region = pickStr(rec, ['region', 'regionName', 'state', 'region_code', 'principalSubdivision']);
  let country = pickStr(rec, ['country_code', 'countryCode', 'country', 'country_iso']);
  if (country && country.length === 2) country = country.toUpperCase();

  const out: ServerGeoHint = {};
  if (city) out.city = city;
  if (region) out.region = region;
  if (country && /^[A-Z]{2}$/.test(country)) out.country = country;
  return out;
}

/**
 * Melhor estimativa servidor (tudo aproximado por IP, nunca 100% preciso):
 * 1) Se `GEO_IP_LOOKUP_URL` estiver definido: **prioridade** — APIs pagas (ipinfo, MaxMind, etc.)
 *    costumam ter cidade/estado melhores que geoip-lite.
 * 2) Senão: geoip-lite (IPv4) + headers de CDN (Cloudflare/Vercel) quando o IP passa no edge.
 * 3) O que ainda faltar, preenche a partir de geoip-lite/headers.
 */
export async function resolveServerGeoHint(req: Request, clientIp?: string): Promise<ServerGeoHint> {
  const ip = (clientIp || '').trim() || getClientIp(req);
  const hdr = geoFromProxyHeaders(req);
  const lite = geoFromGeoipLite(ip);

  const fromLocal: ServerGeoHint = {
    city: lite.city || hdr.city,
    region: lite.region || hdr.region,
    country: lite.country || hdr.country,
  };

  if (process.env.GEO_IP_LOOKUP_URL) {
    try {
      const ext = await geoFromHttpLookup(ip);
      // API externa primeiro (se retornou algo), depois fallback local
      return {
        city: ext.city || fromLocal.city,
        region: ext.region || fromLocal.region,
        country: ext.country || fromLocal.country,
      };
    } catch {
      /* ignora e usa só local */
    }
  }

  return fromLocal;
}
