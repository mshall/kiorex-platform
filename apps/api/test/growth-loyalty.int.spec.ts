import { LoyaltyJob, LoyaltyService, PartnershipOfferService } from '../src/growth/growth-public';
import { REWARDS_PORT, type RewardsPort } from '../src/growth/growth-ports-public';
import { CampaignSchedulerService } from '../src/growth/campaigns/campaign-scheduler.service';
import { GrowthConfigService } from '../src/growth/growth-public';
import { GrowthMaintenanceService } from '../src/growth/maintenance/growth-maintenance.service';
import { expirablePoints } from '../src/growth/loyalty/points-math';
import { activateConfig, seedBooking } from './growth-helpers';
import { createCtx, TestCtx } from './harness';
import { DAY, setRewardRules, unlockAll } from './growth-rewards-helpers';

const ME = '/api/v1/growth/v1/loyalty';
const ADM = '/api/v1/admin/growth/loyalty';
const CAMP = '/api/v1/admin/growth/campaigns';
type Auth = { Authorization: string };
let seq = 0;

const RULES = (o: Record<string, any> = {}) => ({
  enabled: true, pointsPerCompletedBooking: 10, windowMonths: 12, expiryMonths: 12, annualCapPoints: 1000,
  tiers: { SILVER: { minCompletedBookings: 3, bonusPoints: 5 }, GOLD: { minCompletedBookings: 6, bonusPoints: 10 }, PLATINUM: { minCompletedBookings: 12, bonusPoints: 20 } },
  conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 2 }, ...o,
});

/**
 * GRW-P4-D loyalty points and partnership programs, over the real HTTP stack and Postgres: accrual on COMPLETED only and idempotent, tiers from completed-booking counts, FIFO expiry (database function equals the pure model),
 * the balance that can never go negative, conversion into a reward lot of kind LOYALTY in ONE transaction (and its rollback when the reward caps refuse), refund reversal through the rewards port, partnership programs on a PARTNER campaign
 * with the budget enforced by the database under concurrency, privacy, erasure and the flag OFF contract. Mock providers only.
 */
