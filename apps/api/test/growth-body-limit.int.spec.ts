import { createCtx, TestCtx } from './harness';
import { GROWTH_PUBLIC_BODY_LIMIT_BYTES } from '../src/app.setup';

/**
 * Public growth and widget endpoints take small JSON only (32 KiB, enforced while the body is streamed, so also without Content-Length). The global 8 MB limit stays for vault uploads and
 * every other route. A refused body is 413 PAYLOAD_TOO_LARGE in the API error shape, not an HTML page, and nothing is written.
 */
describe('public growth endpoint body limit', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); });
  const pad = (n: number) => 'x'.repeat(n);

  it('refuses an oversized body on growth/v1 and widget/v1 routes with 413 in the API error shape', async () => {
    const big = { analytics: true, evidence: pad(GROWTH_PUBLIC_BODY_LIMIT_BYTES + 1024) };
    for (const path of ['/api/v1/growth/v1/consent', '/api/v1/growth/v1/touch', '/api/v1/growth/v1/events', '/api/v1/growth/v1/experiments/exposures', '/api/v1/widget/v1/anything']) {
      const r = await c.http().post(path).send(big);
      expect({ path, status: r.status, code: r.body.code }).toEqual({ path, status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    expect(await c.prisma.growthVisitorConsent.count()).toBe(0);
  });

  it('a normal small body is untouched: consent is recorded, and the limit sits just above a few KiB', async () => {
    const ok = await c.http().post('/api/v1/growth/v1/consent').send({ analytics: false, marketing: false, textVersion: 'v1', source: 'web', evidence: pad(2000) });
    expect(ok.status).toBe(201);
    const edge = await c.http().post('/api/v1/growth/v1/consent').send({ analytics: false, evidence: pad(GROWTH_PUBLIC_BODY_LIMIT_BYTES - 200) });
    expect(edge.status).not.toBe(413);
  });

  it('a chunked body without Content-Length is stopped as well', async () => {
    // the server may close the socket while the client is still sending: a reset is as good as the 413 (nothing was parsed or written either way)
    const r = await c.http().post('/api/v1/growth/v1/consent').set('Transfer-Encoding', 'chunked').set('Content-Type', 'application/json').send(JSON.stringify({ analytics: true, evidence: pad(GROWTH_PUBLIC_BODY_LIMIT_BYTES * 2) })).then((x) => x.status, (e: { code?: string }) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? 413 : -1));
    expect(r).toBe(413);
    expect(await c.prisma.growthVisitorConsent.count()).toBe(0);
  });

  it('routes outside growth keep the 8 MB limit: a 200 KiB JSON body reaches the (authenticated) vault route instead of being cut at the parser', async () => {
    const patient = await c.as('p_bl');
    const r = await c.http().post('/api/v1/me/vault/uploads').set(patient).send({ name: 'x', blob: pad(200_000) });
    expect(r.status).not.toBe(413);
  });
});
