import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';
import { moderate } from '../src/trust/trust-public';

describe('trust: verified reviews & moderation (KXM-RV-01..03)', () => {
  let c: TestCtx;
  let auth: { Authorization: string };
  let pid: string;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [futureSlot(72)];
    pid = await seedProvider(c, {});
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' });
  });
  const visit = async (complete = true) => {
    const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(201);
    await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    if (complete) { await c.webhook('CHECKED_IN', { externalReference: h.body.id }); await c.webhook('COMPLETED', { externalReference: h.body.id }); }
    return h.body.id as string;
  };
  const review = (id: string, body: object) => c.http().post(`/api/v1/bookings/${id}/review`).set(auth).send(body);

  it('RV-01 only completed Kiorex visits; one review per appointment; rating 1..5; owner only', async () => {
    const open = await visit(false);
    expect((await review(open, { rating: 5 })).status).toBe(403);
    expect((await review(open, { rating: 5 })).body.code).toBe('NOT_A_COMPLETED_VISIT');
    const done = await visit();
    expect((await review(done, { rating: 6 })).status).toBe(400);
    await c.http().post(`/api/v1/bookings/${done}/review`).set(await c.as('sub_hassan')).send({ rating: 5 }).expect(404);
    const ok = await review(done, { rating: 4, text: 'Great doctor' }).expect(201);
    expect(ok.body.status).toBe('VISIBLE');
    expect((await review(done, { rating: 5 })).status).toBe(409);
    const pub = await c.http().get(`/api/v1/providers/${pid}/reviews`).expect(200);
    expect(pub.body).toMatchObject({ average: 4, count: 1 });
    expect(pub.body.reviews).toHaveLength(1);
    expect((await c.http().get(`/api/v1/providers/${pid}`)).body.rating).toEqual({ average: 4, count: 1 });
  });

  it('RV-01 editable for 7 days only', async () => {
    const done = await visit();
    const r = (await review(done, { rating: 3 })).body;
    await c.http().put(`/api/v1/reviews/${r.id}`).set(auth).send({ rating: 5 }).expect(200);
    await c.prisma.review.update({ where: { id: r.id }, data: { editableUntil: new Date(Date.now() - 1000) } });
    const late = await c.http().put(`/api/v1/reviews/${r.id}`).set(auth).send({ rating: 1 }).expect(403);
    expect(late.body.code).toBe('REVIEW_EDIT_WINDOW_CLOSED');
  });

  it('RV-02 PHI / abuse detection hides the review and opens a moderation case; moderator restores or keeps hidden', async () => {
    expect(moderate('call me on 01012345678').flags).toContain('PHI:PHONE');
    expect(moderate('my id 29004020101234').flags).toContain('PHI:NATIONAL_ID');
    expect(moderate('mail a.b@x.com').flags).toContain('PHI:EMAIL');
    expect(moderate('هذا الطبيب نصاب').flags).toContain('ABUSE');
    expect(moderate('Wonderful and kind').hidden).toBe(false);
    const done = await visit();
    const r = (await review(done, { rating: 1, text: 'Dr is a scam, call 01012345678' })).body;
    expect(r.status).toBe('HIDDEN');
    expect((await c.http().get(`/api/v1/providers/${pid}/reviews`)).body.count).toBe(0);
    const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
    const q = await c.http().get('/api/v1/admin/moderation').set(ops).expect(200);
    expect(q.body).toHaveLength(1);
    await c.http().get('/api/v1/admin/moderation').set(auth).expect(403);
    await c.http().post(`/api/v1/admin/moderation/${q.body[0].id}/resolve`).set(ops).send({ resolution: 'RESTORED' }).expect(200);
    expect((await c.http().get(`/api/v1/providers/${pid}/reviews`)).body.count).toBe(1);
  });

  it('RV-03 aggregate + reviews (incl. HIDDEN status) pushed to Kiorly via outbox; NOT_A_COMPLETED_VISIT rejections recorded; replies shown', async () => {
    const done = await visit();
    const r = (await review(done, { rating: 5, text: 'Thanks' })).body;
    await c.get(OutboxService).processBatch();
    expect(c.kiorly.reviewPushes).toHaveLength(1);
    const push = c.kiorly.reviewPushes[0];
    expect(push).toMatchObject({ clinicId: 'cl_1', clinicianId: 'dr_1', averageRating: 5, reviewCount: 1 });
    expect(push.reviews[0]).toMatchObject({ reviewId: r.id, appointmentId: 'apt_1', rating: 5, moderationStatus: 'VISIBLE' });
    expect((await c.prisma.review.findUniqueOrThrow({ where: { id: r.id } })).syncStatus).toBe('SYNCED');
    c.kiorly.rejectReviews = [r.id];
    await c.http().put(`/api/v1/reviews/${r.id}`).set(auth).send({ rating: 4 }).expect(200);
    await c.get(OutboxService).processBatch();
    expect((await c.prisma.review.findUniqueOrThrow({ where: { id: r.id } })).syncStatus).toBe('REJECTED');
    // clinic reply event
    await c.webhook('REVIEW_REPLY_POSTED', { appointmentId: 'apt_1', reply: 'Thank you!' }, { aggregateId: 'apt_1' });
    expect((await c.http().get(`/api/v1/providers/${pid}/reviews`)).body.reviews[0].clinicReply).toBe('Thank you!');
    // hide → aggregate excludes it and HIDDEN is synced
    const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
    await c.prisma.review.update({ where: { id: r.id }, data: { status: 'HIDDEN' } });
    await c.prisma.moderationCase.create({ data: { reviewId: r.id, reason: 'manual' } });
    const q = (await c.http().get('/api/v1/admin/moderation').set(ops)).body[0];
    await c.http().post(`/api/v1/admin/moderation/${q.id}/resolve`).set(ops).send({ resolution: 'KEPT_HIDDEN' }).expect(200);
    await c.get(OutboxService).processBatch();
    const last = c.kiorly.reviewPushes.at(-1);
    expect(last.reviewCount).toBe(0);
    expect(last.reviews[0].moderationStatus).toBe('HIDDEN');
  });

  it('complaints with SLA', async () => {
    const r = await c.http().post('/api/v1/complaints').set(auth).send({ category: 'BILLING', body: 'Charged twice' }).expect(201);
    expect(new Date(r.body.slaDueAt).getTime()).toBeGreaterThan(Date.now());
    const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
    const list = await c.http().get('/api/v1/admin/complaints').set(ops).expect(200);
    expect(list.body[0].slaBreached).toBe(false);
    await c.http().post(`/api/v1/admin/complaints/${r.body.id}/resolve`).set(ops).expect(200);
  });
});
