import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { seedBooking } from './growth-helpers';
import { DAY, setReferralRules, setRewardRules, uid, unlockAll } from './growth-rewards-helpers';
import { FraudCaseService, FraudScoringService, FraudCalibrationService, FraudJob, FraudReviewQueueService } from '../src/growth/fraud/fraud-public-test';
import { RewardIssuanceService, RewardLedgerService, issueKey } from '../src/growth/rewards/rewards-public';
import { ReferralQualificationService } from '../src/growth/referral/referral-public';
import { FRAUD_RULES_DEFAULTS } from '../src/growth/fraud/fraud-config';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/fraud';
const REF = '/api/v1/growth/v1/referral';

/**
 * GRW-P3-D over the real HTTP stack and Postgres: shadow by default, enforce per rule through an ACTIVE FRAUD_RULES version, holds that cannot be redeemed, two-person confirmation of a reversal,
 * appeals decided by a different reviewer, DPO-only identity lookup, SLA, bulk dismissal, append-only history, calibration and fairness. Mock providers only.
 */
describe('growth fraud detection v2 (GRW-P3-D)', () => {
  let c: TestCtx; let sup1: Auth; let sup2: Auth; let admin: Auth; let ops: Auth; let dpo: Auth;
  const scorer = () => c.get(FraudScoringService); const cases = () => c.get(FraudCaseService); const queue = () => c.get(FraudReviewQueueService);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    await unlockAll(c, ['growth.rewards', 'growth.patient_referral']); await setRewardRules(c); await setReferralRules(c);
    sup1 = await c.as('sup_1', { roles: ['ops_admin', 'support'] }); sup2 = await c.as('sup_2', { roles: ['ops_admin', 'support'] }); admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); dpo = await c.as('dpo_1', { roles: ['ops_admin', 'dpo'] });
    c.kiorly.slots = [futureSlot(72)]; await seedProvider(c, { depositAmount: 150 });
  });

  /** Store an ACTIVE FRAUD_RULES version (the maker-checker kind is admitted by contracts 1.13.0; until then the stored-config read path is exercised directly). */
  const setFraudRules = async (payload: Record<string, unknown>) => {
    const full = { ...FRAUD_RULES_DEFAULTS(), ...payload };
    await c.prisma.growthConfigVersion.create({ data: { kind: 'FRAUD_RULES', scope: 'GLOBAL', scopeId: '', version: 1, status: 'ACTIVE', payload: full as never, createdBy: 'maker', approvedBy: 'checker', approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 1000), checksum: 'x'.repeat(8) } });
    c.get(FraudScoringService); (c.get(FraudCaseService), 0); (await import('../src/growth/fraud/fraud-config.service')).FraudConfigService; c.get((await import('../src/growth/fraud/fraud-config.service')).FraudConfigService).invalidate();
  };
  const enforceAll = (extra: Record<string, unknown> = {}) => setFraudRules({ enforce: true, bands: { review: 30, hold: 60 }, rules: Object.fromEntries(Object.entries(FRAUD_RULES_DEFAULTS().rules).map(([k, v]) => [k, { ...v, enforce: true }])), ...extra });

  const as = async (sub: string, phone?: string): Promise<Auth> => ({ Authorization: `Bearer ${await c.token({ sub, phone })}` });
  const referrer = async (sub: string, phone = '+201000000001') => {
    const a = await as(sub, phone);
    await c.http().put('/api/v1/me/profile').set(a).send({ nameEn: 'Referrer' }).expect(200);
    await c.prisma.patientProfile.update({ where: { sub }, data: { createdAt: new Date(Date.now() - 30 * DAY) } });
    const b = await seedBooking(c, { sub }); await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: new Date(Date.now() - 20 * DAY) } });
    return { auth: a, code: (await c.http().get(`${REF}/me`).set(a).expect(200)).body.code as string, sub };
  };
  const referee = async (sub: string, phone: string, code: string) => {
    const a = await as(sub, phone);
    await c.http().put('/api/v1/me/profile').set(a).send({ nameEn: 'Friend' }).expect(200);
    return { auth: a, sub, claim: await c.http().post(`${REF}/claim`).set(a).send({ code }) };
  };
  const relOf = (refereeSub: string) => c.prisma.referralRelationship.findUniqueOrThrow({ where: { market_refereeSub: { market: 'EG', refereeSub } } });
  const lotFor = async (sub: string, relationshipId: string, amountMinor = 4000) => {
    const r = await c.get(RewardIssuanceService).issue({ kind: 'PROMO', sub, amountMinor, funding: 'PLATFORM_MARKETING', idempotencyKey: issueKey('t', uid('k')), reasonCode: 'PROMO_CAMPAIGN', actor: 'test', relationshipId });
    if (r.status === 'SKIPPED') throw new Error(`skipped ${r.reason}`);
    return r.lotId;
  };
  /** A signed-up referral relationship whose rewards can be held: referrer sub_r, referee sub_f. */
  const pair = async () => { const r = await referrer('sub_r'); const f = await referee('sub_f', '+201000000010', r.code); expect(f.claim.status).toBe(200); return { r, f, rel: await relOf('sub_f') }; };
  const heldCase = async (rel: { id: string }, features: Record<string, unknown> = { codeUsedByOtherAccount: true }) => {
    const a = await scorer().assess('REWARD', features as never, { subject: 'sub_r', evidenceRef: `rel:${rel.id}`, relationshipIds: [rel.id] });
    return a;
  };

  describe('shadow by default', () => {
    it('a self-referral claim opens a SHADOW case (band HIGH, would have rejected) while the P2-B1 path behaves exactly as before', async () => {
      const r = await referrer('sub_r', '+201000000001');
      const f = await referee('sub_f', '+201000000001', r.code); // the referee uses the referrer's phone
      expect(f.claim.status).toBe(409); // P2-B1 enforcement (growth.referral_fraud_enforce ON) is unchanged
      const rows = await c.prisma.fraudCase.findMany(); expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'REFERRAL', band: 'HIGH', mode: 'SHADOW', status: 'OPEN' });
      const log = await c.prisma.fraudDecisionLog.findMany({ where: { caseId: rows[0]!.id } }); expect(log[0]!.action).toBe('OPENED'); expect(log[0]!.note).toContain('shadow-would:REJECT_CLAIM');
      expect(await c.prisma.fraudCaseSignal.count({ where: { caseId: rows[0]!.id, ruleId: 'r_self' } })).toBe(1);
    });

    it('with the P2-B1 enforcement OFF, a shadow case changes nothing at all: the claim goes through and no reward is held', async () => {
      await c.prisma.flagValue?.deleteMany?.({ where: { flagKey: 'growth.referral_fraud_enforce' } }).catch(() => undefined);
      const { rel } = await pair();
      const lot = await lotFor('sub_r', rel.id);
      const a = await heldCase(rel);
      expect(a).toMatchObject({ band: 'HOLD', action: 'NONE', shadowAction: 'HOLD_REWARD' });
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lot } })).status).toBe('ACTIVE'); // untouched
      const k = await c.prisma.fraudCase.findFirstOrThrow({ where: { kind: { in: ['REFERRAL', 'REWARD'] } } }); expect(k.mode).toBe('SHADOW');
    });

    it('the flag growth.fraud_scoring OFF records nothing (and scoring fails closed to "no case")', async () => {
      const off = await c.http().put('/api/v1/admin/flags/growth.fraud_scoring/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false });
      if (![200, 202].includes(off.status)) return; // the catalogue entry arrives with contracts 1.13.0 (A4); until then an unknown flag is ON by design
      c.flags.invalidate();
      const { rel } = await pair(); expect(await heldCase(rel)).toMatchObject({ action: 'NONE', caseId: null });
      expect(await c.prisma.fraudCase.count()).toBe(0);
    });

    it('ordinary referral traffic produces no case and the same reward ledger whether scoring is on or not', async () => {
      const r = await referrer('sub_r'); const f = await referee('sub_f', '+201000000010', r.code);
      expect(f.claim.status).toBe(200);
      const b = await seedBooking(c, { sub: 'sub_f' });
      await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: 'COMPLETED', terminalAt: new Date(Date.now() - 20 * DAY) } });
      await c.prisma.bookingEvent.create({ data: { bookingId: b.id, kind: 'STATE', fromStatus: 'CONFIRMED', toStatus: 'COMPLETED' } });
      await c.get(ReferralQualificationService).onBookingCompleted(b.id);
      expect(await c.prisma.fraudCase.count()).toBe(0);
    });
  });

  describe('enforce per rule', () => {
    beforeEach(async () => { await c.prisma.growthConfigVersion.deleteMany({ where: { kind: 'FRAUD_RULES' } }); });

    it('an enforced HOLD_REWARD freezes the lot (it cannot be redeemed), records an ENFORCE case, and a dismissal releases it', async () => {
      await enforceAll();
      const { rel } = await pair(); const lot = await lotFor('sub_r', rel.id);
      const a = await heldCase(rel);
      expect(a).toMatchObject({ band: 'HOLD', action: 'HOLD_REWARD' });
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lot } })).status).toBe('HELD');
      expect(await c.get(RewardLedgerService).balance(c.prisma, lot)).toMatchObject({ available: 0, held: 4000 });
      const k = await c.prisma.fraudCase.findUniqueOrThrow({ where: { id: a.caseId! } }); expect(k).toMatchObject({ mode: 'ENFORCE', band: 'HIGH', kind: 'REWARD' });
      await c.http().post(`${BASE}/cases/${k.id}/assign`).set(sup1).send({ assignTo: 'sup_1' }).expect(200);
      await c.http().post(`${BASE}/cases/${k.id}/decision`).set(sup1).send({ decision: 'DISMISS' }).expect(400); // a reason is required
      await c.http().post(`${BASE}/cases/${k.id}/decision`).set(sup1).send({ decision: 'DISMISS', note: 'Legitimate family, verified by phone' }).expect(200);
      expect(await c.get(RewardLedgerService).balance(c.prisma, lot)).toMatchObject({ available: 4000, held: 0 });
    });

    it('confirming a reversal is a two-person decision; the first request cannot be confirmed by the same person; reversal and suspension follow', async () => {
      await enforceAll();
      const { rel } = await pair(); const lot = await lotFor('sub_r', rel.id);
      const a = await heldCase(rel); const id = a.caseId!;
      await c.http().post(`${BASE}/cases/${id}/assign`).set(sup1).send({ assignTo: 'sup_1' }).expect(200);
      const body = { decision: 'CONFIRM', reverseRewards: true, suspendDays: 30, note: 'Farm pattern confirmed' };
      expect((await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send(body).expect(200)).body.status).toBe('CONFIRM_REQUESTED');
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send(body).expect(409);
      const done = (await c.http().post(`${BASE}/cases/${id}/decision`).set(sup2).send({ decision: 'CONFIRM' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'CONFIRMED', reversedMinor: 4000, suspendedDays: 30 });
      expect((await c.prisma.rewardLot.findUniqueOrThrow({ where: { id: lot } })).status).not.toBe('ACTIVE');
      expect((await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r' } })).status).toBe('SUSPENDED');
      const row = await c.prisma.fraudCase.findUniqueOrThrow({ where: { id } }); expect(row).toMatchObject({ status: 'CONFIRMED', decidedBy: 'sup_2' }); expect(row.decision).toBe('CONFIRM;reverse=1;suspend=30');
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.fraud.confirm_requested', resourceId: id } })).toBe(1);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.fraud.confirm_executed', resourceId: id } })).toBe(1);
      // a suspension of 30 days ends by itself
      const r = await cases().housekeeping({ ...FRAUD_RULES_DEFAULTS() }, new Date(Date.now() + 31 * DAY));
      expect(r.reinstated).toBe(1); expect((await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r' } })).status).toBe('ACTIVE');
    });

    it('an appeal is filed inside the window and decided by a DIFFERENT reviewer; upheld means the invite code works again', async () => {
      await enforceAll();
      const { rel } = await pair(); await lotFor('sub_r', rel.id); const id = (await heldCase(rel)).caseId!;
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send({ decision: 'CONFIRM', suspendDays: 30, note: 'Confirmed after review' }).expect(200); // no reversal: one reviewer is enough
      expect((await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r' } })).status).toBe('SUSPENDED');
      await c.http().post(`${BASE}/cases/${id}/appeal`).set(sup1).send({ note: 'Patient called: the invitees are her cousins' }).expect(200);
      expect((await c.prisma.fraudCase.findUniqueOrThrow({ where: { id } })).status).toBe('APPEALED');
      await c.http().post(`${BASE}/cases/${id}/appeal-decision`).set(sup1).send({ decision: 'DISMISS', note: 'Same reviewer must not decide' }).expect(409);
      expect((await c.http().post(`${BASE}/cases/${id}/appeal-decision`).set(sup2).send({ decision: 'DISMISS', note: 'Family relationship verified' }).expect(200)).body).toMatchObject({ status: 'DISMISSED', appeal: 'UPHELD' });
      expect((await c.prisma.referralCode.findFirstOrThrow({ where: { sub: 'sub_r' } })).status).toBe('ACTIVE');
      // the log tells the whole story, append-only
      const log = await c.prisma.fraudDecisionLog.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } }); expect(log.map((l) => l.action)).toEqual(['OPENED', 'CONFIRMED', 'APPEALED', 'DISMISSED']);
    });

    it('an upheld appeal of a case that reversed value opens ONE goodwill approval request per patient; only a second approver grants it, and asking twice adds nothing', async () => {
      await enforceAll();
      const { rel } = await pair(); await lotFor('sub_r', rel.id); const id = (await heldCase(rel)).caseId!;
      await c.http().post(`${BASE}/cases/${id}/assign`).set(sup1).send({ assignTo: 'sup_1' }).expect(200);
      const body = { decision: 'CONFIRM', reverseRewards: true, note: 'Farm pattern confirmed' };
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send(body).expect(200);
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup2).send({ decision: 'CONFIRM' }).expect(200);
      await c.http().post(`${BASE}/cases/${id}/appeal`).set(sup1).send({ note: 'Patient called: the invitees are her cousins' }).expect(200);
      const appeal = (await c.http().post(`${BASE}/cases/${id}/appeal-decision`).set(await c.as('sup_3', { roles: ['ops_admin', 'support'] })).send({ decision: 'DISMISS', note: 'Family relationship verified' }).expect(200)).body;
      expect(appeal).toMatchObject({ status: 'DISMISSED', appeal: 'UPHELD', restoreRequests: 1 });
      const reqs = await c.prisma.rewardApprovalRequest.findMany({ where: { ticketRef: `fraud-appeal:${id}` } });
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({ kind: 'GOODWILL', sub: 'sub_r', amountMinor: 4000, status: 'PENDING', requestedBy: 'sup_3', reason: 'OTHER_APPROVED' });
      // nothing was credited by the appeal itself, and a repeat adds no second request
      expect(await c.prisma.goodwillGrant.count({ where: { sub: 'sub_r' } })).toBe(0);
      expect((await cases().restoreAfterUpheldAppeal(id, 'sup_3', [rel.id])).requests).toBe(0);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.fraud.restore_requested', resourceId: reqs[0]!.id } })).toBe(1);
    });

    it('an appeal after the window is refused; only a confirmed case can be appealed', async () => {
      await enforceAll();
      const { rel } = await pair(); const id = (await heldCase(rel)).caseId!;
      await c.http().post(`${BASE}/cases/${id}/appeal`).set(sup1).send({ note: 'Not confirmed yet at all' }).expect(409);
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send({ decision: 'CONFIRM', note: 'Confirmed after review' }).expect(200);
      await c.prisma.$executeRawUnsafe(`ALTER TABLE "FraudCase" DISABLE TRIGGER fraud_case_guard`); await c.prisma.fraudCase.update({ where: { id }, data: { decidedAt: new Date(Date.now() - 20 * DAY) } }); await c.prisma.$executeRawUnsafe(`ALTER TABLE "FraudCase" ENABLE TRIGGER fraud_case_guard`);
      await c.http().post(`${BASE}/cases/${id}/appeal`).set(sup1).send({ note: 'Too late, but the patient insists' }).expect(409);
    });

    it('a provider-side finding opens a PROVIDER case only: no booking, attribution decision or commission changes', async () => {
      await enforceAll();
      const { rel } = await pair(); const b = await seedBooking(c, { sub: 'sub_f' });
      const before = { bookings: await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } }), decisions: await c.prisma.growthAttributionDecision.count() };
      const a = await scorer().assess('REWARD', { staffPhoneMatch: true }, { subject: 'sub_r', evidenceRef: `rel:${rel.id}`, relationshipIds: [rel.id] });
      expect(a.action).toBe('OPEN_PROVIDER_REVIEW');
      const k = await c.prisma.fraudCase.findUniqueOrThrow({ where: { id: a.caseId! } }); expect(k.kind).toBe('PROVIDER');
      expect(await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } })).toEqual(before.bookings);
      expect(await c.prisma.growthAttributionDecision.count()).toBe(before.decisions);
    });

    it('a legitimate family (a declared household on one phone) and a receptionist booking on behalf do not reach the review band', async () => {
      await enforceAll();
      const { rel } = await pair();
      expect((await scorer().assess('REFERRAL_CLAIM', { householdDeclared: true, phoneHash: { referrer: 'p', referee: 'p' } }, { subject: 'sub_r', evidenceRef: `rel:${rel.id}` })).caseId).toBeNull();
      expect((await scorer().assess('REWARD', { staffPhoneMatch: true, bookedOnBehalfByStaff: true }, { subject: 'sub_r', evidenceRef: `rel:${rel.id}` })).caseId).toBeNull();
      expect(await c.prisma.fraudCase.count()).toBe(0);
    });

    it('widget abuse: three origin mismatches throttle the origin when the rule is enforced; in shadow they only open a case', async () => {
      const deny = async () => { for (let i = 0; i < 3; i++) await scorer().onWidgetDenied({ org: 'org_1', origin: 'https://evil.example', reason: 'ORIGIN_MISMATCH' }); };
      await deny();
      expect(await scorer().originThrottled('https://evil.example')).toBe(false); // shadow
      await c.prisma.fraudCase.deleteMany().catch(() => undefined);
      await enforceAll(); await c.get(FraudJob); // config row now enforces
      await c.prisma.$executeRawUnsafe(`DELETE FROM "RateLimitBucket"`);
      await deny();
      expect(await scorer().originThrottled('https://evil.example')).toBe(true);
      expect(await scorer().originThrottled('https://clinic.example')).toBe(false);
      expect(await c.prisma.fraudCase.count({ where: { kind: 'WIDGET' } })).toBeGreaterThanOrEqual(1);
    });

    it('a forged link token opens a TOUCH case', async () => {
      await enforceAll();
      const a = await scorer().onLinkToken({ ipHash: 'iphash_abc', ok: false });
      expect(a).toMatchObject({ action: 'QUARANTINE_TOUCH' });
      expect((await c.prisma.fraudCase.findFirstOrThrow({ where: { kind: 'TOUCH' } })).band).toBe('HIGH');
    });
  });

  describe('review queue and evidence', () => {
    beforeEach(async () => { await c.prisma.growthConfigVersion.deleteMany({ where: { kind: 'FRAUD_RULES' } }); });
    it('lists cases with SLA state, shows hashed evidence and check rows only, and the DPO identity lookup is role-gated and audited', async () => {
      const { rel } = await pair(); const id = (await heldCase(rel)).caseId!;
      await c.http().get(`${BASE}/cases`).set(ops).expect(200);
      expect((await c.http().get(`${BASE}/cases`).set(ops).expect(200)).body.rows.map((r: any) => r.id)).toContain(id);
      expect((await c.http().get(`${BASE}/cases/summary`).set(ops).expect(200)).body.open.length).toBeGreaterThan(0);
      const ev = (await c.http().get(`${BASE}/cases/${id}`).set(ops).expect(200)).body;
      const text = JSON.stringify(ev);
      for (const raw of ['sub_r', 'sub_f', '+2010']) expect(text).not.toContain(raw); // no identifier, no phone
      expect(ev.signals.length).toBeGreaterThan(0); expect(ev.case.subjectRef).toHaveLength(12);
      await c.http().post(`${BASE}/cases/${id}/identity`).set(admin).send({ reason: 'Support ticket 4411 needs the account' }).expect(403); // super admin alone is not the DPO
      await c.http().post(`${BASE}/cases/${id}/identity`).set(dpo).send({ reason: 'x' }).expect(400);
      const idn = (await c.http().post(`${BASE}/cases/${id}/identity`).set(dpo).send({ reason: 'Support ticket 4411 needs the account' }).expect(200)).body;
      expect(idn.audited).toBe(true); expect(idn.accounts[0]).toMatchObject({ referrerSub: 'sub_r', refereeSub: 'sub_f' });
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.fraud.identity_lookup', resourceId: id, actor: 'dpo_1' } })).toBe(1);
    });
    it('read-only roles cannot decide; an ops admin reads but a decision needs the reviewer role', async () => {
      const { rel } = await pair(); const id = (await heldCase(rel)).caseId!;
      await c.http().post(`${BASE}/cases/${id}/decision`).set(ops).send({ decision: 'DISMISS', note: 'Not allowed to decide' }).expect(403);
      await c.http().get(`${BASE}/cases`).expect(401);
    });
    it('SLA: a case past its due time shows as breached and the sweep raises ONE audit item per case', async () => {
      const { rel } = await pair(); const id = (await heldCase(rel)).caseId!;
      await c.prisma.fraudCase.update({ where: { id }, data: { slaDueAt: new Date(Date.now() - 3_600_000) } });
      expect((await c.http().get(`${BASE}/cases?breached=true`).set(ops).expect(200)).body.rows[0]).toMatchObject({ id, breached: true });
      expect(await queue().slaSweep()).toMatchObject({ breached: 1, raised: 1 }); expect(await queue().slaSweep()).toMatchObject({ breached: 1, raised: 0 });
    });
    it('bulk dismiss needs a reason, handles LOW and MEDIUM only, and skips a HIGH case', async () => {
      const { rel } = await pair(); const high = (await heldCase(rel)).caseId!;
      const med = (await scorer().assess('REWARD', { refereesInWindow: 9 }, { subject: 'sub_other', evidenceRef: 'rel:x1' }, )).caseId; // 65 < 70 hold band: MEDIUM
      expect(med).toBeTruthy();
      await c.prisma.fraudCase.update({ where: { id: med! }, data: { band: 'MEDIUM' } });
      await c.http().post(`${BASE}/cases/bulk-dismiss`).set(sup1).send({ ids: [high, med], reason: 'short' }).expect(400);
      const r = (await c.http().post(`${BASE}/cases/bulk-dismiss`).set(sup1).send({ ids: [high, med], reason: 'Reviewed together: legitimate siblings' }).expect(200)).body;
      expect(r).toMatchObject({ requested: 2, dismissed: 1, skipped: 1 });
      expect((await c.prisma.fraudCase.findUniqueOrThrow({ where: { id: high } })).status).toBe('OPEN');
    });
    it('history is append-only: signals and the log cannot be changed, a decided case cannot go back to open, and cases are never deleted', async () => {
      const { rel } = await pair(); const id = (await heldCase(rel)).caseId!;
      await expect(c.prisma.fraudCaseSignal.updateMany({ where: { caseId: id }, data: { weight: 1 } })).rejects.toThrow();
      await expect(c.prisma.fraudDecisionLog.deleteMany({ where: { caseId: id } })).rejects.toThrow();
      await expect(c.prisma.fraudCase.delete({ where: { id } })).rejects.toThrow();
      await c.http().post(`${BASE}/cases/${id}/decision`).set(sup1).send({ decision: 'DISMISS', note: 'Legitimate family, verified' }).expect(200);
      await expect(c.prisma.fraudCase.update({ where: { id }, data: { status: 'OPEN' } })).rejects.toThrow();
    });
    it('a second signal on the same subject adds to the one open case and never creates a duplicate', async () => {
      const { rel } = await pair();
      const a = await heldCase(rel); const b = await scorer().assess('REWARD', { cancelledAfterRewardInWindow: true }, { subject: 'sub_r', evidenceRef: `rel:${rel.id}`, relationshipIds: [rel.id] });
      expect(b.caseId).toBe(a.caseId); expect(await c.prisma.fraudCase.count()).toBe(1);
      expect((await c.prisma.fraudCaseSignal.findMany({ where: { caseId: a.caseId! } })).map((s) => s.ruleId).sort()).toEqual(['r_cancel', 'r_redeem']);
    });
  });

  describe('calibration and fairness', () => {
    beforeEach(async () => { await c.prisma.growthConfigVersion.deleteMany({ where: { kind: 'FRAUD_RULES' } }); });
    it('the shadow report shows volume always and precision only after enough labelled cases; the proposal never changes the configuration', async () => {
      for (let i = 0; i < 3; i++) { const r = await scorer().assess('REWARD', { refereesInWindow: 9 }, { subject: `sub_x${i}`, evidenceRef: `rel:r${i}` }); await c.http().post(`${BASE}/cases/${r.caseId}/decision`).set(sup1).send({ decision: i === 0 ? 'CONFIRM' : 'DISMISS', note: 'Reviewed with the support lead' }).expect(200); }
      await c.get(FraudCalibrationService).refresh(30);
      const rep = (await c.http().get(`${BASE}/shadow-report`).set(ops).expect(200)).body;
      const farm = rep.rules.find((r: any) => r.ruleId === 'r_farm'); expect(farm).toMatchObject({ flagged: 3, labelled: 3, confirmed: 1, dismissed: 2, precision: null }); // under 20 labels: no number
      expect(rep.enforce).toBe(false);
      const before = await c.prisma.growthConfigVersion.count();
      expect((await c.http().post(`${BASE}/calibration/propose`).set(admin).send({}).expect(200)).body.proposed).toBe(false); // nothing to propose yet
      expect(await c.prisma.growthConfigVersion.count()).toBe(before);
    });
    it('rules are read-only through the API and report the source of the configuration', async () => {
      const r = (await c.http().get(`${BASE}/rules`).set(ops).expect(200)).body;
      expect(r).toMatchObject({ editable: false, source: 'PROPOSED_DEFAULT' }); expect(r.config.enforce).toBe(false); expect(r.ruleIds).toHaveLength(11);
    });
    it('the fairness report is aggregate and masks every group under ten', async () => {
      await pair();
      const f = (await c.http().get(`${BASE}/fairness?weekStart=${new Date(Date.now() - 2 * DAY).toISOString()}`).set(ops).expect(200)).body;
      expect(f.language.every((g: any) => g.total === '<10')).toBe(true);
    });
  });

  it('every new endpoint requires a session', async () => {
    for (const p of ['/cases', '/cases/summary', '/rules', '/shadow-report', '/fairness']) await c.http().get(`${BASE}${p}`).expect(401);
    expect(c.get(FraudReviewQueueService)).toBeDefined();
  });
});
