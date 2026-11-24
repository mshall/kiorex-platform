import { issueLinkToken, LT_MAX_TTL_SECONDS, verifyLinkToken } from './link-token';

const key = Buffer.from('unit-test-key-0123456789abcdef');
const NOW = Date.parse('2026-11-24T12:00:00Z');

describe('lt link token', () => {
  it('round-trips org, code and window', () => {
    const t = issueLinkToken(key, { orgRef: 'org_A', linkCode: '7K2M9X4Q', now: NOW, ttlSeconds: 600, nonce: 'n1' });
    const v = verifyLinkToken(key, t, NOW + 60_000);
    expect(v).toEqual({ ok: true, claims: { org: 'org_A', code: '7K2M9X4Q', iat: NOW / 1000, exp: NOW / 1000 + 600, n: 'n1' } });
  });
  it('lifetime is capped at 30 minutes even if a longer ttl is requested', () => {
    const t = issueLinkToken(key, { orgRef: 'o', linkCode: 'c', now: NOW, ttlSeconds: 86_400 });
    const v = verifyLinkToken(key, t, NOW) as { ok: true; claims: { exp: number; iat: number } };
    expect(v.claims.exp - v.claims.iat).toBe(LT_MAX_TTL_SECONDS);
  });
  it('expires: valid at 29 min 59 s, EXPIRED at 30 min', () => {
    const t = issueLinkToken(key, { orgRef: 'o', linkCode: 'c', now: NOW });
    expect(verifyLinkToken(key, t, NOW + 1_799_000).ok).toBe(true);
    expect(verifyLinkToken(key, t, NOW + 1_800_000)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
  it('rejects a token from the future beyond clock skew', () => {
    const t = issueLinkToken(key, { orgRef: 'o', linkCode: 'c', now: NOW });
    expect(verifyLinkToken(key, t, NOW - 120_000)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
  it('rejects a tampered payload (org swapped to dodge the fee), a wrong key, garbage and oversize input', () => {
    const t = issueLinkToken(key, { orgRef: 'org_A', linkCode: 'c', now: NOW });
    const [p, body, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), org: 'org_B' })).toString('base64url');
    expect(verifyLinkToken(key, `${p}.${forged}.${s}`, NOW)).toEqual({ ok: false, reason: 'INVALID' });
    expect(verifyLinkToken(Buffer.from('another-key-0123456789'), t, NOW)).toEqual({ ok: false, reason: 'INVALID' });
    for (const bad of ['', 'abc', 'kxl1.a', 'kxl1.a.b.c', 'x'.repeat(600), 42, null, undefined]) expect(verifyLinkToken(key, bad, NOW)).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('a token that claims a longer life than 30 minutes is invalid even with a correct signature', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const payload = Buffer.from(JSON.stringify({ org: 'o', code: 'c', iat: NOW / 1000, exp: NOW / 1000 + 7200, n: 'x' })).toString('base64url');
    const sig = createHmac('sha256', key).update(`kxl1.${payload}`).digest().toString('base64url');
    expect(verifyLinkToken(key, `kxl1.${payload}.${sig}`, NOW)).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('carries no personal data: the payload only holds org, code, times and a nonce', () => {
    const t = issueLinkToken(key, { orgRef: 'org_A', linkCode: 'c', now: NOW });
    expect(Object.keys(JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString())).sort()).toEqual(['code', 'exp', 'iat', 'n', 'org']);
  });
});
