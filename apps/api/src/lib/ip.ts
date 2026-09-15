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

function firstForwardedFor(xff: string): string {
  const first = xff.split(',')[0];
  return first ? cleanIpToken(first) : '';
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

/**
 * IP do cliente para CAPI / rate-limit.
 * Meta pede IPv6 quando o Pixel (navegador) já vê IPv6 — preferimos qualquer
 * candidato IPv6 (cf-connecting-ipv6, XFF, etc.) antes de IPv4.
 */
export function getClientIp(req: Request): string {
  const headerCandidates: Array<string | undefined> = [
    req.headers['cf-connecting-ipv6'] as string | undefined,
    req.headers['cf-connecting-ip'] as string | undefined,
    req.headers['true-client-ip'] as string | undefined,
    req.headers['x-real-ip'] as string | undefined,
    req.headers['x-forwarded-for'] as string | undefined,
    req.ip,
  ];

  const flat: string[] = [];
  for (const c of headerCandidates) {
    if (!c) continue;
    if (c.includes(',')) flat.push(...expandIpCandidates(c));
    else {
      const v = cleanIpToken(c);
      if (v) flat.push(v);
    }
  }

  const ipv6 = flat.find(isIpv6Address);
  if (ipv6) return ipv6;

  const ipv4 = flat.find(isIpv4Address);
  if (ipv4) return ipv4;

  return flat[0] || '';
}
