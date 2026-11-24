import { ForbiddenException } from '@nestjs/common';
import { HealthController } from './health.controller';

/** KX-PT-L2: public liveness and readiness stay minimal; provider detail is internal-only. */
describe('health endpoints (KX-PT-L2)', () => {
  const ctl = new HealthController({ $queryRaw: async () => [{ '?column?': 1 }] } as never);
  const external = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '10.0.0.7' } };
  const internal = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  it('ready: external callers get only the status, internal callers the provider detail', async () => {
    const pub = (await ctl.ready(external)) as unknown as Record<string, unknown>;
    expect(Object.keys(pub)).toEqual(['status']);
    const inn = (await ctl.ready(internal)) as unknown as Record<string, unknown>;
    expect(Array.isArray(inn.providers)).toBe(true); expect(inn.leadSigning).toBeTruthy();
  });
  it('providers: 403 INTERNAL_ONLY for external callers, the directory for internal ones', () => {
    expect(() => ctl.providers(external)).toThrow(ForbiddenException);
    expect(Array.isArray(ctl.providers(internal).providers)).toBe(true);
  });
  it('live stays public and minimal', () => { expect(ctl.live()).toEqual({ status: 'ok' }); });
});
