import { createCtx, TestCtx } from './harness';
import { activateConfig, DAY, registerLink, unlockFlag } from './growth-helpers';
import { CampaignSchedulerService } from '../src/growth/campaigns/campaign-scheduler.service';
import { CampaignBudgetService } from '../src/growth/campaigns/campaign-budget.service';
import { CampaignService, SYSTEM } from '../src/growth/campaigns/campaign.service';
import { GrowthSpendService } from '../src/growth/growth-public';
import { GrowthRollupService } from '../src/growth/growth-public';
import { GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { marketTimezone, nextDayBoundary } from '../src/growth/campaigns/market-day';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/campaigns';
const SPEND = '/api/v1/ops/growth-analytics/spend';
const TOUCH = '/api/v1/growth/v1/touch';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const policy = (o: Record<string, unknown> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.CAMPAIGN_POLICY as object), ...o }) as Record<string, unknown>;

/**
 * GRW-P2-A: the campaign engine over the real HTTP stack and Postgres: lifecycle with maker-checker and a second admin, approval invalidation, ceiling, budget alerts and auto pause, daily cap rollover at Cairo midnight,
 * scheduler idempotency, flag-OFF contract, role matrix, spend de-duplication, creative references, the UTM touch tag, report numbers equal the tables, the campaign dimension of the rollup.
 */
