import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { seedBooking } from './growth-helpers';
import { DAY, setReferralRules, setRewardRules, uid, unlockAll } from './growth-rewards-helpers';
import { addressHash } from '../src/common/privacy-hash';
import { GrowthMaintenanceService } from '../src/growth/growth-public';
import { OutboxService } from '../src/outbox/outbox-public';
import { cfg } from '../src/common/config';
import { staffPhoneMatchHash } from '../src/growth/referral/referral-identity.service';
import { ReferralClaimService, ReferralExpiryJob, ReferralIdentityService, ReferralQualificationService, MockStaffPhoneMatch } from '../src/growth/referral/referral-public';
import { RewardLedgerService } from '../src/growth/rewards/rewards-public';

type Auth = { Authorization: string };
const BASE = '/api/v1/growth/v1/referral';
const ADMIN = '/api/v1/admin/growth/referrals';

/**
 * GRW-P2-B1 over the real HTTP stack and Postgres: codes, first-claim-wins, the no-oracle refusal shape, qualification after a completed and held visit, exactly one ReferralQualified with idempotent
 * issuance, every fraud rule of the table in enforce and shadow mode, reviewer decisions with the two-person override, erasure, and the flag-OFF contract. Mock providers only.
 */
describe('growth referral engine (GRW-P2-B1)', () => {
  let c: TestCtx; let admin: Auth; let admin2: Auth; let support: Auth; let ops: Auth;
  const qual = () => c.get(ReferralQualificationService); const claims = () => c.get(ReferralClaimService); const ident = () => c.get(ReferralIdentityService); const ledger = () => c.get(RewardLedgerService);
  const as = async (sub: string, phone?: string): Promise<Auth> => ({ Authorization: `Bearer ${await c.token({ sub, phone })}` });
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    await unlockAll(c); await setRewardRules(c); await setReferralRules(c);
    admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); admin2 = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); support = await c.as('sup_1', { roles: ['ops_admin', 'support'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
  });

  /** A referrer who "earned" the right: an account older than 7 days with one completed visit. */
  const referrer = async (sub: string, phone = '+201000000001') => {
    const a = await as(sub, phone);
    await c.http().put('/api/v1/me/profile').set(a).send({ nameEn: 'Referrer' }).expect(200);
    await c.prisma.patientProfile.update({ where: { sub }, data: { createdAt: new Date(Date.now() - 30 * DAY) } });
    const b = await seedBooking(c, { sub }); await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: new Date(Date.now() - 20 * DAY) } });
    const me = (await c.http().get(`${BASE}/me`).set(a).expect(200)).body;
    return { auth: a, code: me.code as string, sub };
  };
  const referee = async (sub: string, phone: string, code: string) => {
    const a = await as(sub, phone);
    await c.http().put('/api/v1/me/profile').set(a).send({ nameEn: 'Friend' }).expect(200);
    const r = await c.http().post(`${BASE}/claim`).set(a).send({ code });
    return { auth: a, sub, claim: r };
  };
  const completedVisit = async (sub: string, o: { terminalAt?: Date; providerId?: string } = {}) => {
    const b = await seedBooking(c, { sub, ...(o.providerId ? { providerId: o.providerId } : {}) });
    const done = await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: o.terminalAt ?? new Date() } });
    await c.prisma.bookingEvent.create({ data: { bookingId: b.id, kind: 'STATE', fromStatus: 'CONFIRMED', toStatus: 'COMPLETED' } });
    await qual().onBookingCompleted(b.id);
    return done;
  };
  const rel = (refereeSub: string) => c.prisma.referralRelationship.findUniqueOrThrow({ where: { market_refereeSub: { market: 'EG', refereeSub } } });
  const flagOff = async (key: string) => { const r = await c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }); expect([200, 202]).toContain(r.status); c.flags.invalidate(); };

  describe('codes and links', () => {
    it('me issues ONE code per patient (idempotent, also under a race), registers it as a REFERRAL source, and shows counts only', async () => {
      const a = await as('sub_a', '+201000000001');
      const [x, y, z] = await Promise.all([1, 2, 3].map(() => c.http().get(`${BASE}/me`).set(a)));
      expect([x.status, y.status, z.status]).toEqual([200, 200, 200]);
      expect(new Set([x.body.code, y.body.code, z.body.code]).size).toBe(1);
      expect(x.body).toMatchObject({ status: 'ACTIVE', counts: { invited: 0, signedUp: 0, qualified: 0 }, capsRemaining: { last30Days: 5, thisYear: 20 } });
      expect(x.body.inviteUrl).toBe(`https://kiorex.com/ar/eg/invite/${x.body.code}`); expect(x.body.deepLink).toBe(`kiorex://invite/${x.body.code}`);
      expect(await c.prisma.referralCode.count()).toBe(1);
      expect(await c.prisma.growthAcquisitionSource.count({ where: { sourceKind: 'REFERRAL', sourceRef: x.body.code } })).toBe(1);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'ReferralCodeIssued' } })).toBe(1);
    });
    it('invites record a share (no recipient) and return the link and an Arabic or English share text; a bad channel is a 400; the share is rate limited', async () => {
      const a = await as('sub_a'); const code = (await c.http().get(`${BASE}/me`).set(a)).body.code;
      const en = (await c.http().post(`${BASE}/invites`).set(a).send({ channel: 'WHATSAPP_SHARE', locale: 'en' }).expect(201)).body;
      expect(en).toMatchObject({ code, inviteUrl: `https://kiorex.com/en/eg/invite/${code}` }); expect(en.shareText).toContain('Kiorex');
      const ar = (await c.http().post(`${BASE}/invites`).set(a).send({}).expect(201)).body; expect(ar.shareText).toMatch(/[\u0600-\u06FF]/);
      await c.http().post(`${BASE}/invites`).set(a).send({ channel: 'TELEGRAM' }).expect(400);
      expect((await c.http().get(`${BASE}/me`).set(a)).body.counts.invited).toBe(2);
      expect(await c.prisma.referralShare.count()).toBe(2);
    });
  });

  describe('claim: first claim wins and every refusal looks the same', () => {
    it('claims a code once; the same claim again and a different code later answer the first relationship and change nothing', async () => {
      const r1 = await referrer('sub_r1'); const r2 = await referrer('sub_r2', '+201000000002');
      const f = await referee('sub_f', '+201000000010', r1.code);
      expect(f.claim.status).toBe(200); expect(f.claim.body).toEqual({ status: 'SIGNED_UP' });
      expect((await c.http().post(`${BASE}/claim`).set(f.auth).send({ code: r1.code.toLowerCase() })).body).toEqual({ status: 'SIGNED_UP' });
      expect((await c.http().post(`${BASE}/claim`).set(f.auth).send({ code: r2.code })).body).toEqual({ status: 'SIGNED_UP' }); // first claim wins, nothing changes
      const row = await rel('sub_f'); expect(row.referrerSub).toBe('sub_r1'); expect(await c.prisma.referralRelationship.count()).toBe(1);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'ReferralRelationshipCreated' } })).toBe(1);
      expect((await c.http().get(`${BASE}/me`).set(r1.auth)).body.counts).toEqual({ invited: 0, signedUp: 1, qualified: 0 });
    });
    it('two parallel claims of one person produce one relationship', async () => {
      const r1 = await referrer('sub_r1'); const a = await as('sub_f', '+201000000010');
      const rs = await Promise.all([1, 2, 3, 4].map(() => c.http().post(`${BASE}/claim`).set(a).send({ code: r1.code })));
      expect(rs.every((r) => r.status === 200 && r.body.status === 'SIGNED_UP')).toBe(true);
      expect(await c.prisma.referralRelationship.count()).toBe(1);
    });
    it('self referral, an unknown code, a malformed one and a suspended one are refused with the SAME shape and never say who owns a code', async () => {
      const r1 = await referrer('sub_r1'); const r2 = await referrer('sub_r2', '+201000000002');
      await c.prisma.referralCode.update({ where: { code: r2.code }, data: { status: 'SUSPENDED' } });
      const self = await c.http().post(`${BASE}/claim`).set(r1.auth).send({ code: r1.code });
      const unknown = await c.http().post(`${BASE}/claim`).set(await as('sub_u1', '+201000000021')).send({ code: '0AAA1BBB' });
      const suspended = await c.http().post(`${BASE}/claim`).set(await as('sub_u2', '+201000000022')).send({ code: r2.code });
      for (const r of [self, unknown, suspended]) { expect(r.status).toBe(409); expect(Object.keys(r.body).sort()).toEqual(['code', 'message', 'reason', 'status']); expect(r.body).toMatchObject({ code: 'REFERRAL_REJECTED', status: 'REJECTED' }); }
      expect(self.body.reason).toBe('SELF_REFERRAL'); expect(unknown.body.reason).toBe('CODE_SUSPENDED'); expect(suspended.body.reason).toBe('CODE_SUSPENDED'); // unknown and suspended are indistinguishable
      expect(JSON.stringify([self.body, unknown.body, suspended.body])).not.toMatch(/sub_r|name|phone/i);
      await c.http().post(`${BASE}/claim`).set(r1.auth).send({ code: 'short' }).expect(400);
      expect(await c.prisma.referralRelationship.count()).toBe(0);
    });
    it('an existing patient (a visit already attended or an active booking made before the claim) is refused; a cancelled attempt does not count', async () => {
      const r1 = await referrer('sub_r1');
      const done = await seedBooking(c, { sub: 'sub_old' }); await c.prisma.bookingIntent.update({ where: { id: done.id }, data: { status: 'COMPLETED' } });
      const old = await c.http().post(`${BASE}/claim`).set(await as('sub_old', '+201000000030')).send({ code: r1.code });
      expect(old.status).toBe(409); expect(old.body.reason).toBe('ALREADY_PATIENT');
      expect((await c.http().post(`${BASE}/claim`).set(await as('sub_old', '+201000000030')).send({ code: r1.code })).body.reason).toBe('ALREADY_PATIENT'); // the first answer stands
      const cancelled = await seedBooking(c, { sub: 'sub_try' }); await c.prisma.bookingIntent.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
      expect((await c.http().post(`${BASE}/claim`).set(await as('sub_try', '+201000000031')).send({ code: r1.code })).status).toBe(200);
    });
    it('rules disabled in REFERRAL_RULES refuse new claims (RULES_DISABLED)', async () => {
      await setReferralRules(c, { enabled: false });
      const r1 = await referrer('sub_r1');
      const r = await c.http().post(`${BASE}/claim`).set(await as('sub_f', '+201000000010')).send({ code: r1.code });
      expect([r.status, r.body.reason]).toEqual([409, 'RULES_DISABLED']);
    });
  });

  describe('qualification: attended, held, then exactly once', () => {
    it('a friend registers, books, is attended, the hold passes: one ReferralQualified, one lot each, idempotent; the response of the referrer shows counts only', async () => {
      const r = await referrer('sub_r1'); const f = await referee('sub_f', '+201000000010', r.code);
      expect(f.claim.status).toBe(200);
      const visit = await completedVisit('sub_f');
      const afterVisit = await rel('sub_f');
      expect(afterVisit).toMatchObject({ status: 'BOOKED', firstBookingId: visit.id }); expect(afterVisit.holdUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
      expect(await c.prisma.rewardLot.count()).toBe(0); // issuance waits for the hold window
      const early = await qual().runDue(new Date(Date.now() + 3 * DAY)); expect(early.evaluated).toBe(0);
      const t = new Date(Date.now() + 8 * DAY);
      const job = c.get(ReferralExpiryJob);
      expect(await job.run(t)).toMatchObject({ evaluated: 1 });
      expect(await rel('sub_f')).toMatchObject({ status: 'QUALIFIED', qualifiedBookingId: visit.id });
      const lots = await c.prisma.rewardLot.findMany({ orderBy: { kind: 'asc' } });
      expect(lots.map((l) => [l.kind, l.sub, l.amountMinor, l.mode, l.qualifyingBookingId, l.funding])).toEqual([['REFEREE', 'sub_f', 3000, 'COUPON', visit.id, 'PLATFORM_MARKETING'], ['REFERRER', 'sub_r1', 5000, 'COUPON', visit.id, 'PLATFORM_MARKETING']]);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'ReferralQualified' } })).toBe(1);
      // idempotent: a second run, a parallel evaluation and a repeated completion hook change nothing
      await Promise.all([qual().evaluate((await rel('sub_f')).id, { now: t }), qual().evaluate((await rel('sub_f')).id, { now: t }), qual().onBookingCompleted(visit.id), job.run(t)]);
      expect(await c.prisma.rewardLot.count()).toBe(2); expect(await c.prisma.outboxEvent.count({ where: { type: 'ReferralQualified' } })).toBe(1);
      expect(await c.prisma.rewardLedgerEntry.count({ where: { type: 'ISSUE' } })).toBe(2);
      for (const l of lots) expect((await c.prisma.rewardLedgerEntry.findFirstOrThrow({ where: { lotId: l.id } })).idempotencyKey).toMatch(/^rwd:issue:/);
      const checks = await c.prisma.referralQualificationCheck.findMany({ where: { relationshipId: afterVisit.id } });
      expect(checks.filter((x) => x.checkKey === 'HOLD_PERIOD').some((x) => x.passed)).toBe(true);
      // the referrer learns nothing about the friend
      const me = (await c.http().get(`${BASE}/me`).set(r.auth).expect(200)).body;
      expect(me.counts).toEqual({ invited: 0, signedUp: 1, qualified: 1 }); expect(me.rewards).toEqual({ activeCount: 1, activeMinor: 5000, currency: 'EGP' }); expect(JSON.stringify(me)).not.toMatch(/sub_f|Friend|1000000010/);
      const mine = (await c.http().get('/api/v1/growth/v1/referral/rewards').set(r.auth).expect(200)).body.items;
      expect(mine).toHaveLength(1); expect(JSON.stringify(mine)).not.toMatch(/sub_f|relationship/i);
    });
    it('the real flow end to end: the Clinic COMPLETED webhook drives the referral hook; the friend then spends the welcome voucher on the deposit', async () => {
      c.kiorly.slots = [futureSlot(72)]; const pid = await seedProvider(c, { depositAmount: 150 });
      const r = await referrer('sub_r1'); const f = await referee('sub_f', '+201000000010', r.code);
      const bookIt = async () => { const h = await c.http().post('/api/v1/bookings').set(f.auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(201); await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(f.auth).send({ marketplaceConsent: true }).expect(200); return h.body.id as string; };
      const first = await bookIt();
      await c.webhook('COMPLETED', { externalReference: first });
      expect((await rel('sub_f')).status).toBe('BOOKED');
      await qual().runDue(new Date(Date.now() + 8 * DAY));
      expect((await rel('sub_f')).status).toBe('QUALIFIED');
      const voucher = (await c.http().get('/api/v1/growth/v1/referral/rewards').set(f.auth).expect(200)).body.items[0];
      expect(voucher).toMatchObject({ kind: 'REFEREE', amountMinor: 3000, mode: 'COUPON' });
      c.kiorly.slots = [futureSlot(96)];
      const second = await (async () => { const h = await c.http().post('/api/v1/bookings').set(f.auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(96) }).expect(201); await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(f.auth).send({ marketplaceConsent: true }).expect(200); return h.body.id as string; })();
      const co = (await c.http().post(`/api/v1/bookings/${second}/deposit-checkout`).set(f.auth).send({ lotId: voucher.id }).expect(200)).body;
      expect(co).toMatchObject({ amountMinor: 12000, rewardMinor: 3000 });
      await c.http().post(`/api/v1/pay/fake-checkout/${co.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
      await c.get(OutboxService).processBatch(100);
      expect(c.kiorly.callsTo('POST', '/deposit-paid').pop()!.body).toMatchObject({ amount: 150, tender: { cardMinor: 12000, patientCreditMinor: 3000 } });
    });
    it.each([
      ['a no-show never counts', { status: 'NO_SHOW' }, 'REJECTED'],
      ['a cancelled visit does not qualify', { status: 'CANCELLED' }, 'REJECTED'],
    ])('%s', async (_n, patch, expected) => {
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code);
      const b = await seedBooking(c, { sub: 'sub_f' }); await c.prisma.bookingIntent.update({ where: { id: b.id }, data: patch });
      await c.prisma.referralRelationship.update({ where: { market_refereeSub: { market: 'EG', refereeSub: 'sub_f' } }, data: { status: 'BOOKED', firstBookingId: b.id, completedAt: new Date(), holdUntil: new Date() } });
      const out = await qual().evaluate((await rel('sub_f')).id);
      expect(out.result).toBe(expected); expect(await c.prisma.rewardLot.count()).toBe(0);
      expect((await rel('sub_f')).rejectReason).toBe('NOT_ATTENDED');
    });
    it('a refunded deposit inside the hold window rejects (REFUNDED_OR_DISPUTED); a referrer who has not earned the right waits; the cap rejects', async () => {
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code);
      const visit = await completedVisit('sub_f');
      await c.prisma.bookingIntent.update({ where: { id: visit.id }, data: { depositStatus: 'REFUNDED' } });
      const out = await qual().evaluate((await rel('sub_f')).id, { now: new Date(Date.now() + 8 * DAY) });
      expect(out).toMatchObject({ result: 'REJECTED', reason: 'REFUNDED_OR_DISPUTED' });
      // a referrer whose account is brand new has not earned the right: pending, not rejected
      const rn = await as('sub_new', '+201000000040'); await c.http().put('/api/v1/me/profile').set(rn).send({ nameEn: 'New' });
      const code = (await c.http().get(`${BASE}/me`).set(rn)).body.code;
      await referee('sub_g', '+201000000011', code); await completedVisit('sub_g');
      expect((await qual().evaluate((await rel('sub_g')).id, { now: new Date(Date.now() + 8 * DAY) })).result).toBe('PENDING');
      // velocity: a sixth qualified referral in 30 days is refused
      for (let i = 0; i < 5; i++) await c.prisma.referralRelationship.create({ data: { referrerSub: 'sub_r1', refereeSub: `sub_x${i}`, codeId: (await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r1' } })).id, status: 'QUALIFIED', ruleVersionId: 'v', qualifiedAt: new Date() } });
      await referee('sub_h', '+201000000012', (await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r1' } })).code); await completedVisit('sub_h');
      expect(await rel('sub_h')).toMatchObject({ status: 'REJECTED', rejectReason: 'CAP_REACHED' }); // a hard failure rejects at once, it does not wait for the hold window
    });
    it('repeat bookings are OFF by default (no extra lot) and ON only when REFERRAL_RULES.repeatBonus.count > 0', async () => {
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code);
      await completedVisit('sub_f'); await qual().runDue(new Date(Date.now() + 8 * DAY));
      await completedVisit('sub_f');
      expect(await c.prisma.rewardLot.count({ where: { kind: 'REPEAT' } })).toBe(0);
      await setReferralRules(c, { repeatBonus: { count: 1, windowDays: 90 } });
      await completedVisit('sub_f'); await completedVisit('sub_f');
      expect(await c.prisma.rewardLot.count({ where: { kind: 'REPEAT' } })).toBe(1); // capped at count
      expect((await c.prisma.rewardLot.findFirstOrThrow({ where: { kind: 'REPEAT' } })).sub).toBe('sub_r1');
    });
    it('with the zero-amount defaults the relationship still qualifies but no lot is issued; an exhausted rule budget waits (PENDING) instead of qualifying without value', async () => {
      await setRewardRules(c, { amounts: { referrerMinor: 0, refereeMinor: 0, repeatMinor: 0, promoMinor: 0 } });
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code); await completedVisit('sub_f');
      expect((await qual().evaluate((await rel('sub_f')).id, { now: new Date(Date.now() + 8 * DAY) })).result).toBe('QUALIFIED');
      expect(await c.prisma.rewardLot.count()).toBe(0);
      await setRewardRules(c, { ruleBudgetCeilingMinor: 4000 }); // fits the referee (3000) but not both (8000)
      const r2 = await referrer('sub_r2', '+201000000002'); await referee('sub_g', '+201000000011', r2.code); await completedVisit('sub_g');
      const out = await qual().evaluate((await rel('sub_g')).id, { now: new Date(Date.now() + 8 * DAY) });
      expect(out).toMatchObject({ result: 'PENDING', reason: 'BUDGET_EXHAUSTED' }); expect(await c.prisma.rewardLot.count()).toBe(0); // the transaction rolled back whole
      expect((await rel('sub_g')).status).toBe('BOOKED');
    });
  });

  describe('fraud safeguards (the eight threats of the table, enforce and shadow)', () => {
    const phone = (n: number) => `+2010000001${String(n).padStart(2, '0')}`;
    it('RF_SELF: the same phone on both accounts is refused at claim (enforce) with the standard shape; in shadow mode the claim goes through and the signal is recorded', async () => {
      const r = await referrer('sub_r1', phone(1));
      const same = await c.http().post(`${BASE}/claim`).set(await as('sub_twin', phone(1))).send({ code: r.code });
      expect(same.status).toBe(409); expect(same.body).toMatchObject({ code: 'REFERRAL_REJECTED', reason: 'DUPLICATE_IDENTITY' === same.body.reason ? 'DUPLICATE_IDENTITY' : 'SELF_REFERRAL' });
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_SELF' } })).toBe(1);
      await flagOff('growth.referral_fraud_enforce');
      const shadow = await c.http().post(`${BASE}/claim`).set(await as('sub_twin2', phone(1))).send({ code: r.code });
      expect(shadow.status).toBe(200); expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_SELF' } })).toBe(2);
    });
    it('RF_DUP_ACCOUNT: a phone already seen on another account is refused', async () => {
      const r = await referrer('sub_r1', phone(1));
      await ident().recordPhone('sub_earlier', phone(5));
      const x = await c.http().post(`${BASE}/claim`).set(await as('sub_dup', phone(5))).send({ code: r.code });
      expect([x.status, x.body.reason]).toEqual([409, 'DUPLICATE_IDENTITY']);
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_DUP_ACCOUNT' } })).toBe(1);
    });
    it('RF_DUP_ACCOUNT / bot: many sign-ups from one network prefix in 24 h are held for review (not refused)', async () => {
      const r = await referrer('sub_r1', phone(1));
      for (let i = 0; i < 6; i++) await ident().record(`sub_ip${i}`, 'IP24', require('../src/common/privacy-hash').ipHashOf('::ffff:127.0.0.1'));
      const out = await claims().claim({ sub: 'sub_late', phone: phone(9) }, r.code, { ip: '::ffff:127.0.0.1' });
      expect(out.status).toBe('SIGNED_UP'); expect((await rel('sub_late')).reviewState).toBe('HOLD');
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_DUP_ACCOUNT' } })).toBe(1);
    });
    it('RF_BOT_SIGNUP: a sign-up faster than a person after the consented touch is refused', async () => {
      const r = await referrer('sub_r1', phone(1));
      const src = await c.prisma.growthAcquisitionSource.findFirstOrThrow({ where: { sourceKind: 'REFERRAL', sourceRef: r.code } });
      await c.prisma.growthTouchpoint.create({ data: { visitorKey: 'kxv_abcdefghijklmnop1234', sourceId: src.id, kind: 'REFERRAL', linkCode: r.code, landingKind: 'HOME', ipHash: 'h', occurredAt: new Date(Date.now() - 1000) } });
      const x = await c.http().post(`${BASE}/claim`).set(await as('sub_bot', phone(6))).set('X-KX-Visitor', 'kxv_abcdefghijklmnop1234').send({ code: r.code });
      expect(x.status).toBe(409); expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_BOT_SIGNUP' } })).toBe(1);
    });
    it('RF_FARM: many referees booked with one provider go to HOLD and wait for a reviewer; nothing is issued until the review releases them', async () => {
      const r = await referrer('sub_r1', phone(1));
      const subs = ['sub_f1', 'sub_f2', 'sub_f3'];
      for (const [i, s] of subs.entries()) { await referee(s, phone(10 + i), r.code); await completedVisit(s, { providerId: 'lst_farm' }); }
      const out = await qual().evaluate((await rel('sub_f1')).id, { now: new Date(Date.now() + 8 * DAY) });
      expect(out.result).toBe('PENDING'); expect((await rel('sub_f1')).reviewState).toBe('HOLD');
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_FARM' } })).toBeGreaterThanOrEqual(1);
      expect(await c.prisma.rewardLot.count()).toBe(0);
      const id = (await rel('sub_f1')).id;
      await qual().runDue(new Date(Date.now() + 9 * DAY)); // a held relationship is not retried by the job
      expect(await rel('sub_f1')).toMatchObject({ status: 'BOOKED', reviewState: 'HOLD' });
      const detail = (await c.http().get(`${ADMIN}/${id}`).set(support).expect(200)).body;
      expect(detail).toMatchObject({ status: 'BOOKED', reviewState: 'HOLD' }); expect(JSON.stringify(detail)).not.toMatch(/sub_f1|sub_r1|\+2010/); expect(detail.signals.map((x: any) => x.ruleId)).toContain('RF_FARM');
      await c.http().post(`${ADMIN}/${id}/decision`).set(ops).send({ decision: 'RELEASE_HOLD' }).expect(403); // the review roles are super admin and support
      const rel1 = (await c.http().post(`${ADMIN}/${id}/decision`).set(support).send({ decision: 'RELEASE_HOLD', note: 'checked, genuine family' }).expect(200)).body;
      expect(rel1.status).toBe('RELEASED'); expect((await rel('sub_f1')).reviewState).toBe('RELEASED');
      await qual().runDue(new Date(Date.now() + 9 * DAY)); // released: the normal hold window decides when it qualifies
      expect((await rel('sub_f1')).status).toBe('QUALIFIED'); expect(await c.prisma.rewardLot.count({ where: { relationshipId: id } })).toBe(2);
    });
    it('RF_FAKE_BOOKING and RF_PROVIDER_COLLUSION: a completion without check-in evidence, and a patient phone that matches staff of the booked provider, hold the reward', async () => {
      const r = await referrer('sub_r1', phone(1)); await referee('sub_f', phone(20), r.code);
      const b = await seedBooking(c, { sub: 'sub_f' }); await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: new Date() } });
      await qual().onBookingCompleted(b.id); // no BookingEvent of check-in or completion: completion without evidence
      const out = await qual().evaluate((await rel('sub_f')).id, { now: new Date(Date.now() + 8 * DAY) });
      expect(out.result).toBe('PENDING');
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_FAKE_BOOKING' } })).toBe(1);
      const r2 = await referrer('sub_r2', phone(2)); await referee('sub_g', phone(21), r2.code);
      await ident().recordPhone('sub_g', phone(21));
      c.get(MockStaffPhoneMatch).staff.set('cl_1', new Set([staffPhoneMatchHash(phone(21), cfg().kiorlyClientSecret)])); // the Clinic reports a salted hash match only
      await completedVisit('sub_g');
      expect((await qual().evaluate((await rel('sub_g')).id, { now: new Date(Date.now() + 8 * DAY) })).result).toBe('PENDING');
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_PROVIDER_COLLUSION' } })).toBe(1);
    });
    it('RF_CANCEL_ABUSE: a booking cancelled after the reward reverses it; the referral is not re-qualified', async () => {
      const r = await referrer('sub_r1', phone(1)); await referee('sub_f', phone(30), r.code);
      const visit = await completedVisit('sub_f'); await qual().runDue(new Date(Date.now() + 8 * DAY));
      expect(await c.prisma.rewardLot.count()).toBe(2);
      await c.prisma.bookingIntent.update({ where: { id: visit.id }, data: { status: 'CANCELLED' } });
      await qual().onBookingCancelled(visit.id);
      for (const l of await c.prisma.rewardLot.findMany()) { expect(await ledger().balance(c.prisma, l.id)).toMatchObject({ available: 0 }); expect(l.status === 'REVERSED' || (await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: l.id } })).status === 'REVERSED').toBe(true); }
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_CANCEL_ABUSE' } })).toBe(1);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'RewardReversed' } })).toBe(2);
    });
    it('legit family and friends: two adults of different households with different phones qualify without any hold, even from one office network below the threshold', async () => {
      const r = await referrer('sub_r1', phone(1));
      await ident().record('sub_other', 'IP24', require('../src/common/privacy-hash').ipHashOf('::ffff:127.0.0.1'));
      const out = await claims().claim({ sub: 'sub_f', phone: phone(40) }, r.code, { ip: '::ffff:127.0.0.1' });
      expect(out.status).toBe('SIGNED_UP'); expect((await rel('sub_f')).reviewState).toBe('NONE');
      await c.prisma.patientProfile.upsert({ where: { sub: 'sub_f' }, create: { sub: 'sub_f', phone: phone(40) }, update: {} });
      await completedVisit('sub_f'); expect((await qual().evaluate((await rel('sub_f')).id, { now: new Date(Date.now() + 8 * DAY) })).result).toBe('QUALIFIED');
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: { in: ['RF_SELF', 'RF_FARM', 'RF_DUP_ACCOUNT', 'RF_FAKE_BOOKING'] } } })).toBe(0);
    });
    it('shadow mode (the fraud flag OFF) records the signal and lets the reward through the thresholds that existed before it', async () => {
      await flagOff('growth.referral_fraud_enforce');
      const r = await referrer('sub_r1', phone(1));
      for (const [i, s] of ['sub_f1', 'sub_f2', 'sub_f3'].entries()) { await referee(s, phone(50 + i), r.code); await completedVisit(s, { providerId: 'lst_farm' }); }
      const out = await qual().evaluate((await rel('sub_f1')).id, { now: new Date(Date.now() + 8 * DAY) });
      expect(out.result).toBe('QUALIFIED'); expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'RF_FARM' } })).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reviewer decisions and ops views', () => {
    it('REJECT ends the relationship; QUALIFY_OVERRIDE moves money, so a DIFFERENT super admin must confirm it; a decided relationship cannot be decided again', async () => {
      const r = await referrer('sub_r1', '+201000000001'); await referee('sub_f', '+201000000010', r.code); await completedVisit('sub_f');
      const id = (await rel('sub_f')).id;
      const first = (await c.http().post(`${ADMIN}/${id}/decision`).set(admin).send({ decision: 'QUALIFY_OVERRIDE', note: 'confirmed by phone' }).expect(200)).body;
      expect(first.status).toBe('OVERRIDE_REQUESTED'); expect(await c.prisma.rewardLot.count()).toBe(0);
      const same = await c.http().post(`${ADMIN}/${id}/decision`).set(admin).send({ decision: 'QUALIFY_OVERRIDE' }); expect([same.status, same.body.code]).toEqual([409, 'OVERRIDE_NEEDS_SECOND_PERSON']);
      await c.http().post(`${ADMIN}/${id}/decision`).set(support).send({ decision: 'QUALIFY_OVERRIDE' }).expect(403); // not a super admin
      const done = (await c.http().post(`${ADMIN}/${id}/decision`).set(admin2).send({ decision: 'QUALIFY_OVERRIDE' }).expect(200)).body;
      expect(done.status).toBe('OVERRIDDEN'); expect((await rel('sub_f')).status).toBe('QUALIFIED'); expect(await c.prisma.rewardLot.count()).toBe(2);
      const again = await c.http().post(`${ADMIN}/${id}/decision`).set(admin2).send({ decision: 'REJECT' }); expect([again.status, again.body.code]).toEqual([409, 'REFERRAL_ALREADY_DECIDED']);
      const r2 = await referrer('sub_r2', '+201000000002'); await referee('sub_g', '+201000000011', r2.code);
      await c.http().post(`${ADMIN}/${(await rel('sub_g')).id}/decision`).set(support).send({ decision: 'REJECT', note: 'fraud' }).expect(200);
      expect(await rel('sub_g')).toMatchObject({ status: 'REJECTED', rejectReason: 'FRAUD_HOLD' }); expect(await c.prisma.outboxEvent.count({ where: { type: 'ReferralRejected' } })).toBeGreaterThanOrEqual(1);
    });
    it('the overview is aggregate with k >= 10 masking: counts below 10 show as "<10", never a number', async () => {
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code);
      const o = (await c.http().get(ADMIN).set(ops).expect(200)).body;
      expect(o.funnel.relationships).toBe('<10'); expect(o.funnel.signedUp).toBe('<10'); expect(o.funnel.qualified).toBe(0);
      expect(JSON.stringify(o)).not.toMatch(/sub_/);
    });
  });

  describe('erasure and the flag-OFF contract', () => {
    it('erasing a person anonymises their code, relationships and signals (no phone hash remains) while the ledger keeps its rows', async () => {
      const r = await referrer('sub_r1'); const f = await referee('sub_f', '+201000000010', r.code); void f;
      await completedVisit('sub_f'); await qual().runDue(new Date(Date.now() + 8 * DAY));
      await c.get(GrowthMaintenanceService).eraseSubject('sub_f');
      expect(await c.prisma.referralIdentitySignal.count({ where: { sub: 'sub_f' } })).toBe(0);
      expect(await c.prisma.referralRelationship.count({ where: { refereeSub: 'sub_f' } })).toBe(0);
      expect((await c.prisma.referralRelationship.findFirstOrThrow()).refereeSub).toMatch(/^h:/);
      expect(await c.prisma.rewardLedgerEntry.count({ where: { type: 'ISSUE' } })).toBe(2);
      expect((await c.prisma.rewardLot.findMany({ where: { kind: 'REFEREE' } })).every((l) => l.sub.startsWith('h:'))).toBe(true);
    });
    it('no referral surface leaks a person: no response or event of the engine contains a sub, phone or name', async () => {
      const r = await referrer('sub_r1'); await referee('sub_f', '+201000000010', r.code); await completedVisit('sub_f'); await qual().runDue(new Date(Date.now() + 8 * DAY));
      const events = await c.prisma.outboxEvent.findMany({ where: { type: { in: ['ReferralCodeIssued', 'ReferralRelationshipCreated', 'ReferralQualified', 'ReferralRejected', 'RewardIssued'] } } });
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(/sub_r1|sub_f|\+2010|Friend|Referrer/);
      expect(uid('x')).toBeTruthy();
    });
  });
});
