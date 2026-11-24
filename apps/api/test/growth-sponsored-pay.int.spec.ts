import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { DAY, setRewardRules, uid, unlockAll } from './growth-rewards-helpers';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';
import { RewardIssuanceService, issueKey } from '../src/growth/rewards/rewards-public';

type Auth = { Authorization: string };
const BASE = '/api/v1';
const FLAG = 'growth.sponsored_promotions';
const H = { marketplaceConsent: true, remindersConsent: true };
let seq = 0;

/**
 * GRW-P2-S Kiorex Pay wiring on the real HTTP stack and Postgres (mock PSP, fake Clinic): the worked example of KX-30 section 14.4 (deposit D 500, sponsored S 100, patient credit C 150, card K 250, in minor
 * units 50000 / 10000 / 15000 / 25000): deposit reduced by the sponsored line, `tender.sponsoredDiscountMinor` on `deposit-paid`, the SPONSOR_FUNDED posting only when REWARD_RULES.postToPayLedger is true (default
 * false, finance H-25), refund allocation across card / credit / sponsor, forfeit, the payout gate until the Clinic DEBIT, and the reconciliation check RC-S4 (Pay side).
 */
describe('growth sponsored promotions: Kiorex Pay wiring (GRW-P2-S, RC-S4)', () => {
  let c: TestCtx; let patient: Auth; let pid: string;
  const flush = async () => { for (let i = 0; i < 4; i++) await c.get(OutboxService).processBatch(200); };
  const pay = () => c.get(PayService);
  const unlockSponsored = async () => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); c.flags.invalidate(); };
  const event = (o: Record<string, unknown> = {}) => ({ promotionId: `prm_${++seq}`, version: 1, orgRef: 'tn_1', clinicId: 'cl_1', status: 'ACTIVE', discount: { kind: 'FIXED_MINOR', value: 10000 }, scope: { doctorIds: [], appointmentTypeIds: [], careTypes: ['IN_CLINIC'] }, eligibility: { newPatientsOnly: false, firstBookingOnly: false, minLeadHours: 0, kiorexOnly: true }, budgetCapMinor: 1_000_000, fundingMode: 'WALLET_ONLY',
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 20 * DAY).toISOString(), patientCopy: { ar: 'خصم على سعر الكشف برعاية العيادة', en: 'A discount on the visit fee, sponsored by the clinic' }, name: { ar: 'خصم الكشف', en: 'Visit discount' }, contentHash: 'a'.repeat(64), at: new Date().toISOString(), ...o });
  const push = (data: Record<string, unknown>, type = 'PROVIDER_PROMOTION_UPDATED') => c.webhook(type, data, { aggregateId: String(data.promotionId), eventId: `evt_${++seq}_${Math.random().toString(36).slice(2)}`, aggregateType: 'SponsoredPromotion' });
  const credit = (sub: string, amountMinor: number) => c.get(RewardIssuanceService).issue({ kind: 'PROMO', sub, amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('t', uid('k')), reasonCode: 'PROMO_CAMPAIGN', actor: 'test', mode: 'CREDIT' } as any).then((r: any) => { if (r.status === 'SKIPPED') throw new Error(r.reason); return r.lotId as string; });
  const book = async (i = 0) => {
    const h = await c.http().post(`${BASE}/bookings`).set(patient).send({ providerId: pid, typeId: 'typ_1', ...c.kiorly.slots[i] }).expect(201);
    await c.http().post(`${BASE}/bookings/${h.body.id}/confirm`).set(patient).send(H).expect(200);
    return h.body.id as string;
  };
  const checkout = (id: string, body: Record<string, unknown> = {}) => c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(patient).send(body);
  const capture = async (id: string) => { const co = (await checkout(id).expect(200)).body; await c.http().post(`${BASE}/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); return co; };
  const cancel = (id: string) => c.http().post(`${BASE}/bookings/${id}/cancel`).set(patient).send({ reason: 'plans changed' });
  const acct = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return { debit: r.debitMinor ?? 0, credit: r.creditMinor ?? 0, net: (r.debitMinor ?? 0) - (r.creditMinor ?? 0) }; };
  const unbalanced = () => c.prisma.$queryRaw<{ txId: string }[]>`SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
  const intent = (bookingId: string) => c.prisma.paymentIntent.findFirstOrThrow({ where: { bookingId } });
  const line = (bookingId: string) => c.prisma.bookingSponsoredDiscount.findUniqueOrThrow({ where: { bookingIntentId: bookingId } });
  const clinicDebits = async (bookingId: string) => { const l = await line(bookingId); await push({ promotionId: l.promotionId, version: 1, reservationRef: l.reservationRef, bookingRef: bookingId, amountMinor: l.amountMinor, currency: 'EGP', at: new Date().toISOString() }, 'SponsoredDiscountDebited'); };
  /** HELD net (credit-normal) and every account the Pay ledger knows, as numbers a test can read. */
  const held = async () => { const a = await acct('HELD:cl_1'); return a.credit - a.debit; };
  /** The accounting identity of the Pay ledger: debit-normal accounts (clearing, fees, promo, sponsor funded) equal the liabilities. */
  const identity = async () => { const rows = await pay().balances(); const dn = new Set(['PSP_CLEARING', 'PSP_FEES', 'PROMO_FUNDED:rewards', 'SPONSOR_FUNDED:clinicCredit']); const sum = (f: (r: any) => boolean, s: 1 | -1) => rows.filter(f).reduce((t, r) => t + s * (r.debitMinor - r.creditMinor), 0); return sum((r) => dn.has(r.account), 1) - sum((r) => !dn.has(r.account), -1); };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); jest.restoreAllMocks(); seq = 0;
    await unlockAll(c, ['growth.rewards', 'growth.patient_referral', 'growth.patient_credit', 'growth.refund_as_credit']);
    await unlockSponsored();
    await setRewardRules(c, { mode: 'CREDIT', credit: { refundAsCredit: { enabled: true } } });
    patient = await c.as('sub_amira');
    c.kiorly.slots = [futureSlot(72), futureSlot(96), futureSlot(120), futureSlot(144)]; pid = await seedProvider(c, { fee: 600, depositAmount: 500 });
    await c.http().put(`${BASE}/me/profile`).set(patient).send({ nameEn: 'Amira' }).expect(200);
    await push(event({ promotionId: 'prm_a' }));
  });

  describe('the money-flow example: deposit 500, sponsored 100, credit 150, card 250 (default: nothing posted to the Pay ledger)', () => {
    it('the checkout shows PRICE, the sponsored discount, the credit and the CARD line; the PSP is charged 250; the Clinic is told gross 500 with the tender split', async () => {
      await credit('sub_amira', 15000); const id = await book();
      expect(await line(id)).toMatchObject({ state: 'APPLIED', amountMinor: 10000 });
      const co = await capture(id);
      expect(co).toMatchObject({ amountMinor: 25000, rewardMinor: 15000, sponsoredDiscountMinor: 10000 });
      expect(co.lines).toEqual([{ code: 'PRICE', amountMinor: 50000, labelKey: 'checkout.price' }, { code: 'SPONSORED_DISCOUNT', amountMinor: -10000, labelKey: 'checkout.sponsored' }, { code: 'PATIENT_CREDIT', amountMinor: -15000, labelKey: 'checkout.credit' }, { code: 'CARD', amountMinor: 25000, labelKey: 'checkout.card' }]);
      expect(co.lines.reduce((s: number, l: any) => s + l.amountMinor, 0) - 25000).toBe(25000); // RC-3: price + reductions = card
      expect(await intent(id)).toMatchObject({ amountMinor: 25000, rewardMinor: 15000, sponsoredMinor: 10000, sponsoredPostedMinor: 0, status: 'CAPTURED' });
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 500, currency: 'EGP', tender: { cardMinor: 25000, patientCreditMinor: 15000, sponsoredDiscountMinor: 10000 } });
      expect(JSON.stringify(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body)).not.toContain('sub_amira');
    });

    it('with postToPayLedger false (finance H-25 still open) the Pay ledger holds only what the card paid, no SPONSOR_FUNDED entry exists and the payout is the card amount', async () => {
      await credit('sub_amira', 15000); const id = await book(); await capture(id);
      expect(await held()).toBe(25000); expect((await acct('SPONSOR_FUNDED:clinicCredit')).net).toBe(0); expect((await acct('PROMO_FUNDED:rewards')).net).toBe(0);
      expect(await c.prisma.ledgerTx.count({ where: { kind: 'SPONSOR_FUNDED' } })).toBe(0);
      await pay().releaseForBooking(id, 'COMPLETED'); const r = await pay().runPayouts();
      expect(r.payouts).toMatchObject([{ clinicId: 'cl_1', amountMinor: 25000 }]); expect(r).not.toHaveProperty('heldBack');
      expect(await unbalanced()).toHaveLength(0); expect(Math.abs(await identity())).toBe(0);
    });

    it('with postToPayLedger true the sponsored 100 and the credit 150 reach HELD (500 in all), the payout waits for the Clinic DEBIT and then pays 500; the identity holds (RC-S4)', async () => {
      await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: true, credit: { refundAsCredit: { enabled: true } } });
      await credit('sub_amira', 15000); const id = await book(); await capture(id);
      expect(await intent(id)).toMatchObject({ rewardPostedMinor: 15000, sponsoredPostedMinor: 10000 });
      expect(await held()).toBe(50000); expect((await acct('SPONSOR_FUNDED:clinicCredit')).net).toBe(10000); expect((await acct('PROMO_FUNDED:rewards')).net).toBe(15000);
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 500, tender: { cardMinor: 25000, patientCreditMinor: 15000, sponsoredDiscountMinor: 10000 } });
      await pay().releaseForBooking(id, 'COMPLETED');
      const gated = await pay().runPayouts(); expect(gated.payouts).toEqual([]); expect(gated).toMatchObject({ heldBack: [{ holdMinor: 10000 }] }); // sponsored part not DEBITED yet
      await clinicDebits(id); expect(await line(id)).toMatchObject({ state: 'DEBITED' });
      const paid = await pay().runPayouts(); expect(paid.payouts).toMatchObject([{ clinicId: 'cl_1', amountMinor: 50000 }]);
      expect(await held()).toBe(0); expect(await unbalanced()).toHaveLength(0); expect(Math.abs(await identity())).toBe(0);
      expect((await pay().reconcileDaily()).discrepancies).toEqual([]); // RC-S4 on the Pay side: SPONSOR_FUNDED moved = what the intent says is posted
      // commission and revenue facts are not touched by Pay: no marketplace fee account moves
      expect((await acct('MARKETPLACE_FEES')).net).toBe(0);
    });

    it('a sponsored discount alone (no credit): the card pays deposit minus sponsored, the line list has no credit line; the card keeps at least one minor unit when the discount is as big as the deposit', async () => {
      const id = await book(); const co = await capture(id);
      expect(co).toMatchObject({ amountMinor: 40000, sponsoredDiscountMinor: 10000 }); expect(co).not.toHaveProperty('rewardMinor');
      expect(co.lines.map((l: any) => l.code)).toEqual(['PRICE', 'SPONSORED_DISCOUNT', 'CARD']);
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 500, tender: { cardMinor: 40000, patientCreditMinor: 0, sponsoredDiscountMinor: 10000 } });
      await push(event({ promotionId: 'prm_big', discount: { kind: 'PERCENT_BP', value: 10000 } })); // 100 percent of the 600 fee: bigger than the 500 deposit
      const id2 = await book(1); const co2 = (await checkout(id2).expect(200)).body;
      expect(co2).toMatchObject({ amountMinor: 1, sponsoredDiscountMinor: 49999 });
    });

    it('is idempotent: a second checkout of the same booking returns the same intent and the same lines, and a replayed capture changes nothing', async () => {
      await credit('sub_amira', 15000); const id = await book(); const a = (await checkout(id).expect(200)).body; const b = (await checkout(id).expect(200)).body;
      expect(b).toMatchObject({ paymentId: a.paymentId, amountMinor: 25000, rewardMinor: 15000, sponsoredDiscountMinor: 10000 }); expect(b.lines).toEqual(a.lines);
      await c.http().post(`${BASE}/pay/fake-checkout/${a.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await c.http().post(`${BASE}/pay/fake-checkout/${a.paymentId}/complete`).send({ outcome: 'pay' }); await flush();
      expect(await c.prisma.paymentIntent.count()).toBe(1); expect(await held()).toBe(25000);
    });
  });

  describe('flag OFF and no promotion: the checkout is exactly what it was', () => {
    it('without a sponsored line, or with growth.sponsored_promotions OFF, the deposit is the full deposit and the response and tender carry no sponsored field', async () => {
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: FLAG } }); c.flags.invalidate(); // OFF: no line is created at confirm either
      const id = await book(); const co = await capture(id);
      expect(co).toMatchObject({ amountMinor: 50000 }); expect(co).not.toHaveProperty('sponsoredDiscountMinor'); expect(co).not.toHaveProperty('lines');
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toEqual(expect.not.objectContaining({ tender: expect.anything() }));
      expect(await intent(id)).toMatchObject({ sponsoredMinor: 0, sponsoredPostedMinor: 0 });
      // a line created while ON is not applied once the switch is OFF at checkout (a kill switch stops the money effect)
      await unlockSponsored(); const id2 = await book(1); expect(await line(id2)).toMatchObject({ state: 'APPLIED' });
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: FLAG } }); c.flags.invalidate();
      expect((await checkout(id2).expect(200)).body).toMatchObject({ amountMinor: 50000 });
    });
  });

  describe('cancel and refund (allocation across card, credit and sponsor)', () => {
    for (const post of [false, true]) {
      it(`cancel after payment (postToPayLedger ${post}): the card 250 goes back to the card, the credit 150 is restored, the sponsored 100 is VOIDED and never paid to the patient; HELD returns to 0`, async () => {
        await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: post, credit: { refundAsCredit: { enabled: true } } });
        await credit('sub_amira', 15000); const id = await book(); await capture(id);
        await cancel(id).expect(200); await flush();
        const rf = await c.prisma.refund.findFirstOrThrow(); expect(rf).toMatchObject({ amountMinor: 25000, status: 'SETTLED' }); // exactly the card amount: not 35000 and not 40000
        expect(await intent(id)).toMatchObject({ status: 'REFUNDED', refundedMinor: 25000, sponsoredVoidedMinor: 10000, sponsoredPostedMinor: 0 });
        expect((await c.http().get(`${BASE}/growth/v1/credit`).set(patient).expect(200)).body.openBalanceMinor).toBe(15000); // the credit comes back as credit, the sponsored share does not come back at all
        expect(await held()).toBe(0); expect((await acct('SPONSOR_FUNDED:clinicCredit')).net).toBe(0); expect((await acct('PSP_CLEARING')).net).toBe(0); // card in 250, card out 250
        expect(await unbalanced()).toHaveLength(0);
        expect((await pay().reconcileDaily()).discrepancies).toEqual([]);
      });
    }

    it('a partial refund voids the pro-rata share (half the card: 50 of the 100 sponsored, 75 of the 150 credit), cumulatively exact, and the rest stays held; the second half voids the remainder', async () => {
      await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: true, credit: { refundAsCredit: { enabled: true } } });
      await credit('sub_amira', 15000); const id = await book(); const co = await capture(id);
      await pay().refund(co.paymentId, { reason: 'goodwill', amountMinor: 12500, idempotencyKey: 'rf-half-1' });
      expect(await intent(id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: 12500, sponsoredVoidedMinor: 5000, sponsoredPostedMinor: 5000, rewardPostedMinor: 7500 });
      expect(await held()).toBe(25000); // 125 card + 75 credit + 50 sponsored
      await pay().refund(co.paymentId, { reason: 'goodwill', idempotencyKey: 'rf-half-2' }); await flush(); // the rest
      expect(await intent(id)).toMatchObject({ status: 'REFUNDED', sponsoredVoidedMinor: 10000, sponsoredPostedMinor: 0, rewardPostedMinor: 0 });
      expect(await held()).toBe(0); expect(await unbalanced()).toHaveLength(0); expect(Math.abs(await identity())).toBe(0);
      expect(await pay().refund(co.paymentId, { reason: 'goodwill', amountMinor: 12500, idempotencyKey: 'rf-half-1' })).toMatchObject({ amountMinor: 12500 }); // replay of the first key: the same refund, nothing voided twice
      expect((await intent(id)).sponsoredVoidedMinor).toBe(10000);
    });

    it('a forfeited deposit earned no discount: the posted sponsored part goes back to SPONSOR_FUNDED and the clinic is paid only card plus credit', async () => {
      await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: true, credit: { refundAsCredit: { enabled: true } } });
      await credit('sub_amira', 15000); const id = await book(); await capture(id);
      await pay().releaseForBooking(id, 'FORFEITED');
      expect(await intent(id)).toMatchObject({ sponsoredPostedMinor: 0, sponsoredVoidedMinor: 10000 }); expect((await acct('SPONSOR_FUNDED:clinicCredit')).net).toBe(0);
      const r = await pay().runPayouts(); expect(r.payouts).toMatchObject([{ amountMinor: 40000 }]); expect(r).not.toHaveProperty('heldBack'); // 250 card + 150 credit, no sponsored part
      expect(await unbalanced()).toHaveLength(0); expect((await pay().reconcileDaily()).discrepancies).toEqual([]);
    });

    it('a payment that failed gives everything back: no sponsored posting, the credit reservation is released, the booking can be paid again', async () => {
      await credit('sub_amira', 15000); const id = await book(); const co = (await checkout(id).expect(200)).body;
      await c.http().post(`${BASE}/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'fail' }).expect(200); await flush();
      expect(await c.prisma.ledgerTx.count()).toBe(0);
      const again = (await checkout(id).expect(200)).body; expect(again).toMatchObject({ amountMinor: 25000, rewardMinor: 15000, sponsoredDiscountMinor: 10000 });
    });
  });

  describe('reconciliation RC-S4 (Pay side)', () => {
    it('finds an injected drift between the SPONSOR_FUNDED ledger and what the intent says is posted', async () => {
      await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: true, credit: { refundAsCredit: { enabled: true } } });
      const id = await book(); await capture(id);
      expect((await pay().reconcileDaily()).discrepancies).toEqual([]);
      await c.prisma.$executeRaw`UPDATE "PaymentIntent" SET "sponsoredPostedMinor" = 0 WHERE "bookingId" = ${id}`;
      const run = await pay().reconcileDaily(); expect((run.discrepancies as any[]).map((d) => d.type)).toContain('SPONSORED_LEDGER_MISMATCH');
    });
    it('the database refuses a posted or voided amount above the sponsored amount', async () => {
      const id = await book(); await capture(id);
      await expect(c.prisma.$executeRaw`UPDATE "PaymentIntent" SET "sponsoredPostedMinor" = "sponsoredMinor" + 1 WHERE "bookingId" = ${id}`).rejects.toThrow();
      await expect(c.prisma.$executeRaw`UPDATE "PaymentIntent" SET "sponsoredVoidedMinor" = "sponsoredMinor" + 1 WHERE "bookingId" = ${id}`).rejects.toThrow();
    });
  });
});
