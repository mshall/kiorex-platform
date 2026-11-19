import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { OutboxService, backoffMs, OUTBOX_MAX_ATTEMPTS } from '../src/outbox/outbox-public';

describe('outbox (KX-09 §01) + ops console API (KXM-OP-01..06)', () => {
  let c: TestCtx;
  let ops: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); ops = await c.as('ops_1', { roles: ['ops_admin'] }); });

  it('transactional: event row commits/rolls back with the state change', async () => {
    const ob = c.get(OutboxService);
    await expect(c.prisma.$transaction(async (tx) => { await ob.enqueue(tx, { type: 'x', aggregateType: 'T', aggregateId: '1', payload: {} }); throw new Error('rollback'); })).rejects.toThrow();
    expect(await c.prisma.outboxEvent.count()).toBe(0);
    await c.prisma.$transaction(async (tx) => { await ob.enqueue(tx, { type: 'x', aggregateType: 'T', aggregateId: '1', payload: {} }); });
    expect(await c.prisma.outboxEvent.count()).toBe(1);
  });

  it('exponential backoff, DEAD after 8 attempts, ops replay delivers', async () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(backoffMs(1)).toBe(2000); expect(backoffMs(3)).toBe(8000); expect(backoffMs(20)).toBe(300_000);
    const ob = c.get(OutboxService);
    let ok = false;
    ob.register('flaky', async () => { if (!ok) throw new Error('boom'); });
    const e = await ob.enqueue(c.prisma, { type: 'flaky', aggregateType: 'T', aggregateId: '1', payload: {} });
    for (let i = 1; i <= 8; i++) {
      await c.prisma.outboxEvent.update({ where: { id: e!.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      const r = await ob.processBatch();
      expect(r.processed).toBe(1);
      const row = await c.prisma.outboxEvent.findUniqueOrThrow({ where: { id: e!.id } });
      expect(row.attempts).toBe(i);
      expect(row.status).toBe(i < 8 ? 'FAILED' : 'DEAD');
      if (i < 8) expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    }
    expect((await ob.processBatch()).processed).toBe(0); // DEAD rows are not retried
    const mon = await c.http().get('/api/v1/admin/outbox?status=DEAD').set(ops).expect(200);
    expect(mon.body.stats.dead).toBe(1);
    expect(mon.body.items[0].lastError).toBe('boom');
    ok = true;
    const rep = await c.http().post(`/api/v1/admin/outbox/${e!.id}/replay`).set(ops).expect(200);
    expect(rep.body.status).toBe('SENT');
    expect(await c.prisma.auditLog.count({ where: { action: 'outbox.replay' } })).toBe(1);
    await c.http().get('/api/v1/admin/outbox').set(await c.as('p')).expect(403);
  });

  it('dedupeKey makes enqueue idempotent', async () => {
    const ob = c.get(OutboxService);
    await ob.enqueue(c.prisma, { type: 'x', aggregateType: 'T', aggregateId: '1', payload: {}, dedupeKey: 'k' });
    expect(await ob.enqueue(c.prisma, { type: 'x', aggregateType: 'T', aggregateId: '1', payload: {}, dedupeKey: 'k' })).toBeNull();
    expect(await c.prisma.outboxEvent.count()).toBe(1);
  });

  it('OP-01/02/06: provider directory, booking timeline, liquidity, circuits; roles enforced', async () => {
    c.kiorly.slots = [futureSlot(72)];
    const pid = await seedProvider(c, {});
    const auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' });
    await c.http().get(`/api/v1/search/providers?q=derm`);
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    await c.webhook('COMPLETED', { externalReference: h.body.id });
    const dir = await c.http().get('/api/v1/admin/providers?status=LIVE').set(ops).expect(200);
    expect(dir.body.total).toBe(1);
    expect(dir.body.items[0].status).toBe('LIVE');
    const tl = await c.http().get(`/api/v1/admin/bookings/${h.body.id}/timeline`).set(ops).expect(200);
    expect(tl.body.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['INTENT', 'KIORLY_CALL', 'STATE']));
    expect(tl.body.webhooks.length).toBeGreaterThan(0);
    expect(tl.body.booking.patientSnapshot).toBeUndefined();
    expect((await c.http().get('/api/v1/admin/bookings?status=COMPLETED').set(ops)).body).toHaveLength(1);
    const liq = await c.http().get('/api/v1/admin/liquidity').set(ops).expect(200);
    expect(liq.body).toMatchObject({ liveDoctors: 1, attended: 1 });
    expect(liq.body.searchToBook).toBeGreaterThan(0);
    await c.http().get('/api/v1/admin/circuits').set(ops).expect(200);
    await c.http().get('/api/v1/admin/bookings').set(auth).expect(403);
    await c.http().get('/api/v1/admin/bookings').expect(401);
    await c.http().post('/api/v1/admin/payouts/run').set(ops).expect(200);
    await c.http().post('/api/v1/admin/reconciliation/psp/run').set(ops).expect(200);
    await c.http().post('/api/v1/admin/reconciliation/bookings/run').set(ops).expect(200);
    expect((await c.http().get('/api/v1/admin/reconciliation/runs').set(ops)).body.length).toBe(2);
    await c.http().post('/api/v1/admin/providers/sync').set(ops).expect(200);
  });
});
