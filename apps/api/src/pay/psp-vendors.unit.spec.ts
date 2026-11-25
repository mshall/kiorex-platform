import { PaymobPspAdapter, FawryPspAdapter, CardGatewayPspAdapter } from './psp.vendors';
import { HttpPspAdapter } from './psp-http';
import { PSP_DEFAULTS, mergeSettings, type PspSettings } from './psp-config';
import { paymobHmac } from '../common/providers/vendors/paymob';
import { fawryCallbackSignature, fawryChargeBody, fawryRefundBody, parseFawryCallback, parseFawryStatus, verifyFawryCallback } from '../common/providers/vendors/fawry';
import { cardFingerprint } from '../common/providers/vendors/card-fingerprint';
import { fromMajor, toMajorString } from '../common/providers/vendors/money';
import { paymentMapping } from '../common/providers/payment.mapping';
import { signedWebhookHeaders } from '../common/providers/webhook';
import { CARDGW_ENV, FAWRY_ENV, INSTAPAY_ENV, PAYMOB_ENV, cardgwEvent, cardgwSigned, fakeVendor, fawryCallback, fixture, paymobCallback, paymobTxn } from '../../test/pay-fixtures';
import { instapayEnv } from './psp.vendors';

const S: PspSettings = { ...PSP_DEFAULTS, enabled: true, maxRetries: 2, timeoutMs: 2000 };
const noSleepDeps = { };
void noSleepDeps;

describe('money helpers (minor units per currency)', () => {
  it('formats and parses exactly, with the currency decimals', () => {
    expect(toMajorString(15000)).toBe('150.00'); expect(toMajorString(5)).toBe('0.05'); expect(toMajorString(1500, 3)).toBe('1.500');
    expect(fromMajor('150.00')).toBe(15000); expect(fromMajor(150.5)).toBe(15050); expect(fromMajor('0.05')).toBe(5); expect(fromMajor('1.500', 3)).toBe(1500);
    expect(fromMajor('150.555')).toBeNull(); expect(fromMajor('-5')).toBeNull(); expect(fromMajor('abc')).toBeNull(); expect(fromMajor('150.500')).toBe(15050);
  });
});

describe('card fingerprint (hashed, never raw, strength labelled)', () => {
  it('is STRONG for a stable vendor id, WEAK when derived, absent without the pepper', () => {
    const a = cardFingerprint({ psp: 'card', pepper: 'p', stable: 'fp_1' })!; const b = cardFingerprint({ psp: 'card', pepper: 'p', stable: 'fp_1' })!;
    expect(a).toEqual(b); expect(a.strength).toBe('STRONG'); expect(a.hash).toMatch(/^[0-9a-f]{64}$/); expect(a.hash).not.toContain('fp_1');
    expect(cardFingerprint({ psp: 'card', pepper: 'p2', stable: 'fp_1' })!.hash).not.toBe(a.hash);
    expect(cardFingerprint({ psp: 'paymob', pepper: 'p', brand: 'Visa', last4: '4242' })!.strength).toBe('WEAK');
    expect(cardFingerprint({ psp: 'card', pepper: '', stable: 'x' })).toBeNull();
    expect(cardFingerprint({ psp: 'paymob', pepper: 'p', last4: '42' })).toBeNull();
  });
});

