import { describe, expect, it } from 'vitest';
import {
  fbclidFromEventSourceUrl,
  fbclidFromFbcCookie,
  isPayloadHelperValidFbc,
  preferUnmodifiedFbc,
  preserveFreshMetaFbc,
} from './meta-attribution';

const FBCLID =
  'IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk';
const FBCLID_AEM =
  'IwcGRvZgVleHRuA2FlbQEwAGFkaWQBqzXnOAdzmHNydGMGYXBwX2lkDDM1MDY4NTUzMTcyOAABHuDYS1jn62d82KIsO8ylJWkNH3vyZccCNYYSdCQ5gopzfHUf4dtOUbG6TTIX_aem_FrTxCXE9wvovjkij5pM1Hg';

describe('Payload Helper / fbc', () => {
  it('aceita fbc clássico de 4 partes', () => {
    const fbc = `fb.1.1554763741205.${FBCLID}`;
    expect(isPayloadHelperValidFbc(fbc)).toBe(true);
    expect(fbclidFromFbcCookie(fbc)).toBe(FBCLID);
    expect(preserveFreshMetaFbc(fbc)).toBeUndefined();
  });

  it('aceita fbc com appendix do Param Builder e não trata o appendix como fbclid', () => {
    const ts = Date.now() - 60_000;
    const fbc = `fb.1.${ts}.${FBCLID_AEM}.AQQAAQMB`;
    expect(isPayloadHelperValidFbc(fbc)).toBe(true);
    expect(fbclidFromFbcCookie(fbc)).toBe(FBCLID_AEM);
    expect(preserveFreshMetaFbc(fbc)).toBe(fbc);
  });

  it('não converte o fbclid para minúsculas ao extrair do cookie', () => {
    const ts = Date.now() - 60_000;
    const fbc = `fb.1.${ts}.${FBCLID}.AQQAAQMB`;
    expect(fbclidFromFbcCookie(fbc)).toBe(FBCLID);
    expect(fbclidFromFbcCookie(fbc)).not.toBe(FBCLID.toLowerCase());
  });

  it('rejeita espaço interno no valor', () => {
    expect(isPayloadHelperValidFbc(`fb.1.${Date.now()}.Iw AR2`)).toBe(false);
  });
});

describe('preferUnmodifiedFbc', () => {
  it('não regenera timestamp quando o cookie já tem o mesmo fbclid + appendix', () => {
    const ts = Date.now() - 3_600_000;
    const cookie = `fb.1.${ts}.${FBCLID}.AQQAAQMB`;
    const rebuilt = `fb.1.${Date.now()}.${FBCLID}`;
    expect(preferUnmodifiedFbc(cookie, rebuilt, FBCLID)).toBe(cookie);
  });

  it('permite appendix oficial no mesmo clique e mesmo timestamp', () => {
    const ts = Date.now() - 3_600_000;
    const cookie = `fb.1.${ts}.${FBCLID}`;
    const built = `fb.1.${ts}.${FBCLID}.AQQAAQMB`;
    expect(preferUnmodifiedFbc(cookie, built, FBCLID)).toBe(built);
  });

  it('troca só quando a URL traz um fbclid diferente do cookie', () => {
    const ts = Date.now() - 3_600_000;
    const cookie = `fb.1.${ts}.${FBCLID}.AQQAAQMB`;
    const newId = 'IwBNEwClick';
    const built = `fb.1.${Date.now()}.${newId}.AQQAAQMB`;
    expect(preferUnmodifiedFbc(cookie, built, newId)).toBe(built);
  });

  it('lê fbclid da event_source_url sem alterar caixa', () => {
    const url = `https://example.com/land/?fbclid=${FBCLID}&utm_source=fb`;
    expect(fbclidFromEventSourceUrl(url)).toBe(FBCLID);
  });
});
