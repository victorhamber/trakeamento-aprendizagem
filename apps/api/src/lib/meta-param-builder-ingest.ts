/**
 * Meta Conversions API — Parameter Builder (Node) no ingest.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameter-builder-library
 * @see https://github.com/facebook/capi-param-builder
 */
import type { Request } from 'express';

// Pacote CommonJS oficial Meta (sem tipos first-party completos)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ParamBuilder } = require('capi-param-builder-nodejs') as {
  ParamBuilder: new (domains?: string[] | object) => MetaParamBuilderInstance;
};

type MetaParamBuilderInstance = {
  processRequest(
    host: string,
    queries: Record<string, string>,
    cookies: Record<string, string>,
    referer?: string | null,
    xForwardedFor?: string | null,
    remoteAddress?: string | null
  ): unknown;
  getFbc(): string | null;
  getFbp(): string | null;
};

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      v = decodeURIComponent(v);
    } catch {
      /* mantém bruto */
    }
    out[k] = v;
  }
  return out;
}

function queryRecordFromHttpUrl(urlStr: string): { host: string; query: Record<string, string> } | null {
  try {
    if (!urlStr || (!urlStr.startsWith('http://') && !urlStr.startsWith('https://'))) return null;
    const u = new URL(urlStr);
    const query: Record<string, string> = {};
    u.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    return { host: u.host, query };
  } catch {
    return null;
  }
}

type UserDataLike = Record<string, unknown>;

/**
 * Recomputa fbc/fbp com as regras da Meta (incl. appendix), usando:
 * - query da página (ex.: fbclid em event_source_url)
 * - cookies da requisição ao ingest (se houver)
 * - valores já enviados no body (tratados como _fbc / _fbp para o builder)
 */
export function applyMetaParamBuilderToIngest(
  req: Request,
  eventSourceUrl: string,
  userData: UserDataLike | undefined
): { fbc?: string; fbp?: string } {
  const out: { fbc?: string; fbp?: string } = {};
  try {
    const parsed = queryRecordFromHttpUrl(eventSourceUrl);
    let host = parsed?.host ?? '';
    const query = parsed?.query ?? {};

    if (!host) {
      const h = (req.get('host') || '').trim();
      if (h) host = h;
    }
    if (!host) return out;

    const cookies = parseCookieHeader(req.get('cookie'));
    const u = userData || {};
    const fbcBody = typeof u.fbc === 'string' ? u.fbc : '';
    const fbpBody = typeof u.fbp === 'string' ? u.fbp : '';
    if (fbcBody && !cookies._fbc) cookies._fbc = fbcBody;
    if (fbpBody && !cookies._fbp) cookies._fbp = fbpBody;

    const builder = new ParamBuilder();
    const xff = req.get('x-forwarded-for') ?? null;
    const remote = (req.socket?.remoteAddress as string | undefined) ?? null;
    builder.processRequest(host, query, cookies, req.get('referer') || null, xff, remote);

    const fbc = builder.getFbc();
    const fbp = builder.getFbp();
    if (fbc) out.fbc = fbc;
    if (fbp) out.fbp = fbp;
  } catch (err) {
    console.warn('[Meta ParamBuilder] ingest:', err);
  }
  return out;
}

/** Mescla fbc/fbp oficiais sobre o user_data do evento (preserva demais campos). */
export function mergeUserDataWithMetaParamBuilder(
  req: Request,
  eventSourceUrl: string,
  userData: UserDataLike | undefined | null
): UserDataLike {
  const base = { ...(userData || {}) } as UserDataLike;
  const pb = applyMetaParamBuilderToIngest(req, eventSourceUrl, base);
  if (pb.fbc) base.fbc = pb.fbc;
  if (pb.fbp) base.fbp = pb.fbp;
  return base;
}