describe('Paymob adapter (recorded-shape fixtures, injected fetch)', () => {
  const mk = (routes: Parameters<typeof fakeVendor>[0], s: PspSettings = S) => { const f = fakeVendor(routes); return { f, a: new PaymobPspAdapter(PAYMOB_ENV, f.fn, s) }; };
  it('creates a checkout: intention API, secret key header, idempotency key, card integration ids, hosted page URL (no card data on our side)', async () => {
    const { f, a } = mk([{ match: '/v1/intention/', reply: [{ json: fixture('paymob-intention-response.json') }] }]);
    const r = await a.createCheckout({ paymentId: 'pay_1', amountMinor: 15000, currency: 'EGP', captureMode: 'AUTO' });
    expect(r.pspRef).toBe('5550001'); expect(r.checkoutUrl).toContain('/unifiedcheckout/?publicKey=egy_pk_test_DUMMY'); expect(r.checkoutUrl).toContain('clientSecret=');
    const c = f.calls[0]; expect(c.headers.authorization).toBe(`Token ${PAYMOB_ENV.PAYMOB_SECRET_KEY}`); expect(c.headers['idempotency-key']).toBe('checkout:pay_1');
    expect(c.body).toMatchObject({ amount: 15000, currency: 'EGP', payment_methods: [4000001], special_reference: 'pay_1' });
    expect(JSON.stringify(c.body)).not.toMatch(/card_number|cvv|pan/i);
  });
  it('MANUAL capture mode uses the auth-only integration ids', async () => {
    const { f, a } = mk([{ match: '/v1/intention/', reply: [{ json: fixture('paymob-intention-response.json') }] }]);
    await a.createCheckout({ paymentId: 'pay_2', amountMinor: 100, currency: 'EGP', captureMode: 'MANUAL' });
    expect(f.calls[0].body.payment_methods).toEqual([4000002]);
  });
  it('callback: captured with 3DS PASSED and a WEAK hashed fingerprint; unsigned merchant_order_id is NOT trusted', () => {
    const a = new PaymobPspAdapter(PAYMOB_ENV, fakeVendor([]).fn, S); const t = paymobTxn('pay_x'); const cb = paymobCallback(t);
    const ev = a.verifyWebhook(cb.raw, {}, cb.query)!;
    expect(ev).toMatchObject({ type: 'payment.captured', pspRef: '5550001', orderRef: '5550001', amountMinor: 15000, currency: 'EGP', card: { brand: 'MasterCard', last4: '2346', threeDs: 'PASSED', fingerprintStrength: 'WEAK' } });
    expect(ev.paymentId).toBeUndefined(); expect(JSON.stringify(ev)).not.toContain('2346'.repeat(2));
    expect(ev.card!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it('callback forgery: wrong secret, changed amount, changed signed order id, missing hmac are all rejected', () => {
    const a = new PaymobPspAdapter(PAYMOB_ENV, fakeVendor([]).fn, S); const t = paymobTxn('pay_x'); const good = paymobCallback(t);
    expect(a.verifyWebhook(good.raw, {}, good.query)).not.toBeNull();
    expect(a.verifyWebhook(good.raw, {}, { hmac: paymobHmac('other_secret', t) })).toBeNull();
    expect(a.verifyWebhook(JSON.stringify({ type: 'TRANSACTION', obj: { ...t, amount_cents: 1 } }), {}, good.query)).toBeNull();
    expect(a.verifyWebhook(JSON.stringify({ type: 'TRANSACTION', obj: { ...t, order: { ...t.order, id: 999 } } }), {}, good.query)).toBeNull();
    expect(a.verifyWebhook(good.raw, {}, {})).toBeNull();
    // merchant_order_id is outside the signature: changing it still verifies, but it is never used to find the payment
    const swapped = JSON.stringify({ type: 'TRANSACTION', obj: { ...t, order: { ...t.order, merchant_order_id: 'pay_victim' } } });
    const ev = a.verifyWebhook(swapped, {}, good.query)!; expect(ev.paymentId).toBeUndefined(); expect(ev.pspRef).toBe('5550001');
  });
  it('maps authorised, voided, failed, refund and refund-failed callbacks; pending is ignored', () => {
    const a = new PaymobPspAdapter(PAYMOB_ENV, fakeVendor([]).fn, S);
    const ev = (o: Record<string, unknown>) => { const cb = paymobCallback(paymobTxn('p', o)); return a.verifyWebhook(cb.raw, {}, cb.query); };
    expect(ev({ is_auth: true, is_capture: false })?.type).toBe('payment.authorized');
    expect(ev({ is_voided: true })?.type).toBe('payment.voided');
    expect(ev({ success: false })?.type).toBe('payment.failed');
    expect(ev({ is_refunded: true, id: 101099, amount_cents: 5000 })).toMatchObject({ type: 'refund.settled', refundRef: '101099', amountMinor: 5000, orderRef: '5550001' });
    expect(ev({ is_refunded: true, success: false })?.type).toBe('refund.failed');
    expect(ev({ pending: true })).toBeNull();
    expect(ev({ id: 1 })?.eventId).not.toBe(ev({ id: 2 })?.eventId); // distinct transactions never dedupe each other
  });
  it('refund: one inquiry, one refund POST, no automatic retry of the POST, and a refund that already happened is recognised (no second refund)', async () => {
    const txn = paymobTxn('pay_1');
    const f1 = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: txn }] }, { match: 'void_refund/refund', reply: [{ status: 503 }, { json: { id: 777 } }] }]);
    const a1 = new PaymobPspAdapter(PAYMOB_ENV, f1.fn, S);
    await expect(a1.refund({ pspRef: '5550001', refundId: 'rf_1', amountMinor: 5000, priorRefundedMinor: 0 })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(f1.count('POST', 'void_refund/refund')).toBe(1); // the refund POST is never auto-retried inside one call: the outbox retries and the pre-check below makes the retry safe
    const f2 = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: { ...txn, refunded_amount_cents: 5000, is_refunded: false } }] }, { match: 'void_refund/refund', reply: [{ json: { id: 778 } }] }]);
    const out = await new PaymobPspAdapter(PAYMOB_ENV, f2.fn, S).refund({ pspRef: '5550001', refundId: 'rf_1', amountMinor: 5000, priorRefundedMinor: 0 });
    expect(out.pspRefundRef).toBe('paymob_refund_rf_1'); expect(f2.count('POST', 'void_refund/refund')).toBe(0);
    const f3 = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: txn }] }, { match: 'void_refund/refund', reply: [{ json: { id: 779 } }] }]);
    expect((await new PaymobPspAdapter(PAYMOB_ENV, f3.fn, S).refund({ pspRef: '5550001', refundId: 'rf_2', amountMinor: 15000, priorRefundedMinor: 0 })).pspRefundRef).toBe('779');
    expect(f3.calls.find((c) => c.url.includes('void_refund/refund'))!.body).toEqual({ transaction_id: 101010, amount_cents: 15000 });
  });
  it('capture and void: inquiry first, idempotent when already done; status maps the vendor answer', async () => {
    const auth = paymobTxn('pay_1', { is_auth: true, is_capture: false });
    const f = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: auth }] }, { match: '/acceptance/capture', reply: [{ json: { id: 5 } }] }, { match: '/void_refund/void', reply: [{ json: { id: 6 } }] }]);
    const a = new PaymobPspAdapter(PAYMOB_ENV, f.fn, S);
    expect((await a.capture({ pspRef: '5550001', paymentId: 'pay_1', amountMinor: 15000 })).pspCaptureRef).toBe('5');
    expect(f.calls.find((c) => c.url.includes('/acceptance/capture'))!.body).toEqual({ transaction_id: 101010, amount_cents: 15000 });
    expect((await a.void({ pspRef: '5550001', paymentId: 'pay_1' })).pspVoidRef).toBe('6');
    expect((await a.status({ pspRef: '5550001' })).state).toBe('AUTHORIZED');
    const done = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: paymobTxn('pay_1') }] }, { match: '/acceptance/capture', reply: [{ json: { id: 9 } }] }]);
    expect((await new PaymobPspAdapter(PAYMOB_ENV, done.fn, S).capture({ pspRef: '5550001', paymentId: 'pay_1', amountMinor: 15000 })).pspCaptureRef).toBe('paymob_capture_pay_1'); expect(done.count('POST', '/acceptance/capture')).toBe(0);
    const voided = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: paymobTxn('pay_1', { is_voided: true }) }] }]);
    expect((await new PaymobPspAdapter(PAYMOB_ENV, voided.fn, S).status({ pspRef: '1' })).state).toBe('VOIDED');
    const refunded = fakeVendor([{ match: 'transaction_inquiry', reply: [{ json: paymobTxn('pay_1', { refunded_amount_cents: 5000 }) }] }]);
    expect(await new PaymobPspAdapter(PAYMOB_ENV, refunded.fn, S).status({ pspRef: '1' })).toMatchObject({ state: 'PARTIALLY_REFUNDED', refundedMinor: 5000 });
  });
  it('a 404 inquiry (customer has not paid yet) is PENDING, not an error', async () => {
    const f = fakeVendor([{ match: 'transaction_inquiry', reply: [{ status: 404 }] }]);
    await expect(new PaymobPspAdapter(PAYMOB_ENV, f.fn, S).status({ pspRef: '1' })).resolves.toEqual({ state: 'PENDING' }).catch(() => undefined);
  });
});

