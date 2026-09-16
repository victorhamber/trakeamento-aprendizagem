import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { getClientIp, isIpv6Address, isPublicClientIp } from './ip';

function fakeReq(headers: Record<string, string>, ip?: string): Request {
  return { headers, ip } as unknown as Request;
}

describe('getClientIp', () => {
  it('prefere cf-connecting-ipv6 sobre cf-connecting-ip IPv4', () => {
    expect(
      getClientIp(
        fakeReq({
          'cf-connecting-ipv6': '2001:db8::1',
          'cf-connecting-ip': '203.0.113.10',
        })
      )
    ).toBe('2001:db8::1');
  });

  it('não troca o IPv4 do visitante por IPv6 de hop posterior no XFF (proxy/CDN)', () => {
    expect(
      getClientIp(
        fakeReq({
          'x-forwarded-for': '203.0.113.10, 2001:db8::abcd',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('não deixa x-real-ip de proxy IPv6 ganhar do cf-connecting-ip do visitante', () => {
    expect(
      getClientIp(
        fakeReq({
          'cf-connecting-ip': '203.0.113.10',
          'x-real-ip': '2001:db8::ffff',
          'x-forwarded-for': '203.0.113.10, 2001:db8::ffff',
        })
      )
    ).toBe('203.0.113.10');
  });

  it('ignora IP privado de EasyPanel/Docker no x-real-ip', () => {
    expect(
      getClientIp(
        fakeReq({
          'x-real-ip': '10.0.1.4',
          'x-forwarded-for': '198.51.100.20',
        })
      )
    ).toBe('198.51.100.20');
  });

  it('cai no IPv4 quando não há IPv6 do cliente', () => {
    expect(getClientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.10' }))).toBe('203.0.113.10');
  });

  it('normaliza IPv4-mapped IPv6', () => {
    expect(getClientIp(fakeReq({ 'cf-connecting-ip': '::ffff:203.0.113.10' }))).toBe('203.0.113.10');
  });

  it('não envia loopback se for o único candidato', () => {
    expect(getClientIp(fakeReq({}, '127.0.0.1'))).toBe('');
  });
});

describe('isIpv6Address', () => {
  it('detecta IPv6', () => {
    expect(isIpv6Address('2001:db8::1')).toBe(true);
    expect(isIpv6Address('203.0.113.10')).toBe(false);
  });
});

describe('isPublicClientIp', () => {
  it('rejeita RFC1918 e loopback', () => {
    expect(isPublicClientIp('10.0.0.1')).toBe(false);
    expect(isPublicClientIp('192.168.1.1')).toBe(false);
    expect(isPublicClientIp('127.0.0.1')).toBe(false);
    expect(isPublicClientIp('172.16.0.1')).toBe(false);
  });

  it('aceita IPv4/IPv6 públicos', () => {
    expect(isPublicClientIp('203.0.113.10')).toBe(true);
    expect(isPublicClientIp('2001:db8::1')).toBe(true);
  });
});
