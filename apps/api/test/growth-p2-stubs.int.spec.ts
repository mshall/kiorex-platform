import { createCtx, TestCtx } from './harness';

/** GRW-P2-X1: the Phase 2 module stubs answer every reserved route 404 FEATURE_DISABLED (stub: true) until their package ships; nothing is hidden, nothing throws a 500. */
describe('growth Phase 2 module stubs', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });

  it('the lifecycle admin route is a real endpoint now (GRW-P2-E): it asks for a sign-in instead of answering the stub', async () => {
    const r = await c.http().get('/api/v1/admin/growth/lifecycle');
    expect(r.status).toBe(401);
    expect(r.body).not.toMatchObject({ stub: true });
  });
});
