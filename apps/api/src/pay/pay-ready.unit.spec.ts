import fc from 'fast-check';
import { splitDeposit, depositLines } from './deposit-allocation';
import { allocateRefund, corporateReversedByRefund } from './refund-allocation';
import { A, LedgerBook, capture, chargebackFromHeld, chargebackFromPayable, chargebackLoss, corporateTender, corporateVoid, identityHolds, refundRequest, refundSettle, release, sponsorTender, sponsorVoid } from './ledger';
import { PspBreaker, PspCircuitOpenError } from './psp-breaker';
import { ProviderError } from '../common/providers/http';
import { PSP_DEFAULTS, feeFor, keyModeProblem, mergeSettings, pspsForMarket, resolveSettings, servesMarket, withinRefundWindow, PSP_NAMES } from './psp-config';
import { parseCsv, parseSettlement, expectedNet } from './settlement-import';

const int = (max: number) => fc.integer({ min: 0, max });

describe('deposit allocation (property): parts always sum to the gross, never negative, the card keeps one unit', () => {
  it('S + B + C + K = price for every input, in the founder tender order', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5_000_000 }), int(6_000_000), int(6_000_000), int(6_000_000), (price, s, b, cr) => {
      const d = splitDeposit({ priceMinor: price, sponsoredMinor: s, corporateMinor: b, creditMinor: cr });
      expect(d.sponsoredMinor + d.corporateMinor + d.creditMinor + d.cardMinor).toBe(price);
      for (const v of [d.sponsoredMinor, d.corporateMinor, d.creditMinor]) expect(v).toBeGreaterThanOrEqual(0);
      expect(d.cardMinor).toBeGreaterThanOrEqual(1);
      expect(d.sponsoredMinor).toBe(Math.min(s, price - 1)); // sponsored first
      expect(d.corporateMinor).toBe(Math.min(b, price - 1 - d.sponsoredMinor)); // then corporate, on what is left
      const lines = depositLines(d);
      expect(lines[0].amountMinor + lines.filter((l) => !['PRICE', 'CARD'].includes(l.code)).reduce((t, l) => t + l.amountMinor, 0)).toBe(d.cardMinor);
    }), { numRuns: 2000 });
  });
  it('rejects negative, fractional and below-minimum input', () => {
    expect(() => splitDeposit({ priceMinor: 0 })).toThrow(); expect(() => splitDeposit({ priceMinor: 100, corporateMinor: -1 })).toThrow(); expect(() => splitDeposit({ priceMinor: 100.5 })).toThrow();
  });
});

describe('refund allocation with a corporate share (property)', () => {
  it('shares returned never exceed what was funded, are exact on the full refund, and never go backwards across partial refunds', () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 1_000_000 }), fc.integer({ min: 1, max: 99 }), fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }), (card, pct, cuts) => {
      const corp = Math.floor((card * pct) / 100); let refunded = 0; let reversed = 0;
      for (const cut of cuts) {
        const part = Math.min(card - refunded, Math.max(1, Math.floor(((card - refunded) * cut) / 100))); if (part <= 0) break;
        refunded += part; const r = corporateReversedByRefund({ corporateMinor: corp, cardMinor: card, cardRefundedAfterMinor: refunded, alreadyReversedMinor: reversed });
        expect(r).toBeGreaterThanOrEqual(0); reversed += r; expect(reversed).toBeLessThanOrEqual(corp);
      }
      if (refunded < card) { const last = corporateReversedByRefund({ corporateMinor: corp, cardMinor: card, cardRefundedAfterMinor: card, alreadyReversedMinor: reversed }); expect(reversed + last).toBe(corp); }
      else expect(reversed).toBe(corp);
    }), { numRuns: 1500 });
  });
  it('allocateRefund carries the corporate share only when one is given, and credit + card = patient paid', () => {
    fc.assert(fc.property(fc.integer({ min: 1000, max: 500_000 }), int(40), int(40), int(100), (price, sp, cp, pct) => {
      const S = Math.floor((price * sp) / 100), B = Math.floor((price * cp) / 100), C = Math.floor((price - S - B) / 3), K = price - S - B - C;
      const out = allocateRefund({ priceMinor: price, sponsoredMinor: S, corporateMinor: B, creditMinor: C, cardMinor: K, heldDepositMinor: 0, refundableMinor: Math.floor((price * pct) / 100) });
      expect(out.creditRestoredMinor + out.cardRefundMinor).toBe(out.patientPaidRefundableMinor); expect(out.corporateReversedMinor!).toBeLessThanOrEqual(B); expect(out.sponsoredVoidedMinor).toBeLessThanOrEqual(S);
      expect(out.cardRefundMinor).toBeGreaterThanOrEqual(0);
    }));
    expect(allocateRefund({ priceMinor: 100, sponsoredMinor: 0, creditMinor: 0, cardMinor: 100, heldDepositMinor: 0, refundableMinor: 100 })).not.toHaveProperty('corporateReversedMinor');
  });
});

