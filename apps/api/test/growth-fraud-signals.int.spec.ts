import { LoyaltyService, GrowthConfigService } from '../src/growth/growth-public';
import { FraudCaseService } from '../src/growth/fraud/fraud-public-test';
import { FraudConfigService } from '../src/growth/fraud/fraud-config.service';
import { FRAUD_RULES_DEFAULTS } from '../src/growth/fraud/fraud-config';
import { visitMinutesOf } from '../src/growth/fraud/visit-facts';
import { FraudHoldService } from '../src/growth/fraud/fraud-hold.service';
import { InternalOverviewSource } from '../src/growth/admin/growth-overview.source';
import { activateConfig, seedBooking, seedTouch } from './growth-helpers';
import { createCtx, TestCtx } from './harness';
import { setRewardRules, unlockAll } from './growth-rewards-helpers';

const MIN = 60_000;
const RULES = { enabled: true, pointsPerCompletedBooking: 10, windowMonths: 12, expiryMonths: 12, annualCapPoints: 1000, tiers: {}, conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 2 } };

/** Gap closure: visit-duration times from the Clinic, loyalty scored by the fraud rules, QUARANTINE_TOUCH coverage in the reports. Real Postgres and the real webhook route. */
describe('fraud signals: visit times, loyalty scoring, quarantined touches', () => {
  let c: TestCtx;
  const loyalty = () => c.get(LoyaltyService);
  const setFlag = async (key: string, on = true) => { if (on) await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); else await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: key } }); c.flags.invalidate(); };
  const setFraudRules = async (payload: Record<string, unknown>) => {
    const full = { ...FRAUD_RULES_DEFAULTS(), ...payload };
    await c.prisma.growthConfigVersion.create({ data: { kind: 'FRAUD_RULES', scope: 'GLOBAL', scopeId: '', version: 1, status: 'ACTIVE', payload: full as never, createdBy: 'maker', approvedBy: 'checker', approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 1000), checksum: 'x'.repeat(8) } });
    c.get((await import('../src/growth/fraud/fraud-config.service')).FraudConfigService).invalidate();
  };
  const enforce = () => setFraudRules({ enforce: true, bands: { review: 10, hold: 30 }, rules: Object.fromEntries(Object.entries(FRAUD_RULES_DEFAULTS().rules).map(([k, v]) => [k, { ...v, enforce: true }])) });
  /** A booking the Clinic checked in at `checkedIn` and completed `minutes` later, through the real webhook. */
  const visit = async (sub: string, minutes: number | null) => {
    const b = await seedBooking(c, { sub });
    await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'CONFIRMED', kiorlyAppointmentId: `apt_${b.id}`, depositStatus: 'NOT_REQUIRED' } });
    const t0 = new Date(Date.now() - 2 * 3600_000);
    await c.webhook('CHECKED_IN', { appointmentId: `apt_${b.id}`, externalReference: b.id, clinicId: 'cl_1', previousStatus: 'CONFIRMED', nextStatus: 'CHECKED_IN', checkedInAt: t0.toISOString() }, { aggregateType: 'Appointment', aggregateId: `apt_${b.id}` });
    await c.webhook('COMPLETED', { appointmentId: `apt_${b.id}`, externalReference: b.id, clinicId: 'cl_1', previousStatus: 'CHECKED_IN', nextStatus: 'COMPLETED', ...(minutes !== null ? { checkedInAt: t0.toISOString(), completedAt: new Date(t0.getTime() + minutes * MIN).toISOString() } : {}) }, { aggregateType: 'Appointment', aggregateId: `apt_${b.id}` });
    return b.id;
  };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    await unlockAll(c); await setFlag('growth.loyalty'); await setFlag('growth.fraud_scoring'); await setRewardRules(c);
    await activateConfig(c, 'LOYALTY_RULES', RULES, { announcement: 'Loyalty rules for the test stack.' }); c.get(GrowthConfigService).invalidate();
  });

  it('the Clinic visit times are stored from CHECKED_IN and COMPLETED and give the visit length; malformed or implausible times give nothing', async () => {
    const id = await visit('sub_a', 4);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
    expect(await visitMinutesOf(c.prisma, id)).toBe(4);
    const noTimes = await visit('sub_b', null);
    expect(await visitMinutesOf(c.prisma, noTimes)).toBeUndefined();
    const forgotten = await visit('sub_c', 26 * 60); expect(await visitMinutesOf(c.prisma, forgotten)).toBeUndefined();
    const bad = await seedBooking(c, { sub: 'sub_d' }); await c.prisma.bookingEvent.create({ data: { bookingId: bad.id, kind: 'VISIT_TIMES', detail: { checkedInAt: 'yesterday', completedAt: 5 } } });
    expect(await visitMinutesOf(c.prisma, bad.id)).toBeUndefined();
  });

  it('loyalty is scored by the fraud rules: in shadow (default) a 3-minute visit records a case and the points are still earned', async () => {
    const id = await visit('sub_a', 3); // the COMPLETED webhook accrues
    expect(await c.prisma.loyaltyAccrualEntry.count({ where: { bookingId: id, type: 'ACCRUE', points: 10 } })).toBe(1);
    const cases = await c.prisma.fraudCase.findMany();
    expect(cases.length).toBe(1);
    expect(JSON.stringify(cases)).not.toMatch(/sub_a/); // the subject is a keyed hash
    expect(await loyalty().accrue(id)).toMatchObject({ status: 'EXISTING' });
    expect(await c.prisma.fraudCase.count()).toBe(1); // a duplicate accrual is not scored again
  });

  it('an ordinary visit (25 minutes) records no case', async () => {
    const id = await visit('sub_a', 25);
    expect(await c.prisma.loyaltyAccrualEntry.count({ where: { bookingId: id, type: 'ACCRUE' } })).toBe(1);
    expect(await c.prisma.fraudCase.count()).toBe(0);
  });

  it('with the rule enforced, a 3-minute visit withholds that booking points (no ledger row, an audit row, the case stays for ops) and a normal visit still earns', async () => {
    await enforce();
    const short = await visit('sub_a', 3);
    expect(await loyalty().accrue(short)).toMatchObject({ status: 'SKIPPED', reason: 'FRAUD_HOLD' }); // replay is safe and gives the same answer
    expect(await c.prisma.loyaltyAccrualEntry.count({ where: { bookingId: short } })).toBe(0);
    expect(await c.prisma.auditLog.count({ where: { action: 'growth.loyalty.accrual_withheld', resourceId: short } })).toBeGreaterThanOrEqual(1); // one per attempt: the webhook, then the replay
    expect(await c.prisma.fraudCase.count()).toBe(1);
    const ok = await visit('sub_a', 25);
    expect(await c.prisma.loyaltyAccrualEntry.count({ where: { bookingId: ok, type: 'ACCRUE' } })).toBe(1);
  });

  it('a scoring failure never blocks an accrual', async () => {
    jest.spyOn(c.get(FraudCaseService), 'record').mockRejectedValue(new Error('db blip'));
    const id = await visit('sub_a', 3);
    expect(await c.prisma.loyaltyAccrualEntry.count({ where: { bookingId: id, type: 'ACCRUE' } })).toBe(1);
  });

  it('QUARANTINE_TOUCH coverage: a quarantined touch is not counted by the overview report; the touch row stays', async () => {
    const mk = (n: number) => seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: `vk_${n}` });
    const t1 = await mk(1); await mk(2); await mk(3);
    const src = c.get(InternalOverviewSource);
    const before = await src.overview({ market: 'EG', days: 7 } as never);
    expect(before.touchesBySource.find((t) => t.sourceKind === 'ORGANIC_SEARCH')?.count).toBe(3);
    await c.get(FraudHoldService).quarantineTouch(t1.id);
    const after = await src.overview({ market: 'EG', days: 7 } as never);
    expect(after.touchesBySource.find((t) => t.sourceKind === 'ORGANIC_SEARCH')?.count).toBe(2);
    expect(await c.prisma.growthTouchpoint.count()).toBe(3);
  });
});
