import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { getClientIp, isIpv6Address } from './ip';

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

  it('escolhe IPv6 no XFF mesmo se o primeiro hop for IPv4', () => {
    expect(
      getClientIp(
        fakeReq({
          'x-forwarded-for': '203.0.113.10, 2001:db8::abcd',
        })
      )
    ).toBe('2001:db8::abcd');
  });

  it('cai no IPv4 quando não há IPv6', () => {
    expect(getClientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.10' }))).toBe('203.0.113.10');
  });

  it('normaliza IPv4-mapped IPv6', () => {
    expect(getClientIp(fakeReq({ 'cf-connecting-ip': '::ffff:203.0.113.10' }))).toBe('203.0.113.10');
  });
});

describe('isIpv6Address', () => {
  it('detecta IPv6', () => {
    expect(isIpv6Address('2001:db8::1')).toBe(true);
    expect(isIpv6Address('203.0.113.10')).toBe(false);
  });
});
