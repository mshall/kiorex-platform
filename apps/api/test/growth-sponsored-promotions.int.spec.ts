import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

const H = { marketplaceConsent: true, remindersConsent: true };
const ADMIN = '/api/v1/admin/growth/sponsored-promotions';
const FLAG = 'growth.sponsored_promotions';
let seq = 0;

/** GRW-P2-S, Kiorex side, over the real HTTP stack and Postgres with the fake Clinic (mock providers only): projection, quote, reservation and the booking block, the Clinic's budget events, review with maker-checker, ledger view, flag OFF. */
describe('growth sponsored promotions (GRW-P2-S, Kiorex side)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string; let admin: { Authorization: string }; let admin2: { Authorization: string }; let ops: { Authorization: string };
  const unlock = async () => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); c.flags.invalidate(); };
  const event = (o: Record<string, unknown> = {}) => ({ promotionId: `prm_${++seq}`, version: 1, orgRef: 'tn_1', clinicId: 'cl_1', status: 'ACTIVE', discount: { kind: 'FIXED_MINOR', value: 5000 }, scope: { doctorIds: [], appointmentTypeIds: [], careTypes: ['IN_CLINIC'] }, eligibility: { newPatientsOnly: false, firstBookingOnly: false, minLeadHours: 0, kiorexOnly: true }, budgetCapMinor: 100_000, fundingMode: 'WALLET_ONLY',
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), patientCopy: { ar: 'خصم على سعر الكشف برعاية العيادة', en: 'A discount on the visit fee, sponsored by the clinic' }, name: { ar: 'خصم الكشف', en: 'Visit discount' }, contentHash: 'a'.repeat(64), at: new Date().toISOString(), ...o });
  const push = (data: Record<string, unknown>, type = 'PROVIDER_PROMOTION_UPDATED') => c.webhook(type, data, { aggregateId: String(data.promotionId), eventId: `evt_${++seq}_${Math.random().toString(36).slice(2)}`, aggregateType: 'SponsoredPromotion' });
  const toReview = (o: Record<string, unknown> = {}) => event({ status: 'IN_REVIEW', ...o });
  const hold = (slot = futureSlot(), who = auth) => c.http().post('/api/v1/bookings').set(who).send({ providerId: pid, typeId: 'typ_1', ...slot });
  const confirm = (id: string, who = auth) => c.http().post(`/api/v1/bookings/${id}/confirm`).set(who).send(H);
  const line = (bookingId: string) => c.prisma.bookingSponsoredDiscount.findUnique({ where: { bookingIntentId: bookingId } });
  const bookingCalls = () => c.kiorly.callsTo('POST', '/bookings').filter((x) => x.path.endsWith('/bookings'));

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); seq = 0;
    c.kiorly.slots = [futureSlot(), futureSlot(49), futureSlot(50), futureSlot(51), futureSlot(52)];
    pid = await seedProvider(c, {});
    auth = await c.as('sub_amira'); await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
    admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); admin2 = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
    await unlock();
  });

  describe('projection and quote', () => {
    it('the projection follows the Clinic (newest event wins, an old event or an unknown status is ignored) and holds public text only', async () => {
      const e = event({ promotionId: 'prm_x' });
      expect((await push(e)).body.status).toBe('APPLIED');
      expect((await push({ ...e, status: 'PAUSED', at: new Date(Date.now() - 60_000).toISOString() })).body.status).toBe('IGNORED'); // older: ignored
      expect((await push({ ...e, status: 'NONSENSE', at: new Date(Date.now() + 1000).toISOString() })).body.status).toBe('IGNORED');
      await push({ ...e, status: 'PAUSED', at: new Date(Date.now() + 2000).toISOString() });
      expect((await c.prisma.sponsoredPromotionProjection.findFirstOrThrow({ where: { promotionId: 'prm_x' } })).status).toBe('PAUSED');
      const row = await c.prisma.sponsoredPromotionProjection.findFirstOrThrow({ where: { promotionId: 'prm_x' } });
      expect(Object.keys(row).filter((k) => /sub|patient(?!Copy)|phone|wallet|balance/i.test(k))).toEqual([]);
      await push({ ...e, version: 2, status: 'ACTIVE', at: new Date(Date.now() + 3000).toISOString() });
      expect((await c.prisma.sponsoredPromotionProjection.findUniqueOrThrow({ where: { promotionId_version: { promotionId: 'prm_x', version: 1 } } })).status).toBe('ARCHIVED'); // a newer version replaces the older one for offering
    });

    it('the quote is the best eligible active promotion, labelled "sponsored by <clinic>" with the end date, with the sponsored checkout line; none stacks; another patient gets 404; flag OFF is 403', async () => {
      await push(event({ promotionId: 'prm_small', discount: { kind: 'FIXED_MINOR', value: 2000 } }));
      await push(event({ promotionId: 'prm_big', discount: { kind: 'FIXED_MINOR', value: 6000 } }));
      await push(event({ promotionId: 'prm_other_clinic', orgRef: 'tn_other', discount: { kind: 'FIXED_MINOR', value: 99_000 } }));
      await push(event({ promotionId: 'prm_paused', status: 'PAUSED', discount: { kind: 'FIXED_MINOR', value: 99_000 } }));
      await push(event({ promotionId: 'prm_home', scope: { doctorIds: [], appointmentTypeIds: [], careTypes: ['HOME_VISIT'] }, discount: { kind: 'FIXED_MINOR', value: 99_000 } }));
      const h = await hold().expect(201);
      const q = (await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${h.body.id}`).set(auth).expect(200)).body.quote;
      expect(q).toMatchObject({ promotionId: 'prm_big', amountMinor: 6000, currency: 'EGP' });
      expect(q.label.en).toMatch(/^Discount sponsored by Nile Clinic until \d{4}-\d{2}-\d{2}$/); expect(q.label.ar).toMatch(/^خصم برعاية /); expect(JSON.stringify(q)).not.toMatch(/Kiorex discount/i);
      expect(q.lines.map((l: { code: string }) => l.code)).toEqual(['PRICE', 'SPONSORED_DISCOUNT', 'CARD']);
      expect(q.lines.reduce((s: number, l: { amountMinor: number; code?: string }) => s + (l.code === 'CARD' ? 0 : l.amountMinor), 0)).toBe(q.lines[0].amountMinor - 6000); // price - sponsored = card
      const other = await c.as('sub_other'); await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${h.body.id}`).set(other).expect(404);
      await c.http().put('/api/v1/admin/flags/growth.sponsored_promotions/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).catch(() => undefined);
      c.flags.invalidate(); await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: FLAG } }); c.flags.invalidate();
      const off = await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${h.body.id}`).set(auth); expect(off.status).toBe(403); expect(off.body.code).toBe('FEATURE_DISABLED');
    });

    it('eligibility rules: new patients only, first booking only, minimum lead time and a doctor scope', async () => {
      await push(event({ promotionId: 'prm_new', eligibility: { newPatientsOnly: true, firstBookingOnly: true, minLeadHours: 1, kiorexOnly: true } }));
      const first = await hold().expect(201);
      expect((await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${first.body.id}`).set(auth)).body.quote?.promotionId).toBe('prm_new');
      await confirm(first.body.id).expect(200);
      const second = await hold(futureSlot(49)).expect(201);
      expect((await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${second.body.id}`).set(auth)).body.quote).toBeNull(); // no longer a new patient of this clinic
      await push(event({ promotionId: 'prm_doc', scope: { doctorIds: ['dr_someone_else'], appointmentTypeIds: [], careTypes: ['IN_CLINIC'] }, discount: { kind: 'FIXED_MINOR', value: 9000 } }));
      expect((await c.http().get(`/api/v1/growth/v1/promotions/quote?bookingId=${second.body.id}`).set(auth)).body.quote).toBeNull();
    });
  });

  describe('reservation and the booking block', () => {
    it('confirm reserves at the Clinic (opaque patient reference), sends the sponsoredDiscount block, and records APPLIED; the replay is the same', async () => {
      await push(event({ promotionId: 'prm_a' }));
      const h = await hold().expect(201); await confirm(h.body.id).expect(200);
      const res = [...c.kiorly.promotionReservations.values()];
      expect(res).toHaveLength(1); expect(res[0]).toMatchObject({ promotionId: 'prm_a', version: 1, bookingRef: h.body.id, careType: 'IN_CLINIC', amountMinor: 5000, currency: 'EGP' });
      expect(res[0].patientRef).toMatch(/^[A-Za-z0-9_-]{16,}$/); expect(JSON.stringify(res[0])).not.toContain('sub_amira');
      expect(bookingCalls()[0]!.body.sponsoredDiscount).toEqual({ promotionId: 'prm_a', promotionVersion: 1, reservationRef: res[0].reservationRef, amountMinor: 5000, currency: 'EGP' });
      expect(await line(h.body.id)).toMatchObject({ state: 'APPLIED', amountMinor: 5000, promotionId: 'prm_a' });
      await confirm(h.body.id).expect(200); // double click: same result, one reservation
      expect(c.kiorly.promotionReservations.size).toBe(1); expect(await c.prisma.bookingSponsoredDiscount.count()).toBe(1);
    });

    it('a refusal, an outage, the flag OFF or no promotion each leave the booking at the full price with no block; the Clinic dropping the discount ends RELEASED', async () => {
      await push(event({ promotionId: 'prm_b' }));
      c.kiorly.promotionMode = 'refuse:BUDGET_EXHAUSTED'; const a = await hold().expect(201); await confirm(a.body.id).expect(200);
      expect(bookingCalls()[0]!.body.sponsoredDiscount).toBeUndefined(); expect(await line(a.body.id)).toBeNull();
      c.kiorly.promotionMode = 'down'; const b = await hold(futureSlot(49)).expect(201); await confirm(b.body.id).expect(200);
      expect(bookingCalls()[1]!.body.sponsoredDiscount).toBeUndefined();
      c.kiorly.promotionMode = 'not-applied'; const d = await hold(futureSlot(50)).expect(201); await confirm(d.body.id).expect(200);
      expect(bookingCalls()[2]!.body.sponsoredDiscount).toBeDefined(); expect(await line(d.body.id)).toMatchObject({ state: 'RELEASED' });
      c.kiorly.promotionMode = undefined; const plain = await hold(futureSlot(51), await c.as('sub_two')).expect(201);
      await c.http().put('/api/v1/me/profile').set(await c.as('sub_two')).send({ nameEn: 'Two', nationalId: '29004020101235' });
      await c.prisma.sponsoredPromotionProjection.deleteMany({}); await confirm(plain.body.id, await c.as('sub_two')).expect(200);
      expect(bookingCalls().at(-1)!.body.sponsoredDiscount).toBeUndefined();
    });

    it('a failed Clinic booking call gives the budget back (release command) and the line is RELEASED', async () => {
      await push(event({ promotionId: 'prm_c' }));
      c.kiorly.bookingMode = '409'; const h = await hold().expect(201); await confirm(h.body.id).expect(409);
      expect(await line(h.body.id)).toMatchObject({ state: 'RELEASED' });
      expect(c.kiorly.callsTo('POST', '/release').length).toBe(1); expect([...c.kiorly.promotionReservations.values()][0].state).toBe('RELEASED');
    });

    it('one sponsored promotion per booking: the line is unique on the booking and 12 parallel confirms make one reservation', async () => {
      await push(event({ promotionId: 'prm_d' }));
      const h = await hold().expect(201);
      await Promise.all(Array.from({ length: 12 }, () => confirm(h.body.id)));
      expect(await c.prisma.bookingSponsoredDiscount.count({ where: { bookingIntentId: h.body.id } })).toBe(1); expect(c.kiorly.promotionReservations.size).toBe(1);
      await expect(c.prisma.bookingSponsoredDiscount.create({ data: { bookingIntentId: h.body.id, promotionId: 'prm_other', promotionVersion: 1, amountMinor: 1, reservationRef: 'prs_dup' } })).rejects.toThrow();
    });
  });

  describe('the Clinic budget events', () => {
    it('DEBITED, RELEASED and REVERSED move the line forward only and are idempotent; an unknown reference or a backwards move is ignored; the database enforces the same', async () => {
      await push(event({ promotionId: 'prm_e' }));
      const h = await hold().expect(201); await confirm(h.body.id).expect(200);
      const ref = (await line(h.body.id))!.reservationRef; const data = { promotionId: 'prm_e', version: 1, reservationRef: ref, bookingRef: h.body.id, amountMinor: 5000, currency: 'EGP', at: new Date().toISOString() };
      expect((await push(data, 'SponsoredDiscountReversed')).body.status).toBe('IGNORED'); // nothing debited yet
      expect((await push(data, 'SponsoredDiscountDebited')).body.status).toBe('APPLIED'); expect((await line(h.body.id))).toMatchObject({ state: 'DEBITED', debitRef: ref });
      expect((await push(data, 'SponsoredDiscountDebited')).body.status).toBe('IGNORED'); // a second delivery with a new event id: the state guard makes it a no-op
      expect((await push({ ...data }, 'SponsoredDiscountReleased')).body.status).toBe('IGNORED'); // a debited line cannot be released
      expect((await push(data, 'SponsoredDiscountReversed')).body.status).toBe('APPLIED'); expect((await line(h.body.id))!.state).toBe('REVERSED');
      expect((await push({ ...data, reservationRef: 'prs_unknown' }, 'SponsoredDiscountDebited')).body.status).toBe('IGNORED');
      await expect(c.prisma.bookingSponsoredDiscount.update({ where: { bookingIntentId: h.body.id }, data: { state: 'RESERVED' } })).rejects.toThrow(/cannot move/);
      await expect(c.prisma.bookingSponsoredDiscount.update({ where: { bookingIntentId: h.body.id }, data: { amountMinor: 1 } })).rejects.toThrow(/fixed/);
      await expect(c.prisma.bookingSponsoredDiscount.delete({ where: { bookingIntentId: h.body.id } })).rejects.toThrow(/append-only/);
    });

    it('the ops ledger shows one distinct PROVIDER_SPONSORED_DISCOUNT line per booking with signed amounts, totals by state, and no patient field', async () => {
      await push(event({ promotionId: 'prm_f' }));
      const h = await hold().expect(201); await confirm(h.body.id).expect(200);
      const r = (await c.http().get(`${ADMIN}/prm_f/ledger`).set(ops).expect(200)).body;
      expect(r.total).toBe(1); expect(r.lines[0]).toMatchObject({ bookingIntentId: h.body.id, ledgerLine: 'PROVIDER_SPONSORED_DISCOUNT', signedAmountMinor: -5000, state: 'APPLIED' });
      expect(r.byState).toEqual([{ state: 'APPLIED', count: 1, amountMinor: 5000 }]);
      expect(JSON.stringify(r)).not.toMatch(/sub_amira|sub\b|phone|name/i);
    });
  });

  describe('review (maker-checker)', () => {
    const decide = (who: { Authorization: string }, id: string, b: Record<string, unknown>) => c.http().post(`${ADMIN}/${id}/decisions`).set(who).send({ version: 1, ...b });

    it('an IN_REVIEW projection opens CONTENT and SCOPE (and HIGH_VALUE above the thresholds) with the automated guard attached', async () => {
      const a = toReview({ promotionId: 'prm_r1' }); const b = toReview({ promotionId: 'prm_r2', budgetCapMinor: 6_000_000 });
      await push(a); await push(b);
      expect((await c.prisma.sponsoredPromotionReview.findMany({ where: { promotionId: 'prm_r1' } })).map((r) => r.kind).sort()).toEqual(['CONTENT', 'SCOPE']);
      expect((await c.prisma.sponsoredPromotionReview.findMany({ where: { promotionId: 'prm_r2' } })).map((r) => r.kind).sort()).toEqual(['CONTENT', 'HIGH_VALUE', 'SCOPE']);
      await push(a); expect(await c.prisma.sponsoredPromotionReview.count({ where: { promotionId: 'prm_r1' } })).toBe(2); // idempotent
      const q = (await c.http().get(ADMIN).set(ops).expect(200)).body; expect(q.map((x: { promotionId: string }) => x.promotionId).sort()).toEqual(['prm_r1', 'prm_r2']);
      const d = (await c.http().get(`${ADMIN}/prm_r2`).set(ops).expect(200)).body; expect(d.highValue).toEqual(['BUDGET_AT_OR_ABOVE_THRESHOLD']); expect(d.guard.ok).toBe(true);
    });

    it('only a super admin or a growth admin decides; the decision goes to the Clinic as a signed command; the second approver of a high-value promotion must differ; a note is needed to reject', async () => {
      await push(toReview({ promotionId: 'prm_r3', budgetCapMinor: 6_000_000 }));
      await decide(ops, 'prm_r3', { kind: 'CONTENT', decision: 'APPROVED' }).expect(403);
      const growth = await c.as('gro_1', { roles: ['ops_admin', 'growth_admin'] });
      await decide(growth, 'prm_r3', { kind: 'CONTENT', decision: 'APPROVED' }).expect(200);
      await decide(admin, 'prm_r3', { kind: 'REJECTED_BAD', decision: 'APPROVED' }).expect(400);
      await decide(admin, 'prm_r3', { kind: 'SCOPE', decision: 'REJECTED' }).expect(422); // a rejection needs a reason
      await decide(growth, 'prm_r3', { kind: 'HIGH_VALUE', decision: 'APPROVED' }).expect(403); // the second approver cannot be the first
      await decide(admin, 'prm_r3', { kind: 'HIGH_VALUE', decision: 'APPROVED' }).expect(200);
      await decide(admin, 'prm_r3', { kind: 'SCOPE', decision: 'APPROVED' }).expect(403); // and the high-value approver cannot also decide the scope
      expect(c.kiorly.promotionReviews.map((r) => [r.reviewKind, r.decision, r.decidedBy])).toEqual([['CONTENT', 'APPROVED', 'ops:gro_1'], ['HIGH_VALUE', 'APPROVED', 'ops:adm_a']]);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.promotion_review.high_value.approved' } })).toBe(1);
      await decide(growth, 'prm_r3', { kind: 'CONTENT', decision: 'APPROVED' }).expect(200); // a replay of the same decision by the same person is the same answer
      await decide(admin2, 'prm_r3', { kind: 'CONTENT', decision: 'REJECTED', note: 'no' }).expect(409); // decided: final
    });

    it('the automated guard blocks approval of clinical wording (Arabic and English); the Clinic refusing a decision leaves no local decision; the decision of a promotion not in review is 409', async () => {
      await push(toReview({ promotionId: 'prm_r4', patientCopy: { ar: 'جراحة مجانية', en: 'Free surgery for all' }, name: { ar: 'جراحة', en: 'Surgery' } }));
      const r = await decide(admin, 'prm_r4', { kind: 'CONTENT', decision: 'APPROVED' }).expect(422); expect(r.body.code).toBe('GUARD_BLOCKS_APPROVAL');
      await decide(admin, 'prm_r4', { kind: 'CONTENT', decision: 'REJECTED', note: 'clinical claim' }).expect(200);
      await push(toReview({ promotionId: 'prm_r5' })); c.kiorly.promotionMode = 'review-refuse';
      const refused = await decide(admin, 'prm_r5', { kind: 'SCOPE', decision: 'APPROVED' }).expect(409); expect(refused.body.code).toBe('CLINIC_REFUSED_DECISION'); expect(refused.body.clinicCode).toBe('REVIEW_ALREADY_DECIDED');
      expect((await c.prisma.sponsoredPromotionReview.findFirstOrThrow({ where: { promotionId: 'prm_r5', kind: 'SCOPE' } })).decision).toBeNull();
      c.kiorly.promotionMode = 'down'; await decide(admin, 'prm_r5', { kind: 'SCOPE', decision: 'APPROVED' }).expect(422);
      await push(event({ promotionId: 'prm_r6' })); await decide(admin, 'prm_r6', { kind: 'CONTENT', decision: 'APPROVED' }).expect(409);
    });

    it('the database refuses a review decided by the requester and a second decision on a decided review', async () => {
      await push(toReview({ promotionId: 'prm_r7' }));
      const row = await c.prisma.sponsoredPromotionReview.findFirstOrThrow({ where: { promotionId: 'prm_r7', kind: 'CONTENT' } });
      await expect(c.prisma.sponsoredPromotionReview.update({ where: { id: row.id }, data: { decidedBy: row.requestedBy, decision: 'APPROVED' } })).rejects.toThrow();
      await c.prisma.sponsoredPromotionReview.update({ where: { id: row.id }, data: { decidedBy: 'adm_x', decision: 'APPROVED' } });
      await expect(c.prisma.sponsoredPromotionReview.update({ where: { id: row.id }, data: { decision: 'REJECTED' } })).rejects.toThrow(/already decided/);
    });
  });

  describe('fraud signals (shadow) and the flag', () => {
    it('three reservations by one patient in a day raise PF_FARM as a hash, never an identifier, and never take the discount away', async () => {
      await push(event({ promotionId: 'prm_g' }));
      for (let i = 0; i < 3; i++) { const h = await hold(futureSlot(48 + i)).expect(201); await confirm(h.body.id).expect(200); }
      const s = await c.prisma.growthFraudSignal.findMany({ where: { ruleId: 'PF_FARM' } });
      expect(s.length).toBeGreaterThanOrEqual(1); expect(s[0]!.subjectHash).not.toContain('sub_amira'); expect(await c.prisma.bookingSponsoredDiscount.count({ where: { state: 'APPLIED' } })).toBe(3);
    });
    it('admin writes need the flag (reads keep working) and the patient quote is 403 FEATURE_DISABLED without it', async () => {
      await push(toReview({ promotionId: 'prm_h' })); await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: FLAG } }); c.flags.invalidate();
      await c.http().get(ADMIN).set(ops).expect(200);
      const r = await decide2(admin, 'prm_h'); expect(r.status).toBe(403); expect(r.body.code).toBe('FEATURE_DISABLED');
    });
  });
  const decide2 = (who: { Authorization: string }, id: string) => c.http().post(`${ADMIN}/${id}/decisions`).set(who).send({ version: 1, kind: 'CONTENT', decision: 'APPROVED' });
});
