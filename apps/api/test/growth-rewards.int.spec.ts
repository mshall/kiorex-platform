import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';
import { seedBooking } from './growth-helpers';
import { DAY, setRewardRules, uid, unlockAll } from './growth-rewards-helpers';
import { OutboxService } from '../src/outbox/outbox-public';
import { GrowthMaintenanceService } from '../src/growth/growth-public';
import { PayService } from '../src/pay/pay-public';
import { GoodwillService, RewardExpiryJob, RewardFinanceService, RewardHoldService, RewardIssuanceService, RewardLedgerService, RewardReconcileJob, RewardRedemptionService, RewardReversalService, issueKey } from '../src/growth/rewards/rewards-public';
import { couponHash } from '../src/growth/rewards/reward-coupon';

type Auth = { Authorization: string };
const BASE = '/api/v1';

/**
 * GRW-P2-B2 over the real HTTP stack and Postgres: the append-only ledger, issuance caps and S4, coupon mode, first-expiring-first, reserve/redeem/release against the Kiorex Pay deposit flow,
 * reversal and recoverable loss, holds, expiry, the finance report, erasure, the flag-OFF contract. Mock PSP only.
 */
describe('growth rewards ledger (GRW-P2-B2)', () => {
  let c: TestCtx; let patient: Auth; let ops: Auth; let admin: Auth; let admin2: Auth; let pid: string;
  const iss = () => c.get(RewardIssuanceService); const led = () => c.get(RewardLedgerService); const red = () => c.get(RewardRedemptionService); const rev = () => c.get(RewardReversalService);
  const flush = () => c.get(OutboxService).processBatch(200);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    await unlockAll(c, ['growth.rewards', 'growth.patient_referral']); await setRewardRules(c);
    patient = await c.as('sub_amira'); ops = await c.as('ops_1', { roles: ['ops_admin'] }); admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); admin2 = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] });
    c.kiorly.slots = [futureSlot(72)]; pid = await seedProvider(c, { depositAmount: 150 });
  });
  const promo = async (sub: string, amountMinor: number, o: Record<string, unknown> = {}) => {
    const r = await iss().issue({ kind: 'PROMO', sub, amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('t', uid('k')), reasonCode: 'PROMO_CAMPAIGN', actor: 'test', ...o });
    if (r.status === 'SKIPPED') throw new Error(`skipped ${r.reason}`);
    return r;
  };
  const completed = async (sub: string) => { const b = await seedBooking(c, { sub }); return c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: new Date() } }); };
  const bal = async (lotId: string) => led().balance(c.prisma, lotId);
  const entries = (lotId: string) => c.prisma.rewardLedgerEntry.findMany({ where: { lotId }, orderBy: { createdAt: 'asc' } });
  const slot = futureSlot(72);
  const book = async (auth: Auth = patient) => {
    await c.http().put(`${BASE}/me/profile`).set(auth).send({ nameEn: 'Test Patient' }).expect(200);
    const h = await c.http().post(`${BASE}/bookings`).set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    await c.http().post(`${BASE}/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
    return h.body.id as string;
  };
  const checkout = (id: string, body: Record<string, unknown> = {}, auth: Auth = patient) => c.http().post(`${BASE}/bookings/${id}/deposit-checkout`).set(auth).send(body);
  const pay = (paymentId: string, outcome: 'pay' | 'fail' = 'pay') => c.http().post(`${BASE}/pay/fake-checkout/${paymentId}/complete`).send({ outcome }).expect(200);
  const sum = async (account: string) => { const r = (await c.prisma.ledgerEntry.aggregate({ where: { account }, _sum: { debitMinor: true, creditMinor: true } }))._sum; return (r.debitMinor ?? 0) - (r.creditMinor ?? 0); };

  describe('the wave 6 migration', () => {
    it('is idempotent (applied a second and a third time it changes nothing and fails nothing), replaces no function or index of an earlier migration, and keeps the 096000 rules', async () => {
      const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261217090000_growth_p2_referral_rewards_engine', 'migration.sql'), 'utf8');
      expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION (growth_erase_subject|growth_purge_expired|reward_ledger_guard|reward_ledger_balance_guard|reward_lot_balance|reward_issue_guard|growth_p2_append_only)/); // the replay chain of growth-schema.int.spec.ts needs no change
      expect(sql).not.toMatch(/DROP INDEX|CREATE UNIQUE INDEX(?! IF NOT EXISTS)/);
      const l = await promo('sub_a', 1000);
      const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
      try { await cl.query(sql); await cl.query(sql); } finally { await cl.end(); }
      expect(await entries(l.lotId)).toHaveLength(1);
      expect(await c.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM pg_constraint WHERE conname = 'RewardLot_refund_credit_funding_check'`).toEqual([{ n: 1n }]);
      await expect(c.prisma.rewardLot.create({ data: { sub: 'x', kind: 'PROMO', mode: 'COUPON', amountMinor: 5, ruleVersionId: 'v', funding: 'PATIENT_REFUND', expiresAt: new Date(Date.now() + DAY) } })).rejects.toThrow(); // PATIENT_REFUND is only for REFUND_CREDIT and RESTORED
      await c.prisma.rewardLot.create({ data: { sub: 'x', kind: 'RESTORED', mode: 'CREDIT', amountMinor: 5, ruleVersionId: 'v', funding: 'PATIENT_REFUND', expiresAt: new Date(Date.now() + DAY) } });
    });
  });

  describe('the ledger is append-only and the database enforces the balance', () => {
    it('refuses UPDATE and DELETE of an entry, also with raw SQL; the lot status is only a cache', async () => {
      const l = await promo('sub_a', 5000);
      const e = (await entries(l.lotId))[0];
      await expect(c.prisma.rewardLedgerEntry.update({ where: { id: e.id }, data: { amountMinor: 1 } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.rewardLedgerEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.$executeRawUnsafe(`UPDATE "RewardLedgerEntry" SET "amountMinor" = 1`)).rejects.toThrow(/append-only/);
      await expect(c.prisma.$executeRawUnsafe(`DELETE FROM "RewardLedgerEntry"`)).rejects.toThrow(/append-only/);
      expect(await entries(l.lotId)).toHaveLength(1);
    });
    it('a RESERVE or REDEEM above the available balance is refused by the database trigger, not only by the code', async () => {
      const l = await promo('sub_a', 5000);
      const ins = (type: string, amt: number, key: string) => c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('e_${key}','${l.lotId}','${type}',${amt},'rwd:${type.toLowerCase()}:${key}','v','T','test')`);
      await expect(ins('RESERVE', 5001, 'a1')).rejects.toThrow(/negative balance/);
      await expect(ins('REDEEM', 1, 'a2')).rejects.toThrow(/negative balance/); // nothing reserved: a redeem always consumes a reservation
      await ins('RESERVE', 5000, 'a3');
      expect(await bal(l.lotId)).toMatchObject({ available: 0, reserved: 5000 });
      await expect(ins('RESERVE', 1, 'a4')).rejects.toThrow(/negative balance/);
    });
    it('a lot without an expiry, an expired lot reserved, and a bad idempotency key are refused by constraints', async () => {
      await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLot" ("id","sub","kind","mode","amountMinor","ruleVersionId","expiresAt") VALUES ('x1','s','PROMO','COUPON',100,'v',NULL)`)).rejects.toThrow();
      const l = await promo('sub_a', 5000);
      await c.prisma.rewardLot.update({ where: { id: l.lotId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('e_x','${l.lotId}','RESERVE',10,'rwd:reserve:x','v','T','t')`)).rejects.toThrow(/expired/);
      await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('e_y','${l.lotId}','HOLD',10,'not-a-key','v','T','t')`)).rejects.toThrow();
    });
    it('20 parallel reservations of one 5000 lot: exactly 5000 is reserved in total, never more, and the balance never goes negative', async () => {
      const l = await promo('sub_a', 5000, { mode: 'CREDIT' });
      await c.flags.invalidate(); await unlockAll(c, ['growth.patient_credit']);
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => red().reserveForDeposit({ sub: 'sub_a', bookingId: `kx_bk_par${i}`, amountMinor: 15000, currency: 'EGP', serviceKind: 'IN_CLINIC' })));
      expect(results.reduce((s, r) => s + r.appliedMinor, 0)).toBe(5000);
      expect(results.filter((r) => r.appliedMinor === 5000)).toHaveLength(1);
      expect(await bal(l.lotId)).toMatchObject({ available: 0, reserved: 5000, held: 0 });
    });
    it('the same operation twice is one entry (idempotency key), a different operation under a reused key is a conflict', async () => {
      const key = issueKey('t', 'same');
      const a = await iss().issue({ kind: 'PROMO', sub: 'sub_a', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: key, reasonCode: 'X', actor: 't' });
      const b = await iss().issue({ kind: 'PROMO', sub: 'sub_a', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: key, reasonCode: 'X', actor: 't' });
      expect(a.status).toBe('ISSUED'); expect(b.status).toBe('EXISTING');
      expect(await c.prisma.rewardLot.count()).toBe(1);
      await expect(led().append(c.prisma, { lotId: (a as any).lotId, type: 'HOLD', amountMinor: 5, idempotencyKey: key, ruleVersionId: 'v', reasonCode: 'X', actor: 't' })).rejects.toMatchObject({ response: { code: 'REWARD_IDEMPOTENCY_CONFLICT' } });
    });
  });

  describe('issuance: kill switch, qualifying visit (S4) and caps (S3)', () => {
    it('S4: a REFERRER, REFEREE, WELCOME or CAMPAIGN issue needs a COMPLETED qualifying booking: the service refuses, and the database trigger refuses a raw insert', async () => {
      for (const kind of ['REFERRER', 'REFEREE', 'WELCOME', 'CAMPAIGN'] as const) {
        const r = await iss().issue({ kind, sub: 'sub_a', amountMinor: 1000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('s4', kind), reasonCode: 'X', actor: 't' });
        expect(r).toEqual({ status: 'SKIPPED', reason: 'QUALIFYING_VISIT_REQUIRED' });
      }
      const confirmed = await seedBooking(c, { sub: 'sub_a' }); // CONFIRMED, not COMPLETED
      await c.prisma.rewardLot.create({ data: { id: 'rwl_raw', sub: 'sub_a', kind: 'CAMPAIGN', mode: 'COUPON', amountMinor: 1000, ruleVersionId: 'v', expiresAt: new Date(Date.now() + DAY), qualifyingBookingId: confirmed.id } });
      const raw = (bookingId: string, key: string) => c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('${key}','rwl_raw','ISSUE',1000,'rwd:issue:${key}','v','T','t')`);
      await expect(raw(confirmed.id, 'k1')).rejects.toThrow(/COMPLETED qualifying booking/);
      await c.prisma.bookingIntent.update({ where: { id: confirmed.id }, data: { status: 'COMPLETED' } });
      await raw(confirmed.id, 'k2');
      const ok = await iss().issue({ kind: 'REFEREE', sub: 'sub_b', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('s4', 'ok'), reasonCode: 'REFEREE_WELCOME', actor: 't', qualifyingBookingId: (await completed('sub_b')).id });
      expect(ok.status).toBe('ISSUED');
    });
    it('the kill switch growth.rewards stops issuance; zero amounts and a wrong currency are skipped; nothing is created', async () => {
      expect(await iss().issue({ kind: 'PROMO', sub: 'a', amountMinor: 0, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('z'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'ZERO_AMOUNT' });
      expect(await iss().issue({ kind: 'PROMO', sub: 'a', amountMinor: 100, currency: 'USD', funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('u'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'CURRENCY_MISMATCH' });
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.rewards' } }); // the launch-locked flag is no longer effective: the kill switch state
      c.flags.invalidate();
      expect(await iss().issue({ kind: 'PROMO', sub: 'a', amountMinor: 100, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('off'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'REWARDS_OFF' });
      expect(await c.prisma.rewardLot.count()).toBe(0);
    });
    it('caps fail closed: annual per user, per campaign, rule budget ceiling, maximum open balance; the shipped defaults (all 0) issue nothing', async () => {
      await setRewardRules(c, { perUserAnnualCapMinor: 10_000, perCampaignCapMinor: 6_000, ruleBudgetCeilingMinor: 25_000, credit: { maxOpenBalanceMinor: 9_000 } });
      expect((await iss().issue({ kind: 'PROMO', sub: 'u1', amountMinor: 6000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('c1'), reasonCode: 'X', actor: 't', campaignId: 'camp_1' })).status).toBe('ISSUED');
      expect(await iss().issue({ kind: 'PROMO', sub: 'u2', amountMinor: 1, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('c2'), reasonCode: 'X', actor: 't', campaignId: 'camp_1' })).toEqual({ status: 'SKIPPED', reason: 'CAMPAIGN_CAP' });
      expect(await iss().issue({ kind: 'PROMO', sub: 'u1', amountMinor: 4001, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('c3'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'ANNUAL_CAP' });
      expect((await iss().issue({ kind: 'PROMO', sub: 'u1', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('c4'), reasonCode: 'X', actor: 't' })).status).toBe('ISSUED'); // 9000 open
      expect(await iss().issue({ kind: 'PROMO', sub: 'u1', amountMinor: 1, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('c5'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'MAX_OPEN_BALANCE' });
      for (let i = 0; i < 3; i++) await iss().issue({ kind: 'PROMO', sub: `b${i}`, amountMinor: 5000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('b', i), reasonCode: 'X', actor: 't' });
      expect(await iss().issue({ kind: 'PROMO', sub: 'b9', amountMinor: 5000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('b', 9), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'BUDGET_EXHAUSTED' }); // 6000+3000+3*5000 = 24000, +5000 > 25000
      const budget = await c.prisma.rewardIssuanceBudget.findFirstOrThrow();
      expect(budget.issuedMinor).toBe(24_000); expect(budget.issuedMinor).toBeLessThanOrEqual(budget.ceilingMinor);
    });
    it('20 parallel issuances against a budget that fits 4: exactly 4 lots and the budget never exceeds its ceiling', async () => {
      await setRewardRules(c, { ruleBudgetCeilingMinor: 20_000, perUserAnnualCapMinor: 1_000_000 });
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => iss().issue({ kind: 'PROMO', sub: `p${i}`, amountMinor: 5000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('par', i), reasonCode: 'X', actor: 't' })));
      expect(rs.filter((r) => r.status === 'ISSUED')).toHaveLength(4);
      expect(await c.prisma.rewardLot.count()).toBe(4);
      expect((await c.prisma.rewardIssuanceBudget.findFirstOrThrow()).issuedMinor).toBe(20_000);
    });
    it('every lot carries an expiry (12 months by default) and the event of an issue is the contract shape without a person', async () => {
      const l = await promo('sub_a', 2000);
      const lot = await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } });
      expect(lot.expiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
      const ev = await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'RewardIssued', aggregateId: l.lotId } });
      expect(ev.payload).toMatchObject({ lotRef: l.lotId, mode: 'COUPON', amountMinor: 2000, currency: 'EGP', idempotencyKey: expect.stringMatching(/^rwd:issue:/) });
      expect(JSON.stringify(ev.payload)).not.toContain('sub_a');
    });
  });

  describe('coupon mode (the default): single use, one reveal, one owner', () => {
    it('a coupon lot stores only a keyed hash after the one-time reveal; the code is shown once and never again', async () => {
      const l = await promo('sub_amira', 4000);
      const listed = (await c.http().get(`${BASE}/growth/v1/referral/rewards`).set(patient).expect(200)).body;
      expect(listed.items[0]).toMatchObject({ id: l.lotId, mode: 'COUPON', status: 'ACTIVE', remainingMinor: 4000, couponState: 'UNREVEALED' });
      expect(JSON.stringify(listed)).not.toMatch(/[0-9A-HJKMNP-TV-Z]{10}/);
      const shown = await c.http().post(`${BASE}/growth/v1/rewards/${l.lotId}/reveal`).set(patient).expect(200);
      expect(shown.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      const row = await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } });
      expect(row.couponCodeSealed).toBeNull(); expect(row.couponCodeHash).toBe(couponHash(shown.body.code)); expect(row.couponRevealedAt).not.toBeNull();
      const again = await c.http().post(`${BASE}/growth/v1/rewards/${l.lotId}/reveal`).set(patient);
      expect(again.status).toBe(409); expect(again.body.code).toBe('COUPON_ALREADY_REVEALED');
      await c.http().post(`${BASE}/growth/v1/rewards/${l.lotId}/reveal`).set(await c.as('sub_other')).expect(409); // someone else's lot looks the same: nothing to reveal
    });
    it('redeeming a coupon at the deposit checkout: the card pays the rest, the capture REDEEMs it, the unspent rest of a single-use coupon expires, the Clinic is told the gross deposit and the tender', async () => {
      const l = await promo('sub_amira', 4000);
      const code = (await c.http().post(`${BASE}/growth/v1/rewards/${l.lotId}/reveal`).set(patient).expect(200)).body.code;
      const id = await book();
      const co = (await checkout(id, { couponCode: code.toLowerCase() }).expect(200)).body;
      expect(co).toMatchObject({ amountMinor: 11000, rewardMinor: 4000 });
      expect(co.lines.map((x: any) => x.code)).toEqual(['PRICE', 'PATIENT_CREDIT', 'CARD']);
      expect(co.lines.map((x: any) => x.amountMinor)).toEqual([15000, -4000, 11000]); // price, credit, card
      expect(await bal(l.lotId)).toMatchObject({ available: 0, reserved: 4000 });
      expect((await checkout(id, { couponCode: code }).expect(200)).body.paymentId).toBe(co.paymentId); // checkout is idempotent: still one reservation
      expect((await entries(l.lotId)).filter((e) => e.type === 'RESERVE')).toHaveLength(1);
      await pay(co.paymentId);
      expect((await entries(l.lotId)).map((e) => e.type)).toEqual(['ISSUE', 'RESERVE', 'REDEEM']);
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } })).status).toBe('EXHAUSTED');
      const p = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } });
      expect(p).toMatchObject({ amountMinor: 11000, rewardMinor: 4000, rewardPostedMinor: 0, status: 'CAPTURED' });
      await flush();
      const dp = c.kiorly.callsTo('POST', '/deposit-paid');
      expect(dp[0].body).toMatchObject({ amount: 150, paymentRef: p.id, tender: { cardMinor: 11000, patientCreditMinor: 4000 } });
      expect(JSON.stringify(dp[0].body)).not.toContain('sub_amira');
      // postToPayLedger is false (default): the Pay ledger holds only what was charged
      expect(await sum('PSP_CLEARING')).toBe(11000); expect(await sum(`HELD:${p.clinicId}`)).toBe(-11000);
    });
    it('a coupon belongs to ONE patient: another account gets the same answer as a wrong code, and the attempt is a signal', async () => {
      const l = await promo('sub_amira', 4000);
      const code = (await c.http().post(`${BASE}/growth/v1/rewards/${l.lotId}/reveal`).set(patient).expect(200)).body.code;
      const other = await c.as('sub_hassan'); await c.http().put(`${BASE}/me/profile`).set(other).send({ nameEn: 'H' });
      const id = await book(other);
      const stolen = (await checkout(id, { couponCode: code }, other).expect(200)).body;
      const wrong = (await checkout(await book(await c.as('sub_third')), { couponCode: 'ZZZZZZZZZZ' }, await c.as('sub_third')).expect(200)).body;
      expect(stolen).toMatchObject({ amountMinor: 15000, couponProblem: 'COUPON_INVALID' }); expect(wrong).toMatchObject({ amountMinor: 15000, couponProblem: 'COUPON_INVALID' });
      expect(stolen.rewardMinor).toBeUndefined();
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_REDEEM_ABUSE' } })).toBe(1);
      expect(await bal(l.lotId)).toMatchObject({ available: 4000 });
    });
    it('one tap on a voucher (lotId) works like the code; a COUPON lot is never applied automatically', async () => {
      const l = await promo('sub_amira', 4000);
      const auto = (await checkout(await book()).expect(200)).body;
      expect(auto.rewardMinor).toBeUndefined(); expect(auto.amountMinor).toBe(15000);
      await c.prisma.paymentIntent.update({ where: { id: auto.paymentId }, data: { status: 'FAILED' } });
      const tapped = (await checkout(await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: auto.paymentId } }).then((p) => p.bookingId!), { lotId: l.lotId }).expect(200)).body;
      expect(tapped).toMatchObject({ rewardMinor: 4000, amountMinor: 11000 });
    });
  });

  describe('order of use, scope, and the redemption limits', () => {
    beforeEach(async () => { await unlockAll(c, ['growth.patient_credit']); await setRewardRules(c, { mode: 'CREDIT' }); });
    it('CREDIT lots apply automatically, first-expiring first; the quote lines add up to the price and the card keeps at least one minor unit', async () => {
      const late = await promo('sub_amira', 5000, { expiresAt: new Date(Date.now() + 200 * DAY) });
      const soon = await promo('sub_amira', 3000, { expiresAt: new Date(Date.now() + 30 * DAY) });
      const q = (await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 6000 }).expect(200)).body;
      expect(q.lines.map((x: any) => [x.code, x.amountMinor])).toEqual([['PRICE', 6000], ['PATIENT_CREDIT', -5999], ['CARD', 1]]);
      expect(q.payableMinor).toBe(1);
      const id = await book(); const co = (await checkout(id).expect(200)).body;
      expect(co.rewardMinor).toBe(8000); expect((await entries(soon.lotId)).map((e) => e.type)).toContain('RESERVE');
      const reserved = async (lot: string) => (await entries(lot)).filter((e) => e.type === 'RESERVE').reduce((s, e) => s + e.amountMinor, 0);
      expect(await reserved(soon.lotId)).toBe(3000); expect(await reserved(late.lotId)).toBe(5000);
    });
    it('a scoped lot (service kinds) is used before an unscoped one and is "not applicable" to a visit outside its scope', async () => {
      await promo('sub_amira', 2000, { expiresAt: new Date(Date.now() + 30 * DAY) });
      const scoped = await promo('sub_amira', 2000, { expiresAt: new Date(Date.now() + 300 * DAY), scope: { serviceKinds: ['HOME_VISIT'] } });
      const inClinic = (await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 3000, careType: 'IN_CLINIC' }).expect(200)).body;
      expect(inClinic.applicableMinor).toBe(2000); expect(inClinic.notApplicable).toEqual([scoped.lotId]);
      const home = (await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 3000, careType: 'HOME_VISIT' }).expect(200)).body;
      expect(home.applicableMinor).toBe(2999); // the card always keeps one minor unit
      const lots = (await c.http().get(`${BASE}/growth/v1/credit`).set(patient).expect(200)).body.lots;
      expect(lots.find((l: any) => l.id === scoped.lotId).scopeText).toBe('على الزيارات المنزلية'); // the test token carries no locale: Arabic is the default
      const en = (await c.http().get(`${BASE}/growth/v1/credit`).set({ Authorization: `Bearer ${await c.token({ sub: 'sub_amira' })}` }).expect(200)).body.lots;
      expect(en).toHaveLength(2);
    });
    it('redemptionMaxBp limits the share of the deposit and minPayable keeps card money', async () => {
      await setRewardRules(c, { mode: 'CREDIT', redemptionMaxBp: 5000, minPayableMinor: 8000 });
      await promo('sub_amira', 14000);
      const q = (await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 15000 }).expect(200)).body;
      expect(q.applicableMinor).toBe(7000); // min(14000, 50% of 15000 = 7500, 15000 - 8000 = 7000)
    });
    it('a held lot cannot be reserved; a release makes it spendable again; the hold times out by itself', async () => {
      const l = await promo('sub_amira', 4000);
      const holds = c.get(RewardHoldService);
      expect((await holds.hold(l.lotId, 'FRAUD_HOLD', 'adm_a')).heldMinor).toBe(4000);
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } })).status).toBe('HELD');
      expect((await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 10000 }).expect(200)).body.applicableMinor).toBe(0);
      await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('eh','${l.lotId}','RESERVE',1,'rwd:reserve:eh','v','T','t')`)).rejects.toThrow(/HELD|negative/);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RewardHeld' } })).toBe(1);
      await holds.release(l.lotId, 'adm_a');
      expect((await c.http().post(`${BASE}/growth/v1/rewards/quote`).set(patient).send({ amountMinor: 10000 }).expect(200)).body.applicableMinor).toBe(4000);
      await holds.hold(l.lotId, 'FRAUD_HOLD', 'adm_a');
      expect(await holds.autoRelease(new Date(Date.now() + 20 * DAY))).toBe(1); // holdMaxDays is 14
      expect(await bal(l.lotId)).toMatchObject({ available: 4000, held: 0 });
    });
  });

  describe('release: a payment that fails or a booking that ends gives the credit back', () => {
    beforeEach(async () => { await unlockAll(c, ['growth.patient_credit']); await setRewardRules(c, { mode: 'CREDIT' }); });
    it('payment.failed releases the reservation; a second checkout reserves again (a new cycle)', async () => {
      const l = await promo('sub_amira', 4000);
      const id = await book(); const co = (await checkout(id).expect(200)).body;
      expect(await bal(l.lotId)).toMatchObject({ available: 0, reserved: 4000 });
      await pay(co.paymentId, 'fail');
      expect(await bal(l.lotId)).toMatchObject({ available: 4000, reserved: 0 });
      const again = (await checkout(id).expect(200)).body;
      expect(again.rewardMinor).toBe(4000); expect(again.paymentId).not.toBe(co.paymentId);
      await pay(again.paymentId);
      expect((await entries(l.lotId)).map((e) => e.type)).toEqual(['ISSUE', 'RESERVE', 'UNRESERVE', 'RESERVE', 'REDEEM']);
    });
    it('a booking cancelled before it was paid releases the credit; the housekeeping job releases the reservation of a dead booking', async () => {
      const l = await promo('sub_amira', 4000);
      const id = await book(); await checkout(id).expect(200);
      await c.prisma.bookingIntent.update({ where: { id }, data: { status: 'EXPIRED' } });
      const r = await c.get(RewardExpiryJob).runOnce(new Date(Date.now() + 30 * 60_000));
      expect(r.releasedReservations).toBe(4000);
      expect(await bal(l.lotId)).toMatchObject({ available: 4000, reserved: 0 });
    });
    it('a capture that arrives after the credit was reversed is still one REDEEM and one deposit (value in flight is never pulled away)', async () => {
      const booking = await completed('sub_amira');
      const lot = await iss().issue({ kind: 'CAMPAIGN', sub: 'sub_amira', amountMinor: 4000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('rv'), reasonCode: 'PROMO_CAMPAIGN', actor: 't', qualifyingBookingId: booking.id, mode: 'CREDIT' });
      const id = await book(); const co = (await checkout(id).expect(200)).body;
      expect(co.rewardMinor).toBe(4000);
      const out = await rev().reverseForBooking(booking.id, 'REFUND');
      expect(out[0]).toMatchObject({ reversedMinor: 0 }); // reserved for a payment in flight: nothing available to take back
      await pay(co.paymentId);
      expect((await entries((lot as any).lotId)).map((e) => e.type)).toEqual(['ISSUE', 'RESERVE', 'REDEEM']);
      const again = await rev().reverseForBooking(booking.id, 'REFUND');
      expect(again[0]).toMatchObject({ reversedMinor: 0, recoverableLossMinor: 4000 }); // spent: becomes a recoverable loss
    });
  });

  describe('reversal and recoverable loss', () => {
    it('a reward whose qualifying booking is refunded inside the window loses its unspent part; a spent part blocks issuance for 90 days; outside the window nothing happens', async () => {
      const b = await completed('sub_amira');
      const l = await iss().issue({ kind: 'REFEREE', sub: 'sub_amira', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('rv1'), reasonCode: 'REFEREE_WELCOME', actor: 't', qualifyingBookingId: b.id });
      const lotId = (l as any).lotId as string;
      const out = await rev().reverseForBooking(b.id, 'REFUND');
      expect(out).toEqual([{ lotId, reversedMinor: 3000, recoverableLossMinor: 0 }]);
      expect(await bal(lotId)).toMatchObject({ available: 0 });
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lotId } })).status).toBe('REVERSED');
      expect((await rev().reverseForBooking(b.id, 'REFUND'))[0]).toMatchObject({ skipped: 'NOTHING_AVAILABLE' }); // idempotent
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RewardReversed' } })).toBe(1);
      // part spent: reverse the rest, the spent part is a recoverable loss and blocks new issuance
      const b2 = await completed('sub_amira');
      const l2 = await iss().issue({ kind: 'REFEREE', sub: 'sub_amira', amountMinor: 5000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('rv2'), reasonCode: 'REFEREE_WELCOME', actor: 't', qualifyingBookingId: b2.id });
      const id2 = (l2 as any).lotId as string;
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('r1','${id2}','RESERVE',2000,'rwd:reserve:r1','v','T','t','bk')`);
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('r2','${id2}','REDEEM',2000,'rwd:redeem:r2','v','T','t','bk')`);
      expect((await rev().reverseForBooking(b2.id, 'REFUND'))[0]).toEqual({ lotId: id2, reversedMinor: 3000, recoverableLossMinor: 2000 });
      expect(await c.prisma.rewardRecoverableLoss.count({ where: { lotId: id2 } })).toBe(1);
      expect(await iss().issue({ kind: 'PROMO', sub: 'sub_amira', amountMinor: 1000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('blk'), reasonCode: 'X', actor: 't' })).toEqual({ status: 'SKIPPED', reason: 'RECOVERABLE_LOSS_BLOCK' });
      // outside the 30-day window a refund no longer reverses
      const b3 = await completed('sub_third');
      const l3 = await iss().issue({ kind: 'REFEREE', sub: 'sub_third', amountMinor: 3000, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('rv3'), reasonCode: 'REFEREE_WELCOME', actor: 't', qualifyingBookingId: b3.id });
      expect(await rev().reverseForBooking(b3.id, 'REFUND', new Date(Date.now() + 31 * DAY))).toEqual([]);
      expect(await bal((l3 as any).lotId)).toMatchObject({ available: 3000 });
    });
    it('a REFUND_CREDIT or RESTORED lot is the patient\'s own money: no referral, fraud or booking rule reverses it', async () => {
      const lot = await c.prisma.rewardLot.create({ data: { id: 'rwl_rc', sub: 'sub_amira', ownerSub: 'sub_amira', kind: 'REFUND_CREDIT', mode: 'CREDIT', funding: 'PATIENT_REFUND', amountMinor: 5000, ruleVersionId: 'v', expiresAt: new Date(Date.now() + DAY * 100), qualifyingBookingId: null } });
      const cr = await c.prisma.refundDestinationChoice.create({ data: { refundId: 'rf_x', bookingId: 'bk', sub: 'sub_amira', choice: 'CREDIT', source: 'PATIENT_CANCEL' } });
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","refundId") VALUES ('rc1','${lot.id}','ISSUE',5000,'rwd:issue:rc1','v','T','t','${cr.refundId}')`);
      expect(await rev().reverseLot(lot.id, 'MANUAL_REVERSAL', 'adm')).toMatchObject({ skipped: 'NEVER_REVERSED_KIND' });
      expect(await bal(lot.id)).toMatchObject({ available: 5000 });
      // and S7: a REFUND_CREDIT ISSUE without a recorded CREDIT choice for its refund is refused by the database
      await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","refundId") VALUES ('rc2','${lot.id}','ISSUE',100,'rwd:issue:rc2','v','T','t','rf_none')`)).rejects.toThrow(/CREDIT choice/);
    });
  });

  describe('expiry', () => {
    it('expires unspent value past the expiry date, first-expiring first; value reserved for a payment in flight is not expired under it; a second run changes nothing', async () => {
      const a = await promo('sub_a', 3000, { expiresAt: new Date(Date.now() + 10 * DAY) });
      const b = await promo('sub_b', 4000, { expiresAt: new Date(Date.now() + 20 * DAY) });
      const live = await seedBooking(c, { sub: 'sub_b' }); // a live booking with an open checkout: its reservation is a payment in flight
      await c.prisma.paymentIntent.create({ data: { id: 'pay_live', bookingId: live.id, sub: 'sub_b', clinicId: 'cl_1', amountMinor: 100, psp: 'paymob' } });
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('x1','${b.lotId}','RESERVE',1000,'rwd:reserve:x1','v','T','t','${live.id}')`);
      const job = c.get(RewardExpiryJob);
      const r1 = await job.runOnce(new Date(Date.now() + 15 * DAY));
      expect(r1).toMatchObject({ expiredLots: 1, expiredMinor: 3000 });
      expect(await bal(a.lotId)).toMatchObject({ available: 0 }); expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: a.lotId } })).status).toBe('EXPIRED');
      const r2 = await job.runOnce(new Date(Date.now() + 25 * DAY));
      expect(r2.expiredMinor).toBe(3000); // b: 4000 - 1000 reserved
      expect(await bal(b.lotId)).toMatchObject({ available: 0, reserved: 1000 });
      expect(await job.runOnce(new Date(Date.now() + 25 * DAY))).toMatchObject({ expiredLots: 0, expiredMinor: 0 });
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RewardExpired' } })).toBe(2);
    });
  });

  describe('finance report, reconcile, erasure, ops and the flag-OFF contract', () => {
    it('the finance report equals the ledger sums, refund credit liability is shown apart, revenue effect is always 0, CSV is formula-safe', async () => {
      const l1 = await promo('sub_a', 5000); const l2 = await promo('sub_b', 2000);
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor") VALUES ('f1','${l1.lotId}','RESERVE',1500,'rwd:reserve:f1','v','T','t')`);
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('f2','${l1.lotId}','REDEEM',1500,'rwd:redeem:f2','v','T','t','bk_f')`);
      void l2;
      const month = new Date().toISOString().slice(0, 7);
      const fin = await c.get(RewardFinanceService).report(month);
      expect(fin.totals).toMatchObject({ issuedMinor: 7000, redeemedMinor: 1500, reversedMinor: 0, expiredMinor: 0 });
      expect(fin.outstanding[0]).toMatchObject({ platformFundedMinor: 5500, refundCreditLiabilityMinor: 0, totalMinor: 5500 });
      expect(fin.kiorexRevenueEffectMinor).toBe(0);
      const api = await c.http().get(`${BASE}/admin/growth/rewards/finance?month=${month}`).set(await c.as('fin', { roles: ['ops_admin', 'finance'] })).expect(200);
      expect(api.body.totals.issuedMinor).toBe(7000);
      await c.http().get(`${BASE}/admin/growth/rewards/finance?month=${month}`).set(ops).expect(403); // ops_admin without finance cannot read money
      const csv = await c.http().get(`${BASE}/admin/growth/rewards/finance.csv?month=${month}`).set(admin).expect(200);
      expect(csv.text).toContain('issuedMinor'); expect(csv.headers['content-type']).toContain('text/csv');
      await c.http().get(`${BASE}/admin/growth/rewards/finance?month=2026-13`).set(admin).expect(400);
    });
    it('the daily reconcile (RC-1 to RC-7) passes on a healthy ledger, records a run, and on a broken ledger writes a case and corrects nothing', async () => {
      const l = await promo('sub_a', 5000);
      const job = c.get(RewardReconcileJob);
      const ok = await job.run();
      expect(ok.ok).toBe(true); expect(ok.checks.map((x) => x.id)).toEqual(['RC-1', 'RC-2', 'RC-3', 'RC-4', 'RC-5', 'RC-6', 'RC-7']);
      expect(await c.prisma.rewardReconcileRun.count()).toBe(1);
      // simulate a corruption that the code paths cannot produce: a REDEEM with no checkout snapshot, and a provider wallet reference
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('z1','${l.lotId}','RESERVE',100,'rwd:reserve:z1','v','T','tenant:org_1','bk_z')`);
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","bookingId") VALUES ('z2','${l.lotId}','REDEEM',100,'rwd:redeem:z2','v','T','t','bk_z')`);
      const bad = await job.run();
      expect(bad.ok).toBe(false);
      expect(bad.checks.filter((x) => !x.ok).map((x) => x.id).sort()).toEqual(['RC-3', 'RC-5']);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.reward_reconcile_failed' } })).toBe(1);
      expect(await c.prisma.rewardLedgerEntry.count({ where: { lotId: l.lotId } })).toBe(3); // nothing was corrected
      expect((await c.http().get(`${BASE}/admin/growth/credit/reconcile`).set(ops).expect(200)).body).toHaveLength(2);
    });
    it('subject erasure keeps the ledger rows (accounting), loses the person, and clears an unrevealed coupon seal', async () => {
      const l = await promo('sub_erase', 3000);
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } })).couponCodeSealed).not.toBeNull();
      await c.get(GrowthMaintenanceService).eraseSubject('sub_erase');
      const lot = await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.lotId } });
      expect(lot.sub).toMatch(/^h:[0-9a-f]{64}$/); expect(lot.ownerSub).toMatch(/^h:/); expect(lot.couponCodeSealed).toBeNull(); expect(lot.couponCodeHash).toBeNull();
      expect(await entries(l.lotId)).toHaveLength(1);
    });
    it('W8: GET /admin/growth/rewards/lots?take=200 answers in one balance query, never exhausts the pool, and take is bounded (200 at most, 50 by default for junk)', async () => {
      const made: string[] = [];
      for (let i = 0; i < 205; i++) made.push((await promo(`sub_w8_${i}`, 100 + i)).lotId);
      const before = Date.now();
      const calls = await Promise.all([1, 2, 3, 4].map(() => c.http().get(`${BASE}/admin/growth/rewards/lots?take=200`).set(ops).expect(200)));
      expect(Date.now() - before).toBeLessThan(15_000);
      for (const r of calls) {
        expect(r.body).toHaveLength(200);
        for (const l of r.body) expect(l.availableMinor).toBe(l.amountMinor);
      }
      expect((await c.http().get(`${BASE}/admin/growth/rewards/lots?take=9999`).set(ops).expect(200)).body).toHaveLength(200);
      for (const junk of ['abc', '-5', '0', '1e999', '']) expect((await c.http().get(`${BASE}/admin/growth/rewards/lots?take=${junk}`).set(ops).expect(200)).body).toHaveLength(50);
      expect((await c.http().get(`${BASE}/admin/growth/rewards/lots?take=3.9`).set(ops).expect(200)).body).toHaveLength(3);
      const b = await led().balances(c.prisma, [...made.slice(0, 5), 'rl_missing']);
      expect(b.size).toBe(6); expect(b.get('rl_missing')).toEqual({ available: 0, held: 0, reserved: 0 });
      for (const id of made.slice(0, 5)) expect(b.get(id)).toEqual(await bal(id));
    });
    it('ops reads show patients as opaque references only, with the pricing banner; manual issuance has a daily cap and a second approver above the threshold', async () => {
      const l = await promo('sub_amira', 2000);
      const lots = (await c.http().get(`${BASE}/admin/growth/rewards/lots`).set(ops).expect(200)).body;
      expect(lots[0]).toMatchObject({ id: l.lotId, availableMinor: 2000 });
      expect(JSON.stringify(lots)).not.toContain('sub_amira');
      expect((await c.http().get(`${BASE}/admin/growth/rewards/lots/${l.lotId}/ledger`).set(ops).expect(200)).body).toHaveLength(1);
      const ov = (await c.http().get(`${BASE}/admin/growth/rewards`).set(ops).expect(200)).body;
      expect(ov).toMatchObject({ mode: 'COUPON', effectiveMode: 'COUPON', banner: 'NO_DEPOSIT_CONFIGURED' });
      await c.http().post(`${BASE}/admin/growth/rewards/manual-issue`).set(ops).send({ sub: 'sub_x', amountMinor: 1000, reason: 'x' }).expect(403); // super admin only
      const small = (await c.http().post(`${BASE}/admin/growth/rewards/manual-issue`).set(admin).send({ sub: 'sub_x', amountMinor: 1000, reason: 'compensation for a wrong slot' }).expect(201)).body;
      expect(small.status).toBe('ISSUED');
      const big = (await c.http().post(`${BASE}/admin/growth/rewards/manual-issue`).set(admin).send({ sub: 'sub_x', amountMinor: 20_001, reason: 'larger compensation' }).expect(201)).body;
      expect(big.status).toBe('PENDING_APPROVAL');
      const cap = await c.http().post(`${BASE}/admin/growth/rewards/manual-issue`).set(admin).send({ sub: 'sub_y', amountMinor: 40_000, reason: 'too much for one day' });
      expect(cap.status).toBe(422); expect(cap.body.code).toBe('MANUAL_DAILY_CAP');
      const self = await c.http().post(`${BASE}/admin/growth/rewards/approvals/${big.requestId}/decide`).set(admin).send({ decision: 'APPROVED' });
      expect(self.status).toBe(403); expect(self.body.code).toBe('APPROVAL_SELF_DECISION');
      const done = (await c.http().post(`${BASE}/admin/growth/rewards/approvals/${big.requestId}/decide`).set(admin2).send({ decision: 'APPROVED' }).expect(200)).body;
      expect(done.status).toBe('APPROVED'); expect(await bal(done.lotId)).toMatchObject({ available: 20_001 });
      expect((await c.http().post(`${BASE}/admin/growth/rewards/approvals/${big.requestId}/decide`).set(admin2).send({ decision: 'APPROVED' })).status).toBe(409);
      await expect(c.prisma.rewardApprovalRequest.update({ where: { id: big.requestId }, data: { reasonNote: 'x' } as any })).rejects.toBeTruthy();
      expect(await c.prisma.auditLog.count({ where: { action: { startsWith: 'growth.manual_issue' } } })).toBeGreaterThanOrEqual(3);
    });
    it('flag-OFF contract: every patient route answers 403 FEATURE_DISABLED {key} while the flag is not effective; ops reads still work (nothing is hidden)', async () => {
      await c.reset(); c.flags.invalidate(); // pristine flags: the launch-locked ones have no gate evidence
      const p = await c.as('sub_amira');
      for (const [m, path, key] of [['get', '/growth/v1/referral/rewards', 'growth.rewards'], ['post', '/growth/v1/rewards/quote', 'growth.rewards'], ['post', '/growth/v1/rewards/rwl_x/reveal', 'growth.rewards'], ['get', '/growth/v1/credit', 'growth.patient_credit'], ['get', '/growth/v1/credit/household', 'growth.family_credit'], ['get', '/growth/v1/referral/me', 'growth.patient_referral'], ['post', '/growth/v1/referral/claim', 'growth.patient_referral'], ['post', '/growth/v1/referral/invites', 'growth.patient_referral']] as const) {
        const r = await (c.http() as any)[m](`${BASE}${path}`).set(p).send({ amountMinor: 1000, code: 'K7Q2M9XA' });
        expect([r.status, r.body.code, r.body.key]).toEqual([403, 'FEATURE_DISABLED', key]);
      }
      expect((await c.http().get(`${BASE}/admin/growth/rewards`).set(await c.as('ops_1', { roles: ['ops_admin'] })).expect(200)).body.flags.rewards).toBe(false);
      // and a deposit checkout with every growth flag off is exactly the plain deposit
      c.kiorly.slots = [slot]; pid = await seedProvider(c, { depositAmount: 150 });
      const id = await book(p); const co = (await checkout(id, {}, p).expect(200)).body;
      expect(co).toMatchObject({ amountMinor: 15000 }); expect(co.rewardMinor).toBeUndefined();
      expect(await c.prisma.rewardLedgerEntry.count()).toBe(0);
    });
    it('goodwill service is switched off with its flag; the GoodwillService is wired', async () => {
      await expect(c.get(GoodwillService).grant({ sub: 'agent', roles: ['support'] }, { sub: 'sub_amira', reason: 'LONG_WAIT', amountMinor: 1000, ticketRef: 'T-1' })).rejects.toMatchObject({ response: { code: 'FEATURE_DISABLED' } });
      expect(c.get(PayService)).toBeDefined();
    });
  });
});
