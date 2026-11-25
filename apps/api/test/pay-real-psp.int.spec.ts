import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { DAY, setRewardRules, unlockAll } from './growth-rewards-helpers';
import { CARDGW_ENV, PAYMOB_ENV, cardgwEvent, cardgwSigned, fakeVendor, fixture, fixtureText, paymobCallback, paymobTxn } from './pay-fixtures';
import { OutboxService } from '../src/outbox/outbox-public';
import { PayService, PspConfigService } from '../src/pay/pay-public';
import { __setPspAdapterOverride } from '../src/pay/psp';
import { CardGatewayPspAdapter, PaymobPspAdapter } from '../src/pay/psp.vendors';
import { resetBreakers } from '../src/pay/psp-breaker';
import { signedWebhookHeaders } from '../src/common/providers/webhook';

type Auth = { Authorization: string };
const BASE = '/api/v1';
const H = { marketplaceConsent: true, remindersConsent: true };

/**
 * PAY-READY on the real HTTP stack and Postgres: the REAL vendor adapters (Paymob, card gateway) wired to scripted vendor HTTP (recorded-shape fixtures), mock Clinic. No network, no credentials.
 * Covers: hosted checkout, signed callbacks, replay, forgery and amount tampering, refunds (full, partial, double), chargebacks (open, won, lost), status polling, settlement import and
 * reconciliation, the corporate benefit in the tender order, and both postToPayLedger paths with the ledger identity.
 */
