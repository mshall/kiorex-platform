import { createCtx, TestCtx } from './harness';

/** GRW-P2-X1: the Phase 2 module stubs answer every reserved route 404 FEATURE_DISABLED (stub: true) until their package ships; nothing is hidden, nothing throws a 500. */
describe('growth Phase 2 module stubs', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });

  const routes: Array<[string, 'get' | 'post', string, string, string]> = [
    ['assistant link', 'post', '/api/v1/growth/v1/assistant/link', 'kiorex.whatsapp_ai_assistant', 'GRW-P2-D'],
  ];
  it.each(routes)('%s answers 404 FEATURE_DISABLED with the flag and the package that will fill it', async (_n, method, path, key, pkg) => {
    const r = await c.http()[method](path).send({});
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key, pkg, stub: true });
  });
});
