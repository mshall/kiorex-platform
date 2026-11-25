import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { setRewardRules, unlockAll } from './growth-rewards-helpers';
import { CorporateBenefitService } from '../src/growth/corporate-public';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService } from '../src/pay/pay-public';

type Auth = { Authorization: string };
const BASE = '/api/v1'; const ADM = `${BASE}/admin/growth/corporate`; const PAT = `${BASE}/growth/v1/corporate`; const FLAG = 'growth.corporate';
const H = { marketplaceConsent: true, remindersConsent: true };

/**
 * The corporate benefit in Kiorex Pay (GRW-P4-C wiring, PAY-READY): deposit 500, cover 50% capped at 200 per visit, so the employer pays 200 and the card 300. Tender order
 * sponsored -> corporate -> credit -> card; provider income unchanged (the Clinic is told the GROSS 500); refund / cancel / forfeit allocation; the corporate ledger and the Pay
 * ledger reconcile; both postToPayLedger paths (finance H-25, default false) keep the Pay ledger identity.
 */
describe('corporate benefit wired into Kiorex Pay', () => {
  let c: TestCtx; let patient: Auth; let a: Auth; let b: Auth; let pid: string;
  const flush = async () => { for (let i = 0; i < 5; i++) await c.get(OutboxService).processBatch(200); };
  const unlock = async () => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); c.flags.invalidate(); };
  const acct = async (x: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account: x }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.debitMinor ?? 0) - (r.creditMinor ?? 0); };
  const intent = (id: string) => c.prisma.paymentIntent.findFirstOrThrow({ where: { bookingId: id } });
  const use = (id: string) => c.get(CorporateBenefitService).bookingUse(id);
  const book = async (i = 0) => { const h = await c.http().post(`${BASE}/bookings`).set(patient).send({ providerId: pid, typeId: 'typ_1', ...c.kiorly.slots[i] }).expect(201); await c.http().post(`${BASE}/bookings/${h.body.id}/confirm`).set(patient).send(H).expect(200); return h.body.id as string; };
  const pay = async (id: string) => { const co = (await c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(patient).send({}).expect(200)).body; await c.http().post(`${BASE}/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); return co; };
  const identity = async () => { const rows = await c.get(PayService).balances(); const dn = new Set(['PSP_CLEARING', 'PSP_FEES', 'PROMO_FUNDED:rewards', 'SPONSOR_FUNDED:clinicCredit', 'CORPORATE_FUNDED:benefit', 'CHARGEBACK_LOSS']); const net = (r: any) => r.debitMinor - r.creditMinor; return rows.filter((r) => dn.has(r.account)).reduce((t, r) => t + net(r), 0) + rows.filter((r) => !dn.has(r.account)).reduce((t, r) => t + net(r), 0); };
  const enrol = async () => {
    const acc = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Acme' }).expect(201)).body.id;
    await c.http().put(`${ADM}/accounts/${acc}/terms`).set(a).send({ contractRef: 'CTR-T', sponsorCeilingMinor: 100_000, perMemberCapMinor: 50_000, perVisitMaxMinor: 20_000, coverBp: 5000, endsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(), emailDomains: ['acme.com'] }).expect(200);
    await c.http().post(`${ADM}/accounts/${acc}/activate`).set(b).expect(200);
    const code = (await c.http().post(`${ADM}/accounts/${acc}/codes`).set(a).send({ label: 'HR', maxRedemptions: 5 }).expect(201)).body.code;
    await c.http().post(`${PAT}/join`).set(patient).send({ code }).expect(200);
  };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); await unlock();
    a = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); b = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] });
    patient = await c.as('sub_amira', { phone: '+201000000777' });
    c.kiorly.slots = [futureSlot(72), futureSlot(96), futureSlot(120)]; pid = await seedProvider(c, { fee: 600, depositAmount: 500 });
    await c.http().put(`${BASE}/me/profile`).set(patient).send({ nameEn: 'Amira' }).expect(200);
  });

  for (const post of [false, true]) {
    describe(`postToPayLedger ${post}`, () => {
      beforeEach(async () => { await unlockAll(c, ['growth.rewards', 'growth.patient_credit']); await setRewardRules(c, { mode: 'CREDIT', postToPayLedger: post }); await enrol(); });
      it('checkout shows PRICE, CORPORATE_BENEFIT, CARD; the card is charged 300; the Clinic is told gross 500 with the tender; the corporate ledger redeems; HELD follows the policy', async () => {
        const id = await book(); const co = await pay(id);
        expect(co).toMatchObject({ amountMinor: 30000 });
        expect(co.lines).toEqual([{ code: 'PRICE', amountMinor: 50000, labelKey: 'checkout.price' }, { code: 'CORPORATE_BENEFIT', amountMinor: -20000, labelKey: 'checkout.corporate' }, { code: 'CARD', amountMinor: 30000, labelKey: 'checkout.card' }]);
        expect(await intent(id)).toMatchObject({ amountMinor: 30000, corporateMinor: 20000, corporatePostedMinor: post ? 20000 : 0, status: 'CAPTURED' });
        expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 500, tender: { cardMinor: 30000, corporateBenefitMinor: 20000 } });
        expect(await use(id)).toEqual({ held: 0, used: 20000, net: 20000 });
        expect(-(await acct('HELD:cl_1'))).toBe(post ? 50000 : 30000); expect(await acct('CORPORATE_FUNDED:benefit')).toBe(post ? 20000 : 0); expect(await identity()).toBe(0);
      });
      it('full cancel: the patient gets the card amount back only, the corporate share returns to the account (never to the patient), HELD returns to 0', async () => {
        const id = await book(); await pay(id);
        await c.http().post(`${BASE}/bookings/${id}/cancel`).set(patient).send({ reason: 'plans changed' }); await flush();
        expect(await intent(id)).toMatchObject({ status: 'REFUNDED', refundedMinor: 30000, corporateVoidedMinor: 20000, corporatePostedMinor: 0 });
        expect(await use(id)).toEqual({ held: 0, used: 0, net: 0 }); expect(await acct('HELD:cl_1')).toBe(0); expect(await acct('CORPORATE_FUNDED:benefit')).toBe(0); expect(await acct('PSP_CLEARING')).toBe(0); expect(await identity()).toBe(0);
      });
      it('partial refunds return the corporate share pro rata and exactly in total; a replayed reverse does not return it twice', async () => {
        const id = await book(); await pay(id); const p = await intent(id); const pays = c.get(PayService);
        await pays.refund(p.id, { reason: 'p1', amountMinor: 10000, idempotencyKey: 'a' }); await flush();
        expect((await intent(id)).corporateVoidedMinor).toBe(6667); expect((await use(id)).net).toBe(20000 - 6667);
        await pays.refund(p.id, { reason: 'p2', amountMinor: 20000, idempotencyKey: 'b' }); await flush();
        expect(await intent(id)).toMatchObject({ corporateVoidedMinor: 20000, status: 'REFUNDED' }); expect((await use(id)).net).toBe(0);
        await c.prisma.outboxEvent.updateMany({ where: { type: 'pay.corporate_move' }, data: { status: 'PENDING', attempts: 0 } as never }).catch(() => undefined); await flush();
        expect((await use(id)).net).toBe(0); expect(await identity()).toBe(0);
      });
      it('forfeit (no-show): the employer is not charged (policy reverse); the clinic is paid the card part; reconciliation has no corporate mismatch', async () => {
        const id = await book(); await pay(id); const p = await intent(id);
        await c.get(PayService).releaseForBooking(id, 'FORFEITED'); await flush();
        expect(await intent(id)).toMatchObject({ corporateVoidedMinor: 20000, corporatePostedMinor: 0 }); expect(await use(id)).toMatchObject({ net: 0 });
        expect(Math.abs(await acct('HELD:cl_1'))).toBe(0); expect(-(await acct(`PAYABLE:${p.clinicId}`))).toBe(30000);
        await c.prisma.paymentIntent.update({ where: { id: p.id }, data: { capturedAt: new Date(Date.now() - 2 * 3600_000) } });
        const run = await c.get(PayService).reconcileDaily(); expect((run.discrepancies as any[]).filter((d) => /CORPORATE/.test(d.type))).toEqual([]);
      });
      it('reconciliation flags a corporate ledger that disagrees with the intent', async () => {
        const id = await book(); await pay(id); const p = await intent(id);
        await c.prisma.paymentIntent.update({ where: { id: p.id }, data: { capturedAt: new Date(Date.now() - 2 * 3600_000), corporateVoidedMinor: 5000 } });
        const run = await c.get(PayService).reconcileDaily(); expect((run.discrepancies as any[]).map((d) => d.type)).toContain('CORPORATE_LEDGER_MISMATCH');
      });
    });
  }

  it('a failed payment and a cancelled unpaid booking release the benefit hold; the DB refuses a benefit above the cap', async () => {
    await unlockAll(c, ['growth.rewards']); await enrol();
    const id = await book(); const co = (await c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(patient).send({}).expect(200)).body;
    expect((await use(id)).held).toBe(20000);
    await c.http().post(`${BASE}/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'fail' }).expect(200);
    expect(await use(id)).toMatchObject({ held: 0, used: 0 });
    expect((await intent(id)).corporateMinor).toBe(20000); // the intent keeps what it was priced with; the hold is what moves
    await expect(c.prisma.paymentIntent.update({ where: { id: (await intent(id)).id }, data: { corporateVoidedMinor: 99999999 } })).rejects.toThrow();
  });

  it('no corporate membership: the deposit, the lines and the Clinic notice are exactly as before', async () => {
    await unlockAll(c, ['growth.rewards']); const id = await book(); const co = await pay(id);
    expect(co.amountMinor).toBe(50000); expect(co.corporateBenefitMinor).toBeUndefined(); expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body.tender).toBeUndefined();
  });
});
