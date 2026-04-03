import type { Request } from 'express';

function cleanIpToken(raw: string): string {
  let v = raw.trim().replace(/^"+|"+$/g, '');
  if (!v) return '';

  // Ex.: "[2001:db8::1]:1234" ou "[2001:db8::1]"
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end > 1) v = v.slice(1, end);
  }

  // Remove ::ffff: prefix (IPv4-mapped IPv6)
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

export function getClientIp(req: Request): string {
  const candidates: Array<string | undefined> = [
    req.headers['cf-connecting-ip'] as string | undefined,
    req.headers['true-client-ip'] as string | undefined,
    req.headers['x-real-ip'] as string | undefined,
    req.headers['x-forwarded-for'] as string | undefined,
    req.ip,
  ];

  for (const c of candidates) {
    if (!c) continue;
    const v = c.includes(',') ? firstForwardedFor(c) : cleanIpToken(c);
    if (v) return v;
  }
  return '';
}

