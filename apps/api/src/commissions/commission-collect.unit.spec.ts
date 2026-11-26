import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agingBucketNames, agingEdges, commissionJobIntervalMs, dunningBounds, moneyPolicyLeadMs, moneyPolicyNoticeDays } from './commission-bounds';
import { AGING_BUCKETS, afterFailure, agingBucket, collectAtOf, csvCell, duePeriod, eligibleForRun, latestCutoff, missingSettings, netSplit, parseSettings, reconcilePayout, reconcileRun, resolveSettings, settingsProblems, startingMode, toCsv, EMPTY_SETTINGS, type ClaimLite } from './commission-collect';
import { canCommission, commissionCapabilitiesOf } from './commission-access';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// placeholder values for TESTS only; the product ships none (NEEDS_HUMAN, LG-COM-1)
const S = { mode: 'AUTO_CHARGE_SAVED_METHOD', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 2, retryDays: [2, 5], minCollectMinor: 1000, invoiceDueDays: 10 } as const;
const claim = (o: Partial<ClaimLite> = {}): ClaimLite => ({ id: 'c1', amountMinor: 5000, decisionAmountMinor: 5000, chargeStatus: 'CONFIRMED', collectionStatus: 'UNCOLLECTED', confirmedAt: d('2026-11-10'), disputeDeadline: d('2026-11-17'), disputeStatus: null, currency: 'EGP', ...o });

describe('commission settings', () => {
  it('ships nothing: empty settings are not configured and name what is missing', () => {
    expect(missingSettings(EMPTY_SETTINGS)).toEqual(['mode', 'cycle', 'cutoffDay', 'graceDays', 'retryDays', 'minCollectMinor', 'invoiceDueDays']);
    expect(missingSettings({ ...parseSettings(S), mode: 'NET_FROM_PAYOUT', invoiceDueDays: null })).toEqual([]);
  });
  it('rejects unknown keys, bad cutoff for the cycle, unordered retries', () => {
    expect(settingsProblems({ foo: 1 })).toContain('unknown setting foo');
    expect(settingsProblems({ cycle: 'MONTHLY', cutoffDay: 31 })).toContain('cutoffDay is invalid');
    expect(settingsProblems({ cycle: 'WEEKLY', cutoffDay: 7 })).toEqual([]);
    expect(settingsProblems({ retryDays: [5, 2] })).toContain('retryDays is invalid');
    expect(settingsProblems({ mode: 'CASH' })).toContain('mode is invalid');
    expect(settingsProblems([])).toEqual(['settings must be an object']);
  });
  it('org overrides win field by field, null inherits', () => {
    const r = resolveSettings(parseSettings(S), { mode: 'NET_FROM_PAYOUT', graceDays: null });
    expect(r.mode).toBe('NET_FROM_PAYOUT'); expect(r.graceDays).toBe(2); expect(r.cycle).toBe('MONTHLY');
  });
});

describe('periods and cut-offs', () => {
  it('monthly: latest cut-off at or before now, period key is the cut-off date', () => {
    expect(latestCutoff(d('2026-11-25'), 'MONTHLY', 5)).toEqual(d('2026-11-05'));
    expect(latestCutoff(d('2026-11-03'), 'MONTHLY', 5)).toEqual(d('2026-10-05'));
    expect(latestCutoff(d('2026-01-02'), 'MONTHLY', 5)).toEqual(d('2025-12-05'));
  });
  it('weekly: ISO weekday cut-off (Wed 25 Nov 2026 with cutoff Monday = 23 Nov)', () => {
    expect(latestCutoff(d('2026-11-25'), 'WEEKLY', 1)).toEqual(d('2026-11-23'));
    expect(latestCutoff(d('2026-11-29'), 'WEEKLY', 7)).toEqual(d('2026-11-29'));
  });
  it('a period is due only after the grace days; before that the previous one is due', () => {
    const s = parseSettings(S);
    expect(duePeriod(d('2026-11-06'), s)?.periodKey).toBe('2026-10-05');
    expect(duePeriod(d('2026-11-07'), s)?.periodKey).toBe('2026-11-05');
    expect(duePeriod(d('2026-11-07'), parseSettings({ ...S, cycle: null }))).toBeNull();
    expect(collectAtOf(d('2026-11-05'), 2)).toEqual(d('2026-11-07'));
  });
});

