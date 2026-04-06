/**
 * Integração com a Parameter Builder Library oficial da Meta (Node).
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameter-builder-library
 */
import type { Request } from 'express';
import { ParamBuilder } from 'capi-param-builder-nodejs';

export type MetaParamBuilderResult = {
  fbc: string | null;
  fbp: string | null;
  clientIpAddress: string | null;
};

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      v = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      // mantém bruto
    }
    out[k] = v;
  }
  return out;
}

function mergeCookiesForBuilder(
  headerCookies: Record<string, string>,
  userData: Record<string, unknown>
): Record<string, string> {
  const merged: Record<string, string> = { ...headerCookies };
  const fbc = typeof userData.fbc === 'string' ? userData.fbc.trim() : '';
  const fbp = typeof userData.fbp === 'string' ? userData.fbp.trim() : '';
  if (fbc && !merged._fbc) merged._fbc = fbc;
  if (fbp && !merged._fbp) merged._fbp = fbp;
  return merged;
}

/**
 * Executa o ParamBuilder da Meta com host/query/cookies alinhados à página do evento (não ao host da API).
 */
export function runMetaParamBuilder(
  req: Request,
  userData: Record<string, unknown>,
  eventSourceUrl: string | undefined
): MetaParamBuilderResult {
  const empty: MetaParamBuilderResult = { fbc: null, fbp: null, clientIpAddress: null };

  let hostForProcess = (req.get('host') || '').trim() || 'localhost';
  let domainForConstructor = (typeof req.hostname === 'string' && req.hostname ? req.hostname : hostForProcess.split(':')[0]) || 'localhost';
  const queries: Record<string, string> = {};

  if (eventSourceUrl) {
    try {
      const u = new URL(eventSourceUrl.trim());
      hostForProcess = u.host;
      domainForConstructor = u.hostname;
      u.searchParams.forEach((value, key) => {
        queries[key] = value;
      });
    } catch {
      /* mantém valores da requisição */
    }
  }

  try {
    const headerCookies = parseCookieHeader(req.headers.cookie);
    const cookies = mergeCookiesForBuilder(headerCookies, userData);
    const builder = new ParamBuilder([domainForConstructor]);

    builder.processRequest(
      hostForProcess,
      Object.keys(queries).length > 0 ? queries : null,
      Object.keys(cookies).length > 0 ? cookies : null,
      typeof req.headers.referer === 'string' ? req.headers.referer : null,
      typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : null,
      req.socket?.remoteAddress ?? null
    );

    return {
      fbc: builder.getFbc(),
      fbp: builder.getFbp(),
      clientIpAddress: builder.getClientIpAddress(),
    };
  } catch (e) {
    console.warn('[Meta ParamBuilder] processRequest falhou, usando só payload do cliente:', e);
    return empty;
  }
}
