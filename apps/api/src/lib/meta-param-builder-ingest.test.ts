import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { mergeUserDataWithMetaParamBuilder } from './meta-param-builder-ingest';
import { fbclidFromFbcCookie } from './meta-attribution';

function fakeReq(headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    get: (name: string) => lower[name.toLowerCase()],
    headers: lower,
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as Request;
}

describe('mergeUserDataWithMetaParamBuilder', () => {
  it('cria fbc a partir do fbclid da página, sem mexer na caixa do clique', () => {
    const out = mergeUserDataWithMetaParamBuilder(
      fakeReq({ host: 'api.trajettu.com' }),
      'https://site.com.br/vsl?fbclid=IwAR0AbCdEf_Gh',
      {}
    );
    expect(typeof out.fbc).toBe('string');
    expect(fbclidFromFbcCookie(out.fbc as string)).toBe('IwAR0AbCdEf_Gh');
  });

  it('mantém o fbc do cookie quando a página não traz fbclid', () => {
    const fbc = `fb.1.${Date.now()}.IwAR0KeepMe`;
    const out = mergeUserDataWithMetaParamBuilder(
      fakeReq({ host: 'api.trajettu.com' }),
      'https://site.com.br/obrigado',
      { fbc }
    );
    expect(fbclidFromFbcCookie(out.fbc as string)).toBe('IwAR0KeepMe');
  });

  it('não inventa fbc em visita sem clique de anúncio', () => {
    const out = mergeUserDataWithMetaParamBuilder(
      fakeReq({ host: 'api.trajettu.com' }),
      'https://site.com.br/',
      {}
    );
    expect(out.fbc).toBeUndefined();
    expect(typeof out.fbp).toBe('string');
  });
});