describe('eligibility (nothing lost, nothing early)', () => {
  const cut = d('2026-11-20');
  it('only confirmed, undisputed, past the window, uncollected', () => {
    expect(eligibleForRun(claim(), cut)).toBe(true);
    expect(eligibleForRun(claim({ chargeStatus: 'PENDING' }), cut)).toBe(false);
    expect(eligibleForRun(claim({ chargeStatus: 'DISPUTED' }), cut)).toBe(false);
    expect(eligibleForRun(claim({ disputeStatus: 'OPEN' }), cut)).toBe(false);
    expect(eligibleForRun(claim({ disputeDeadline: d('2026-11-25') }), cut)).toBe(false);
    expect(eligibleForRun(claim({ confirmedAt: d('2026-11-21') }), cut)).toBe(false);
    expect(eligibleForRun(claim({ collectionStatus: 'COLLECTED' }), cut)).toBe(false);
  });
  it('an old uncollected claim carries over to a later period', () => {
    expect(eligibleForRun(claim({ confirmedAt: d('2026-08-01'), disputeDeadline: d('2026-08-08') }), d('2026-12-20'))).toBe(true);
  });
});

describe('mode and safe fallback', () => {
  const s = parseSettings(S);
  it('auto-charge needs a chosen provider and a saved method, else invoice with the reason', () => {
    expect(startingMode(s, { provider: 'paymob', hasSavedMethod: true, payableMinor: 0 })).toEqual({ mode: 'AUTO_CHARGE_SAVED_METHOD', requested: 'AUTO_CHARGE_SAVED_METHOD' });
    expect(startingMode(s, { provider: null, hasSavedMethod: true, payableMinor: 0 }).fallbackReason).toBe('NO_PROVIDER_CHOSEN');
    expect(startingMode(s, { provider: 'paymob', hasSavedMethod: false, payableMinor: 0 })).toMatchObject({ mode: 'INVOICE_AND_COLLECT', fallbackReason: 'NO_SAVED_METHOD' });
    expect(startingMode(EMPTY_SETTINGS, { provider: null, hasSavedMethod: false, payableMinor: 0 }).fallbackReason).toBe('NOT_CONFIGURED');
  });
  it('net-from-payout never takes more than is payable; the rest is invoiced', () => {
    expect(netSplit(5000, 3000)).toEqual({ netMinor: 3000, invoiceMinor: 2000 });
    expect(netSplit(5000, 9000)).toEqual({ netMinor: 5000, invoiceMinor: 0 });
    expect(netSplit(5000, -5)).toEqual({ netMinor: 0, invoiceMinor: 5000 });
  });
});

