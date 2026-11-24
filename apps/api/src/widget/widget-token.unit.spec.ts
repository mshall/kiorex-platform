import { issueWidgetToken, verifyWidgetToken } from './widget-token';

describe('widget session token (GRW-P1-G)', () => {
  const now = Date.UTC(2026, 10, 24, 10, 0, 0);
  it('round-trips, binds the organisation and origin, and expires', () => {
    const { token, expiresAt } = issueWidgetToken({ org: 'clinic_1', origin: 'https://Clinic.example' }, 900, now);
    expect(expiresAt).toBe(new Date(now + 900_000).toISOString());
    const v = verifyWidgetToken(token, now + 1000);
    expect(v).toMatchObject({ ok: true, claims: { org: 'clinic_1', origin: 'https://clinic.example', v: 1 } });
    expect(verifyWidgetToken(token, now + 901_000)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
  it('rejects tampering: changed payload, changed signature, wrong prefix, garbage, oversized', () => {
    const { token } = issueWidgetToken({ org: 'clinic_1', origin: 'https://a.example' }, 900, now);
    const [p, b, s] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url').toString()), origin: 'https://evil.example' })).toString('base64url');
    expect(verifyWidgetToken(`${p}.${forged}.${s}`, now).ok).toBe(false);
    expect(verifyWidgetToken(`${p}.${b}.${s.slice(0, -2)}xx`, now).ok).toBe(false);
    expect(verifyWidgetToken(`kxw2.${b}.${s}`, now).ok).toBe(false);
    for (const g of ['', 'a.b', 'kxw1..', null, 42, undefined, 'x'.repeat(2000)]) expect(verifyWidgetToken(g as string, now).ok).toBe(false);
  });
  it('two tokens for the same input differ (nonce) and the sandbox flag is part of the signed claims', () => {
    const a = issueWidgetToken({ org: 'o', origin: 'http://localhost:4000', sandbox: true }, 60, now).token;
    const b = issueWidgetToken({ org: 'o', origin: 'http://localhost:4000', sandbox: true }, 60, now).token;
    expect(a).not.toBe(b);
    expect((verifyWidgetToken(a, now) as { claims: { sbx?: number } }).claims.sbx).toBe(1);
  });
});
