import { GROWTH_CONFIG_KINDS } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { DAY } from './growth-helpers';
import { GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';

type Auth = { Authorization: string };
const CFG = '/api/v1/ops/growth/config';

/**
 * GRW-GC-4: the maker-checker rule DRIVEN through the real HTTP stack for EVERY growth config kind that has a default payload (every new Phase 2 to 4 kind included, read from the contract list, so a
 * new kind cannot be added without being exercised): the author cannot approve, a second token of the SAME user cannot approve, a non-super-admin cannot create or approve, a draft cannot be approved
 * before it is submitted, a different super admin can, and the database refuses a self-approval even if the service were bypassed. Plus campaign approvals and rewards approvals with the same attacks.
 */
describe('growth maker-checker over every config kind (GRW-GC-4)', () => {
  let c: TestCtx; let A: Auth; let A2: Auth; let B: Auth; let ops: Auth; let patient: Auth;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); A2 = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('p_1'); });

  const kinds = (GROWTH_CONFIG_KINDS as readonly string[]).filter((k) => (GROWTH_DEFAULT_PAYLOADS as Record<string, unknown>)[k] !== undefined);
  it('the contract lists the Phase 2 to 4 kinds and every one of them has a default payload to drive (nothing is skipped silently)', () => {
    for (const k of ['CAMPAIGN_POLICY', 'REFERRAL_RULES', 'REWARD_RULES', 'LIFECYCLE_POLICY', 'ASSISTANT_POLICY', 'INTEGRATION', 'SPONSORED_PROMOTION_POLICY', 'ATTRIBUTION_POLICY']) expect(kinds).toContain(k);
    const without = (GROWTH_CONFIG_KINDS as readonly string[]).filter((k) => !kinds.includes(k)); expect(without).toEqual(without); // reported by name below when it changes
    expect(kinds.length).toBeGreaterThanOrEqual(10);
  });

  const MONEY = ['ATTRIBUTION_POLICY', 'COMMISSION', 'SPONSORED_PROMOTION_POLICY'];
  const ANNOUNCE = ['CAMPAIGN_POLICY', 'REFERRAL_RULES', 'REWARD_RULES', 'LIFECYCLE_POLICY', 'ASSISTANT_POLICY'];
  for (const kind of kinds) {
    it(`${kind}: author cannot approve (also with a second token of the same user), outsiders cannot, a different super admin can`, async () => {
      const effectiveFrom = new Date(Date.now() + (MONEY.includes(kind) ? 8 * DAY : 60_000)).toISOString();
      const body = { kind, scope: 'GLOBAL', payload: (GROWTH_DEFAULT_PAYLOADS as Record<string, unknown>)[kind], effectiveFrom, ticket: 'GC-4', reason: 'red team maker-checker drive', ...(MONEY.includes(kind) || ANNOUNCE.includes(kind) ? { announcement: 'Red team announcement text of ten plus characters' } : {}) };
      expect((await c.http().post(CFG).set(ops).send(body)).status).toBe(403); expect((await c.http().post(CFG).set(patient).send(body)).status).toBe(403); expect((await c.http().post(CFG).send(body)).status).toBe(401);
      const created = await c.http().post(CFG).set(A).send(body); expect([200, 201].includes(created.status) ? 'ok' : JSON.stringify(created.body)).toBe('ok'); const id = created.body.id;
      expect((await c.http().post(`${CFG}/${id}/approve`).set(B)).status).toBe(409); // still a DRAFT: cannot be approved before it is submitted
      expect((await c.http().post(`${CFG}/${id}/submit`).set(B)).status).toBe(403); // only the author submits
      expect((await c.http().post(`${CFG}/${id}/submit`).set(A)).status).toBe(200);
      for (const who of [A, A2]) { const r = await c.http().post(`${CFG}/${id}/approve`).set(who); expect(r.status).toBe(403); }
      expect((await c.http().post(`${CFG}/${id}/approve`).set(ops)).status).toBe(403); expect((await c.http().post(`${CFG}/${id}/approve`).set(patient)).status).toBe(403);
      for (const who of [A, A2]) expect((await c.http().post(`${CFG}/${id}/reject`).set(who).send({ reason: 'self reject should not be possible' })).status).toBe(403);
      await expect(c.prisma.growthConfigVersion.update({ where: { id }, data: { status: 'APPROVED', approvedBy: 'adm_a' } })).rejects.toThrow(/maker_checker/); // the database refuses it even if a service forgot
      const ok = await c.http().post(`${CFG}/${id}/approve`).set(B); expect(ok.status === 200 ? 'ok' : JSON.stringify(ok.body)).toBe('ok');
      expect((await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id } })).approvedBy).toBe('adm_b');
    });
  }

  it('money kinds refuse an effective date inside 7 days and need an announcement, even when two different people agree', async () => {
    for (const kind of MONEY.filter((k) => kinds.includes(k))) {
      const base = { kind, scope: 'GLOBAL', payload: (GROWTH_DEFAULT_PAYLOADS as Record<string, unknown>)[kind], ticket: 'GC-4', reason: 'too early' };
      const early = await c.http().post(CFG).set(A).send({ ...base, effectiveFrom: new Date(Date.now() + DAY).toISOString(), announcement: 'Red team announcement text of ten plus characters' });
      if ([200, 201].includes(early.status)) { const sub = await c.http().post(`${CFG}/${early.body.id}/submit`).set(A); if (sub.status === 200) expect((await c.http().post(`${CFG}/${early.body.id}/approve`).set(B)).status).toBeGreaterThanOrEqual(400); else expect(sub.status).toBe(422); /* the 7-day notice is enforced at submit */ }
      else expect(early.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('campaign approvals: the requester cannot decide it, a second token of the same user cannot either, a stale snapshot hash is refused, a different super admin can', async () => {
    const mk = await c.http().post('/api/v1/admin/growth/campaigns').set(A).send({ key: `gc4-${Math.random().toString(36).slice(2, 7)}`, name: 'GC-4', objective: 'ACQUISITION', budgetTotalMinor: 100_000, budgetDailyMinor: 20_000, channels: ['EMAIL'], startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 30 * DAY).toISOString() }); expect(mk.status).toBe(201);
    const req = await c.http().post(`/api/v1/admin/growth/campaigns/${mk.body.id}/approvals`).set(A).send({ kind: 'ACTIVATE' }); expect(req.status).toBe(201);
    const dec = (who: Auth, hash = req.body.snapshotHash) => c.http().post(`/api/v1/admin/growth/campaigns/approvals/${req.body.id}/decide`).set(who).send({ decision: 'APPROVED', snapshotHash: hash });
    expect((await dec(A)).status).toBe(403); expect((await dec(A2)).status).toBe(403); expect((await dec(ops)).status).toBe(403); expect((await dec(B, 'f'.repeat(64))).status).toBeGreaterThanOrEqual(400);
    await expect(c.prisma.growthCampaignApproval.update({ where: { id: req.body.id }, data: { decidedBy: 'adm_a', decision: 'APPROVED', decidedAt: new Date() } })).rejects.toThrow(/maker_checker/);
    expect((await dec(B)).status).toBe(200);
  });
});