describe('dunning', () => {
  const first = d('2026-11-07');
  it('retries on the configured days counted from the first attempt, then falls back to an invoice', () => {
    expect(afterFailure(1, first, first, [2, 5], true)).toEqual({ action: 'RETRY', at: d('2026-11-09'), attemptNo: 2 });
    expect(afterFailure(2, first, d('2026-11-09'), [2, 5], true)).toEqual({ action: 'RETRY', at: d('2026-11-12'), attemptNo: 3 });
    expect(afterFailure(3, first, d('2026-11-12'), [2, 5], true)).toEqual({ action: 'FALL_BACK_TO_INVOICE' });
  });
  it('a hard decline or no retry plan falls back at once (never a silent write-off)', () => {
    expect(afterFailure(1, first, first, [2, 5], false)).toEqual({ action: 'FALL_BACK_TO_INVOICE' });
    expect(afterFailure(1, first, first, null, true)).toEqual({ action: 'FALL_BACK_TO_INVOICE' });
  });
  it('aging buckets', () => {
    expect(AGING_BUCKETS).toHaveLength(5);
    const now = d('2026-12-31');
    expect([agingBucket(d('2026-12-31'), now), agingBucket(d('2026-12-20'), now), agingBucket(d('2026-11-20'), now), agingBucket(d('2026-10-20'), now), agingBucket(d('2026-08-01'), now)]).toEqual(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']);
  });
});

describe('reconciliation', () => {
  const run = { id: 'r1', orgRef: 'org1', periodKey: '2026-11-05', claimsMinor: 8000, claimsCount: 2, collectedMinor: 5000, deductedMinor: 0, invoicedMinor: 3000, paidMinor: 0, status: 'INVOICE_OPEN' };
  const claims = [{ id: 'a', runId: 'r1', amountMinor: 5000, decisionAmountMinor: 5000, collectionStatus: 'COLLECTED', collectedMinor: 5000, chargeStatus: 'CONFIRMED' }, { id: 'b', runId: 'r1', amountMinor: 3000, decisionAmountMinor: 3000, collectionStatus: 'INVOICED', collectedMinor: 0, chargeStatus: 'CONFIRMED' }];
  const attempts = [{ runId: 'r1', kind: 'CHARGE', status: 'SUCCEEDED', amountMinor: 5000 }, { runId: 'r1', kind: 'INVOICE', status: 'SUCCEEDED', amountMinor: 3000 }];
  it('clean books give no findings', () => expect(reconcileRun(run, claims, attempts)).toEqual([]));
  it('charged != decision is a finding', () => expect(reconcileRun(run, [{ ...claims[0]!, decisionAmountMinor: 4500 }, claims[1]!], attempts).map((f) => f.code)).toEqual(['CHARGE_NE_DECISION']));
  it('a missing decision amount, a stray total and an unaccounted run are findings', () => {
    expect(reconcileRun(run, [{ ...claims[0]!, decisionAmountMinor: null }, claims[1]!], attempts).map((f) => f.code)).toEqual(['NO_DECISION_AMOUNT']);
    expect(reconcileRun({ ...run, collectedMinor: 4000 }, claims, attempts).map((f) => f.code)).toEqual(expect.arrayContaining(['COLLECTED_NE_ATTEMPTS', 'RUN_NOT_FULLY_ACCOUNTED']));
    expect(reconcileRun({ ...run, claimsMinor: 9000 }, claims, attempts).map((f) => f.code)).toContain('RUN_CLAIMS_MISMATCH');
  });
  it('payout: cash + deduction = released deposits and equals the deduction attempts', () => {
    const p = { payoutRef: 'po1', clinicId: 'c', amountMinor: 7000, commissionDeductedMinor: 3000 };
    expect(reconcilePayout(p, 10000, [3000])).toEqual([]);
    expect(reconcilePayout(p, 10500, [2000]).map((f) => f.code)).toEqual(['PAYOUT_GROSS_MISMATCH', 'PAYOUT_DEDUCTION_MISMATCH']);
  });
});

describe('exports', () => {
  it('csv escapes quotes and neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell(-12.5)).toBe('-12.5'); expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [['1']])).toBe('﻿a\r\n1\r\n');
  });
});

describe('finance roles', () => {
  it('super_admin and finance read and export; ops_admin alone sees no money; only super_admin configures', () => {
    expect(canCommission(['ops_admin'], 'read')).toBe(false);
    expect(canCommission(['ops_admin', 'finance'], 'export')).toBe(true);
    expect(canCommission(['finance'], 'proposeConfig')).toBe(false);
    expect(canCommission(['finance'], 'approveConfig')).toBe(false);
    expect(commissionCapabilitiesOf(['super_admin']).approveConfig).toBe(true);
    expect(commissionCapabilitiesOf(['support', 'growth_admin']).read).toBe(false);
  });
});

describe('collection never blocks care', () => {
  it('the commissions module has no listing pause, suspension, plan or booking gate', () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect({ f, hit: /listing\.|PAUSED|suspend|blockBooking|bookingIntent|revokeAccess/i.test(src) }).toEqual({ f, hit: false });
    }
  });
});

describe('COM-3 configured dispute window and token permission', () => {
  const cut = d('2026-11-20');
  it('a dispute window on the rate (days after confirmation) replaces the reported deadline; unset keeps it', () => {
    const c = claim({ confirmedAt: d('2026-11-10'), disputeDeadline: d('2026-11-30') });
    expect(eligibleForRun(c, cut)).toBe(false); // reported deadline after the cut-off
    expect(eligibleForRun(c, cut, 5)).toBe(true); // 10 Nov + 5 days = 15 Nov
    expect(eligibleForRun(c, cut, 15)).toBe(false); // 25 Nov
    expect(eligibleForRun(c, cut, 0)).toBe(true);
  });
  it('savedMethodChargeAllowed=false falls back to an invoice with its own reason; true / unset keep the saved-method charge', () => {
    const s = { ...EMPTY_SETTINGS, mode: 'AUTO_CHARGE_SAVED_METHOD' as const };
    const f = { provider: 'paymob', hasSavedMethod: true, payableMinor: 0 };
    expect(startingMode(s, { ...f, savedMethodAllowed: false })).toMatchObject({ mode: 'INVOICE_AND_COLLECT', fallbackReason: 'SAVED_METHOD_NOT_PERMITTED' });
    expect(startingMode(s, { ...f, savedMethodAllowed: true }).mode).toBe('AUTO_CHARGE_SAVED_METHOD');
    expect(startingMode(s, f).mode).toBe('AUTO_CHARGE_SAVED_METHOD');
  });
});