describe('growth campaigns (GRW-P2-A)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth; let patient: Auth;
  const sched = () => c.get(CampaignSchedulerService); const budget = () => c.get(CampaignBudgetService);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); delete process.env.GROWTH_RATE_TOUCH_PER_MIN;
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('p_1');
  });
  const now = () => new Date();
  const body = (o: Record<string, unknown> = {}) => ({ key: `camp-${Math.random().toString(36).slice(2, 8)}`, name: 'Ramadan check-up', objective: 'ACQUISITION', budgetTotalMinor: 1_000_000, budgetDailyMinor: 200_000, channels: ['EMAIL'], startsAt: new Date(now().getTime() - 3_600_000).toISOString(), endsAt: new Date(now().getTime() + 30 * DAY).toISOString(), ...o });
  const create = async (o: Record<string, unknown> = {}, who: Auth = A) => (await c.http().post(BASE).set(who).send(body(o)).expect(201)).body;
  const get = async (id: string) => (await c.http().get(`${BASE}/${id}`).set(A).expect(200)).body;
  const flagOff = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/values`).set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).then((r) => { c.flags.invalidate(); return r; });
  const approvalFlagOff = async () => { const r = await flagOff('growth.campaign_approval_required'); expect([200, 202]).toContain(r.status); };
  const approveFlow = async (id: string) => {
    const a = (await c.http().post(`${BASE}/${id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body;
    return (await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: a.snapshotHash }).expect(200)).body;
  };
  const spendLine = async (id: string, amountMinor: number, who: Auth = A, approver: Auth | null = B, day?: string) => {
    const r = (await c.http().post(`${BASE}/${id}/spend`).set(who).send({ day: day ?? new Date().toISOString().slice(0, 10), amountMinor }).expect(201)).body;
    if (approver) await c.http().post(`${SPEND}/${r.id}/approve`).set(approver).expect(200);
    return r;
  };
  const activeCampaign = async (o: Record<string, unknown> = {}) => { const k = await create(o); await approveFlow(k.id); await sched().runOnce(now()); expect((await get(k.id)).status).toBe('ACTIVE'); return k; };

  describe('create and validation', () => {
    it('creates a DRAFT with its UTM tag, tracked links, audit row and CampaignCreated event; the key is unique per market', async () => {
      const k = await create({ key: 'ramadan-checkup', utmConfig: { targetPath: '/doctors', content: 'banner-a' } });
      expect(k).toMatchObject({ status: 'DRAFT', utmCampaign: 'eg-ramadan-checkup', market: 'EG', currency: 'EGP', ownerSub: 'adm_a', version: 1 });
      expect(k.links.webUrl).toBe('https://kiorex.com/ar/eg/doctors?utm_source=kiorex&utm_medium=email&utm_campaign=eg-ramadan-checkup&utm_content=banner-a');
      expect(k.approval.required).toBe(true); expect(k.approval.reasons).toEqual(['POLICY_FLAG']);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.campaign.create', resourceId: k.id } })).toBe(1);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'CampaignCreated', aggregateId: k.id } })).toBe(1);
      const dup = await c.http().post(BASE).set(A).send(body({ key: 'ramadan-checkup' })); expect(dup.status).toBe(409); expect(dup.body.code).toBe('CAMPAIGN_KEY_TAKEN');
    });
    it.each([
      ['a bad key', { key: 'Bad Key' }, 400], ['a zero budget', { budgetTotalMinor: 0 }, 400], ['a negative budget', { budgetTotalMinor: -5 }, 400], ['a non-integer budget', { budgetTotalMinor: 10.5 }, 400],
      ['a daily cap above the total', { budgetDailyMinor: 2_000_000 }, 422], ['an unknown channel', { channels: ['TELEPATHY'] }, 400], ['no channel', { channels: [] }, 422],
      ['an end before the start', { startsAt: '2027-02-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' }, 422],
      ['a specialty in the audience', { eligibility: { specialty: ['cardiology'] } }, 422], ['a provider in the audience', { eligibility: { providerId: 'x' } }, 422], ['a diagnosis in the audience', { eligibility: { diagnosis: ['x'] } }, 422],
      ['an unknown UTM key', { utmConfig: { surprise: 'x' } }, 422], ['an upper-case UTM token', { utmConfig: { source: 'UPPER' } }, 422], ['an absolute target path', { utmConfig: { targetPath: 'https://evil.example/' } }, 422],
    ])('%s is refused', async (_n, o, status) => { const r = await c.http().post(BASE).set(A).send(body(o as Record<string, unknown>)); expect(r.status).toBe(status); });
    it('the validation error lists the failing fields', async () => {
      const r = await c.http().post(BASE).set(A).send(body({ budgetDailyMinor: 2_000_000, eligibility: { specialty: ['x'] } })).expect(422);
      expect(r.body.code).toBe('CAMPAIGN_INVALID'); expect(JSON.stringify(r.body.errors)).toMatch(/daily cap|not an allowed eligibility key/);
    });
    it('only super admins write; ops_admin reads; patients and anonymous callers are refused', async () => {
      const k = await create();
      expect((await c.http().post(BASE).set(ops).send(body())).status).toBe(403);
      expect((await c.http().patch(`${BASE}/${k.id}`).set(ops).send({ version: 1, name: 'x' })).status).toBe(403);
      expect((await c.http().post(`${BASE}/${k.id}/transition`).set(ops).send({ to: 'ARCHIVED', reasonCode: 'X' })).status).toBe(403);
      expect((await c.http().get(BASE).set(ops)).status).toBe(200); expect((await c.http().get(`${BASE}/${k.id}`).set(ops)).status).toBe(200); const opsReport = await c.http().get(`${BASE}/${k.id}/report`).set(ops).expect(200); expect(opsReport.body.revenue).toMatchObject({ netMinor: null, restricted: true }); expect(opsReport.body.kpis.roas.values.roas).toBeNull(); // revenue is a finance view
      expect((await c.http().get(BASE).set(patient)).status).toBe(403); expect((await c.http().get(BASE)).status).toBe(401);
    });
    it('unknown and malformed ids are 404, never 5xx', async () => {
      for (const id of ['nope', 'x'.repeat(80), '%00', '..%2f..']) { const r = await c.http().get(`${BASE}/${id}`).set(A); expect([400, 404]).toContain(r.status); }
      expect((await c.http().post(`${BASE}/approvals/nope/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: 'a'.repeat(64) })).status).toBe(404);
    });
    it('promotional filter lists only objective PROMOTION', async () => {
      await create({ objective: 'PROMOTION', name: 'Promo' }); await create({ objective: 'AWARENESS' });
      const r = (await c.http().get(`${BASE}?promotional=1`).set(A).expect(200)).body; expect(r).toHaveLength(1); expect(r[0].objective).toBe('PROMOTION');
    });
  });

  describe('lifecycle with maker-checker', () => {
    it('draft, approval request, second admin approves, schedule, scheduler activates, pause, resume, complete at the end date, archive; every step in history and in the audit log', async () => {
      const k = await create({ key: 'full-cycle' });
      const bad = await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'SCHEDULED' }); expect(bad.status).toBe(409); expect(bad.body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');
      const ask = (await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body;
      expect((await get(k.id)).status).toBe('PENDING_APPROVAL');
      expect((await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: 2, name: 'Edit while pending' })).status).toBe(409); // locked while an approval is open
      const self = await c.http().post(`${BASE}/approvals/${ask.id}/decide`).set(A).send({ decision: 'APPROVED', snapshotHash: ask.snapshotHash }); expect(self.status).toBe(403); expect(self.body.code).toBe('CAMPAIGN_SELF_APPROVAL');
      const stale = await c.http().post(`${BASE}/approvals/${ask.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: 'f'.repeat(64) }); expect(stale.status).toBe(409);
      const ok = (await c.http().post(`${BASE}/approvals/${ask.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: ask.snapshotHash }).expect(200)).body;
      expect(ok).toMatchObject({ decision: 'APPROVED', decidedBy: 'adm_b' });
      expect((await c.http().post(`${BASE}/approvals/${ask.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: ask.snapshotHash })).status).toBe(422); // already decided
      let s = await get(k.id); expect(s.status).toBe('SCHEDULED'); expect(s.approval.current).toBe(true); expect(s.autoExpiresAt).toBeTruthy();
      const r1 = await sched().runOnce(now()); expect(r1.activated).toBe(1);
      s = await get(k.id); expect(s.status).toBe('ACTIVE'); expect(s.activatedAt).toBeTruthy();
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'PAUSED' }).expect(422); // a person needs a reason
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'PAUSED', reason: 'Agency asked for a pause', reasonCode: 'OPS_REASON' }).expect(200);
      expect((await get(k.id)).status).toBe('PAUSED');
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' }).expect(200);
      const end = new Date((await get(k.id)).endsAt as string).getTime();
      const r2 = await sched().runOnce(new Date(end + 1000)); expect(r2.completed).toBe(1);
      expect((await get(k.id)).status).toBe('COMPLETED');
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' }).expect(409);
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ARCHIVED' }).expect(200);
      const hist = (await c.http().get(`${BASE}/${k.id}/history`).set(A).expect(200)).body as Array<{ from: string; to: string; actor: string; reasonCode: string }>;
      // the scheduler ran on a simulated clock a month ahead, so the rows are compared as a set; in production `at` is the real time
      expect(hist.map((h) => `${h.from}>${h.to}`).sort()).toEqual(['DRAFT>PENDING_APPROVAL', 'PENDING_APPROVAL>SCHEDULED', 'SCHEDULED>ACTIVE', 'ACTIVE>PAUSED', 'PAUSED>ACTIVE', 'ACTIVE>COMPLETED', 'COMPLETED>ARCHIVED'].sort());
      expect(hist.find((h) => h.to === 'ACTIVE')!.actor).toBe('system:scheduler'); expect(hist.find((h) => h.to === 'SCHEDULED')!.actor).toBe('adm_b');
      const audit = await c.prisma.auditLog.findMany({ where: { resourceId: k.id, action: { startsWith: 'growth.campaign.' } }, select: { action: true } });
      for (const a of ['create', 'approval.request', 'approval.approved', 'transition.pending_approval', 'transition.scheduled', 'transition.active', 'transition.paused', 'transition.completed', 'transition.archived']) expect(audit.map((x) => x.action)).toContain(`growth.campaign.${a}`);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'CampaignStatusChanged', aggregateId: k.id } })).toBe(7);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'CampaignApprovalDecided', aggregateId: k.id } })).toBe(1);
    });
    it('a rejection needs a reason, returns the campaign to DRAFT and is recorded; the requester can resubmit', async () => {
      const k = await create(); const a = (await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body;
      await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(B).send({ decision: 'REJECTED', snapshotHash: a.snapshotHash }).expect(422);
      await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(B).send({ decision: 'REJECTED', snapshotHash: a.snapshotHash, reason: 'Budget too high for the season' }).expect(200);
      expect((await get(k.id)).status).toBe('DRAFT');
      await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201);
    });
    it('a second admin token of the SAME user cannot approve (the requester is the sub, not the session)', async () => {
      const k = await create(); const a = (await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body;
      const again = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'], sid: 'other-session' });
      expect((await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(again).send({ decision: 'APPROVED', snapshotHash: a.snapshotHash })).status).toBe(403);
      await expect(c.prisma.$executeRawUnsafe(`UPDATE "GrowthCampaignApproval" SET "decidedBy"='adm_a', "decision"='APPROVED', "decidedAt"=now() WHERE id='${a.id}'`)).rejects.toThrow(/maker_checker/); // and the database refuses it too
    });
    it('below the threshold with the policy flag OFF a campaign goes straight to SCHEDULED; a sensitive channel or a budget above the threshold still needs a second approver', async () => {
      await approvalFlagOff();
      const small = await create({ key: 'small-one', budgetTotalMinor: 100_000, budgetDailyMinor: 10_000 });
      expect(small.approval.required).toBe(false);
      await c.http().post(`${BASE}/${small.id}/transition`).set(A).send({ to: 'SCHEDULED' }).expect(200);
      const wa = await create({ key: 'wa-one', channels: ['WHATSAPP'] }); expect(wa.approval.reasons).toEqual(['SENSITIVE_CHANNEL']);
      expect((await c.http().post(`${BASE}/${wa.id}/transition`).set(A).send({ to: 'SCHEDULED' })).body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');
      const big = await create({ key: 'big-one', budgetTotalMinor: 5_000_000, budgetDailyMinor: 500_000 }); expect(big.approval.reasons).toEqual(['BUDGET_ABOVE_THRESHOLD']);
      expect((await c.http().post(`${BASE}/${big.id}/transition`).set(A).send({ to: 'SCHEDULED' })).status).toBe(409);
    });
    it('an edit of the money-relevant fields after approval invalidates it (a SCHEDULED campaign goes back to DRAFT); a name edit does not', async () => {
      const k = await create(); await approveFlow(k.id); let s = await get(k.id); expect(s.approval.current).toBe(true);
      s = (await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: s.version, name: 'New name' }).expect(200)).body; expect(s.status).toBe('SCHEDULED'); expect(s.approval.current).toBe(true);
      s = (await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: s.version, budgetTotalMinor: 900_000 }).expect(200)).body;
      expect(s.status).toBe('DRAFT'); expect(s.approval.current).toBe(false);
      const stale = await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: 1, name: 'stale' }); expect(stale.status).toBe(409); expect(stale.body.code).toBe('CAMPAIGN_LOCKED');
      const hist = (await c.http().get(`${BASE}/${k.id}/history`).set(A)).body; expect(hist.at(-1)).toMatchObject({ to: 'DRAFT', reasonCode: 'EDITED_AFTER_APPROVAL' });
    });
    it('key and tracking cannot change once the campaign has been active; the budget cannot go below approved spend', async () => {
      const k = await activeCampaign(); const s = await get(k.id);
      const r = await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: s.version, utmConfig: { source: 'other' } }); expect(r.status).toBe(422);
      await spendLine(k.id, 100_000);
      const low = await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: s.version, budgetTotalMinor: 50_000, budgetDailyMinor: 10_000 }); expect(low.status).toBe(422);
    });
  });

  describe('budgets and guardrails', () => {
    it('the monthly ceiling refuses scheduling a campaign that would exceed it (409 CAMPAIGN_CEILING_EXCEEDED) and counts only ACTIVE and SCHEDULED', async () => {
      await activateConfig(c, 'CAMPAIGN_POLICY', policy({ monthlyCeilingMinor: 1_500_000 }), { announcement: 'Marketing: lower monthly ceiling for the test.' }); c.get(CampaignService).policy; c.flags.invalidate();
      const k1 = await create({ key: 'ceil-1', budgetTotalMinor: 1_000_000 }); await approveFlow(k1.id);
      const k2 = await create({ key: 'ceil-2', budgetTotalMinor: 1_000_000 }); const a = (await c.http().post(`${BASE}/${k2.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }).expect(201)).body;
      const r = await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: a.snapshotHash }); expect(r.status).toBe(409); expect(r.body.code).toBe('CAMPAIGN_CEILING_EXCEEDED');
      expect((await get(k2.id)).status).toBe('PENDING_APPROVAL'); // the whole decision rolled back
      await c.http().post(`${BASE}/${k1.id}/transition`).set(A).send({ to: 'DRAFT', reason: 'Free the ceiling for the next one' }).expect(200);
      await c.http().post(`${BASE}/approvals/${a.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: a.snapshotHash }).expect(200);
    });
    it('approved spend drives utilisation: alerts at 50, 80 and 100 percent fire ONCE each, 100 percent pauses with BUDGET and a resume needs a budget increase approved by a second person', async () => {
      const k = await activeCampaign({ budgetTotalMinor: 1_000_000, budgetDailyMinor: 1_000_000 });
      const pendingOnly = await spendLine(k.id, 400_000, A, null); expect((await get(k.id)).budget).toMatchObject({ approvedSpendMinor: 0, pendingSpendMinor: 400_000, utilisationBp: 0 });
      await c.http().post(`${SPEND}/${pendingOnly.id}/approve`).set(A).expect(403); // maker-checker of the spend line itself
      await c.http().post(`${SPEND}/${pendingOnly.id}/approve`).set(B).expect(200);
      let s = await get(k.id); expect(s.budget.utilisationBp).toBe(4000); expect(s.thresholdsFiredBp).toEqual([]);
      await spendLine(k.id, 150_000); s = await get(k.id); expect(s.thresholdsFiredBp).toEqual([5000]); expect(s.status).toBe('ACTIVE');
      await spendLine(k.id, 250_000); s = await get(k.id); expect(s.thresholdsFiredBp).toEqual([5000, 8000]);
      await budget().recompute(k.id); await budget().recompute(k.id); // idempotent: nothing fires twice
      await spendLine(k.id, 200_000); s = await get(k.id);
      expect(s.thresholdsFiredBp).toEqual([5000, 8000, 10000]); expect(s.status).toBe('PAUSED'); expect(s.pauseReason).toBe('BUDGET');
      expect(await c.prisma.outboxEvent.count({ where: { type: 'CampaignBudgetThresholdReached', aggregateId: k.id } })).toBe(3);
      const resume = await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' }); expect(resume.status).toBe(409); expect(resume.body.code).toBe('CAMPAIGN_BUDGET_EXHAUSTED');
      const tooSmall = await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: s.version, budgetTotalMinor: 1_100_000 }).expect(200); void tooSmall; // +10 percent is within the policy and needs no approval
      expect((await get(k.id)).status).toBe('PAUSED');
      const big = await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: (await get(k.id)).version, budgetTotalMinor: 3_000_000 }); expect(big.status).toBe(409); expect(big.body.code).toBe('CAMPAIGN_APPROVAL_REQUIRED');
      const inc = (await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'BUDGET_INCREASE', budgetTotalMinor: 2_000_000, budgetDailyMinor: 1_000_000 }).expect(201)).body;
      await c.http().post(`${BASE}/approvals/${inc.id}/decide`).set(A).send({ decision: 'APPROVED', snapshotHash: inc.snapshotHash }).expect(403);
      await c.http().post(`${BASE}/approvals/${inc.id}/decide`).set(B).send({ decision: 'APPROVED', snapshotHash: inc.snapshotHash }).expect(200);
      s = await get(k.id); expect(s.budgetTotalMinor).toBe(2_000_000); expect(s.pauseReason).toBe('MANUAL');
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' }).expect(200);
    });
    it('the daily cap pauses the campaign until the next Cairo day boundary; the scheduler resumes it exactly then (and not a minute before)', async () => {
      const k = await activeCampaign({ budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000 });
      await spendLine(k.id, 100_000);
      let s = await get(k.id); expect(s.status).toBe('PAUSED'); expect(s.pauseReason).toBe('GUARDRAIL');
      const boundary = nextDayBoundary(now(), marketTimezone('EG')); expect(new Date(s.pausedUntil).getTime()).toBe(boundary.getTime());
      expect((await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'ACTIVE' })).status).toBe(409);
      let r = await sched().runOnce(new Date(boundary.getTime() - 60_000)); expect(r.resumed).toBe(0); expect((await get(k.id)).status).toBe('PAUSED');
      r = await sched().runOnce(new Date(boundary.getTime() + 1000)); expect(r.resumed).toBe(1);
      s = await get(k.id); expect(s.status).toBe('ACTIVE'); expect(s.pausedUntil).toBeNull();
      const hist = (await c.http().get(`${BASE}/${k.id}/history`).set(A)).body; expect(hist.map((h: { reasonCode: string }) => h.reasonCode)).toEqual(expect.arrayContaining(['DAILY_CAP', 'DAILY_RESUME']));
    });
    it('spend lines: positive, not in the future, not on a DRAFT campaign; adapter lines are idempotent on (campaign, day, source, adapterRef); the label of a campaign line is its UTM tag', async () => {
      const draft = await create(); const day = new Date().toISOString().slice(0, 10);
      expect((await c.http().post(`${BASE}/${draft.id}/spend`).set(A).send({ day, amountMinor: 1000 })).status).toBe(422);
      const k = await activeCampaign();
      for (const bad of [{ day, amountMinor: 0 }, { day, amountMinor: -5 }, { day, amountMinor: 1.5 }, { day: '2999-01-01', amountMinor: 100 }, { day: 'nope', amountMinor: 100 }]) expect([400, 422]).toContain((await c.http().post(`${BASE}/${k.id}/spend`).set(A).send(bad)).status);
      const row = await spendLine(k.id, 5000, A, null); expect(row).toMatchObject({ campaignId: k.id, campaign: k.utmCampaign, sourceKind: 'CAMPAIGN', source: 'MANUAL' });
      const svc = c.get(GrowthSpendService);
      const one = await svc.create('system:test', { day, amountMinor: 700, campaignId: k.id, source: 'ADAPTER', adapterRef: 'g_1' }); const two = await svc.create('system:test', { day, amountMinor: 700, campaignId: k.id, source: 'ADAPTER', adapterRef: 'g_1' });
      expect(two.id).toBe(one.id); expect(await c.prisma.growthSpendEntry.count({ where: { campaignId: k.id, source: 'ADAPTER' } })).toBe(1);
      await expect(svc.create('system:test', { day, amountMinor: 700, source: 'ADAPTER', adapterRef: 'g_2' })).rejects.toThrow();
    });
  });

  describe('scheduler', () => {
    it('is idempotent: two simultaneous runs activate a campaign once, write one history row and one heartbeat each, and a later run does nothing', async () => {
      const k = await create(); await approveFlow(k.id);
      const [a, b] = await Promise.all([sched().runOnce(now()), sched().runOnce(now())]);
      expect(a.activated + b.activated).toBe(1);
      expect((await c.http().get(`${BASE}/${k.id}/history`).set(A)).body.filter((h: { to: string }) => h.to === 'ACTIVE')).toHaveLength(1);
      expect((await sched().runOnce(now())).activated).toBe(0);
      expect(await c.prisma.growthJobRun.count({ where: { job: 'campaign-scheduler' } })).toBe(3);
      const run = await c.http().post(`${BASE}/scheduler/run`).set(A).expect(200); expect(run.body).toHaveProperty('activated');
    });
    it('a window that already ended is archived with WINDOW_MISSED instead of starting; a future start waits', async () => {
      const past = await create({ key: 'past-one', startsAt: new Date(now().getTime() - 3 * DAY).toISOString(), endsAt: new Date(now().getTime() - 2 * DAY).toISOString() }); await approveFlow(past.id);
      const future = await create({ key: 'future-one', startsAt: new Date(now().getTime() + 5 * DAY).toISOString(), endsAt: new Date(now().getTime() + 9 * DAY).toISOString() }); await approveFlow(future.id);
      const r = await sched().runOnce(now()); expect(r.archived).toBe(1);
      expect((await get(past.id)).status).toBe('ARCHIVED'); expect((await get(future.id)).status).toBe('SCHEDULED');
      expect((await c.http().get(`${BASE}/${past.id}/history`).set(A)).body.at(-1).reasonCode).toBe('WINDOW_MISSED');
    });
    it('an ACTIVE or PAUSED campaign completes at its auto expiry (endsAt plus the policy grace)', async () => {
      await activateConfig(c, 'CAMPAIGN_POLICY', policy({ autoExpiryGraceHours: 6 }), { announcement: 'Marketing: six hour grace for the test.' }); c.flags.invalidate();
      const k = await activeCampaign(); const end = new Date((await get(k.id)).endsAt as string).getTime();
      expect((await sched().runOnce(new Date(end + 5 * 3600_000))).completed).toBe(0); expect((await sched().runOnce(new Date(end + 6 * 3600_000 + 1000))).completed).toBe(1);
    });
  });

  describe('flag growth.campaigns', () => {
    it('OFF: every write answers 403 FEATURE_DISABLED, every read still works, the public resolve is off, the scheduler skips; ON again restores it (nothing was deleted)', async () => {
      const k = await activeCampaign();
      expect((await flagOff('growth.campaigns')).status).toBe(200);
      for (const r of [await c.http().post(BASE).set(A).send(body()), await c.http().patch(`${BASE}/${k.id}`).set(A).send({ version: 1, name: 'x' }), await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'COMPLETED' }), await c.http().post(`${BASE}/${k.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }), await c.http().post(`${BASE}/${k.id}/spend`).set(A).send({ day: new Date().toISOString().slice(0, 10), amountMinor: 100 }), await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${k.utmCampaign}`)]) {
        expect(r.status).toBe(403); expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'growth.campaigns' });
      }
      expect((await c.http().get(BASE).set(A)).status).toBe(200); expect((await c.http().get(`${BASE}/${k.id}/report`).set(A)).status).toBe(200);
      expect((await sched().runOnce(new Date(Date.now() + 90 * DAY))).skipped).toBeGreaterThan(0); expect((await get(k.id)).status).toBe('ACTIVE');
      await c.http().put('/api/v1/admin/flags/growth.campaigns/values').set(A).send({ scope: 'GLOBAL', value: 'ON', reason: 'restore', ticket: 'T-9' }).expect(200); c.flags.invalidate();
      expect((await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${k.utmCampaign}`)).status).toBe(200);
    });
  });

  describe('creatives', () => {
    it('accepts an object key under the campaign prefix and an allowlisted https URL; refuses http, data, traversal, other hosts and other campaigns', async () => {
      const k = await create();
      const add = (assetRef: string) => c.http().post(`${BASE}/${k.id}/creatives`).set(A).send({ kind: 'IMAGE', assetRef });
      expect((await add(`growth/creatives/eg/${k.id}/banner.png`)).status).toBe(201); expect((await add('https://cdn.kiorex.com/a/b.png')).status).toBe(201);
      for (const bad of ['http://cdn.kiorex.com/a.png', 'https://evil.example/a.png', 'data:image/png;base64,AAAA', '../etc/passwd', 'growth/creatives/eg/other/a.png', `growth/creatives/sa/${k.id}/a.png`, 'javascript:alert(1)']) expect((await add(bad)).status).toBe(422);
      expect((await c.http().get(`${BASE}/${k.id}/creatives`).set(A)).body).toHaveLength(2);
    });
  });

  describe('public resolve and the campaign touch tag', () => {
    it('resolves an ACTIVE campaign only, with no budget, spend, channel or eligibility in the answer; anything else is 404 or 400', async () => {
      const k = await create(); await approveFlow(k.id);
      expect((await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${k.utmCampaign}`)).status).toBe(404); // SCHEDULED does not resolve
      await sched().runOnce(now());
      const r = await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${k.utmCampaign}&locale=en`).expect(200);
      expect(r.body).toEqual({ landing: { path: '/en/eg', locale: 'en', landingPageId: null }, campaignToken: k.utmCampaign });
      expect(JSON.stringify(r.body)).not.toMatch(/budget|spend|channel|eligib|owner/i);
      expect((await c.http().get('/api/v1/growth/v1/campaign/resolve?utm_campaign=eg-unknown')).status).toBe(404);
      for (const bad of ['', 'UPPER', 'a b', 'x'.repeat(80), '<script>']) expect((await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${encodeURIComponent(bad)}`)).status).toBe(400);
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'COMPLETED' }).expect(200);
      expect((await c.http().get(`/api/v1/growth/v1/campaign/resolve?utm_campaign=${k.utmCampaign}`)).status).toBe(404);
    });
    it('a touch with the campaign UTM is a CAMPAIGN touch tagged with the campaign id while ACTIVE; after it ended the touch is still CAMPAIGN but carries no id; unknown UTMs and provider links are never re-labelled; with the flag OFF nothing is tagged', async () => {
      await unlockFlag(c, 'growth.analytics_visitor');
      const k = await activeCampaign({ key: 'tag-test' });
      const touch = (utm: Record<string, string>, extra: Record<string, unknown> = {}) => c.http().post(TOUCH).set({ 'user-agent': UA, 'x-kx-consent': 'analytics' }).send({ landingKind: 'HOME', utm, ...extra }).expect(202);
      await touch({ source: 'newsletter', medium: 'email', campaign: k.utmCampaign });
      let t: any = await c.prisma.growthTouchpoint.findFirstOrThrow({ orderBy: { occurredAt: 'desc' }, include: { source: true } });
      expect(t).toMatchObject({ kind: 'CAMPAIGN', utmCampaign: k.utmCampaign }); expect(t.source).toMatchObject({ sourceKind: 'CAMPAIGN', sourceRef: k.id });
      await touch({ source: 'x', medium: 'organic', campaign: 'eg-not-a-campaign' });
      t = await c.prisma.growthTouchpoint.findFirstOrThrow({ orderBy: { occurredAt: 'desc' }, include: { source: true } }); expect(t.kind).not.toBe('CAMPAIGN');
      await registerLink(c, '7K2M9X4Q', 'org_A');
      await touch({ source: 'x', medium: 'email', campaign: k.utmCampaign }, { landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q', dwellMs: 2000 });
      t = await c.prisma.growthTouchpoint.findFirstOrThrow({ orderBy: { occurredAt: 'desc' } }); expect(t.kind).toBe('PROVIDER_LINK');
      await c.http().post(`${BASE}/${k.id}/transition`).set(A).send({ to: 'COMPLETED' }).expect(200);
      await touch({ source: 'newsletter', medium: 'email', campaign: k.utmCampaign });
      t = await c.prisma.growthTouchpoint.findFirstOrThrow({ orderBy: { occurredAt: 'desc' }, include: { source: true } }); expect(t.kind).toBe('CAMPAIGN'); expect(t.source.sourceRef).toBe('');
      await flagOff('growth.campaigns');
      await touch({ source: 'newsletter', medium: 'email', campaign: k.utmCampaign });
      t = await c.prisma.growthTouchpoint.findFirstOrThrow({ orderBy: { occurredAt: 'desc' }, include: { source: true } }); expect(t.source.sourceRef).toBe(''); // the e-mail medium is still a campaign-like touch, but it carries no campaign id any more
    });
  });

  describe('reporting', () => {
    it('the report equals the approved spend lines and the metric rows of the campaign dimension; counts under 10 and everything resting on them are "<10"; external numbers are "not connected" until an adapter provided them', async () => {
      const k = await activeCampaign({ budgetTotalMinor: 5_000_000, budgetDailyMinor: 2_000_000, channels: ['EMAIL'] });
      await spendLine(k.id, 120_000); await spendLine(k.id, 30_000);
      const day = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const row = (metric: string, value: number, extra: Record<string, unknown> = {}) => ({ market: 'EG', day, metric, value, campaignId: k.id, campaign: k.utmCampaign, sourceKind: 'CAMPAIGN', ...extra });
      await c.prisma.growthMetricDaily.createMany({ data: [row('PageViewed', 1000), row('SearchStarted', 400), row('BookingConfirmed', 50), row('BookingAttended', 40), row('AttendedNewPatient', 30), row('RevenueMinor', 120_000), row('RevenueReversedMinor', 0), row('SlotSelected', 5, { sourceKind: 'CAMPAIGN' }), row('PageViewed', 9, { campaignId: 'cmp_other', campaign: 'eg-other' })] });
      const r = (await c.http().get(`${BASE}/${k.id}/report`).set(A).expect(200)).body;
      expect(r.budget).toMatchObject({ approvedSpendMinor: 150_000, pendingSpendMinor: 0, utilisationBp: 300, totalMinor: 5_000_000 });
      const f = Object.fromEntries(r.funnel.map((x: { stage: string; count: unknown }) => [x.stage, x.count]));
      expect(f).toMatchObject({ PageViewed: 1000, SearchStarted: 400, BookingConfirmed: 50, BookingAttended: 40, AttendedNewPatient: 30, SlotSelected: '<10' });
      expect(r.kpis.cpa.values.cpaMinor).toBe(3000); expect(r.kpis.cac.values.cacMinor).toBe(5000); expect(r.kpis.roas.values.roas).toBe(0.8);
      expect(r.daily[0]).toMatchObject({ spendMinor: 150_000, pageViews: 1000, bookingsConfirmed: 50 });
      expect(r.external).toEqual({ connected: false, kinds: [], metrics: {} });
      await c.prisma.growthExternalMetricDaily.createMany({ data: [{ kind: 'googleads', day, dimensionKey: k.id, metric: 'impressions', value: 90000 }, { kind: 'googleads', day, dimensionKey: k.utmCampaign, metric: 'clicks', value: 1200 }] });
      const r2 = (await c.http().get(`${BASE}/${k.id}/report`).set(A).expect(200)).body; expect(r2.external).toEqual({ connected: true, kinds: ['googleads'], metrics: { 'googleads.impressions': 90000, 'googleads.clicks': 1200 } });
      await c.prisma.growthMetricDaily.deleteMany({ where: { campaignId: k.id, metric: { in: ['BookingConfirmed', 'AttendedNewPatient'] } } });
      await c.prisma.growthMetricDaily.createMany({ data: [row('BookingConfirmed', 7), row('AttendedNewPatient', 4)] });
      const r3 = (await c.http().get(`${BASE}/${k.id}/report`).set(A).expect(200)).body;
      expect(r3.kpis.cpa.values.cpaMinor).toBe('<10'); expect(r3.kpis.cac.values.cacMinor).toBe('<10'); expect(r3.kpis.roas.values.roas).toBe('<10'); expect(r3.revenue.masked).toBe(true);
    });
    it('the rollup carries the campaign dimension: a visitor-stream event after a campaign touch lands in a row with campaignId and the UTM tag', async () => {
      await unlockFlag(c, 'growth.analytics_visitor'); const k = await activeCampaign({ key: 'rollup-test' });
      const res = await c.http().post(TOUCH).set({ 'user-agent': UA, 'x-kx-consent': 'analytics' }).send({ landingKind: 'HOME', utm: { source: 'n', medium: 'email', campaign: k.utmCampaign } }).expect(202);
      const visitorKey = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((x) => x.startsWith('kxv='))!.split(';')[0]!.slice(4);
      await c.prisma.growthEvent.create({ data: { name: 'PageViewed', visitorKey, careType: 'DOCTORS', dedupeKey: 'camp|pv|1', props: { platform: 'web', landingKind: 'HOME' }, occurredAt: new Date(Date.now() + 1000) } });
      await c.get(GrowthRollupService).rollup();
      const rows = await c.prisma.growthMetricDaily.findMany({ where: { metric: 'PageViewed', campaignId: k.id } });
      expect(rows.length).toBeGreaterThan(0); expect(rows[0]).toMatchObject({ campaign: k.utmCampaign, sourceKind: 'CAMPAIGN', campaignId: k.id });
    });
  });

  it('no endpoint of the module reaches an external ad platform: the module source imports no HTTP client and no adapter', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const dir = join(__dirname, '..', 'src', 'growth', 'campaigns');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.includes('spec'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/from 'axios'|from 'node-fetch'|from 'undici'|globalThis\.fetch|\bfetch\(|from 'node:https?'|googleads|metaads|tiktok|graph\.facebook|@aws-sdk/);
    }
    void SYSTEM;
  });
});
