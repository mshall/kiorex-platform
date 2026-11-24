import { createHmac } from 'node:crypto';
import { deriveIntakeSigningKey, verifyIntakeSignature } from '@kiorex/contracts';
import { DEV_LEAD_SIGNING_SECRET, leadSecrets, leadSigningKeys, leadSigningStatus, verifyLeadSigningStartup } from './lead-signing';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...extra });
const sign = (secret: string, body: string, ts: number) => ({ timestamp: String(ts), signature: `sha256=${createHmac('sha256', deriveIntakeSigningKey(secret)).update(`${ts}.${body}`).digest('hex')}` });
const accepts = (env: Record<string, string | undefined>, secret: string) => {
  const body = '{"x":1}'; const ts = Math.floor(Date.now() / 1000); const h = sign(secret, body, ts);
  return leadSigningKeys(env).some((signingKey) => verifyIntakeSignature({ signingKey, body, ...h }));
};

describe('lead signing secret', () => {
  it('uses the fixed dev value outside production only', () => {
    expect(leadSecrets({ NODE_ENV: 'development' })).toEqual([DEV_LEAD_SIGNING_SECRET]);
    expect(leadSecrets({})).toEqual([DEV_LEAD_SIGNING_SECRET]);
    expect(leadSecrets(prod())).toEqual([]);
    expect(accepts(prod(), DEV_LEAD_SIGNING_SECRET)).toBe(false);
  });

  it('accepts the configured secret in production and rejects a short or wrong one', () => {
    const env = prod({ PARTNER_LEAD_SIGNING_SECRET: A });
    expect(accepts(env, A)).toBe(true);
    expect(accepts(env, B)).toBe(false);
    expect(leadSecrets(prod({ PARTNER_LEAD_SIGNING_SECRET: 'short' }))).toEqual([]);
    expect(accepts(prod({ PARTNER_LEAD_SIGNING_SECRET: 'short' }), 'short')).toBe(false);
  });

  it('dual accept: "current,previous" verifies both, a third secret never, and only two are read', () => {
    const env = prod({ PARTNER_LEAD_SIGNING_SECRET: `${A},${B}` });
    expect(accepts(env, A)).toBe(true);
    expect(accepts(env, B)).toBe(true);
    expect(accepts(env, 'c'.repeat(64))).toBe(false);
    expect(leadSecrets(prod({ PARTNER_LEAD_SIGNING_SECRET: `${A},${B},${'c'.repeat(64)}` }))).toEqual([A, B]);
    expect(accepts(prod({ PARTNER_LEAD_SIGNING_SECRET: A }), B)).toBe(false); // after --finish-rotation the old one is gone
  });

  it('startup check: fails fast in production without a secret, passes with one, optional only when explicitly allowed', () => {
    expect(() => verifyLeadSigningStartup(prod())).toThrow(/PARTNER_LEAD_SIGNING_SECRET/);
    expect(() => verifyLeadSigningStartup(prod({ PARTNER_LEAD_SIGNING_SECRET: 'short' }))).toThrow();
    expect(verifyLeadSigningStartup(prod({ PARTNER_LEAD_SIGNING_SECRET: A }))).toEqual({ status: 'configured', previousAccepted: false });
    expect(verifyLeadSigningStartup(prod({ PARTNER_LEAD_SIGNING_OPTIONAL: 'true' })).status).toBe('not configured');
    expect(() => verifyLeadSigningStartup({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('status never contains the value', () => {
    const s = leadSigningStatus(prod({ PARTNER_LEAD_SIGNING_SECRET: `${A},${B}` }));
    expect(s).toEqual({ status: 'configured', previousAccepted: true });
    expect(JSON.stringify(s)).not.toContain(A);
    expect(JSON.stringify(leadSigningStatus(prod()))).toContain('not configured');
  });

  it('the startup error carries the variable name, never a value', () => {
    try { verifyLeadSigningStartup(prod({ PARTNER_LEAD_SIGNING_SECRET: 'tiny-secret' })); throw new Error('should throw'); } catch (e) { expect((e as Error).message).not.toContain('tiny-secret'); }
  });
});