describe('12.B hardcoded values now configuration (defaults unchanged)', () => {
  const KEYS = ['COMMISSION_RETRY_DAY_MAX', 'COMMISSION_RETRY_MAX_COUNT', 'COMMISSION_GRACE_DAYS_MAX', 'COMMISSION_INVOICE_DUE_DAYS_MAX', 'COMMISSION_AGING_BUCKET_DAYS', 'COMMISSION_JOB_INTERVAL_MS', 'MONEY_POLICY_NOTICE_DAYS'];
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it('defaults equal the values that used to be literals', () => {
    expect(dunningBounds()).toEqual({ retryDayMax: 60, retryMaxCount: 6, graceDaysMax: 30, invoiceDueDaysMax: 90 });
    expect(agingEdges()).toEqual([30, 60, 90]); expect(agingBucketNames()).toEqual([...AGING_BUCKETS]);
    expect(commissionJobIntervalMs()).toBe(15 * 60_000); expect(moneyPolicyNoticeDays()).toBe(7); expect(moneyPolicyLeadMs()).toBe(7 * 86_400_000);
  });
  it('dunning bounds widen the accepted settings; out-of-range or junk values fall back to the default', () => {
    expect(parseSettings({ retryDays: [1, 90] }).retryDays).toBeNull(); expect(parseSettings({ graceDays: 45 }).graceDays).toBeNull(); expect(parseSettings({ invoiceDueDays: 120 }).invoiceDueDays).toBeNull();
    process.env.COMMISSION_RETRY_DAY_MAX = '120'; process.env.COMMISSION_GRACE_DAYS_MAX = '60'; process.env.COMMISSION_INVOICE_DUE_DAYS_MAX = '180'; process.env.COMMISSION_RETRY_MAX_COUNT = '8';
    expect(parseSettings({ retryDays: [1, 90] }).retryDays).toEqual([1, 90]); expect(parseSettings({ graceDays: 45 }).graceDays).toBe(45); expect(parseSettings({ invoiceDueDays: 120 }).invoiceDueDays).toBe(120);
    expect(parseSettings({ retryDays: [1, 2, 3, 4, 5, 6, 7, 8] }).retryDays).toHaveLength(8);
    process.env.COMMISSION_RETRY_DAY_MAX = '0'; process.env.COMMISSION_GRACE_DAYS_MAX = 'abc'; expect(dunningBounds().retryDayMax).toBe(60); expect(dunningBounds().graceDaysMax).toBe(30);
  });
  it('aging edges and bucket names follow COMMISSION_AGING_BUCKET_DAYS; invalid values keep 30/60/90', () => {
    const now = d('2027-01-01');
    process.env.COMMISSION_AGING_BUCKET_DAYS = '15,45,120';
    expect(agingBucketNames()).toEqual(['CURRENT', 'D1_15', 'D16_45', 'D46_120', 'D120_PLUS']);
    expect([agingBucket(d('2026-12-20'), now), agingBucket(d('2026-12-01'), now), agingBucket(d('2026-10-01'), now), agingBucket(d('2026-05-01'), now)]).toEqual(['D1_15', 'D16_45', 'D46_120', 'D120_PLUS']);
    for (const bad of ['30,60', '60,30,90', 'a,b,c', '0,5,9', '30,60,400']) { process.env.COMMISSION_AGING_BUCKET_DAYS = bad; expect(agingEdges()).toEqual([30, 60, 90]); }
  });
  it('job interval and money-policy notice are clamped', () => {
    process.env.COMMISSION_JOB_INTERVAL_MS = '60000'; expect(commissionJobIntervalMs()).toBe(60_000);
    process.env.COMMISSION_JOB_INTERVAL_MS = '10'; expect(commissionJobIntervalMs()).toBe(15 * 60_000);
    process.env.MONEY_POLICY_NOTICE_DAYS = '14'; expect(moneyPolicyLeadMs()).toBe(14 * 86_400_000);
    process.env.MONEY_POLICY_NOTICE_DAYS = '0'; expect(moneyPolicyNoticeDays()).toBe(7); process.env.MONEY_POLICY_NOTICE_DAYS = '1.5'; expect(moneyPolicyNoticeDays()).toBe(7);
  });
});