describe('Pay ledger with corporate, chargeback and loss accounts keeps the accounting identity (property)', () => {
  type Op = { t: 'corp' | 'refund' | 'release' | 'cbHeld' | 'cbPayable' | 'cbLoss'; n: number };
  it('any legal sequence leaves debit-normal accounts equal to liabilities and no liability negative', () => {
    fc.assert(fc.property(fc.integer({ min: 1000, max: 100_000 }), int(100), fc.array(fc.constantFrom('refund', 'release', 'cbHeld') as fc.Arbitrary<Op['t']>, { maxLength: 3 }), (card, pct, tail) => {
      const book = new LedgerBook(); const corp = Math.floor((card * pct) / 100);
      book.post({ key: 'c', kind: 'CAPTURE', postings: capture('c1', card) });
      if (corp > 0) book.post({ key: 'ct', kind: 'CORPORATE_FUNDED', postings: corporateTender('c1', corp) });
      let held = card + corp; let ended = false;
      for (const [i, t] of tail.entries()) {
        if (ended) break;
        if (t === 'refund') { const n = Math.min(card, held); if (n > 0) { book.post({ key: `r${i}`, kind: 'R', postings: refundRequest('c1', n) }); book.post({ key: `s${i}`, kind: 'S', postings: refundSettle(n) }); held -= n; if (corp > 0 && held > 0) { const v = Math.min(corp, held); book.post({ key: `cv${i}`, kind: 'V', postings: corporateVoid(A.held('c1'), v) }); held -= v; } ended = true; } }
        else if (t === 'release') { book.post({ key: `rl${i}`, kind: 'RL', postings: release('c1', held) }); held = 0; ended = true; }
        else { book.post({ key: `cb${i}`, kind: 'CB', postings: chargebackFromHeld(A.held('c1'), Math.min(card, held)) }); held -= Math.min(card, held); ended = true; }
      }
      expect(identityHolds(book)).toBe(true);
    }), { numRuns: 800 });
    const b = new LedgerBook(); b.post({ key: 'c', kind: 'C', postings: capture('c1', 500) }); b.post({ key: 'r', kind: 'RL', postings: release('c1', 500) }); b.post({ key: 'cb', kind: 'CB', postings: chargebackFromPayable('c1', 500) }); expect(identityHolds(b)).toBe(true);
    const l = new LedgerBook(); l.post({ key: 'c', kind: 'C', postings: capture('c1', 500) }); l.post({ key: 'cb', kind: 'CB', postings: chargebackLoss(500) }); expect(l.balance(A.chargebackLoss)).toBe(500);
    const s = new LedgerBook(); s.post({ key: 'c', kind: 'C', postings: capture('c1', 300) }); s.post({ key: 's', kind: 'S', postings: sponsorTender('c1', 100) }); s.post({ key: 'ct', kind: 'CT', postings: corporateTender('c1', 100) }); s.post({ key: 'sv', kind: 'SV', postings: sponsorVoid(A.held('c1'), 100) }); expect(identityHolds(s)).toBe(true);
  });
  it('a liability can never be driven negative by a chargeback larger than what is held', () => {
    const b = new LedgerBook(); b.post({ key: 'c', kind: 'C', postings: capture('c1', 100) });
    expect(() => b.post({ key: 'cb', kind: 'CB', postings: chargebackFromHeld(A.held('c1'), 101) })).toThrow(/negative/);
  });
});

describe('circuit breaker', () => {
  const transient = () => Promise.reject(new ProviderError('PROVIDER_UNAVAILABLE', true, 503));
  it('opens after the threshold of transient failures, refuses instantly, probes once after the cool-down, closes on success', async () => {
    let now = 0; const b = new PspBreaker('x', { threshold: 3, cooldownMs: 1000, now: () => now });
    for (let i = 0; i < 3; i++) await expect(b.exec(transient)).rejects.toBeInstanceOf(ProviderError);
    let called = 0; await expect(b.exec(async () => { called++; })).rejects.toBeInstanceOf(PspCircuitOpenError); expect(called).toBe(0);
    now = 1500; await expect(b.exec(transient)).rejects.toBeInstanceOf(ProviderError); expect(b.snapshot().state).toBe('OPEN'); // the probe failed: open again
    now = 3000; await expect(b.exec(async () => 'ok')).resolves.toBe('ok'); expect(b.snapshot().state).toBe('CLOSED');
  });
  it('a rejection (4xx) is the caller or the configuration, not an outage: it never trips the breaker', async () => {
    const b = new PspBreaker('y', { threshold: 2, cooldownMs: 1000 });
    for (let i = 0; i < 5; i++) await expect(b.exec(() => Promise.reject(new ProviderError('INVALID_REQUEST', false, 400)))).rejects.toBeTruthy();
    expect(b.snapshot().state).toBe('CLOSED');
  });
});