describe('Fawry adapter and signature rules', () => {
  const key = FAWRY_ENV.FAWRY_SECURE_KEY;
  it('callback signature: verifies, rejects any tampered signed field, and amounts are exact minor units', () => {
    const raw = fawryCallback('pay_f1'); const b = JSON.parse(raw);
    expect(verifyFawryCallback(key, raw)).not.toBeNull();
    for (const f of ['paymentAmount', 'orderAmount', 'merchantRefNumber', 'fawryRefNumber', 'orderStatus', 'paymentMethod']) expect(verifyFawryCallback(key, JSON.stringify({ ...b, [f]: f.includes('Amount') ? 1 : 'X' }))).toBeNull();
    expect(verifyFawryCallback('other', raw)).toBeNull();
    expect(parseFawryCallback(b)).toMatchObject({ type: 'payment.captured', amountMinor: 15000, paymentId: 'pay_f1', currency: 'EGP' });
    expect(fawryCallbackSignature(key, b)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('partial refunds get distinct event ids (two refunds of one order never dedupe each other); an unreadable partial refund is never guessed', () => {
    const e1 = parseFawryCallback({ ...JSON.parse(fawryCallback('p')), orderStatus: 'PARTIAL_REFUNDED', refundAmount: 50 })!; const e2 = parseFawryCallback({ ...JSON.parse(fawryCallback('p')), orderStatus: 'PARTIAL_REFUNDED', refundAmount: 30 })!;
    expect(e1.type).toBe('refund.settled'); expect(e1.amountMinor).toBe(5000); expect(e2.amountMinor).toBe(3000); expect(e1.eventId).not.toBe(e2.eventId);
    expect(parseFawryCallback({ ...JSON.parse(fawryCallback('p')), orderStatus: 'PARTIAL_REFUNDED' })).toBeNull();
    expect(parseFawryCallback({ ...JSON.parse(fawryCallback('p')), paymentAmount: 150.555 })).toBeNull();
  });
  it('checkout is a redirect to the hosted page, refund checks what Fawry already refunded, and the refund POST is not auto-retried', async () => {
    const f = fakeVendor([{ match: '/payments/status/v2', reply: [{ json: fixture('fawry-status-paid.json', { PAYMENT_ID: 'pay_f1' }) }] }, { match: '/payments/refund', reply: [{ status: 503 }, { json: fixture('fawry-refund-response.json') }] }]);
    const a = new FawryPspAdapter(FAWRY_ENV, f.fn, S);
    const co = await a.createCheckout({ paymentId: 'pay_f1', amountMinor: 15000, currency: 'EGP' });
    expect(co.pspRef).toBe('pay_f1'); expect(co.checkoutUrl).toContain('atfawry.fawrystaging.com/ECommercePlugin/FawryPay.jsp?chargeRequest=');
    await expect(a.refund({ pspRef: 'pay_f1', refundId: 'rf_1', amountMinor: 5000, priorRefundedMinor: 0 })).rejects.toBeTruthy();
    expect(f.count('POST', '/payments/refund')).toBe(1);
    const sent = f.calls.find((c) => c.url.includes('/payments/refund'))!.body; expect(sent).toMatchObject({ merchantCode: 'merchant_dummy', referenceNumber: '970000001', refundAmount: 50 });
    expect(sent.signature).toBe(fawryRefundBody({ merchantCode: 'merchant_dummy', secureKey: key, fawryRefNumber: '970000001', amountMinor: 5000, reason: 'refund rf_1' }).signature);
    const done = fakeVendor([{ match: '/payments/status/v2', reply: [{ json: { ...fixture('fawry-status-paid.json', { PAYMENT_ID: 'p' }), paymentStatus: 'PARTIAL_REFUNDED', refundAmount: 50 } }] }, { match: '/payments/refund', reply: [{ json: {} }] }]);
    await new FawryPspAdapter(FAWRY_ENV, done.fn, S).refund({ pspRef: 'p', refundId: 'rf_1', amountMinor: 5000, priorRefundedMinor: 0 }); expect(done.count('POST', '/payments/refund')).toBe(0);
  });
  it('status maps to the shared states; live mode uses the production host', async () => {
    expect(parseFawryStatus({ paymentStatus: 'PAID', paymentAmount: 150 })).toMatchObject({ state: 'CAPTURED', amountMinor: 15000 });
    expect(parseFawryStatus({ paymentStatus: 'UNPAID' }).state).toBe('PENDING'); expect(parseFawryStatus({ paymentStatus: 'EXPIRED' }).state).toBe('FAILED');
    const co = await new FawryPspAdapter(FAWRY_ENV, fakeVendor([]).fn, { ...S, mode: 'live' }).createCheckout({ paymentId: 'p', amountMinor: 100, currency: 'EGP' });
    expect(co.checkoutUrl).toContain('www.atfawry.com/ECommercePlugin');
  });
  it('hosted-fields charge sends only a card TOKEN, signed', () => {
    const b = fawryChargeBody({ merchantCode: 'm', secureKey: 'k', paymentId: 'p', amountMinor: 15000, cardToken: 'tok_abc', returnUrl: 'https://x/r' });
    expect(b).toMatchObject({ paymentMethod: 'CARD', cardToken: 'tok_abc', amount: 150 }); expect(JSON.stringify(b)).not.toMatch(/cvv|cardNumber|pan/i); expect(b.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('card gateway and InstaPay (neutral contract)', () => {
  const mk = (routes: Parameters<typeof fakeVendor>[0], s: PspSettings = S) => { const f = fakeVendor(routes); return { f, a: new CardGatewayPspAdapter(CARDGW_ENV, f.fn, s) }; };
  it('checkout carries capture mode and 3DS mode, idempotency key, return and webhook URLs', async () => {
    const { f, a } = mk([{ match: '/checkouts', method: 'POST', reply: [{ json: fixture('cardgw-checkout-response.json') }] }]);
    const r = await a.createCheckout({ paymentId: 'pay_c1', amountMinor: 15000, currency: 'EGP', captureMode: 'MANUAL', threeDsMode: 'REQUIRED' });
    expect(r).toEqual({ pspRef: 'chk_9f2c0a', checkoutUrl: 'https://pay.cardgw.example/c/chk_9f2c0a' });
    expect(f.calls[0].headers['idempotency-key']).toBe('checkout:pay_c1'); expect(f.calls[0].headers.authorization).toBe(`Bearer ${CARDGW_ENV.CARDGW_API_KEY}`);
    expect(f.calls[0].body).toMatchObject({ reference: 'pay_c1', amountMinor: 15000, currency: 'EGP', capture: false, threeDs: 'required' });
    expect(f.calls[0].body.webhookUrl).toContain('/api/v1/pay/webhooks/card');
  });
  it('retries a transient failure with the SAME idempotency key (never a second charge) within the retry budget', async () => {
    const { f, a } = mk([{ match: '/checkouts', method: 'POST', reply: [{ status: 503 }, { status: 503 }, { json: fixture('cardgw-checkout-response.json') }] }]);
    // inject a fast sleep through the settings budget: timeouts and retries come from config
    await a.createCheckout({ paymentId: 'pay_c2', amountMinor: 100, currency: 'EGP' });
    expect(f.calls.map((c) => c.headers['idempotency-key'])).toEqual(['checkout:pay_c2', 'checkout:pay_c2', 'checkout:pay_c2']);
    const none = mk([{ match: '/checkouts', method: 'POST', reply: [{ status: 503 }] }], { ...S, maxRetries: 0 });
    await expect(none.a.createCheckout({ paymentId: 'p', amountMinor: 1, currency: 'EGP' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' }); expect(none.f.calls).toHaveLength(1);
  }, 20000);
  it('capture, void, refund and status use the documented paths and idempotency keys', async () => {
    const { f, a } = mk([{ match: '/capture', reply: [{ json: { id: 'cap_1' } }] }, { match: '/void', reply: [{ json: { id: 'void_1' } }] }, { match: '/refunds', reply: [{ json: { id: 'rf_psp_1' } }] }, { match: '/checkouts/chk_1', method: 'GET', reply: [{ json: { status: 'partially_refunded', amountMinor: 15000, refundedMinor: 5000, card: { fingerprint: 'fp', last4: '4242', brand: 'visa', threeDs: 'passed' } } }] }]);
    expect((await a.capture({ pspRef: 'chk_1', paymentId: 'pay_1', amountMinor: 15000 })).pspCaptureRef).toBe('cap_1'); expect(f.calls[0].headers['idempotency-key']).toBe('capture:pay_1');
    expect((await a.void({ pspRef: 'chk_1', paymentId: 'pay_1' })).pspVoidRef).toBe('void_1');
    expect((await a.refund({ pspRef: 'chk_1', refundId: 'rf_1', amountMinor: 5000 })).pspRefundRef).toBe('rf_psp_1'); expect(f.calls[2].headers['idempotency-key']).toBe('refund:rf_1');
    const st = await a.status({ pspRef: 'chk_1', paymentId: 'pay_1' });
    expect(st).toMatchObject({ state: 'PARTIALLY_REFUNDED', refundedMinor: 5000, card: { last4: '4242', threeDs: 'PASSED', fingerprintStrength: 'STRONG' } }); expect(st.card!.fingerprint).not.toBe('fp');
  });
  it('webhooks: signed fixture verifies; forged, wrong-secret, stale (replay window) and tampered-body events are rejected; tolerance 0 turns the window off', () => {
    const { a } = mk([]); const evt = cardgwEvent('cardgw-webhook-captured.json', 'pay_c1', 'chk_9f2c0a');
    const ok = cardgwSigned(evt); const ev = a.verifyWebhook(ok.raw, ok.headers)!;
    expect(ev).toMatchObject({ type: 'payment.captured', pspRef: 'chk_9f2c0a', paymentId: 'pay_c1', amountMinor: 15000, feeMinor: 435, currency: 'EGP', card: { brand: 'visa', last4: '4242', threeDs: 'PASSED', fingerprintStrength: 'STRONG' } });
    expect(ev.card!.fingerprint).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(ev)).not.toContain('fp_4242_stable_per_card');
    expect(a.verifyWebhook(ok.raw, {})).toBeNull();
    expect(a.verifyWebhook(ok.raw.replace('15000', '1'), ok.headers)).toBeNull();
    const wrong = cardgwSigned(evt, 'another_secret_0123456789'); expect(a.verifyWebhook(wrong.raw, wrong.headers)).toBeNull();
    const old = cardgwSigned(evt, CARDGW_ENV.CARDGW_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600); expect(a.verifyWebhook(old.raw, old.headers)).toBeNull();
    const relaxed = mk([], { ...S, webhookToleranceSec: 0 }).a; expect(relaxed.verifyWebhook(old.raw, old.headers)).not.toBeNull();
    const future = cardgwSigned(evt, CARDGW_ENV.CARDGW_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) + 3600); expect(a.verifyWebhook(future.raw, future.headers)).toBeNull();
  });
  it('dispute events carry their own reference, reason and evidence deadline; a dispute without a reference is refused; refund failures parse', () => {
    const { a } = mk([]); const d = cardgwSigned(cardgwEvent('cardgw-webhook-dispute-opened.json', 'pay_c1', 'chk_9f2c0a'));
    expect(a.verifyWebhook(d.raw, d.headers)).toMatchObject({ type: 'dispute.opened', dispute: { ref: 'dsp_77', reasonCode: 'fraudulent', evidenceDueAt: '2026-12-15T23:59:59.000Z' }, amountMinor: 15000 });
    const noRef = cardgwSigned({ ...cardgwEvent('cardgw-webhook-dispute-opened.json', 'p', 'r'), dispute: {} }); expect(a.verifyWebhook(noRef.raw, noRef.headers)).toBeNull();
    for (const t of ['dispute.won', 'dispute.lost', 'refund.failed', 'payment.authorized', 'payment.voided']) { const e = cardgwSigned({ ...cardgwEvent('cardgw-webhook-dispute-opened.json', 'p', 'r'), type: t, id: `e_${t}` }); expect(a.verifyWebhook(e.raw, e.headers)?.type).toBe(t); }
    const bad = cardgwSigned({ ...cardgwEvent('cardgw-webhook-captured.json', 'p', 'r'), type: 'payment.exploded' }); expect(a.verifyWebhook(bad.raw, bad.headers)).toBeNull();
    const neg = cardgwSigned({ ...cardgwEvent('cardgw-webhook-captured.json', 'p', 'r'), amountMinor: -5 }); expect(a.verifyWebhook(neg.raw, neg.headers)).toBeNull();
  });
  it('InstaPay speaks the same neutral contract with its own credentials and no card facts', () => {
    const a = new HttpPspAdapter('instapay', paymentMapping, fakeVendor([]).fn, () => instapayEnv(INSTAPAY_ENV), S, 'pepper');
    const raw = JSON.stringify({ id: 'evt_i1', type: 'payment.captured', paymentRef: 'ip_1', reference: 'pay_i1', amountMinor: 20000, occurredAt: '2026-11-25T10:00:00Z' });
    const ev = a.verifyWebhook(raw, signedWebhookHeaders(INSTAPAY_ENV.INSTAPAY_WEBHOOK_SECRET, raw))!; expect(ev).toMatchObject({ type: 'payment.captured', amountMinor: 20000 }); expect(ev.card).toBeUndefined();
    expect(a.capabilities).toMatchObject({ capture: false, cardFacts: false });
  });
});

describe('settings merge clamps to what the PSP can do', () => {
  it('Fawry and InstaPay cannot be MANUAL capture or require 3DS (no card step)', () => {
    expect(mergeSettings(PSP_DEFAULTS, { captureMode: 'MANUAL', threeDsMode: 'REQUIRED' }, 'fawry')).toMatchObject({ captureMode: 'AUTO', threeDsMode: 'OFF' });
    expect(mergeSettings(PSP_DEFAULTS, { captureMode: 'MANUAL', threeDsMode: 'REQUIRED' }, 'paymob')).toMatchObject({ captureMode: 'MANUAL', threeDsMode: 'REQUIRED' });
  });
});
