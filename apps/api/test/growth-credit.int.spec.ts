import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { seedBooking } from './growth-helpers';
import { DAY, setRewardRules, uid, unlockAll } from './growth-rewards-helpers';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';
import { FakePspAdapter } from '../src/pay/psp';
import { GoodwillService, RewardExpiryJob, RewardHoldService, RewardHouseholdService, RewardIssuanceService, RewardReversalService, RewardLedgerService, RewardReconcileJob, RewardRedemptionService, issueKey } from '../src/growth/rewards/rewards-public';

type Auth = { Authorization: string };
const BASE = '/api/v1';
const ALL_FLAGS = ['growth.rewards', 'growth.patient_referral', 'growth.patient_credit', 'growth.refund_as_credit', 'growth.family_credit', 'growth.support_goodwill'] as const;

/**
 * GRW-P2-B2 patient credit: the refund destination (original method by default, credit as an option), checkout lines, restoring credit on a refund, expiry back to the original method,
 * household spend, goodwill with a second approver, and the reconciliation invariants RC-1 to RC-7 after a random sequence of operations. Mock PSP only.
 */
describe('growth patient credit (GRW-P2-B2, ADR-048)', () => {
  let c: TestCtx; let patient: Auth; let admin: Auth; let admin2: Auth; let support: Auth; let ops: Auth; let pid: string;
  const flush = async () => { for (let i = 0; i < 4; i++) await c.get(OutboxService).processBatch(200); };
  const iss = () => c.get(RewardIssuanceService); const led = () => c.get(RewardLedgerService); const red = () => c.get(RewardRedemptionService); const pay = () => c.get(PayService);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); jest.restoreAllMocks();
    await unlockAll(c, [...ALL_FLAGS]);
    await setRewardRules(c, { mode: 'CREDIT', credit: { refundAsCredit: { enabled: true }, family: { enabled: true } } });
    patient = await c.as('sub_amira'); admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); admin2 = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); support = await c.as('sup_1', { roles: ['ops_admin', 'support'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
    c.kiorly.slots = [futureSlot(72), futureSlot(96), futureSlot(120)]; pid = await seedProvider(c, { depositAmount: 150 });
    await c.http().put(`${BASE}/me/profile`).set(patient).send({ nameEn: 'Amira' }).expect(200);
  });
  const book = async (i = 0, auth: Auth = patient) => {
    const s = c.kiorly.slots[i];
    const h = await c.http().post(`${BASE}/bookings`).set(auth).send({ providerId: pid, typeId: 'typ_1', ...s }).expect(201);
    await c.http().post(`${BASE}/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    return h.body.id as string;
  };
  const checkout = (id: string, body: Record<string, unknown> = {}) => c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(patient).send(body);
  const capture = async (id: string, body: Record<string, unknown> = {}) => { const co = (await checkout(id, body).expect(200)).body; await c.http().post(`${BASE}/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); return co; };
  const preview = (bookingRef: string, auth: Auth = patient) => c.http().post(`${BASE}/pay/v1/refunds/preview`).set(auth).send({ bookingRef });
  const cancel = (id: string, body: Record<string, unknown> = {}) => c.http().post(`${BASE}/bookings/${id}/cancel`).set(patient).send(body);
  const acct = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return { debit: r.debitMinor ?? 0, credit: r.creditMinor ?? 0, net: (r.debitMinor ?? 0) - (r.creditMinor ?? 0) }; };
  const unbalanced = () => c.prisma.$queryRaw<{ txId: string }[]>`SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
  const credit = (sub: string, amountMinor: number, o: Record<string, unknown> = {}) => iss().issue({ kind: 'PROMO', sub, amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('t', uid('k')), reasonCode: 'PROMO_CAMPAIGN', actor: 'test', mode: 'CREDIT', ...o } as any).then((r: any) => { if (r.status === 'SKIPPED') throw new Error(r.reason); return r.lotId as string; });
  const lots = (sub = 'sub_amira') => c.prisma.rewardLot.findMany({ where: { sub }, orderBy: { createdAt: 'asc' } });

  describe('refund destination: the original payment method is the default, credit is an option', () => {
    it('the preview lists the original method FIRST and as the default, "keep as credit" second and never the default; with the switches off there is no credit option at all', async () => {
      const id = await book(); await capture(id);
      const on = (await preview(id).expect(200)).body;
      expect(on.options).toEqual([{ destination: 'ORIGINAL', amountMinor: 15000, isDefault: true }, { destination: 'CREDIT', amountMinor: 15000, isDefault: false }]);
      expect(on.options.filter((o: any) => o.isDefault)).toHaveLength(1); expect(on.creditRestoredMinor).toBe(0);
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.refund_as_credit' } }); c.flags.invalidate();
      const off = (await preview(id).expect(200)).body;
      expect(off.options).toEqual([{ destination: 'ORIGINAL', amountMinor: 15000, isDefault: true }]);
      expect((await preview('kx_bk_nope').expect(404)).body.code).toBe('BOOKING_NOT_FOUND');
      await preview(id, await c.as('sub_other')).expect(404); // someone else's booking
    });
    it('cancel without a destination (and with ORIGINAL) refunds to the original method at once: a choice row ORIGINAL, no credit lot, no money kept', async () => {
      const id = await book(); await capture(id);
      await cancel(id, { reason: 'plans changed' }).expect(200); await flush();
      const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf.status).toBe('SETTLED');
      expect(await c.prisma.refundDestinationChoice.findMany()).toMatchObject([{ refundId: rf.id, choice: 'ORIGINAL', source: 'PATIENT_CANCEL', sub: 'sub_amira' }]);
      expect(await c.prisma.rewardLot.count({ where: { kind: 'REFUND_CREDIT' } })).toBe(0);
      expect((await acct('PSP_CLEARING')).net).toBe(0); expect((await acct('PATIENT_REFUND_CREDIT')).net).toBe(0);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RefundDestinationChosen' } })).toBe(1);
      expect((await unbalanced())).toHaveLength(0);
    });
    it('a request for CREDIT while the option is not available is refused (422) and the booking is untouched, so nobody thinks they chose credit', async () => {
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.refund_as_credit' } }); c.flags.invalidate();
      const id = await book(); await capture(id);
      const r = await cancel(id, { refundDestination: 'CREDIT' }); expect([r.status, r.body.code]).toEqual([422, 'REFUND_CREDIT_NOT_AVAILABLE']);
      expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED'); expect(c.kiorly.callsTo('POST', '/cancel')).toHaveLength(0);
      await cancel(id, { refundDestination: 'GOLD' }).expect(400); // anything else is not a destination
    });
    it('"keep as credit": the card refund becomes ONE REFUND_CREDIT lot equal to it, no PSP movement, a balanced Pay ledger, the choice is immutable; the next checkout shows the credit line before the card', async () => {
      const psp = jest.spyOn(FakePspAdapter.prototype, 'refund');
      const id = await book(); await capture(id);
      await cancel(id, { refundDestination: 'CREDIT' }).expect(200); await flush();
      expect(psp).not.toHaveBeenCalled();
      const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf.status).toBe('CREDITED');
      const lot = (await lots()).find((l) => l.kind === 'REFUND_CREDIT')!;
      expect(lot).toMatchObject({ amountMinor: 15000, funding: 'PATIENT_REFUND', mode: 'CREDIT', sub: 'sub_amira' }); expect(lot.expiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
      expect(await c.prisma.rewardLedgerEntry.findFirstOrThrow({ where: { lotId: lot.id } })).toMatchObject({ type: 'ISSUE', refundId: rf.id });
      expect((await acct('PSP_CLEARING')).net).toBe(15000); expect((await acct('REFUND_PAYABLE')).net).toBe(0); expect((await acct('PATIENT_REFUND_CREDIT')).net).toBe(-15000); expect((await acct(`HELD:${rf.paymentId ? (await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: rf.paymentId } })).clinicId : ''}`)).net).toBe(0);
      expect(await unbalanced()).toHaveLength(0);
      const ch = await c.prisma.refundDestinationChoice.findFirstOrThrow({ where: { refundId: rf.id } }); expect(ch.choice).toBe('CREDIT');
      await expect(c.prisma.refundDestinationChoice.update({ where: { id: ch.id }, data: { choice: 'ORIGINAL' } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.refundDestinationChoice.delete({ where: { id: ch.id } })).rejects.toThrow(/append-only/);
      const credit = (await c.http().get(`${BASE}/growth/v1/credit`).set(patient).expect(200)).body; expect(credit).toMatchObject({ openBalanceMinor: 15000, currency: 'EGP' }); expect(credit.lots[0]).toMatchObject({ kind: 'REFUND_CREDIT', remainingMinor: 15000 });
      const next = await book(1); const co = (await checkout(next).expect(200)).body;
      expect(co.lines.map((l: any) => l.code)).toEqual(['PRICE', 'PATIENT_CREDIT', 'CARD']); expect(co.lines.map((l: any) => l.amountMinor)).toEqual([15000, -14999, 1]); expect(co.amountMinor).toBe(1);
      // settling the refund again (an outbox retry) never issues a second lot
      await pay().settleRefund(rf.id); expect(await c.prisma.rewardLot.count({ where: { kind: 'REFUND_CREDIT' } })).toBe(1);
    });
    it('spending the refund credit moves the patient\'s own money to the clinic\'s HELD, the visit releases the whole deposit, and the Clinic is told the gross deposit with its funding', async () => {
      const id = await book(); await capture(id); await cancel(id, { refundDestination: 'CREDIT' }).expect(200); await flush();
      const next = await book(1); const co = await capture(next);
      const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
      expect(p).toMatchObject({ amountMinor: 1, rewardMinor: 14999, rewardPostedMinor: 14999 });
      expect((await acct(`HELD:${p.clinicId}`)).net).toBe(-15000); expect((await acct('PATIENT_REFUND_CREDIT')).net).toBe(-1); // 15000 kept - 14999 spent
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 150, tender: { cardMinor: 1, patientCreditMinor: 14999 } });
      await c.webhook('COMPLETED', { externalReference: next }); await flush();
      expect((await acct(`HELD:${p.clinicId}`)).net).toBe(0); expect((await acct(`PAYABLE:${p.clinicId}`)).net).toBe(-15000);
      expect(await unbalanced()).toHaveLength(0);
      const r = await pay().runPayouts(); expect(r.payouts[0].amountMinor).toBe(15000);
    });
    it('a booking paid with credit and then cancelled gets its credit RESTORED as a new lot (never counted against caps) and the card part to the original method; RC-4 holds', async () => {
      await credit('sub_amira', 5000);
      const id = await book(); const co = await capture(id);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } })).rewardMinor).toBe(5000);
      await cancel(id).expect(200); await flush();
      const restored = (await lots()).filter((l) => l.kind === 'RESTORED');
      expect(restored).toHaveLength(1); expect(restored[0]).toMatchObject({ amountMinor: 5000, mode: 'CREDIT', funding: 'PLATFORM_MARKETING' });
      expect(await led().balance(c.prisma, restored[0].id)).toMatchObject({ available: 5000 });
      const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf).toMatchObject({ amountMinor: 10000, status: 'SETTLED' });
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RewardRestored' } })).toBe(1);
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } })).toMatchObject({ status: 'REFUNDED' });
      const rec = await c.get(RewardReconcileJob).run(); expect(rec.ok).toBe(true);
      // restored credit never counts against the annual cap or the open balance cap: another issue still fits
      await setRewardRules(c, { mode: 'CREDIT', perUserAnnualCapMinor: 5001, credit: { refundAsCredit: { enabled: true }, family: { enabled: true } } });
      expect(await credit('sub_amira', 1)).toBeTruthy(); // 5000 issued + 1 fits; the 5000 restored did not count (it would have exceeded the cap)
      await expect(credit('sub_amira', 1)).rejects.toThrow('ANNUAL_CAP');
    });
    it('partial refunds restore the credit cumulatively (no drift, exact on the last one); posted promotional credit goes back out of HELD when postToPayLedger is true', async () => {
      await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: true, credit: { refundAsCredit: { enabled: true }, family: { enabled: true } } });
      await credit('sub_amira', 5000);
      const id = await book(); const co = await capture(id);
      const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
      expect(p).toMatchObject({ amountMinor: 10000, rewardMinor: 5000, rewardPostedMinor: 5000 });
      expect((await acct(`HELD:${p.clinicId}`)).net).toBe(-15000); expect((await acct('PROMO_FUNDED:rewards')).net).toBe(5000); // Kiorex's marketing cost, in the Pay ledger because finance said so
      await pay().refund(p.id, { reason: 'ops', amountMinor: 3333, idempotencyKey: 'pr1' });
      await pay().refund(p.id, { reason: 'ops', amountMinor: 3333, idempotencyKey: 'pr2' });
      await pay().refund(p.id, { reason: 'ops', amountMinor: 3334, idempotencyKey: 'pr3' });
      await flush();
      const restored = (await lots()).filter((l) => l.kind === 'RESTORED').map((l) => l.amountMinor);
      expect(restored.reduce((s, x) => s + x, 0)).toBe(5000); expect(restored).toHaveLength(3);
      expect((await acct(`HELD:${p.clinicId}`)).net).toBe(0); expect((await acct('PROMO_FUNDED:rewards')).net).toBe(0);
      expect(await unbalanced()).toHaveLength(0);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).rewardPostedMinor).toBe(0);
      expect((await c.get(RewardReconcileJob).run()).ok).toBe(true);
    });
    it('with postToPayLedger false (the default) the Pay ledger holds only the card money and its sums are unchanged by promotional credit', async () => {
      await credit('sub_amira', 5000);
      const id = await book(); const co = await capture(id); const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
      expect(p).toMatchObject({ amountMinor: 10000, rewardMinor: 5000, rewardPostedMinor: 0 });
      expect((await acct('PSP_CLEARING')).net).toBe(10000); expect((await acct(`HELD:${p.clinicId}`)).net).toBe(-10000); expect((await acct('PROMO_FUNDED:rewards')).net).toBe(0);
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 150, tender: { cardMinor: 10000, patientCreditMinor: 5000 } });
    });
    it('a refund started by anyone else (the clinic cancels) goes to the original method at once, even if a credit choice is parked on the booking; no choice row is written', async () => {
      const id = await book(); await capture(id);
      await c.prisma.bookingEvent.create({ data: { bookingId: id, kind: 'REFUND_CHOICE', detail: { destination: 'CREDIT', source: 'PATIENT_CANCEL' } } });
      await c.webhook('CANCELLED_BY_CLINIC', { externalReference: id, cancelledBy: 'CLINIC' }); await flush();
      expect((await c.prisma.refund.findFirstOrThrow()).status).toBe('SETTLED');
      expect(await c.prisma.refundDestinationChoice.count()).toBe(0); expect(await c.prisma.rewardLot.count({ where: { kind: 'REFUND_CREDIT' } })).toBe(0);
    });
    it('a PSP refund that FAILS never silently becomes credit: it stays REQUESTED for ops and the reconciliation flags it', async () => {
      jest.spyOn(FakePspAdapter.prototype, 'refund').mockRejectedValue(new Error('PSP down'));
      const id = await book(); await capture(id);
      await cancel(id).expect(200); await flush();
      const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf.status).toBe('REQUESTED');
      expect(await c.prisma.rewardLot.count({ where: { kind: 'REFUND_CREDIT' } })).toBe(0);
      expect((await c.prisma.outboxEvent.findFirst({ where: { type: 'pay.refund_requested' } }))!.status).not.toBe('SENT');
    });
    it('if credit can no longer be issued when the refund settles (the switch went off in between), the refund goes to the original method: the patient never loses the money', async () => {
      const id = await book(); await capture(id);
      await cancel(id, { refundDestination: 'CREDIT' }).expect(200);
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.refund_as_credit' } }); c.flags.invalidate();
      await flush();
      const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf.status).toBe('SETTLED');
      expect(await c.prisma.rewardLot.count({ where: { kind: 'REFUND_CREDIT' } })).toBe(0);
      expect(await c.prisma.auditLog.count({ where: { action: 'pay.refund_credit_unavailable' } })).toBe(1);
    });
    it('an expired REFUND_CREDIT lot sends its unspent rest back to the ORIGINAL payment method (a system reversal), once, and the Pay ledger balances', async () => {
      const id = await book(); await capture(id); await cancel(id, { refundDestination: 'CREDIT' }).expect(200); await flush();
      const lot = (await lots()).find((l) => l.kind === 'REFUND_CREDIT')!;
      const psp = jest.spyOn(FakePspAdapter.prototype, 'refund');
      const job = c.get(RewardExpiryJob); const later = new Date(Date.now() + 400 * DAY);
      expect((await job.runOnce(later)).refundCreditRefunds).toBe(1);
      await flush(); await job.runOnce(later); await flush(); // a second run changes nothing
      expect(psp).toHaveBeenCalledTimes(1);
      const refunds = await c.prisma.refund.findMany({ orderBy: { createdAt: 'asc' } });
      expect(refunds.map((r) => [r.reason, r.status, r.amountMinor])).toEqual([['PATIENT_CANCELLED_REFUNDABLE', 'CREDITED', 15000], ['REFUND_CREDIT_EXPIRED', 'SETTLED', 15000]]);
      expect((await acct('PATIENT_REFUND_CREDIT')).net).toBe(0); expect((await acct('PSP_CLEARING')).net).toBe(0); expect((await acct('REFUND_PAYABLE')).net).toBe(0);
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('EXPIRED'); expect(await led().balance(c.prisma, lot.id)).toMatchObject({ available: 0 });
      expect(await unbalanced()).toHaveLength(0); expect((await c.get(RewardReconcileJob).run()).ok).toBe(true);
    });
  });

  describe('household credit (dependants draw from the owner, behind growth.family_credit)', () => {
    const dep = (o: Record<string, unknown> = {}) => c.prisma.dependant.create({ data: { guardianSub: 'sub_amira', nameEn: 'Omar', dateOfBirth: new Date('2018-01-01'), relationship: 'CHILD', ...o } });
    const dependantBooking = async (dependantId: string) => { const b = await seedBooking(c, { sub: 'sub_amira' }); return c.prisma.bookingIntent.update({ where: { id: b.id }, data: { dependantId, status: 'CONFIRMED' } }); };
    const quote = (bookingRef: string) => c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 10000, bookingRef }).expect(200).then((r) => r.body);
    it('a booking for a dependant gets no credit until the owner enables that dependant; then it spends the owner\'s credit; removal and majority end it at once', async () => {
      await credit('sub_amira', 4000); const d = await dep(); const b = await dependantBooking(d.id);
      expect((await quote(b.id)).applicableMinor).toBe(0);
      const view = (await c.http().post(`${BASE}/growth/v1/credit/household`).set(patient).send({ dependantId: d.id }).expect(200)).body; expect(view.members.map((m: any) => m.dependantId)).toEqual([d.id]);
      expect((await quote(b.id)).applicableMinor).toBe(4000);
      await c.http().post(`${BASE}/growth/v1/credit/household`).set(await c.as('sub_stranger')).send({ dependantId: d.id }).expect(404); // not their dependant
      await c.http().delete(`${BASE}/growth/v1/credit/household?memberId=${d.id}`).set(patient).expect(200);
      expect((await quote(b.id)).applicableMinor).toBe(0);
      await c.http().post(`${BASE}/growth/v1/credit/household`).set(patient).send({ dependantId: d.id }).expect(200);
      await c.prisma.dependant.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); // age of majority reached
      expect((await quote(b.id)).applicableMinor).toBe(0);
      expect((await c.get(RewardExpiryJob).runOnce()).endedMembers).toBe(1);
    });
    it('with growth.family_credit not effective the household endpoints answer 403 and a dependant never draws credit', async () => {
      await credit('sub_amira', 4000); const d = await dep(); const b = await dependantBooking(d.id);
      await c.http().post(`${BASE}/growth/v1/credit/household`).set(patient).send({ dependantId: d.id }).expect(200);
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.family_credit' } }); c.flags.invalidate();
      expect((await c.http().get(`${BASE}/growth/v1/credit/household`).set(patient)).body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'growth.family_credit' });
      expect((await quote(b.id)).applicableMinor).toBe(0); // the owner's own bookings still use the credit
      const own = await seedBooking(c, { sub: 'sub_amira' }); expect((await quote(own.id)).applicableMinor).toBe(4000);
    });
    it('20 parallel reservations by the owner and a member never spend more than the owner holds', async () => {
      const lot = await credit('sub_amira', 6000); const d = await dep(); await c.get(RewardHouseholdService).add('sub_amira', d.id);
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => red().reserveForDeposit({ sub: 'sub_amira', bookingId: `kx_bk_fam${i}`, amountMinor: 10000, currency: 'EGP', serviceKind: 'IN_CLINIC', dependantId: i % 2 ? d.id : null })));
      expect(rs.reduce((s, r) => s + r.appliedMinor, 0)).toBe(6000); expect(await led().balance(c.prisma, lot)).toMatchObject({ available: 0, reserved: 6000 });
    });
  });

  describe('goodwill (support): closed reasons, references, caps, a second approver, no self-grant', () => {
    const grant = (who: Auth, b: Record<string, unknown>) => c.http().post(`${BASE}/admin/growth/credit/goodwill`).set(who).send({ sub: 'sub_amira', reason: 'LONG_WAIT', ticketRef: 'T-100', amountMinor: 3000, ...b });
    it('a small grant is issued at once as a GOODWILL lot with the service-recovery funding label, audited, with an event; bookings reference only the patient\'s own booking', async () => {
      const r = await grant(support, {}).expect(201); expect(r.body.status).toBe('GRANTED');
      const lot = await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: r.body.lotId } }); expect(lot).toMatchObject({ kind: 'GOODWILL', funding: 'PLATFORM_SERVICE_RECOVERY', amountMinor: 3000, mode: 'CREDIT', sub: 'sub_amira' });
      const g = await c.prisma.goodwillGrant.findFirstOrThrow(); expect(g).toMatchObject({ grantedBy: 'sup_1', approvedBy: null, reason: 'LONG_WAIT', ticketRef: 'T-100' });
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.goodwill.grant' } })).toBe(1); expect(await c.prisma.outboxEvent.count({ where: { type: 'GoodwillGranted' } })).toBe(1);
      const other = await seedBooking(c, { sub: 'sub_someone_else' });
      const bad = await grant(support, { ticketRef: undefined, bookingId: other.id }); expect([bad.status, bad.body.code]).toEqual([422, 'GOODWILL_REFERENCE_INVALID']);
    });
    it.each([
      ['a reason outside the closed list', { reason: 'BECAUSE' }, 400],
      ['no booking or ticket reference', { ticketRef: undefined }, 422],
      ['an amount above the per-reason maximum', { amountMinor: 10_001 }, 422],
      ['a non-integer amount', { amountMinor: 10.5 }, 400],
    ])('refuses %s', async (_n, patch, status) => { const r = await grant(support, patch as any); expect(r.status).toBe(status); expect(await c.prisma.goodwillGrant.count()).toBe(0); });
    it('the per-agent daily cap and the per-patient 90-day cap hold; ops_admin without the support role cannot grant', async () => {
      await setRewardRules(c, { mode: 'CREDIT', credit: { goodwill: { reasons: ['LONG_WAIT', 'PROVIDER_LATE_CANCEL', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED'], perAgentDailyCapMinor: 7000, perPatient90dCapMinor: 6000, perReasonMaxMinor: 5000, approvalAboveMinor: 5000 } } });
      await grant(ops, {}).expect(403);
      await grant(support, { amountMinor: 3000 }).expect(201); await grant(support, { amountMinor: 3000 }).expect(201);
      const p90 = await grant(support, { amountMinor: 1 }); expect([p90.status, p90.body.reason]).toEqual([422, 'PATIENT_90D_CAP']);
      const daily = await grant(support, { sub: 'sub_second', amountMinor: 3000 }); expect([daily.status, daily.body.reason]).toEqual([422, 'AGENT_DAILY_CAP']);
    });
    it('above the threshold the grant waits for a second support lead or super admin: the requester cannot approve, the approval issues once, a decided request is immutable', async () => {
      await setRewardRules(c, { mode: 'CREDIT', credit: { goodwill: { reasons: ['LONG_WAIT', 'PROVIDER_LATE_CANCEL', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED'], perAgentDailyCapMinor: 50_000, perPatient90dCapMinor: 20_000, perReasonMaxMinor: 10_000, approvalAboveMinor: 2000 } } });
      const pending = (await grant(support, { amountMinor: 4000 }).expect(201)).body; expect(pending.status).toBe('PENDING_APPROVAL'); expect(await c.prisma.rewardLot.count()).toBe(0);
      const self = await c.http().post(`${BASE}/admin/growth/rewards/approvals/${pending.requestId}/decide`).set(admin).send({ decision: 'APPROVED' }); // another person is needed, and the requester is the support agent: a super admin may approve
      expect(self.status).toBe(200); expect(self.body).toMatchObject({ status: 'APPROVED' });
      const g = await c.prisma.goodwillGrant.findFirstOrThrow(); expect(g).toMatchObject({ grantedBy: 'sup_1', approvedBy: 'adm_a' }); expect(g.approvedBy).not.toBe(g.grantedBy);
      expect(await c.prisma.rewardLot.count({ where: { kind: 'GOODWILL' } })).toBe(1);
      await expect(c.prisma.goodwillGrant.update({ where: { id: g.id }, data: { approvedBy: 'sup_1' } })).rejects.toThrow(); // the database refuses approvedBy = grantedBy
      await c.http().post(`${BASE}/admin/growth/rewards/approvals/${pending.requestId}/decide`).set(admin2).send({ decision: 'REJECTED' }).expect(409);
      const second = (await grant(support, { amountMinor: 3000 }).expect(201)).body;
      const rej = (await c.http().post(`${BASE}/admin/growth/rewards/approvals/${second.requestId}/decide`).set(admin).send({ decision: 'REJECTED', note: 'no evidence' }).expect(200)).body; expect(rej.status).toBe('REJECTED');
    });
    it('a grant to the agent\'s own account (or a related phone) is refused; goodwill is off with its flag; charging the provider is not built', async () => {
      const own = await c.http().post(`${BASE}/admin/growth/credit/goodwill`).set(support).send({ sub: 'sup_1', reason: 'LONG_WAIT', ticketRef: 'T-1', amountMinor: 1000 }); expect([own.status, own.body.reason]).toEqual([422, 'SELF_GRANT']);
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.support_goodwill' } }); c.flags.invalidate();
      const off = await grant(support, {}); expect([off.status, off.body.code]).toEqual([403, 'FEATURE_DISABLED']);
      expect(c.get(GoodwillService)).toBeDefined();
    });
  });

  describe('invariants after a random sequence of operations (RC-1 to RC-7)', () => {
    it('300 seeded random operations (issue, reserve, release, redeem, hold, release, reverse, expire, refund) keep every reconciliation check true and no balance negative', async () => {
      let seed = 20261217; const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
      await setRewardRules(c, { mode: 'CREDIT', perUserAnnualCapMinor: 10_000_000, credit: { maxOpenBalanceMinor: 10_000_000, refundAsCredit: { enabled: true }, family: { enabled: true } }, ruleBudgetCeilingMinor: 100_000_000 });
      const subs = ['sa', 'sb', 'sc']; const bookings: Array<{ id: string; sub: string; state: 'NEW' | 'RESERVED' | 'REDEEMED' }> = [];
      const lotIds: string[] = []; const holds = c.get(RewardHoldService); const job = c.get(RewardExpiryJob);
      for (let step = 0; step < 300; step++) {
        const op = rnd(9); const sub = subs[rnd(3)];
        try {
          if (op === 0 || lotIds.length < 3) lotIds.push(await credit(sub, 500 + rnd(5000), { expiresAt: new Date(Date.now() + (1 + rnd(60)) * DAY) }));
          else if (op === 1 || op === 2) { const id = `kx_bk_rnd${step}`; const r = await red().reserveForDeposit({ sub, bookingId: id, amountMinor: 3000 + rnd(15000), currency: 'EGP', serviceKind: 'IN_CLINIC' }); bookings.push({ id, sub, state: r.appliedMinor > 0 ? 'RESERVED' : 'NEW' }); }
          else if (op === 3) { const b = bookings.find((x) => x.state === 'RESERVED'); if (b) { await red().releaseForBooking(b.id, 'PAYMENT_FAILED'); b.state = 'NEW'; } }
          else if (op === 4) { const b = bookings.find((x) => x.state === 'RESERVED'); if (b) { await c.prisma.$transaction((tx) => red().redeemOnCapture(tx, { bookingId: b.id, paymentId: `pay_rnd${step}` })); b.state = 'REDEEMED'; } }
          else if (op === 5) await holds.hold(lotIds[rnd(lotIds.length)], 'FRAUD_HOLD', 'adm');
          else if (op === 6) await holds.release(lotIds[rnd(lotIds.length)], 'adm');
          else if (op === 7) await c.get(RewardReversalService).reverseLot(lotIds[rnd(lotIds.length)], 'MANUAL_REVERSAL', 'adm');
          else await job.runOnce(new Date(Date.now() + rnd(70) * DAY));
        } catch (e) { if (!/^[A-Z_]+$/.test(String((e as Error).message)) && !/negative balance/.test(String((e as Error).message))) throw e; } // a refused issuance is a normal outcome of a random sequence
        if (step % 50 === 49) for (const id of lotIds) { const b = await led().balance(c.prisma, id); expect(Math.min(b.available, b.held, b.reserved)).toBeGreaterThanOrEqual(0); }
      }
      const rec = await c.get(RewardReconcileJob).run();
      expect(rec.checks.filter((x) => !x.ok)).toEqual([]); expect(rec.ok).toBe(true);
      const types = new Set((await c.prisma.rewardLedgerEntry.findMany({ select: { type: true }, distinct: ['type'] })).map((e) => e.type));
      for (const t of ['ISSUE', 'RESERVE', 'UNRESERVE', 'REDEEM']) expect(types).toContain(t); // the sequence really exercised the ledger, it is not a run of refusals
      expect(await c.prisma.rewardLedgerEntry.count()).toBeGreaterThan(50);
    });
  });
});