describe('settings: layers, fees as config (never invented), windows, routing order', () => {
  it('env < market row; unknown or out-of-range values are ignored; fees are null until configured', () => {
    const env = { PAYMENT_ENABLED_PSPS: 'fawry,paymob', PAYMENT_ENVIRONMENT: 'live' };
    const f = resolveSettings('fawry', 'EG', [], env); const p = resolveSettings('paymob', 'EG', [], env);
    expect(f).toMatchObject({ enabled: true, order: 10, mode: 'live' }); expect(p.order).toBe(20); expect(f.fee).toEqual({ percentBps: null, fixedMinor: null, vatBps: null });
    const row = resolveSettings('paymob', 'EG', [{ market: '*', settings: { fee: { percentBps: 250 }, order: 5 } }, { market: 'EG', settings: { timeoutMs: 99999999, maxRetries: 'x', threeDsMode: 'NOPE', refundWindowDays: 30 } }], env);
    expect(row).toMatchObject({ order: 5, fee: { percentBps: 250 }, refundWindowDays: 30, timeoutMs: PSP_DEFAULTS.timeoutMs, maxRetries: PSP_DEFAULTS.maxRetries, threeDsMode: 'REQUIRED' });
    expect(resolveSettings('paymob', 'EG', [], { PSP_FEE_BPS: '0' }).fee.percentBps).toBeNull();
  });
  it('fee: the PSP-reported fee wins; unset config books 0 and says NEEDS_HUMAN; config is percent plus fixed, half up, never above the amount', () => {
    expect(feeFor(PSP_DEFAULTS, 10000)).toEqual({ feeMinor: 0, source: 'UNSET', needsHuman: true });
    expect(feeFor(PSP_DEFAULTS, 10000, 123)).toMatchObject({ feeMinor: 123, source: 'PSP_REPORTED' });
    expect(feeFor(mergeSettings(PSP_DEFAULTS, { fee: { percentBps: 250, fixedMinor: 100 } }), 10001)).toMatchObject({ feeMinor: 350, source: 'CONFIG' });
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e7 }), fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 1e5 }), (amt, bps, fx) => { const r = feeFor(mergeSettings(PSP_DEFAULTS, { fee: { percentBps: bps, fixedMinor: fx } }), amt); expect(r.feeMinor).toBeGreaterThanOrEqual(0); expect(r.feeMinor).toBeLessThanOrEqual(amt); }));
  });
  it('refund window, market/currency service and the order of preference', () => {
    const s = mergeSettings(PSP_DEFAULTS, { refundWindowDays: 10 }); const cap = new Date('2026-11-01T00:00:00Z');
    expect(withinRefundWindow(s, cap, new Date('2026-11-10T00:00:00Z'))).toBe(true); expect(withinRefundWindow(s, cap, new Date('2026-11-12T00:00:00Z'))).toBe(false); expect(withinRefundWindow(PSP_DEFAULTS, cap, new Date('2030-01-01'))).toBe(true);
    const all = Object.fromEntries(PSP_NAMES.map((n, i) => [n, mergeSettings(PSP_DEFAULTS, { enabled: n !== 'instapay', order: 40 - i * 10, markets: n === 'card' ? ['AE'] : ['*'] }, n)])) as never;
    expect(pspsForMarket(all, 'EG', 'EGP', 'EGP')).toEqual(['bank_ipn', 'fawry', 'paymob']); expect(pspsForMarket(all, 'AE', 'AED', 'AED')[0]).toBe('bank_ipn');
    expect(servesMarket(mergeSettings(PSP_DEFAULTS, { enabled: true }), 'EG', 'USD', 'EGP')).toBe(false);
  });
  it('a test key in live mode (and the reverse) is flagged without echoing the key', () => {
    expect(keyModeProblem('paymob', 'live', { PAYMOB_SECRET_KEY: 'egy_sk_test_abc' })).toMatch(/TEST key/); expect(keyModeProblem('paymob', 'sandbox', { PAYMOB_SECRET_KEY: 'egy_sk_live_abc' })).toMatch(/LIVE key/);
    expect(keyModeProblem('paymob', 'live', { PAYMOB_SECRET_KEY: 'egy_sk_live_abc' })).toBeNull(); expect(String(keyModeProblem('paymob', 'live', { PAYMOB_SECRET_KEY: 'egy_sk_test_abc' }))).not.toContain('abc');
  });
});

