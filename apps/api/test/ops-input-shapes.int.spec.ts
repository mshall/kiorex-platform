import { createCtx, TestCtx } from './harness';

/** KX-PT-L3: ops-only endpoints answer 4xx, never 500, for payloads of the wrong shape and for unknown ids (they used to surface Prisma / TypeErrors as INTERNAL_ERROR). */
describe('ops-only endpoints: wrongly shaped input is a 4xx', () => {
  let c: TestCtx;
  let ops: { Authorization: string }; let sa: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); ops = await c.as('ops_1', { roles: ['ops_admin'] }); sa = await c.as('sa_1', { roles: ['super_admin'] }); });

  const cases: [string, string, unknown, number][] = [
    ['put', '/api/v1/admin/flags/products/unknown-product', { active: 'yes' }, 400],
    ['put', '/api/v1/admin/flags/products/unknown-product', [1], 400],
    ['put', '/api/v1/admin/flags/products/unknown-product', { webhookUrl: 5 }, 400],
    ['put', '/api/v1/admin/flags/products/unknown-product', { active: true }, 404],
    ['post', '/api/v1/admin/reconciliation/psp/import', { lines: 'x' }, 400],
    ['post', '/api/v1/admin/reconciliation/psp/import', [1], 400],
    ['post', '/api/v1/admin/reconciliation/psp/import', { lines: [{ psp: 1, pspRef: {}, kind: 'X', amountMinor: 'a', date: 'no' }] }, 400],
    ['post', '/api/v1/admin/complaints/no-such/resolve', {}, 404],
    ['post', '/api/v1/admin/complaints/no-such/resolve', [1], 404],
    ['post', '/api/v1/admin/pharmacy/orders/no-such/resubmit', [1], 404],
    ['post', '/api/v1/admin/pharmacy/orders/no-such/resubmit', {}, 404],
    ['post', '/api/v1/admin/lab/bookings/no-such/resubmit', {}, 404],
  ];
  it.each(cases)('%s %s %j -> %i', async (method, path, body, status) => {
    const auth = path.includes('/flags/') ? sa : ops;
    const r = await (c.http() as any)[method](path).set(auth).send(body);
    expect(r.status).toBe(status);
    expect(r.status).toBeLessThan(500);
  });
});
