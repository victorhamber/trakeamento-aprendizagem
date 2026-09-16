import type { Request } from 'express';

function cleanIpToken(raw: string): string {
  let v = raw.trim().replace(/^"+|"+$/g, '');
  if (!v) return '';

  // Ex.: "[2001:db8::1]:1234" ou "[2001:db8::1]"
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end > 1) v = v.slice(1, end);
  }

  // Remove ::ffff: prefix (IPv4-mapped IPv6) → fica IPv4 puro
  v = v.replace(/^::ffff:/i, '');

  // Ex.: "203.0.113.10:54321" (IPv4 com porta)
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) {
    v = v.split(':')[0] || v;
  }

  // Ex.: "2001:db8::1:443" pode ser IPv6 válido; não tenta remover porta sem colchetes.
  return v.trim();
}

/** Lista IPs limpos de um header (suporta XFF com vários hops). */
function expandIpCandidates(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => cleanIpToken(p))
    .filter(Boolean);
}

export function isIpv6Address(ip: string): boolean {
  const v = (ip || '').trim();
  if (!v) return false;
  // IPv4-mapped já foi normalizado em cleanIpToken; aqui só IPv6 “de verdade”.
  return v.includes(':') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v);
}

export function isIpv4Address(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test((ip || '').trim());
}

function ipv4Octets(ip: string): number[] | null {
  if (!isIpv4Address(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/**
 * IP que podemos mandar à Meta como client_ip_address.
 * Descarta loopback / RFC1918 / link-local / IPv6 ULA — típicos de EasyPanel, Docker e hop de proxy.
 */
export function isPublicClientIp(ip: string): boolean {
  const v = (ip || '').trim();
  if (!v) return false;

  const oct = ipv4Octets(v);
  if (oct) {
    const [a, b] = oct;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
    return true;
  }

  if (!isIpv6Address(v)) return false;
  const low = v.toLowerCase();
  if (low === '::' || low === '::1') return false;
  if (low.startsWith('fe80:')) return false;
  if (low.startsWith('fc') || low.startsWith('fd')) return false;
  return true;
}

function firstPublicIp(raw: string | undefined): string {
  for (const c of expandIpCandidates(raw)) {
    if (isPublicClientIp(c)) return c;
  }
  return '';
}

/**
 * IP do cliente para CAPI / rate-limit.
 * Meta pede IPv6 quando o Pixel já vê IPv6 — usamos cf-connecting-ipv6 (IP do visitante).
 * Não vasculhamos hops seguintes do X-Forwarded-For à procura de IPv6: isso pega IP do
 * Cloudflare/EasyPanel e a Meta acusa “IP associado a vários usuários” no PageView.
 */
export function getClientIp(req: Request): string {
  const cfV6 = cleanIpToken(String(req.headers['cf-connecting-ipv6'] || ''));
  if (isPublicClientIp(cfV6) && isIpv6Address(cfV6)) return cfV6;

  const cf = cleanIpToken(String(req.headers['cf-connecting-ip'] || ''));
  if (isPublicClientIp(cf)) return cf;

  const trueClient = firstPublicIp(req.headers['true-client-ip'] as string | undefined);
  if (trueClient) return trueClient;

  const xff = firstPublicIp(req.headers['x-forwarded-for'] as string | undefined);
  if (xff) return xff;

  const real = firstPublicIp(req.headers['x-real-ip'] as string | undefined);
  if (real) return real;

  const reqIp = cleanIpToken(String(req.ip || ''));
  if (isPublicClientIp(reqIp)) return reqIp;

  return '';
}