describe('settlement file parsing', () => {
  it('reads quoted CSV, BOM and CRLF', () => { expect(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n\r\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']]); });
  it('Paymob-style CSV: skips failed rows, exact amounts, several refunds of one order stay distinct, payout net', () => {
    const csv = 'Order ID,Type,Status,Amount (EGP),Fees,Settlement Date,Payout ID\n1,Sale,Success,150.00,4.35,2026-11-25,P1\n2,Sale,Failed,80.00,0,2026-11-25,P1\n1,Refund,Success,50.00,0,2026-11-25,P1\n1,Refund,Success,25.50,0,2026-11-25,P1\n3,Sale,Success,10.555,0,2026-11-25,P1\n,Sale,Success,10,0,2026-11-25,P1\n4,Wire,Success,10,0,2026-11-25,P1\n5,Sale,Success,10,0,not-a-date,P1\n';
    const r = parseSettlement(csv);
    expect(r.lines.map((l) => [l.pspRef, l.kind, l.amountMinor, l.feeMinor])).toEqual([['1', 'CAPTURE', 15000, 435], ['1', 'REFUND', 5000, 0], ['1#2', 'REFUND', 2550, 0]]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['BAD_AMOUNT', 'NO_REFERENCE', 'UNKNOWN_KIND:wire', 'BAD_DATE']); expect(expectedNet(r.lines)).toBe(15000 - 435 - 5000 - 2550);
  });
  it('JSON with minor-unit columns and a per-PSP column mapping (no deploy needed for a new export format)', () => {
    expect(parseSettlement(JSON.stringify({ transactions: [{ reference: 'r1', type: 'capture', amountMinor: 15000, feeMinor: 435, date: '2026-11-25' }, { reference: 'r1', type: 'chargeback', amountMinor: 15000, date: '2026-12-20' }] })).lines.map((l) => [l.kind, l.amountMinor, l.feeMinor])).toEqual([['CAPTURE', 15000, 435], ['CHARGEBACK', 15000, 0]]);
    const m = mergeSettings(PSP_DEFAULTS, { settlement: { columns: { pspRef: 'Our Ref', amount: 'Gross', kind: 'Movement', date: 'Day' }, amountUnit: 'minor', kindMap: { cashin: 'CAPTURE' } } }).settlement;
    expect(parseSettlement('Our Ref,Gross,Movement,Day\nX1,2500,CashIn,2026-11-25\n', { mapping: m }).lines).toEqual([{ pspRef: 'X1', kind: 'CAPTURE', amountMinor: 2500, feeMinor: 0, date: '2026-11-25', currency: 'EGP' }]);
  });
  it('garbage never throws and never invents lines', () => { for (const g of ['', 'not json {', '[1,2', '{"a":1}', 'a\n']) expect(parseSettlement(g).lines).toEqual([]); });
});

describe('fixture recorder redacts credentials', () => {
  it('never writes an authorization header, a secret field, or a signature in a URL', async () => {
    const { mkdtempSync, readdirSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const { recordingFetch, redactUrl } = await import('./psp-recorder'); const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const f = recordingFetch((async () => new Response(JSON.stringify({ id: 1, client_secret: 'zzz', is_3d_secure: true }), { status: 200 })) as never, { PAYMENT_RECORD_FIXTURES_DIR: dir, NODE_ENV: 'development' });
    await f('https://x.test/a?signature=abc&y=1', { method: 'POST', headers: { authorization: 'Token egy_sk_test_SECRET' }, body: JSON.stringify({ amount: 1, apiKey: 'k1', card_number: '4242' }) });
    const out = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'); expect(out).not.toMatch(/SECRET|k1|zzz|4242|signature=abc/); expect(out).toContain('"is_3d_secure": true'); expect(redactUrl('u?hmac=1&a=2')).toBe('u?hmac=[REDACTED]&a=2');
    const prod = recordingFetch(async () => new Response('{}'), { PAYMENT_RECORD_FIXTURES_DIR: dir, NODE_ENV: 'production' }); await prod('https://x.test'); expect(readdirSync(dir)).toHaveLength(1); // never records in production
  });
});