describe('growth loyalty and partnerships (GRW-P4-D)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth;
  const loyalty = () => c.get(LoyaltyService); const programs = () => c.get(PartnershipOfferService); const rewards = () => c.app.get<RewardsPort>(REWARDS_PORT);
  const setFlag = async (key: string, on: boolean) => { if (on) await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); else await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: key } }); c.flags.invalidate(); };
  const setRules = async (o: Record<string, any> = {}) => { await activateConfig(c, 'LOYALTY_RULES', RULES(o), { announcement: 'Loyalty rules for the test stack.' }); c.get(GrowthConfigService).invalidate(); };
  const done = async (sub: string, o: { at?: Date; dependantId?: string; status?: string } = {}) => {
    const b = await seedBooking(c, { sub });
    return c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: o.status ?? 'COMPLETED', terminalAt: o.at ?? new Date(), ...(o.dependantId ? { dependantId: o.dependantId } : {}) } });
  };
  const acct = (sub: string) => c.prisma.loyaltyAccount.findUnique({ where: { market_sub: { market: 'EG', sub } } });
  const bal = async (sub: string) => (await acct(sub))?.pointsBalanceCache ?? 0;
  const entries = async (sub: string) => c.prisma.loyaltyAccrualEntry.findMany({ where: { account: { sub } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const earn = async (sub: string, n: number) => { for (let i = 0; i < n; i++) { const b = await done(sub); await loyalty().accrue(b.id); } };
  const asP = (sub: string) => c.as(sub);

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); seq = 0;
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
    await unlockAll(c); await setFlag('growth.loyalty', true); await setRewardRules(c); await setRules();
  });
  /** A stack with the flags effective but NO configuration version at all: the shipped defaults answer (every amount 0). */
  const bare = async (o: { reward?: boolean; loyalty?: boolean } = {}) => { await c.reset(); c.flags.invalidate(); c.get(GrowthConfigService).invalidate(); await unlockAll(c); await setFlag('growth.loyalty', true); if (o.reward) await setRewardRules(c); if (o.loyalty) await setRules(); A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); };

  describe('defaults and the flag', () => {
    it('with every shipped default (all zero) nothing accrues, no tier exists and conversion is closed, even with the flags effective', async () => {
      await bare();
      const b = await done('sub_a'); const r = await loyalty().accrue(b.id);
      expect(r).toMatchObject({ status: 'SKIPPED', reason: 'ZERO_POINTS', tier: 'NONE' }); expect(await c.prisma.loyaltyAccrualEntry.count()).toBe(0);
      for (let i = 0; i < 5; i++) await loyalty().accrue((await done('sub_a')).id);
      expect((await acct('sub_a'))!.tier).toBe('NONE');
      const me = (await c.http().get(`${ME}/me`).set(await asP('sub_a')).expect(200)).body; expect(me).toMatchObject({ tier: 'NONE', next: null, notMoney: true, conversion: { open: false, canConvert: false } }); expect(me.points.balance).toBe(0);
      const x = await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'abcdefgh1' }); expect([x.status, x.body.code]).toEqual([422, 'LOYALTY_CONVERSION_OFF']);
      expect((await c.http().get(`${ADM}/rules`).set(ops).expect(200)).body).toMatchObject({ defaultsOnly: true, allZero: true });
    });
    it('flag OFF: accrual is a no-op, the patient routes and money acts answer 403 FEATURE_DISABLED, reads of ops keep working, the job does nothing', async () => {
      await setFlag('growth.loyalty', false);
      expect(await loyalty().accrue((await done('sub_a')).id)).toMatchObject({ status: 'SKIPPED', reason: 'FLAG_OFF' }); expect(await acct('sub_a')).toBeNull();
      for (const r of [c.http().get(`${ME}/me`).set(await asP('sub_a')), c.http().get(`${ME}/history`).set(await asP('sub_a')), c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'abcdefgh1' }), c.http().post(`${ME}/partner/redeem`).set(await asP('sub_a')).send({ code: 'ABCDE-FGHJK' })]) { const res = await r; expect(res.status).toBe(403); expect(res.body.code).toBe('FEATURE_DISABLED'); }
      for (const r of [c.http().get(`${ADM}/summary`).set(ops), c.http().get(`${ADM}/rules`).set(ops), c.http().get(`${ADM}/partnerships`).set(ops)]) expect((await r).status).toBe(200);
      const p = (await c.http().post(`${ADM}/partnerships`).set(A).send({ key: 'off-test', partnerRef: 'bank-x', kind: 'CODE_DISCOUNT' }).expect(201)).body;
      const act = await c.http().post(`${ADM}/partnerships/${p.id}/activate`).set(B); expect([act.status, act.body.code]).toEqual([403, 'FEATURE_DISABLED']);
      expect((await c.get(LoyaltyJob).runOnce())).toMatchObject({ skipped: 'FLAG_OFF' });
    });
    it('depends on growth.rewards: with rewards OFF loyalty is OFF too', async () => { await setFlag('growth.rewards', false); await setFlag('growth.patient_referral', false); expect((await c.http().get(`${ME}/me`).set(await asP('sub_a'))).status).toBe(403); });
  });

  describe('accrual', () => {
    it('only a COMPLETED booking earns, once per booking: a hold, a deposit, a confirmation, a no-show and a dependant earn nothing; a replay and 20 parallel calls make one entry', async () => {
      for (const status of ['CONFIRMED', 'HELD', 'PENDING_CLINIC', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED']) expect(await loyalty().accrue((await done('sub_a', { status })).id)).toMatchObject({ status: 'SKIPPED', reason: 'NOT_COMPLETED' });
      expect(await loyalty().accrue((await done('sub_a', { dependantId: 'dep_1' })).id)).toMatchObject({ status: 'SKIPPED', reason: 'DEPENDANT' });
      expect(await loyalty().accrue('kx_bk_nope')).toMatchObject({ status: 'SKIPPED', reason: 'UNKNOWN_BOOKING' }); expect(await c.prisma.loyaltyAccrualEntry.count()).toBe(0);
      const b = await done('sub_a'); expect(await loyalty().accrue(b.id)).toMatchObject({ status: 'ACCRUED', points: 10 }); expect(await loyalty().accrue(b.id)).toMatchObject({ status: 'EXISTING' });
      const b2 = await done('sub_a'); await Promise.all(Array.from({ length: 20 }, () => loyalty().accrue(b2.id)));
      expect((await entries('sub_a')).map((e) => [e.type, e.points])).toEqual([['ACCRUE', 10], ['ACCRUE', 10]]); expect(await bal('sub_a')).toBe(20);
    });
    it('the booking hook fires on the real COMPLETED transition path (BookingGrowthService.onCompleted) and never fails the booking', async () => {
      const b = await done('sub_a'); await c.app.get<any>('GROWTH_BOOKING_PORT').onCompleted(b.id);
      expect(await bal('sub_a')).toBe(10);
      await c.app.get<any>('GROWTH_BOOKING_PORT').onCompleted('kx_bk_missing'); // a missing booking is a quiet no-op
    });
    it('the annual cap refuses points past it, and a cap of 0 refuses everything until the founder sets one', async () => {
      await setRules({ annualCapPoints: 25, tiers: {} });
      await earn('sub_a', 2); expect(await bal('sub_a')).toBe(20); const r = await loyalty().accrue((await done('sub_a')).id); expect(r).toMatchObject({ status: 'SKIPPED', reason: 'ANNUAL_CAP' }); expect(await bal('sub_a')).toBe(20);
      await setRules({ annualCapPoints: 0 }); expect(await loyalty().accrue((await done('sub_b')).id)).toMatchObject({ status: 'SKIPPED', reason: 'ANNUAL_CAP' });
    });
    it('points expire 12 months after they were earned (the expiry is on the entry)', async () => {
      const b = await done('sub_a'); await loyalty().accrue(b.id, new Date('2027-03-01T00:00:00Z'));
      const e = (await entries('sub_a'))[0]; expect(e.expiresAt!.toISOString()).toBe('2028-03-01T00:00:00.000Z');
    });
  });

  describe('tiers', () => {
    it('three completed bookings reach SILVER, six GOLD; the tier bonus is granted once per tier per year; only bookings inside the window count', async () => {
      await earn('sub_a', 2); expect((await acct('sub_a'))!.tier).toBe('NONE');
      const b3 = await done('sub_a'); expect(await loyalty().accrue(b3.id)).toMatchObject({ status: 'ACCRUED', tier: 'SILVER', tierBonus: 5 });
      expect((await acct('sub_a'))).toMatchObject({ tier: 'SILVER' }); expect((await acct('sub_a'))!.tierSince).toBeTruthy();
      expect((await entries('sub_a')).filter((e) => e.type === 'TIER_BONUS')).toHaveLength(1); expect(await bal('sub_a')).toBe(35);
      await loyalty().accrue(b3.id); expect((await entries('sub_a')).filter((e) => e.type === 'TIER_BONUS')).toHaveLength(1);
      await earn('sub_a', 3); expect((await acct('sub_a'))!.tier).toBe('GOLD'); expect((await entries('sub_a')).filter((e) => e.type === 'TIER_BONUS').map((e) => e.points)).toEqual([5, 10]);
      expect((await c.prisma.auditLog.findMany({ where: { action: 'growth.loyalty.tier_changed' } })).length).toBe(2);
      // old bookings fall out of the window
      for (let i = 0; i < 3; i++) await done('sub_old', { at: new Date(Date.now() - 400 * DAY) }); await loyalty().accrue((await done('sub_old')).id); expect((await acct('sub_old'))!.tier).toBe('NONE');
      const me = (await c.http().get(`${ME}/me`).set(await asP('sub_a')).expect(200)).body; expect(me).toMatchObject({ tier: 'GOLD', next: { tier: 'PLATINUM', minCompletedBookings: 12, remaining: 6 }, window: { months: 12, completed: 6 } });
    });
    it('the daily job moves a tier down when the window moves past old bookings, and never invents points', async () => {
      await earn('sub_a', 3); expect((await acct('sub_a'))!.tier).toBe('SILVER');
      const r = await loyalty().housekeeping(new Date(Date.now() + 400 * DAY)); expect(r.tiersChanged).toBe(1); expect((await acct('sub_a'))!.tier).toBe('NONE');
    });
  });

  describe('the ledger in the database', () => {
    it('the balance can never go negative, can only move through ledger entries and the ledger is append-only', async () => {
      await earn('sub_a', 1); const a = (await acct('sub_a'))!;
      const raw = (o: Record<string, any>) => c.prisma.loyaltyAccrualEntry.create({ data: { id: `lae_t${++seq}`, accountId: a.id, type: 'REVERSE', points: 5, idempotencyKey: `k${++seq}`, reasonCode: 'T', actor: 't', ...o } as never });
      await expect(raw({ points: 11 })).rejects.toThrow(/LOYALTY_NEGATIVE_BALANCE/);
      await raw({ points: 10 }); expect(await bal('sub_a')).toBe(0); await expect(raw({ points: 1 })).rejects.toThrow(/LOYALTY_NEGATIVE_BALANCE/);
      await expect(c.prisma.loyaltyAccount.update({ where: { id: a.id }, data: { pointsBalanceCache: 99999 } })).rejects.toThrow(/LOYALTY_CACHE_LOCKED/);
      await expect(c.prisma.$executeRaw`UPDATE "LoyaltyAccount" SET "pointsBalanceCache" = -1 WHERE "id" = ${a.id}`).rejects.toThrow();
      const e = (await entries('sub_a'))[0];
      await expect(c.prisma.loyaltyAccrualEntry.update({ where: { id: e.id }, data: { points: 1 } })).rejects.toThrow(/append-only/); await expect(c.prisma.loyaltyAccrualEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
      await earn('sub_a', 1); await expect(raw({ type: 'TOPUP' })).rejects.toThrow(/type_check/); await expect(raw({ type: 'TRANSFER' })).rejects.toThrow(/type_check/); await expect(raw({ points: 0 })).rejects.toThrow(/points_check/);
      await expect(raw({ type: 'ACCRUE', bookingId: 'b', expiresAt: null })).rejects.toThrow(/expiry_check/); await expect(raw({ type: 'CONVERT', points: 1 })).rejects.toThrow(/convert_lot_check|LOYALTY_CONVERT_LOT_MISMATCH/); await expect(raw({ type: 'CONVERT', points: 1, lotId: 'rwl_nope' })).rejects.toThrow(/LOYALTY_CONVERT_LOT_MISMATCH/);
      const other = await c.prisma.rewardLot.create({ data: { sub: 'sub_a', kind: 'PROMO', mode: 'COUPON', amountMinor: 5, ruleVersionId: 'v', expiresAt: new Date(Date.now() + DAY) } });
      await earn('sub_a', 1); await expect(raw({ type: 'CONVERT', points: 1, lotId: other.id })).rejects.toThrow(/LOYALTY_CONVERT_LOT_MISMATCH/); // a CONVERT must name a LOYALTY lot
    });
    it('20 parallel spends of a 30-point balance by 10 points: exactly three succeed (the account row serialises them)', async () => {
      await setRules({ pointsPerCompletedBooking: 30, annualCapPoints: 100000 }); await earn('sub_a', 1); const a = (await acct('sub_a'))!;
      const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => c.prisma.loyaltyAccrualEntry.create({ data: { id: `lae_p${i}`, accountId: a.id, type: 'REVERSE', points: 10, idempotencyKey: `par${i}`, reasonCode: 'T', actor: 't' } })));
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(3); expect(await bal('sub_a')).toBe(0);
    });
    it('the database FIFO expiry function equals the pure model for a mixed timeline, and the job expires exactly that', async () => {
      await setRules({ annualCapPoints: 100000, tiers: {} });
      const t0 = new Date('2027-01-01T00:00:00Z'); const at = (m: number) => new Date(Date.UTC(2027, m, 1));
      for (const m of [0, 2, 4]) await loyalty().accrue((await done('sub_a')).id, at(m)); // 3 x 10 points, expiring Jan, Mar, May 2028
      await c.prisma.$transaction((tx) => (loyalty() as any).expireLocked(tx, '', at(5))).catch(() => undefined);
      const a = (await acct('sub_a'))!; const rows = await entries('sub_a');
      const model = (now: Date) => expirablePoints(rows.map((r) => ({ id: r.id, type: r.type as never, points: r.points, expiresAt: r.expiresAt, createdAt: r.createdAt })), now);
      for (const now of [at(11), new Date('2028-01-02T00:00:00Z'), new Date('2028-03-02T00:00:00Z'), new Date('2029-01-01T00:00:00Z')]) {
        const sql = (await c.prisma.$queryRaw<{ n: number }[]>`SELECT loyalty_expirable_points(${a.id}, ${now}::timestamptz) AS n`)[0].n; expect(sql).toBe(model(now));
      }
      const r = await loyalty().housekeeping(new Date('2028-03-02T00:00:00Z')); expect(r).toMatchObject({ accountsExpired: 1, pointsExpired: 20 }); expect(await bal('sub_a')).toBe(10);
      expect((await loyalty().housekeeping(new Date('2028-03-02T00:00:00Z'))).pointsExpired).toBe(0); // idempotent
      expect(t0.getTime()).toBeLessThan(at(1).getTime());
    });
    it('conversion spends the oldest points first and expired points are never spendable', async () => {
      await setRules({ annualCapPoints: 100000, pointsPerCompletedBooking: 30, conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 5 } });
      await loyalty().accrue((await done('sub_a')).id, new Date(Date.now() - 400 * DAY)); // a block that lapsed 35 days ago
      const me = (await c.http().get(`${ME}/me`).set(await asP('sub_a')).expect(200)).body; expect(me.points.balance).toBe(0); expect(me.conversion.canConvert).toBe(false); // lapsed points are not shown as spendable
      const stale = await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-stale01' }); expect([stale.status, stale.body.code]).toEqual([422, 'LOYALTY_INSUFFICIENT_POINTS']); // and cannot be spent before the job has run
      await loyalty().accrue((await done('sub_a')).id); // the next accrual runs the expiry first: 30 lapsed, 30 new
      expect(await bal('sub_a')).toBe(30); expect((await entries('sub_a')).map((e) => e.type).sort()).toEqual(['ACCRUE', 'ACCRUE', 'EXPIRE']);
      await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-aaaa1' }).expect(200); expect(await bal('sub_a')).toBe(0);
      const again = await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-bbbb2' }); expect([again.status, again.body.code]).toEqual([422, 'LOYALTY_INSUFFICIENT_POINTS']);
    });
  });

  describe('conversion into a reward lot (one transaction)', () => {
    it('30 points become one LOYALTY lot of 5000 in the patient reward ledger; the lot is issued, the points are spent, a retry with the same key returns the same lot', async () => {
      await earn('sub_a', 3); expect(await bal('sub_a')).toBe(35);
      const p = await asP('sub_a'); const r = await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'req-12345678' }).expect(200);
      expect(r.body).toMatchObject({ amountMinor: 5000, points: 30, currency: 'EGP', balanceAfter: 5 });
      const lot = await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: r.body.lotId } }); expect(lot).toMatchObject({ kind: 'LOYALTY', funding: 'PLATFORM_MARKETING', sub: 'sub_a', amountMinor: 5000, status: 'ACTIVE' });
      expect(await c.prisma.rewardLedgerEntry.count({ where: { lotId: lot.id, type: 'ISSUE' } })).toBe(1);
      const conv = (await entries('sub_a')).find((e) => e.type === 'CONVERT')!; expect(conv).toMatchObject({ lotId: lot.id, points: 30 }); expect(await bal('sub_a')).toBe(5);
      const again = await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'req-12345678' }).expect(200); expect(again.body.lotId).toBe(lot.id); expect(await c.prisma.rewardLot.count({ where: { kind: 'LOYALTY' } })).toBe(1); expect(await bal('sub_a')).toBe(5);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'LoyaltyPointsConverted' } })).toBe(1);
    });
    it('the voucher is used at checkout: reveal the code in the normal rewards wallet, then reserve it against a deposit through the rewards port', async () => {
      await earn('sub_a', 3); const p = await asP('sub_a'); const r = (await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'req-checkout1' }).expect(200)).body;
      const wallet = (await c.http().get('/api/v1/growth/v1/referral/rewards').set(p).expect(200)).body; expect(JSON.stringify(wallet)).toContain('LOYALTY');
      const code = (await c.http().post(`/api/v1/growth/v1/rewards/${r.lotId}/reveal`).set(p).expect(200)).body.code as string; expect(code).toBeTruthy();
      const res = await rewards().reserveForDeposit({ sub: 'sub_a', bookingId: 'kx_bk_checkout1', amountMinor: 15000, currency: 'EGP', serviceKind: 'IN_CLINIC', couponCode: code }); expect(res.appliedMinor).toBe(5000);
    });
    it('when the reward caps refuse, NOTHING is spent: no CONVERT entry, no lot, the balance is unchanged (rollback), and a later conversion works once the cap is raised', async () => {
      await earn('sub_a', 3); await setRewardRules(c, { perUserAnnualCapMinor: 1000 });
      const x = await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-capped001' }); expect([x.status, x.body.code, x.body.reason]).toEqual([422, 'LOYALTY_CONVERSION_REFUSED', 'ANNUAL_CAP']);
      expect(await bal('sub_a')).toBe(35); expect(await c.prisma.rewardLot.count({ where: { kind: 'LOYALTY' } })).toBe(0); expect((await entries('sub_a')).filter((e) => e.type === 'CONVERT')).toHaveLength(0);
      await setRewardRules(c); await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-capped001' }).expect(200);
    });
    it('with the shipped reward caps (all 0) conversion is refused: the founder sets them first', async () => {
      await bare({ loyalty: true }); await earn('sub_a', 3);
      const x = await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-zero0001' }); expect([x.status, x.body.code]).toEqual([422, 'LOYALTY_CONVERSION_REFUSED']); expect(await bal('sub_a')).toBe(35);
    });
    it('the yearly block limit and the minimum points are enforced; a stranger without an account cannot convert', async () => {
      await setRules({ annualCapPoints: 100000, pointsPerCompletedBooking: 30, conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 1 } }); await earn('sub_a', 3);
      const p = await asP('sub_a'); await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'req-yearly001' }).expect(200);
      const x = await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'req-yearly002' }); expect([x.status, x.body.code, x.body.reason]).toEqual([422, 'LOYALTY_CONVERSION_REFUSED', 'YEARLY_LIMIT']);
      const y = await c.http().post(`${ME}/convert`).set(await asP('nobody')).send({ requestKey: 'req-nobody001' }); expect([y.status, y.body.code]).toEqual([422, 'LOYALTY_INSUFFICIENT_POINTS']);
      await c.http().post(`${ME}/convert`).set(p).send({ requestKey: 'x' }).expect(400);
    });
    it('10 parallel conversions of a balance that covers one block: exactly one lot, one CONVERT, balance never negative', async () => {
      await earn('sub_a', 3); await setRules({ conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 9 } });
      const p = await asP('sub_a'); const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => c.http().post(`${ME}/convert`).set(p).send({ requestKey: `req-par-${i}-aaaa` })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1); expect(rs.filter((r) => r.status === 422).every((r) => r.body.code === 'LOYALTY_INSUFFICIENT_POINTS')).toBe(true);
      expect(await c.prisma.rewardLot.count({ where: { kind: 'LOYALTY' } })).toBe(1); expect(await bal('sub_a')).toBe(5);
    });
    it('there is no route to transfer, gift, top up, sell or cash out points', async () => {
      const p = await asP('sub_a');
      for (const [m, path] of [['post', 'transfer'], ['post', 'gift'], ['post', 'topup'], ['post', 'top-up'], ['post', 'withdraw'], ['post', 'cash-out'], ['post', 'sell'], ['put', 'balance'], ['delete', 'me']] as const) expect([404, 405]).toContain((await (c.http() as any)[m](`${ME}/${path}`).set(p).send({ points: 1, to: 'sub_b' })).status);
    });
  });

  describe('refund reversal through the rewards port', () => {
    const refund = (bookingId: string, sub = 'sub_a') => c.prisma.$transaction((tx) => rewards().onRefundCreated(tx, { bookingId, sub, paymentId: 'pay_x', refundId: `rf_${++seq}`, cardRefundMinor: 0, paymentCardMinor: 0, paymentRewardMinor: 0, paymentRewardPostedMinor: 0, alreadyRefundedMinor: 0, destination: 'ORIGINAL', source: null, currency: 'EGP' }));
    it('a refund of the booking that earned points takes them back (once), through the same hook that reverses referral rewards', async () => {
      const b = await done('sub_a'); await loyalty().accrue(b.id); await earn('sub_a', 1); expect(await bal('sub_a')).toBe(20);
      await refund(b.id); expect(await bal('sub_a')).toBe(10); expect((await entries('sub_a')).find((e) => e.type === 'REVERSE')).toMatchObject({ points: 10, shortfallPoints: 0, bookingId: b.id });
      await refund(b.id); expect(await bal('sub_a')).toBe(10); expect((await entries('sub_a')).filter((e) => e.type === 'REVERSE')).toHaveLength(1);
      await refund('kx_bk_none'); expect(await bal('sub_a')).toBe(10);
    });
    it('points already converted cannot be clawed from the balance: the part that cannot be taken back is a recorded shortfall, the balance stays at zero, never negative', async () => {
      const bs = []; for (let i = 0; i < 3; i++) { const b = await done('sub_a'); await loyalty().accrue(b.id); bs.push(b); }
      await c.http().post(`${ME}/convert`).set(await asP('sub_a')).send({ requestKey: 'req-short0001' }).expect(200); expect(await bal('sub_a')).toBe(5); // 35 earned, 30 spent
      await refund(bs[0].id); const rev = (await entries('sub_a')).find((e) => e.type === 'REVERSE')!; expect(rev).toMatchObject({ points: 5, shortfallPoints: 5 }); expect(await bal('sub_a')).toBe(0);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.loyalty.reverse_shortfall' } })).toBe(1); // 5 of the first booking could not be taken back
      await refund(bs[1].id); expect(await bal('sub_a')).toBe(0); expect(await c.prisma.auditLog.count({ where: { action: 'growth.loyalty.reverse_shortfall' } })).toBe(2);
      await refund(bs[1].id); expect(await c.prisma.auditLog.count({ where: { action: 'growth.loyalty.reverse_shortfall' } })).toBe(2); // idempotent
    });
    it('a refund still takes points back while the flag is OFF (it only removes value) and a refund never fails because of the loyalty ledger', async () => {
      const b = await done('sub_a'); await loyalty().accrue(b.id); await setFlag('growth.loyalty', false); await refund(b.id); expect(await bal('sub_a')).toBe(0);
    });
  });

  describe('privacy, ops reads and erasure', () => {
    it('the patient view and history carry no booking, provider, specialty or other person; the entry list is own data only', async () => {
      await earn('sub_a', 3); await earn('sub_b', 1);
      const me = JSON.stringify((await c.http().get(`${ME}/me`).set(await asP('sub_a')).expect(200)).body); const hist = (await c.http().get(`${ME}/history`).set(await asP('sub_a')).expect(200)).body;
      for (const s of [me, JSON.stringify(hist)]) expect(s).not.toMatch(/kx_bk|bookingId|bookingRef|provider|specialt|clinic|sub_a|sub_b|doctor/i);
      expect(hist.items.length).toBe(4); expect(hist.items[0]).toEqual(expect.objectContaining({ type: expect.any(String), points: expect.any(Number), direction: expect.stringMatching(/IN|OUT/) }));
    });
    it('the ops summary is aggregate only: every cell below 10 people is masked (null) and listed in `suppressed`, nothing names a person', async () => {
      for (let i = 0; i < 3; i++) await earn(`sub_${i}`, 1);
      const s = (await c.http().get(`${ADM}/summary`).set(ops).expect(200)).body; expect(s.k).toBe(10); expect(s.accounts).toBeNull(); expect(s.points.outstanding).toBeNull(); expect(s.suppressed).toEqual(expect.arrayContaining(['accounts', 'points.outstanding', 'last30Days.earned.people']));
      expect(JSON.stringify(s)).not.toMatch(/sub_\d|kx_bk/);
      for (let i = 3; i < 12; i++) await earn(`sub_${i}`, 1); const t = (await c.http().get(`${ADM}/summary`).set(ops).expect(200)).body; expect(t.accounts).toBe(12); expect(t.points.outstanding).toBe(120);
    });
    it('erasure keeps the ledger but removes the person: the account sub becomes a one-way hash, redemption hashes are anonymised', async () => {
      await earn('sub_gone', 2); const id = (await acct('sub_gone'))!.id; const r = await c.get(GrowthMaintenanceService).eraseSubject('sub_gone');
      expect(r).toMatchObject({ loyaltyAccountsAnonymised: 1 }); expect(await acct('sub_gone')).toBeNull(); const row = await c.prisma.loyaltyAccount.findUniqueOrThrow({ where: { id } }); expect(row.sub).toMatch(/^h:[0-9a-f]{64}$/); expect(row.pointsBalanceCache).toBe(20); expect(await c.prisma.loyaltyAccrualEntry.count({ where: { accountId: id } })).toBe(2);
    });
    it('ops roles: reads for ops, writes for a super admin only', async () => {
      expect((await c.http().get(`${ADM}/summary`).set(await asP('patient_1'))).status).toBe(403);
      expect((await c.http().post(`${ADM}/partnerships`).set(ops).send({ key: 'k-one', partnerRef: 'x', kind: 'CODE_DISCOUNT' })).status).toBe(403);
      expect((await c.http().get(`${ADM}/tiers/preview?completed=6`).set(ops).expect(200)).body).toMatchObject({ completed: 6, tier: 'GOLD' });
    });
  });

  describe('partnership programs', () => {
    const campaign = async (o: Record<string, unknown> = {}) => (await c.http().post(CAMP).set(A).send({ key: `partner-${++seq}-${Math.random().toString(36).slice(2, 6)}`, name: 'Bank partner offer', objective: 'ACQUISITION', budgetTotalMinor: 1_000_000, budgetDailyMinor: 200_000, channels: ['PARTNER'], startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 30 * DAY).toISOString(), ...o }).expect(201)).body;
    const approveCampaign = async (id: string) => { const a = (await c.http().post(`${CAMP}/${id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body; await c.http().post(`${CAMP}/approvals/${a.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: a.snapshotHash }).expect(200); };
    const activeCampaign = async () => { const k = await campaign(); await approveCampaign(k.id); await c.get(CampaignSchedulerService).runOnce(new Date()); expect((await c.http().get(`${CAMP}/${k.id}`).set(A)).body.status).toBe('ACTIVE'); return k; };
    const program = async (o: Record<string, unknown> = {}) => (await c.http().post(`${ADM}/partnerships`).set(A).send({ key: `bank-${++seq}`, partnerRef: 'bank-x', kind: 'CODE_DISCOUNT', nameAr: 'بنك إكس', nameEn: 'Bank X', budgetMinor: 9000, perRedemptionMinor: 3000, startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 20 * DAY).toISOString(), ...o }).expect(201)).body;
    const live = async (o: Record<string, unknown> = {}) => { const k = await activeCampaign(); const p = await program(o); await c.http().post(`${ADM}/partnerships/${p.id}/campaign`).set(A).send({ campaignId: k.id }).expect(200); const a = (await c.http().post(`${ADM}/partnerships/${p.id}/activate`).set(B).expect(200)).body; return { p: a, k }; };
    const mkCode = async (id: string, o: Record<string, unknown> = {}) => (await c.http().post(`${ADM}/partnerships/${id}/codes`).set(A).send({ label: 'Card mailer', maxRedemptions: 100, ...o }).expect(201)).body.code as string;
    const redeem = async (sub: string, code: string) => c.http().post(`${ME}/partner/redeem`).set(await asP(sub)).send({ code });

    it('a draft starts with every amount at 0 and a placeholder legal text; it cannot run: no campaign, no budget, same-person activation, an unapproved campaign', async () => {
      const p = (await c.http().post(`${ADM}/partnerships`).set(A).send({ key: 'draft-one', partnerRef: 'bank-x', kind: 'CO_PROMO' }).expect(201)).body;
      expect(p).toMatchObject({ status: 'DRAFT', budgetMinor: 0, perRedemptionMinor: 0, fundingMode: 'PLATFORM_MARKETING', campaignId: null, legalTextIsPlaceholder: true }); expect(p.legalTextRef).toContain('NEEDS_HUMAN');
      const self = await c.http().post(`${ADM}/partnerships/${p.id}/activate`).set(A); expect([self.status, self.body.code]).toEqual([403, 'PARTNERSHIP_SELF_APPROVAL']);
      const none = await c.http().post(`${ADM}/partnerships/${p.id}/activate`).set(B); expect([none.status, none.body.code]).toEqual([422, 'PARTNERSHIP_TERMS_INCOMPLETE']);
      const full = await program(); const k = await campaign(); await c.http().post(`${ADM}/partnerships/${full.id}/campaign`).set(A).send({ campaignId: k.id }).expect(200);
      const draftCampaign = await c.http().post(`${ADM}/partnerships/${full.id}/activate`).set(B); expect([draftCampaign.status, draftCampaign.body.code]).toEqual([422, 'PARTNERSHIP_TERMS_INCOMPLETE']); expect(draftCampaign.body.message).toMatch(/approved through the campaign path/);
      await approveCampaign(k.id); expect((await c.http().post(`${ADM}/partnerships/${full.id}/activate`).set(B).expect(200)).body).toMatchObject({ status: 'ACTIVE', activatedBy: 'adm_b' });
    });
    it('the linked campaign must be in the market and carry the PARTNER channel; a program over the campaign budget cannot activate; money terms freeze after activation; PARTNER_FUNDED never activates', async () => {
      const email = await campaign({ channels: ['EMAIL'] }); const p = await program(); const bad = await c.http().post(`${ADM}/partnerships/${p.id}/campaign`).set(A).send({ campaignId: email.id }); expect([bad.status, bad.body.code]).toEqual([422, 'PARTNERSHIP_TERMS_INCOMPLETE']);
      const small = await campaign({ budgetTotalMinor: 5000, budgetDailyMinor: 5000 }); await approveCampaign(small.id); await c.get(CampaignSchedulerService).runOnce(new Date());
      const over = await program({ budgetMinor: 9000 }); await c.http().post(`${ADM}/partnerships/${over.id}/campaign`).set(A).send({ campaignId: small.id }).expect(200); const x = await c.http().post(`${ADM}/partnerships/${over.id}/activate`).set(B); expect([x.status, x.body.code]).toEqual([422, 'PARTNERSHIP_BUDGET_EXCEEDED']);
      const { p: ok } = await live(); await expect(c.prisma.partnershipProgram.update({ where: { id: ok.id }, data: { budgetMinor: 99999 } })).rejects.toThrow(/PARTNERSHIP_FROZEN/); const edit = await c.http().put(`${ADM}/partnerships/${ok.id}`).set(A).send({ budgetMinor: 1 }); expect([edit.status, edit.body.code]).toEqual([422, 'PARTNERSHIP_FROZEN']);
      const pf = await program({ fundingMode: 'PARTNER_FUNDED' }); const k = await activeCampaign(); await c.http().post(`${ADM}/partnerships/${pf.id}/campaign`).set(A).send({ campaignId: k.id }).expect(200); const y = await c.http().post(`${ADM}/partnerships/${pf.id}/activate`).set(B); expect([y.status, y.body.code]).toEqual([422, 'PARTNERSHIP_TERMS_INCOMPLETE']);
      await expect(c.prisma.partnershipProgram.update({ where: { id: pf.id }, data: { status: 'ACTIVE', activatedBy: 'zzz' } })).rejects.toThrow(/active_check/);
    });
    it('a code is shown once, stored only as a keyed hash, and redeeming issues a PROMO lot for the program campaign (3000) with the program recorded: acceptance "partnership code applies"', async () => {
      const { p, k } = await live(); const code = await mkCode(p.id); const row = await c.prisma.partnershipCode.findFirstOrThrow({ where: { programId: p.id } }); expect(row.codeHash).not.toContain(code.replace('-', '')); expect(JSON.stringify((await c.http().get(`${ADM}/partnerships/${p.id}/codes`).set(ops).expect(200)).body)).not.toContain(code);
      const r = (await redeem('sub_a', code.toLowerCase().replace('-', ' '))).body; expect(r).toMatchObject({ redeemed: true, amountMinor: 3000, currency: 'EGP', partner: { en: 'Bank X' } });
      expect(await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: r.lotId } })).toMatchObject({ kind: 'PROMO', campaignId: k.id, funding: 'PLATFORM_MARKETING', amountMinor: 3000, sub: 'sub_a' });
      expect((await c.prisma.partnershipCodeRedemption.findFirstOrThrow()).subHash).not.toContain('sub_a'); expect(await c.prisma.outboxEvent.count({ where: { type: 'PartnershipCodeRedeemed' } })).toBe(1);
      const dup = await redeem('sub_a', code); expect([dup.status, dup.body.code]).toEqual([409, 'PARTNERSHIP_ALREADY_REDEEMED']);
      const wallet = (await c.http().get('/api/v1/growth/v1/referral/rewards').set(await asP('sub_a')).expect(200)).body; expect(JSON.stringify(wallet)).toContain('PROMO');
    });
    it('the budget cap is enforced in the database: a 9000 budget at 3000 each allows exactly 3 redemptions, the 4th is refused AND leaves no lot behind (rollback)', async () => {
      const { p } = await live(); const code = await mkCode(p.id);
      for (const s of ['p1', 'p2', 'p3']) expect((await redeem(s, code)).status).toBe(200);
      const x = await redeem('p4', code); expect([x.status, x.body.code]).toEqual([409, 'PARTNERSHIP_BUDGET_EXCEEDED']); expect(await c.prisma.rewardLot.count({ where: { kind: 'PROMO', sub: 'p4' } })).toBe(0); expect(await c.prisma.partnershipCodeRedemption.count()).toBe(3);
      expect((await c.prisma.partnershipCode.findFirstOrThrow()).redeemedCount).toBe(3);
      const det = (await c.http().get(`${ADM}/partnerships/${p.id}`).set(ops).expect(200)).body; expect(det).toMatchObject({ usedMinor: 9000, redemptions: 3, budgetMinor: 9000 });
      // the trigger itself, bypassing the service
      const lot = await c.prisma.rewardLot.findFirstOrThrow({ where: { sub: 'p1' } });
      await expect(c.prisma.partnershipCodeRedemption.create({ data: { id: 'pcr_x1', programId: p.id, codeId: (await c.prisma.partnershipCode.findFirstOrThrow()).id, subHash: 'zz', lotId: lot.id, amountMinor: 3000, idempotencyKey: 'raw1' } })).rejects.toThrow(/PARTNERSHIP_BUDGET_EXCEEDED/);
    });
    it('12 parallel redemptions against a budget for 2: exactly 2 succeed, 2 lots exist, the sum never passes the budget', async () => {
      const { p } = await live({ budgetMinor: 6000 }); const code = await mkCode(p.id);
      const rs = await Promise.all(Array.from({ length: 12 }, async (_, i) => redeem(`par_${i}`, code)));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(2); expect(rs.filter((r) => r.status !== 200).every((r) => r.status === 409 && r.body.code === 'PARTNERSHIP_BUDGET_EXCEEDED')).toBe(true);
      expect(await c.prisma.rewardLot.count({ where: { kind: 'PROMO' } })).toBe(2); expect((await c.prisma.partnershipCodeRedemption.aggregate({ _sum: { amountMinor: true } }))._sum.amountMinor).toBe(6000);
    });
    it('code limits: used up, revoked, expired, unknown, malformed; an ended or paused program refuses; a code of another program is not a code of this one', async () => {
      const { p } = await live(); const one = await mkCode(p.id, { maxRedemptions: 1 });
      expect((await redeem('c1', one)).status).toBe(200); expect((await redeem('c2', one)).body.code).toBe('PARTNERSHIP_CODE_EXHAUSTED');
      const rv = await mkCode(p.id); const id = (await c.prisma.partnershipCode.findMany({ where: { programId: p.id } })).find((x) => x.maxRedemptions === 100)!.id; await c.http().post(`${ADM}/partnerships/${p.id}/codes/${id}/revoke`).set(A).expect(200); expect((await redeem('c3', rv)).body.code).toBe('PARTNERSHIP_CODE_INVALID');
      const ex = await mkCode(p.id, { expiresAt: new Date(Date.now() - 1000).toISOString() }); expect((await redeem('c4', ex)).body.code).toBe('PARTNERSHIP_CODE_EXPIRED');
      for (const bad of ['', 'short', 'ZZZZZ-ZZZZZ', '!!!!!-!!!!!']) expect([400, 422]).toContain((await redeem('c5', bad)).status);
      const ok = await mkCode(p.id); await c.http().post(`${ADM}/partnerships/${p.id}/pause`).set(A).expect(200); expect((await redeem('c6', ok)).body.code).toBe('PARTNERSHIP_NOT_ACTIVE');
      await c.http().post(`${ADM}/partnerships/${p.id}/activate`).set(B).expect(200); expect((await redeem('c6', ok)).status).toBe(200);
      await c.http().post(`${ADM}/partnerships/${p.id}/end`).set(A).expect(200); expect((await redeem('c7', ok)).body.code).toBe('PARTNERSHIP_NOT_ACTIVE'); await expect(c.prisma.partnershipProgram.update({ where: { id: p.id }, data: { status: 'ACTIVE' } })).rejects.toThrow(/PARTNERSHIP_ENDED/);
    });
    it('the campaign path governs the program: a paused or completed campaign stops redemption even though the program says ACTIVE', async () => {
      const { p, k } = await live(); const code = await mkCode(p.id);
      await c.http().post(`${CAMP}/${k.id}/transition`).set(A).send({ to: 'PAUSED', pauseReason: 'MANUAL', reason: 'partner asked' }).expect(200);
      expect((await redeem('x1', code)).body.code).toBe('PARTNERSHIP_NOT_ACTIVE');
      await c.http().post(`${CAMP}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' }).expect(200); expect((await redeem('x1', code)).status).toBe(200);
    });
    it('with the shipped reward caps (all 0) a redemption is refused with a reason and leaves nothing behind; the program budget alone never lets value out', async () => {
      await bare({ loyalty: true }); const { p } = await live(); const code = await mkCode(p.id);
      const x = await redeem('z1', code); expect([x.status, x.body.code]).toEqual([422, 'PARTNERSHIP_OFFER_UNAVAILABLE']); expect(await c.prisma.rewardLot.count()).toBe(0); expect(await c.prisma.partnershipCodeRedemption.count()).toBe(0);
    });
    it('the redeem endpoint is rate limited per person and a corporate code is not a partnership code', async () => {
      const { p } = await live(); await mkCode(p.id); const { hashCode } = await import('../src/growth/corporate/corporate-code');
      expect((await redeem('rl_1', 'ABCDE-FGHJK')).body.code).toBe('PARTNERSHIP_CODE_INVALID'); expect(hashCode('ABCDEFGHJK')).toBeTruthy();
      for (let i = 0; i < 12; i++) await redeem('rl_2', 'ABCDE-FGHJK'); expect((await redeem('rl_2', 'ABCDE-FGHJK')).status).toBe(429);
    });
    it('audit: every program act writes an AuditLog row; creating a program sends no message', async () => {
      const { p } = await live(); await mkCode(p.id); await c.http().post(`${ADM}/partnerships/${p.id}/pause`).set(A).expect(200);
      expect((await c.prisma.auditLog.findMany({ where: { resourceId: p.id, action: { startsWith: 'growth.partnership.' } } })).map((r) => r.action)).toEqual(expect.arrayContaining(['growth.partnership.created', 'growth.partnership.campaign_linked', 'growth.partnership.activated', 'growth.partnership.code_created', 'growth.partnership.paused']));
      expect(await c.prisma.outboxEvent.count({ where: { type: { in: ['MessageRequested', 'NotificationRequested'] } } })).toBe(0);
    });
  });
});
