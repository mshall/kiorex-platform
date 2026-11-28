import { createServer, type Server } from 'node:http';
import { verifyKiorlyRequest } from '@kiorex/contracts';
import { ProductPlansClient } from './product-plans.client';

describe('ProductPlansClient: signed, platform-level door to Pharmacy and Lab prices', () => {
  let server: Server; let port = 0; const seen: Array<{ method: string; path: string; ok: boolean; body: string }> = []; let mode: 'ok' | '404' | '409' | '500' = 'ok';
  const SECRET = 'plans-admin-test-secret-0123456789';
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const v = verifyKiorlyRequest({ headers: req.headers as never, method: req.method!, path: req.url!.split('?')[0]!, body: raw.length ? raw : '', secret: SECRET });
        seen.push({ method: req.method!, path: req.url!, ok: v.ok && req.headers['x-kiorly-client-key'] === 'plans-admin-key', body: raw.toString() });
        const send = (s: number, b: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); };
        if (mode === '404') return send(404, { code: 'NOT_FOUND' });
        if (mode === '409') return send(409, { code: 'PRICE_NOT_AFTER_LATEST', message: 'later please', details: { newestVersion: 2 } });
        if (mode === '500') return send(500, {});
        send(200, { editions: ['LITE'], prices: [], organisations: [] });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    process.env.KIORLY_PLANS_ADMIN_CLIENT_KEY = 'plans-admin-key'; process.env.KIORLY_PLANS_ADMIN_CLIENT_SECRET = SECRET;
    process.env.KIORLY_PHARMACY_BASE_URL = `http://127.0.0.1:${port}`; process.env.KIORLY_LAB_BASE_URL = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); for (const k of ['KIORLY_PLANS_ADMIN_CLIENT_KEY', 'KIORLY_PLANS_ADMIN_CLIENT_SECRET', 'KIORLY_PHARMACY_BASE_URL', 'KIORLY_LAB_BASE_URL']) delete process.env[k]; });
  beforeEach(() => { seen.length = 0; mode = 'ok'; });

  it('signs every request with the platform credential and uses each product\'s own path', async () => {
    const c = new ProductPlansClient();
    expect(c.configured()).toBe(true);
    await c.overview('PHARMACY'); await c.overview('LAB'); await c.price('LAB', { preview: true });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /marketplace/v1/plans', 'GET /api/v1/integration/v1/plans', 'POST /api/v1/integration/v1/plans/prices']);
    expect(seen.every((s) => s.ok)).toBe(true);
    expect(JSON.parse(seen[2]!.body)).toEqual({ preview: true });
  });
  it('a product refusal keeps its code; a missing route and a server error are "unavailable", never a guess', async () => {
    const c = new ProductPlansClient();
    mode = '409';
    await expect(c.price('PHARMACY', {})).rejects.toMatchObject({ code: 'PRICE_NOT_AFTER_LATEST', status: 409 });
    mode = '404';
    await expect(c.overview('LAB')).rejects.toMatchObject({ code: 'PRODUCT_PRICES_UNAVAILABLE', status: 503 });
    mode = '500';
    await expect(c.overview('LAB')).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE', status: 503 });
  });
  it('without a credential nothing is called', async () => {
    const k = process.env.KIORLY_PLANS_ADMIN_CLIENT_KEY; delete process.env.KIORLY_PLANS_ADMIN_CLIENT_KEY;
    try {
      const c = new ProductPlansClient();
      expect(c.configured()).toBe(false);
      await expect(c.overview('PHARMACY')).rejects.toMatchObject({ code: 'PRODUCT_PRICES_NOT_CONFIGURED' });
      expect(await c.cachedOverview('PHARMACY')).toBeNull();
      expect(seen).toHaveLength(0);
    } finally { process.env.KIORLY_PLANS_ADMIN_CLIENT_KEY = k; }
  });
});