describe('Kiorex Pay with real PSP adapters (PAY-READY)', () => {
  let c: TestCtx; let patient: Auth; let pid: string; let vendor: ReturnType<typeof fakeVendor>;
  const flush = async () => { for (let i = 0; i < 5; i++) await c.get(OutboxService).processBatch(200); };
  const pay = () => c.get(PayService);
  const book = async (i = 0) => { const h = await c.http().post(`${BASE}/bookings`).set(patient).send({ providerId: pid, typeId: 'typ_1', ...c.kiorly.slots[i] }).expect(201); await c.http().post(`${BASE}/bookings/${h.body.id}/confirm`).set(patient).send(H).expect(200); return h.body.id as string; };
  const checkout = (id: string) => c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(patient).send({});
  const intent = (id: string) => c.prisma.paymentIntent.findFirstOrThrow({ where: { bookingId: id } });
  const acct = async (a: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account: a }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.debitMinor ?? 0) - (r.creditMinor ?? 0); };
  const unbalanced = () => c.prisma.$queryRaw<{ txId: string }[]>`SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
  const paymobHook = (obj: object, q?: Record<string, string>) => { const cb = paymobCallback(obj as never); return c.http().post(`${BASE}/pay/webhooks/paymob`).query(q ?? cb.query).set('content-type', 'application/json').send(cb.raw); };
  const cardHook = (evt: object, secret = CARDGW_ENV.CARDGW_WEBHOOK_SECRET) => { const s = cardgwSigned(evt, secret); return c.http().post(`${BASE}/pay/webhooks/card`).set(s.headers).set('content-type', 'application/json').send(s.raw); };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { __setPspAdapterOverride(null); await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); resetBreakers(); seqReset();
    patient = await c.as('sub_amira');
    c.kiorly.slots = [futureSlot(72), futureSlot(96), futureSlot(120)]; pid = await seedProvider(c, { fee: 600, depositAmount: 500 });
    await c.http().put(`${BASE}/me/profile`).set(patient).send({ nameEn: 'Amira' }).expect(200);
    vendor = fakeVendor([
      { match: '/v1/intention/', reply: [(call) => ({ json: { ...fixture('paymob-intention-response.json'), intention_order_id: 5550000 + Math.floor(Math.random() * 99999), special_reference: call.body.special_reference } })] },
      { match: 'transaction_inquiry', reply: [{ json: paymobTxn('pay_x') }] }, { match: 'void_refund/refund', reply: [{ json: { id: 880001 } }] },
      { match: '/checkouts', method: 'POST', reply: [() => { const id = `chk_${Math.random().toString(36).slice(2, 10)}`; return { json: { ...fixture('cardgw-checkout-response.json'), id, checkoutUrl: `https://pay.cardgw.example/c/${id}` } }; }] },
    ]);
    __setPspAdapterOverride((name, s) => name === 'paymob' ? new PaymobPspAdapter(PAYMOB_ENV, vendor.fn, s) : name === 'card' ? new CardGatewayPspAdapter(CARDGW_ENV, vendor.fn, s) : null);
  });
  const seqReset = () => undefined;

  describe('Paymob: hosted checkout, signed callbacks, forgery and replay', () => {
    it('checkout redirects to the hosted page; a signed callback captures once with 3DS and card facts; replay is a DUPLICATE; the ledger and the Clinic notice are written once', async () => {
      const id = await book(); const co = (await checkout(id).expect(200)).body;
      expect(co.checkoutUrl).toContain('/unifiedcheckout/'); const p = await intent(id); expect(p).toMatchObject({ psp: 'paymob', amountMinor: 50000 });
      const order = Number(p.pspRef);
      const txn = paymobTxn(p.id, { amount_cents: 50000, order: { id: order, merchant_order_id: p.id } });
      expect((await paymobHook(txn).expect(200)).body.status).toBe('CAPTURED');
      expect((await paymobHook(txn).expect(200)).body.status).toBe('DUPLICATE');
      expect(await intent(id)).toMatchObject({ status: 'CAPTURED', cardBrand: 'MasterCard', cardLast4: '2346', threeDsStatus: 'PASSED' });
      expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `capture:${p.id}` } })).toBe(1); expect(await acct('PSP_CLEARING')).toBe(50000);
      await flush(); expect(c.kiorly.callsTo('POST', '/deposit-paid')).toHaveLength(1);
      expect((await c.prisma.referralIdentitySignal.count({ where: { kind: 'PAY_FINGERPRINT' } }))).toBe(0); // a WEAK (derived) fingerprint is not a signal unless ops opt in
    });
    it('security: forged hmac, tampered amount and tampered signed order id are 400 and change nothing; an unsigned merchant_order_id swap cannot capture another payment', async () => {
      const a = await book(0); const b = await book(1); await checkout(a).expect(200); await checkout(b).expect(200);
      const pa = await intent(a); const pb = await intent(b);
      const txn = paymobTxn(pa.id, { amount_cents: 50000, order: { id: Number(pa.pspRef), merchant_order_id: pa.id } });
      await paymobHook(txn, { hmac: 'f'.repeat(128) }).expect(400);
      const good = paymobCallback(txn);
      await c.http().post(`${BASE}/pay/webhooks/paymob`).query(good.query).set('content-type', 'application/json').send(JSON.stringify({ type: 'TRANSACTION', obj: { ...txn, amount_cents: 100 } })).expect(400);
      await c.http().post(`${BASE}/pay/webhooks/paymob`).query(good.query).set('content-type', 'application/json').send(JSON.stringify({ type: 'TRANSACTION', obj: { ...txn, order: { ...txn.order, id: Number(pb.pspRef) } } })).expect(400);
      // the attacker pays payment A legitimately, then points the (unsigned) merchant_order_id at payment B
      await c.http().post(`${BASE}/pay/webhooks/paymob`).query(good.query).set('content-type', 'application/json').send(JSON.stringify({ type: 'TRANSACTION', obj: { ...txn, order: { ...txn.order, merchant_order_id: pb.id } } })).expect(200);
      expect((await intent(a)).status).toBe('CAPTURED'); expect((await intent(b)).status).toBe('CREATED');
      // amount mismatch with a VALID signature is refused and audited
      const low = paymobTxn(pb.id, { id: 202020, amount_cents: 100, order: { id: Number(pb.pspRef), merchant_order_id: pb.id } });
      await paymobHook(low).expect(409); expect((await intent(b)).status).toBe('CREATED');
      expect(await c.prisma.auditLog.count({ where: { action: 'pay.amount_mismatch', resourceId: pb.id } })).toBe(1);
      expect(await c.prisma.webhookReceipt.count({ where: { eventId: 'psp:paymob_202020' } })).toBe(0); // a refused event stays retryable
    });
    it('refunds: partial then rest, no over-refund, a refund callback after the API settled is a no-op, a wrong refund amount is refused, a payment is never refunded twice', async () => {
      const id = await book(); await checkout(id).expect(200); const p = await intent(id);
      await paymobHook(paymobTxn(p.id, { amount_cents: 50000, order: { id: Number(p.pspRef) } })).expect(200); await flush();
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      vendor.calls.length = 0;
      const r1 = await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'goodwill', amountMinor: 20000 }).expect(200); await flush();
      expect((await c.prisma.refund.findUniqueOrThrow({ where: { id: r1.body.id } })).status).toBe('SETTLED');
      expect(vendor.count('POST', 'void_refund/refund')).toBe(1); expect(vendor.calls.find((x) => x.url.includes('void_refund/refund'))!.body).toEqual({ transaction_id: 101010, amount_cents: 20000 });
      await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'too much', amountMinor: 40000 }).expect(400);
      expect((await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'goodwill', amountMinor: 20000 }).expect(200)).body.id).toBe(r1.body.id); // same idempotency key -> same refund
      const r2 = await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'rest', amountMinor: 30000 }).expect(200); await flush();
      expect(await intent(id)).toMatchObject({ status: 'REFUNDED', refundedMinor: 50000 });
      await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'again' }).expect(409);
      const late = paymobTxn(p.id, { is_refunded: true, id: 880001, amount_cents: 20000, order: { id: Number(p.pspRef) } });
      expect((await paymobHook(late).expect(200)).body.status).toBe('ALREADY_SETTLED');
      expect(r2.body.id).not.toBe(r1.body.id); expect(await unbalanced()).toHaveLength(0); expect(await acct('PSP_CLEARING')).toBe(0); expect(await acct('HELD:cl_1')).toBe(0);
    });
    it('a refund callback with an amount that is not ours is refused (tampered unsigned refund amount never settles another refund)', async () => {
      const id = await book(); await checkout(id).expect(200); const p = await intent(id);
      await paymobHook(paymobTxn(p.id, { amount_cents: 50000, order: { id: Number(p.pspRef) } })).expect(200);
      const rf = await pay().refund(p.id, { reason: 'x', amountMinor: 10000, idempotencyKey: 'k1' });
      expect((await paymobHook(paymobTxn(p.id, { is_refunded: true, id: 990001, amount_cents: 9999, order: { id: Number(p.pspRef) } })).expect(200)).body.status).toBe('REFUND_NOT_FOUND');
      expect((await c.prisma.refund.findUniqueOrThrow({ where: { id: rf.id } })).status).toBe('REQUESTED');
    });
  });

  describe('card gateway: fingerprint, disputes, manual capture, polling', () => {
    const mkCard = async (i = 0) => { const id = await book(i); const intentRow = await pay().createDepositIntent({ bookingId: id, sub: 'sub_amira', clinicId: 'cl_1', amountMinor: 50000, currency: 'EGP', psp: 'card' }); return { id, p: intentRow }; };
    it('a captured card payment records the STRONG hashed fingerprint for the fraud signals (never the raw value)', async () => {
      const { p } = await mkCard();
      await cardHook(cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000 })).expect(200);
      const rows = await c.prisma.referralIdentitySignal.findMany({ where: { kind: 'PAY_FINGERPRINT' } });
      expect(rows).toHaveLength(1); expect(rows[0].sub).toBe('sub_amira'); expect(rows[0].valueHash).toMatch(/^[0-9a-f]{64}$/); expect(rows[0].valueHash).not.toContain('fp_4242');
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ cardLast4: '4242', threeDsStatus: 'PASSED', feeMinor: 435 });
      expect(await acct('PSP_FEES')).toBe(435);
    });
    it('dispute OPEN freezes the deposit (no payout, no refund) and holds the reward credit tied to the booking; WON releases; LOST posts the chargeback out of HELD and the identity holds', async () => {
      await unlockAll(c, ['growth.rewards', 'growth.patient_credit']); await setRewardRules(c, { mode: 'CREDIT' });
      const { id, p } = await mkCard(); await cardHook(cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000, card: undefined })).expect(200);
      // a reward lot that this booking produced
      const lot = await c.prisma.rewardLot.create({ data: { sub: 'sub_amira', kind: 'REFERRER', mode: 'CREDIT', amountMinor: 5000, ruleVersionId: 'rv', qualifyingBookingId: id, status: 'ACTIVE' } as never }).catch(() => null);
      const open = cardgwEvent('cardgw-webhook-dispute-opened.json', p.id, p.pspRef!, { amountMinor: 50000 });
      expect((await cardHook(open).expect(200)).body.status).toBe('DISPUTE_OPENED');
      expect((await cardHook(open).expect(200)).body.status).toBe('DUPLICATE');
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ disputeState: 'OPEN' });
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      expect((await c.http().post(`${BASE}/admin/payments/refund`).set(ops).send({ paymentId: p.id, reason: 'xxx' }).expect(409)).body.code).toBe('DISPUTE_OPEN');
      await c.prisma.paymentIntent.update({ where: { id: p.id }, data: { releasedAt: new Date(), releaseKind: 'COMPLETED' } });
      expect((await pay().runPayouts()).payouts).toHaveLength(0); // never paid out while disputed
      await c.prisma.paymentIntent.update({ where: { id: p.id }, data: { releasedAt: null, releaseKind: null } });
      if (lot) expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('HELD');
      const lost = { ...open, id: 'evt_dsp_lost', type: 'dispute.lost' };
      expect((await cardHook(lost).expect(200)).body.status).toBe('DISPUTE_LOST');
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'REFUNDED', refundedMinor: 50000, disputeState: 'LOST' });
      expect(await acct('HELD:cl_1')).toBe(0); expect(await acct('PSP_CLEARING')).toBe(-435); /* only the PSP fee stays booked */ expect(await unbalanced()).toHaveLength(0);
      expect(await c.prisma.ledgerTx.count({ where: { kind: 'CHARGEBACK_FROM_HELD' } })).toBe(1);
      expect((await cardHook({ ...open, id: 'evt_dsp_lost2', type: 'dispute.lost' }).expect(200)).body.status).toBe('DUPLICATE_DISPUTE'); // a repeated verdict never posts twice
      const run = await pay().reconcileDaily(); expect((run.discrepancies as any[]).map((d) => d.type)).not.toContain('LEDGER_UNBALANCED');
    });
    it('dispute WON: the freeze and the holds are released and the deposit can be paid out', async () => {
      const { p } = await mkCard(); await cardHook(cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000 })).expect(200);
      const open = cardgwEvent('cardgw-webhook-dispute-opened.json', p.id, p.pspRef!, { amountMinor: 50000 });
      await cardHook(open).expect(200); await cardHook({ ...open, id: 'evt_won', type: 'dispute.won' }).expect(200);
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'CAPTURED', disputeState: 'WON' });
      await pay().releaseForBooking(p.bookingId!, 'COMPLETED'); expect((await pay().runPayouts()).payouts).toHaveLength(1);
    });
    it('chargeback AFTER the payout books CHARGEBACK_LOSS (Kiorex out of pocket) and the identity still holds; ops can record a dispute from the PSP dashboard', async () => {
      const { p } = await mkCard(); await cardHook(cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000 })).expect(200);
      await pay().releaseForBooking(p.bookingId!, 'COMPLETED'); await pay().runPayouts();
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      await c.http().post(`${BASE}/admin/payments/${p.id}/dispute`).set(ops).send({ state: 'LOST', reference: 'dash-991' }).expect(200);
      expect(await acct('CHARGEBACK_LOSS')).toBe(50000); expect(await unbalanced()).toHaveLength(0);
      await c.http().post(`${BASE}/admin/payments/${p.id}/dispute`).set(await c.as('sub_pat')).send({ state: 'LOST', reference: 'x1x' }).expect(403);
    });
    it('manual capture: authorised, captured by ops once, or voided; nothing is ledgered until captured', async () => {
      await c.prisma.pspSetting.create({ data: { psp: 'card', market: '*', settings: { captureMode: 'MANUAL' }, updatedBy: 't' } }); c.get(PspConfigService).invalidate();
      const a = await mkCard(0); const b = await mkCard(1); expect(vendor.calls.find((x) => x.url.endsWith('/checkouts'))!.body.capture).toBe(false);
      await cardHook(cardgwEvent('cardgw-webhook-captured.json', a.p.id, a.p.pspRef!, { id: 'evt_auth', type: 'payment.authorized', amountMinor: 50000 })).expect(200);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: a.p.id } })).status).toBe('AUTHORIZED'); expect(await acct('PSP_CLEARING')).toBe(0);
      vendor = Object.assign(vendor, {}); const v2 = fakeVendor([{ match: '/capture', reply: [{ json: { id: 'cap_1' } }] }, { match: '/void', reply: [{ json: { id: 'v1' } }] }, { match: '/checkouts/', method: 'GET', reply: [{ json: { status: 'captured', amountMinor: 50000 } }] }]);
      __setPspAdapterOverride((n, s) => n === 'card' ? new CardGatewayPspAdapter(CARDGW_ENV, v2.fn, s) : null);
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      await c.http().post(`${BASE}/admin/payments/${a.p.id}/capture`).set(ops).expect(200);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: a.p.id } })).status).toBe('CAPTURED'); expect(await acct('PSP_CLEARING')).toBe(50000);
      await cardHook(cardgwEvent('cardgw-webhook-captured.json', b.p.id, b.p.pspRef!, { id: 'evt_auth_b', type: 'payment.authorized', amountMinor: 50000 })).expect(200);
      await c.http().post(`${BASE}/admin/payments/${b.p.id}/void`).set(ops).send({}).expect(200);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: b.p.id } })).status).toBe('VOIDED');
      await c.http().post(`${BASE}/admin/payments/${b.p.id}/capture`).set(ops).expect(409);
    });
    it('status polling fallback: a payment whose callback never arrived is captured from the PSP answer exactly once; a late callback is a no-op', async () => {
      const { p } = await mkCard(); const stuck = await mkCard(1);
      const v2 = fakeVendor([{ match: '/checkouts/', method: 'GET', reply: [{ json: { status: 'captured', amountMinor: 50000, feeMinor: 435 } }] }]);
      __setPspAdapterOverride((n, s) => n === 'card' ? new CardGatewayPspAdapter(CARDGW_ENV, v2.fn, s) : null);
      await c.prisma.paymentIntent.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      await c.prisma.paymentIntent.update({ where: { id: stuck.p.id }, data: { createdAt: new Date(Date.now() + 3600_000) } }); // keep the second one out of this run
      expect(await pay().pollPending()).toMatchObject({ checked: 1, changed: 1 });
      expect(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'CAPTURED', feeMinor: 435 });
      expect((await cardHook(cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000 })).expect(200)).body.status).toBe('ALREADY_CAPTURED');
      expect(await c.prisma.ledgerTx.count({ where: { idempotencyKey: `capture:${p.id}` } })).toBe(1);
      const v3 = fakeVendor([{ match: '/checkouts/', method: 'GET', reply: [{ json: { status: 'pending' } }] }]);
      __setPspAdapterOverride((n, s) => n === 'card' ? new CardGatewayPspAdapter(CARDGW_ENV, v3.fn, s) : null);
      await c.prisma.paymentIntent.update({ where: { id: stuck.p.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
      await pay().pollPending(); expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: stuck.p.id } })).status).toBe('FAILED'); // never paid: given up, holds released
    });
    it('a stale or forged gateway callback is rejected; an outage opens the circuit and the patient gets a retryable 503 instead of a hang', async () => {
      const { p } = await mkCard(); const evt = cardgwEvent('cardgw-webhook-captured.json', p.id, p.pspRef!, { amountMinor: 50000 });
      const old = JSON.stringify(evt); await c.http().post(`${BASE}/pay/webhooks/card`).set(signedWebhookHeaders(CARDGW_ENV.CARDGW_WEBHOOK_SECRET, old, Math.floor(Date.now() / 1000) - 7200)).set('content-type', 'application/json').send(old).expect(400);
      await cardHook(evt, 'wrong_secret_0123456789').expect(400);
      const down = fakeVendor([{ match: '/checkouts', method: 'POST', reply: [{ status: 503 }] }]);
      await c.prisma.pspSetting.create({ data: { psp: 'card', market: '*', settings: { maxRetries: 0, breaker: { threshold: 2, cooldownMs: 60000 } }, updatedBy: 't' } }); c.get(PspConfigService).invalidate();
      __setPspAdapterOverride((n, s) => n === 'card' ? new CardGatewayPspAdapter(CARDGW_ENV, down.fn, s) : null);
      for (let i = 0; i < 2; i++) await expect(pay().createDepositIntent({ bookingId: `b${i}`, sub: 's', clinicId: 'cl_1', amountMinor: 100, currency: 'EGP', psp: 'card' })).rejects.toBeTruthy();
      const before = down.calls.length;
      await expect(pay().createDepositIntent({ bookingId: 'b9', sub: 's', clinicId: 'cl_1', amountMinor: 100, currency: 'EGP', psp: 'card' })).rejects.toMatchObject({ status: 503 });
      expect(down.calls.length).toBe(before); // refused instantly: no call to the dead gateway
    });
  });

  describe('settlement import and reconciliation', () => {
    it('imports a Paymob CSV once (idempotent on the file hash), matches captures and reports typed mismatches; the mismatch report is CSV and formula-safe', async () => {
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      const id = await book(); await checkout(id).expect(200); const p = await intent(id);
      await paymobHook(paymobTxn(p.id, { amount_cents: 50000, order: { id: Number(p.pspRef) } })).expect(200);
      const day = new Date().toISOString().slice(0, 10);
      const csv = `Order ID,Type,Status,Amount,Fees,Settlement Date,Payout ID\n${p.pspRef},Sale,Success,400.00,12.00,${day},PO-1\n=HYPERLINK("x"),Sale,Success,10.00,0,${day},PO-1\n`; // the file says 400, we captured 500
      const r1 = await c.http().post(`${BASE}/admin/payments/settlement/import`).set(ops).send({ psp: 'paymob', filename: 's.csv', content: csv }).expect(200);
      expect(r1.body).toMatchObject({ imported: 2, duplicate: false }); expect((await c.http().post(`${BASE}/admin/payments/settlement/import`).set(ops).send({ psp: 'paymob', filename: 's.csv', content: csv }).expect(200)).body.duplicate).toBe(true);
      const run = await c.http().post(`${BASE}/admin/reconciliation/psp/run`).query({ date: day }).set(ops).expect(200);
      const types = (run.body.discrepancies as any[]).map((d) => d.type); expect(types).toEqual(expect.arrayContaining(['AMOUNT_MISMATCH', 'UNKNOWN_AT_PSP']));
      const out = await c.http().get(`${BASE}/admin/payments/reconciliation/${run.body.id}/mismatches.csv`).set(ops).expect(200);
      expect(out.text.split('\n')[0]).toBe('type,psp,reference,detail'); expect(out.text).not.toMatch(/^=HYPERLINK|,=HYPERLINK/m);
    });
  });

  describe('connection check and settings (ops, mock-safe)', () => {
    it('the check lists secret REFERENCES (never values), webhook URLs and a signature self-test; settings changes are audited and refuse secrets', async () => {
      const ops = await c.as('sub_ops', { roles: ['ops_admin'] });
      const chk = (await c.http().get(`${BASE}/admin/payments/connection-check`).set(ops).expect(200)).body;
      expect(chk.mode).toBe('mock'); expect(chk.psps.map((x: any) => x.psp)).toEqual(['paymob', 'fawry', 'instapay', 'card']);
      expect(chk.psps[0].webhook.url).toContain('/api/v1/pay/webhooks/paymob'); expect(chk.psps[0].secrets.some((s: any) => s.ref === '/kiorex/staging/paymob-hmac-secret')).toBe(true);
      expect(JSON.stringify(chk)).not.toContain(PAYMOB_ENV.PAYMOB_HMAC_SECRET);
      const saved = await c.http().put(`${BASE}/admin/payments/settings/paymob`).set(ops).send({ settings: { fee: { percentBps: 250 }, refundWindowDays: 14, threeDsMode: 'PREFERRED' } }).expect(200);
      expect(saved.body.settings).toMatchObject({ fee: { percentBps: 250 }, refundWindowDays: 14, threeDsMode: 'PREFERRED' });
      expect(await c.prisma.auditLog.count({ where: { action: 'pay.settings_changed' } })).toBe(1);
      await c.http().put(`${BASE}/admin/payments/settings/paymob`).set(ops).send({ settings: { apiKey: 'sk_live_x' } }).expect(400);
      await c.http().put(`${BASE}/admin/payments/settings/paymob`).set(ops).send({ settings: { mode: 'live' } }).expect(400); // live outside production needs an explicit acknowledgement
      await c.http().get(`${BASE}/admin/payments/connection-check`).set(patient).expect(403);
    });
  });
});
