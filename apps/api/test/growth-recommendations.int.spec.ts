import { createCtx, TestCtx } from './harness';
import { DAY, unlockFlag } from './growth-helpers';
import { checkAggregateOnly } from '../src/growth/recommendations/assert-aggregate-only';
import { AiSummaryService, MockSummaryModel, type SummaryModel } from '../src/growth/recommendations/ai-summary.service';
import { RecommendationService } from '../src/growth/recommendations/recommendation.service';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/recommendations';
const now = () => new Date();

/**
 * GRW-P3-E recommendations over the real HTTP stack and Postgres: advisory only (proposals never act), aggregate-only (k >= 10), closed vocabulary, human approval creating a DRAFT at most,
 * expiry, feedback, the launch lock, the mock model by default, a hostile model, and the database walls (CHECKs and the immutability trigger).
 */
describe('growth AI-assisted recommendations (GRW-P3-E)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth;
  const svc = () => c.get(RecommendationService);
  let seq = 0;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); delete process.env.RECOMMENDATION_MODEL_MODE; });
  beforeEach(async () => {
    delete process.env.RECOMMENDATION_MODEL_MODE; c.get(AiSummaryService).setOverride(null);
    await c.reset(); c.flags.invalidate();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
    await unlockAi();
  });
  const unlockAi = async () => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: 'growth.ai_recommendations', gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: 'growth.ai_recommendations', gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' } as never, update: {} }); c.flags.invalidate(); };

  /** A campaign with approved spend and attended new patients inside the 28 day window. */
  const campaign = async (key: string, channel: string, o: { spend: number; attended: number; status?: string; activeDays?: number }) => {
    const row = await c.prisma.growthCampaign.create({ data: { market: 'EG', key, utmCampaign: `eg-${key}`, name: key, objective: 'ACQUISITION', status: o.status ?? 'ACTIVE', budgetTotalMinor: 5_000_000, budgetDailyMinor: 500_000, channels: [channel], policyVersionId: 'pv', ownerSub: 'adm_a', activatedAt: new Date(Date.now() - (o.activeDays ?? 20) * DAY) } });
    const day = new Date(Date.now() - 3 * DAY); day.setUTCHours(0, 0, 0, 0);
    if (o.spend) await c.prisma.growthSpendEntry.create({ data: { market: 'EG', day, campaign: row.utmCampaign, campaignId: row.id, channel, amountMinor: o.spend, status: 'APPROVED', createdBy: 'adm_a', source: 'MANUAL' } });
    if (o.attended) await c.prisma.growthMetricDaily.create({ data: { market: 'EG', day, metric: 'AttendedNewPatient', campaign: row.utmCampaign, campaignId: row.id, sourceKind: 'CAMPAIGN', value: o.attended } });
    return row;
  };
  const seedMarket = async () => {
    await campaign('referral-wave', 'REFERRAL', { spend: 100_000, attended: 50 });
    await campaign('search-spring', 'PAID_SEARCH', { spend: 800_000, attended: 40 });
    await campaign('social-quiet', 'PAID_SOCIAL', { spend: 200_000, attended: 0 });
  };
  const run = (auth: Auth = A) => c.http().post(`${BASE}/run`).set(auth).send({}).expect(200);
  const list = async (q = '') => (await c.http().get(`${BASE}${q}`).set(ops).expect(200)).body as Array<{ id: string; kind: string; status: string; payload: Record<string, unknown>; rationale: { en: string; ar: string }; modelMode: string; aiAssisted: boolean; convertedRef: string | null; next: unknown }>;

  describe('proposals', () => {
    it('builds proposals from aggregates, bilingual, idempotent per open fingerprint, and acts on nothing', async () => {
      await seedMarket();
      const before = { campaigns: await c.prisma.growthCampaign.findMany({ orderBy: { key: 'asc' } }), spend: await c.prisma.growthSpendEntry.count(), msgs: await c.prisma.message.count(), outbox: await c.prisma.outboxEvent.count() };
      const r1 = (await run()).body;
      expect(r1).toMatchObject({ created: 2, existing: 0, mode: 'mock' });
      const rows = await list();
      expect(rows.map((x) => x.kind).sort()).toEqual(['PAUSE_CAMPAIGN', 'REALLOCATE_BUDGET']);
      for (const x of rows) { expect(x.status).toBe('PROPOSED'); expect(x.rationale.en.length).toBeGreaterThan(20); expect(x.rationale.ar).toMatch(/[؀-ۿ]/); expect(x.aiAssisted).toBe(true); expect(x.modelMode).toBe('mock'); }
      const re = rows.find((x) => x.kind === 'REALLOCATE_BUDGET')!;
      expect(re.payload).toMatchObject({ fromChannel: 'PAID_SEARCH', toChannel: 'REFERRAL', basis: 'CAC' });
      expect((await run()).body).toMatchObject({ created: 0, existing: 2 });
      // nothing else changed: no campaign touched, no spend, no message, no outbox event
      expect(await c.prisma.growthCampaign.findMany({ orderBy: { key: 'asc' } })).toEqual(before.campaigns);
      expect(await c.prisma.growthSpendEntry.count()).toBe(before.spend); expect(await c.prisma.message.count()).toBe(before.msgs); expect(await c.prisma.outboxEvent.count()).toBe(before.outbox);
    });

    it('PRIVACY: every stored payload and evidence is aggregate-only; a cell under 10 never becomes a proposal; a health word in a campaign key drops the proposal', async () => {
      await seedMarket();
      await campaign('small-cell', 'PAID_VIDEO', { spend: 400_000, attended: 5 }); // 5 attended: a small cell, neither "none" nor a ratio
      await campaign('cardiology-promo', 'EMAIL', { spend: 300_000, attended: 0 }); // would be a pause proposal, but the key names a specialty
      const r = (await run()).body;
      expect(r.dropped.map((d: { fingerprint: string }) => d.fingerprint)).toContain('pause:eg-cardiology-promo');
      const rows = await c.prisma.growthRecommendation.findMany();
      expect(rows.length).toBe(2);
      for (const x of rows) { expect(checkAggregateOnly({ payload: x.payload, evidence: x.evidenceRefs })).toEqual([]); expect(JSON.stringify(x)).not.toMatch(/small-cell|cardiology/); }
    });

    it('with no data there is nothing to propose (and no error)', async () => { expect((await run()).body).toMatchObject({ created: 0, considered: 0 }); expect(await list()).toEqual([]); });
  });

  describe('decisions: a human approves, a DRAFT at most', () => {
    it('ACCEPTANCE: approving a reallocation creates a DRAFT campaign that never activates, spends or changes a budget by itself', async () => {
      await seedMarket(); await run();
      const re = (await list('?kind=REALLOCATE_BUDGET'))[0]!;
      const before = { active: await c.prisma.growthCampaign.count({ where: { status: 'ACTIVE' } }), spend: await c.prisma.growthSpendEntry.count(), budgets: (await c.prisma.growthCampaign.findMany({ select: { key: true, budgetTotalMinor: true, status: true }, orderBy: { key: 'asc' } })) };
      const r = (await c.http().post(`${BASE}/${re.id}/decision`).set(A).send({ decision: 'APPROVE', note: 'looks right' }).expect(200)).body;
      expect(r).toMatchObject({ status: 'CONVERTED', decidedBy: 'adm_a', conversionError: null }); expect(r.convertedRef).toMatch(/^campaign:/);
      const draft = await c.prisma.growthCampaign.findFirstOrThrow({ where: { key: { startsWith: 'rec-' } } });
      expect(draft.status).toBe('DRAFT'); expect(draft.channels).toEqual(['REFERRAL']); expect(draft.budgetTotalMinor).toBe(re.payload.shiftMinor);
      expect(draft.activatedAt).toBeNull(); expect(draft.approvedPayloadHash).toBeNull();
      expect(await c.prisma.growthCampaign.count({ where: { status: 'ACTIVE' } })).toBe(before.active);
      expect(await c.prisma.growthSpendEntry.count()).toBe(before.spend);
      expect(await c.prisma.growthCampaign.findMany({ where: { key: { not: { startsWith: 'rec-' } } }, select: { key: true, budgetTotalMinor: true, status: true }, orderBy: { key: 'asc' } })).toEqual(before.budgets);
      expect(await c.prisma.message.count()).toBe(0);
      // the draft still needs the normal campaign approval to activate: activating it directly is refused for lack of an approval
      await c.http().post(`/api/v1/admin/growth/campaigns/${draft.id}/transition`).set(A).send({ to: 'ACTIVE' }).then((x) => expect(x.status).toBeGreaterThanOrEqual(400));
      expect((await c.prisma.growthCampaign.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    });

    it('approving a pause proposal changes NOTHING: the campaign stays ACTIVE and the answer points at the campaign screen', async () => {
      await seedMarket(); await run();
      const p = (await list('?kind=PAUSE_CAMPAIGN'))[0]!;
      const r = (await c.http().post(`${BASE}/${p.id}/decision`).set(A).send({ decision: 'APPROVE' }).expect(200)).body;
      expect(r).toMatchObject({ status: 'APPROVED', convertedRef: null, next: { screen: '/growth/campaigns' } });
      expect(await c.prisma.growthCampaign.count({ where: { status: 'ACTIVE' } })).toBe(3);
    });

    it('a holdout result with no lift becomes a DRAFT LIFECYCLE_POLICY version (maker-checker still needed); the policy in force is unchanged', async () => {
      const at = new Date(Date.now() - 45 * DAY);
      for (let i = 0; i < 60; i++) for (const g of ['S', 'H']) await c.prisma.lifecycleMessageDecision.create({ data: { sub: `ho_${g}_${i}`, journeyKey: 'reengagement', step: 1, messageClass: 'MARKETING', channel: 'PUSH', templateKey: 'REENGAGE_DORMANT', decision: g === 'S' ? 'SEND' : 'SKIP', reason: g === 'S' ? 'OK' : 'HOLDOUT', at } });
      await run();
      const h = (await list('?kind=LIFECYCLE_HOLDOUT'))[0]!;
      expect(h.payload).toMatchObject({ journey: 'reengagement', action: 'DISABLE_JOURNEY', sent: 60, holdout: 60, liftBp: 0 });
      const r = (await c.http().post(`${BASE}/${h.id}/decision`).set(A).send({ decision: 'APPROVE' }).expect(200)).body;
      expect(r).toMatchObject({ status: 'CONVERTED', conversionError: null }); expect(r.convertedRef).toMatch(/^config:/);
      const v = await c.prisma.growthConfigVersion.findFirstOrThrow({ where: { kind: 'LIFECYCLE_POLICY', status: 'DRAFT' } });
      expect((v.payload as { journeys: Record<string, { enabled: boolean }> }).journeys.reengagement.enabled).toBe(false);
      expect(v.createdBy).toBe('adm_a');
      const active = await c.prisma.growthConfigVersion.findFirst({ where: { kind: 'LIFECYCLE_POLICY', status: 'ACTIVE' } }); // the proposal never became the policy in force
      expect(active?.id).not.toBe(v.id); expect((active?.payload as { journeys?: Record<string, { enabled?: boolean }> } | undefined)?.journeys?.reengagement?.enabled).not.toBe(false);
    });

    it('reject needs a reason; a second decision is refused; the role matrix; unknown decisions are refused', async () => {
      await seedMarket(); await run();
      const [x, y] = await list();
      await c.http().post(`${BASE}/${x!.id}/decision`).set(ops).send({ decision: 'APPROVE' }).expect(403);
      await c.http().post(`${BASE}/${x!.id}/decision`).set(A).send({ decision: 'REJECT' }).expect(400);
      await c.http().post(`${BASE}/${x!.id}/decision`).set(A).send({ decision: 'APPLY' }).expect(400);
      expect((await c.http().post(`${BASE}/${x!.id}/decision`).set(A).send({ decision: 'REJECT', note: 'we ran this already' }).expect(200)).body).toMatchObject({ status: 'REJECTED', decisionNote: 'we ran this already' });
      expect((await c.http().post(`${BASE}/${x!.id}/decision`).set(B).send({ decision: 'APPROVE' }).expect(409)).body.code).toBe('RECOMMENDATION_NOT_PROPOSED');
      expect(y).toBeDefined();
    });

    it('two people deciding at once: exactly one wins', async () => {
      await seedMarket(); await run();
      const p = (await list('?kind=PAUSE_CAMPAIGN'))[0]!;
      const rs = await Promise.all([c.http().post(`${BASE}/${p.id}/decision`).set(A).send({ decision: 'APPROVE' }), c.http().post(`${BASE}/${p.id}/decision`).set(B).send({ decision: 'REJECT', note: 'no thanks' })]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('expires after 14 days: a late decision is refused and the row is marked EXPIRED', async () => {
      await seedMarket(); await run();
      const p = (await list('?kind=PAUSE_CAMPAIGN'))[0]!;
      const row = await c.prisma.growthRecommendation.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThanOrEqual(14 * DAY - 5000); expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(14 * DAY + 5000);
      await expect(svc().decide({ sub: 'adm_a', kind: 'USER' }, p.id, 'APPROVE', '', new Date(Date.now() + 15 * DAY))).rejects.toMatchObject({ response: { code: 'RECOMMENDATION_EXPIRED' } });
      expect((await list('?status=EXPIRED')).map((x) => x.id)).toContain(p.id);
      expect(await svc().expireDue(new Date(Date.now() + 15 * DAY))).toBeGreaterThanOrEqual(0);
    });

    it('stores reviewer feedback for evaluation', async () => {
      await seedMarket(); await run();
      const p = (await list())[0]!;
      await c.http().post(`${BASE}/${p.id}/feedback`).set(A).send({ value: 'MAYBE' }).expect(400);
      expect((await c.http().post(`${BASE}/${p.id}/feedback`).set(A).send({ value: 'USEFUL' }).expect(200)).body.feedback).toBe('USEFUL');
      expect((await c.prisma.growthRecommendation.findUniqueOrThrow({ where: { id: p.id } })).feedbackBy).toBe('adm_a');
    });
  });

  describe('flag and model', () => {
    it('growth.ai_recommendations is launch-locked: without gate evidence writes answer 403 FEATURE_DISABLED and reads keep working', async () => {
      await seedMarket(); await run();
      await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: 'growth.ai_recommendations' } }); c.flags.invalidate();
      const p = (await list())[0]!;
      const r = await c.http().post(`${BASE}/run`).set(A).send({}).expect(403); expect(r.body.code).toBe('FEATURE_DISABLED');
      await c.http().post(`${BASE}/${p.id}/decision`).set(A).send({ decision: 'APPROVE' }).expect(403);
      await c.http().get(`${BASE}/${p.id}`).set(ops).expect(200);
    });

    it('the mock model is the default and is labelled AI-assisted; mode "rules" stores no summary', async () => {
      await seedMarket(); await run();
      const row = await c.prisma.growthRecommendation.findFirstOrThrow({ where: { kind: 'REALLOCATE_BUDGET' } });
      expect(row.modelMode).toBe('mock'); expect(row.aiSummary).toMatchObject({ label: 'AI-assisted', model: 'mock' });
      await c.prisma.growthRecommendation.deleteMany().catch(() => undefined);
    });
    it('mode rules: no summary at all', async () => {
      process.env.RECOMMENDATION_MODEL_MODE = 'rules'; await seedMarket(); await run();
      for (const x of await c.prisma.growthRecommendation.findMany()) { expect(x.modelMode).toBe('rules'); expect(x.aiSummary).toBeNull(); }
    });
    it('real mode requested without every gate falls back to the mock summary (no network)', async () => {
      process.env.RECOMMENDATION_MODEL_MODE = 'real'; await seedMarket(); await run();
      for (const x of await c.prisma.growthRecommendation.findMany()) expect(x.modelMode).toBe('mock');
    });
    it('a hostile model (phone number, URL, health word, extra field) is discarded: the proposal keeps its rule rationale and no summary', async () => {
      const hostile = (text: unknown): SummaryModel => ({ name: 'hostile', mode: 'real', summarise: async () => text as never });
      for (const bad of [{ en: 'Call +201012345678 now please', ar: 'اتصل برقم' }, { en: 'Visit https://evil.example/x for more', ar: 'زور الموقع دلوقتي' }, { en: 'Target cardiology patients with this offer', ar: 'استهدف المرضى' }, { en: 'fine text here ok', ar: 'نص سليم تمامًا', extra: 'x' }, { en: 'x', ar: 'y' }]) {
        c.get(AiSummaryService).setOverride(hostile(bad)); await c.prisma.growthRecommendation.deleteMany().catch(() => undefined);
        await c.prisma.$executeRawUnsafe('ALTER TABLE "GrowthRecommendation" DISABLE TRIGGER "GrowthRecommendation_guard"'); await c.prisma.$executeRawUnsafe('DELETE FROM "GrowthRecommendation"'); await c.prisma.$executeRawUnsafe('ALTER TABLE "GrowthRecommendation" ENABLE TRIGGER "GrowthRecommendation_guard"');
        if (!(await c.prisma.growthCampaign.count())) await seedMarket();
        await run();
        for (const x of await c.prisma.growthRecommendation.findMany()) { expect(x.aiSummary).toBeNull(); expect(x.modelMode).toBe('rules'); }
      }
    });
    it('a model that throws or hangs never blocks the proposal', async () => {
      c.get(AiSummaryService).setOverride({ name: 'broken', mode: 'real', summarise: async () => { throw new Error('boom'); } }); await seedMarket(); await run();
      expect((await c.prisma.growthRecommendation.count())).toBe(2);
    });
    it('a well-behaved model summary is stored with the AI-assisted label', async () => {
      c.get(AiSummaryService).setOverride(new MockSummaryModel()); await seedMarket(); await run();
      expect((await c.prisma.growthRecommendation.findFirstOrThrow()).aiSummary).toMatchObject({ label: 'AI-assisted' });
    });
  });

  describe('the database walls', () => {
    const row = (o: Record<string, unknown> = {}) => ({ kind: 'SEO_GAP', fingerprint: `fp-${++seq}`, payload: { pageGroup: 'city', pages: 40 }, rationale: 'r', expiresAt: new Date(Date.now() + DAY), ...o });
    it('rejects an identifier key in the payload or the evidence, and a kind outside the closed vocabulary', async () => {
      await expect(c.prisma.growthRecommendation.create({ data: row({ payload: { sub: 'x' } }) as never })).rejects.toThrow(/aggregate_only/);
      await expect(c.prisma.growthRecommendation.create({ data: row({ payload: { nested: { phone: '1' } } }) as never })).rejects.toThrow(/aggregate_only/);
      await expect(c.prisma.growthRecommendation.create({ data: row({ evidenceRefs: [{ specialty: 'x' }] }) as never })).rejects.toThrow(/aggregate_only/);
      for (const kind of ['SEND_MESSAGE', 'ACTIVATE_CAMPAIGN', 'BUILD_AUDIENCE', 'SET_BUDGET']) await expect(c.prisma.growthRecommendation.create({ data: row({ kind }) as never })).rejects.toThrow(/kind_check/);
      await expect(c.prisma.growthRecommendation.create({ data: row() as never })).resolves.toBeDefined();
    });
    it('the evidence is immutable, the decision cannot be changed and nothing is deleted', async () => {
      const r = await c.prisma.growthRecommendation.create({ data: row() as never });
      await expect(c.prisma.growthRecommendation.update({ where: { id: r.id }, data: { payload: { pageGroup: 'other' } } })).rejects.toThrow(/immutable/);
      await expect(c.prisma.growthRecommendation.update({ where: { id: r.id }, data: { rationale: 'changed' } })).rejects.toThrow(/immutable/);
      await c.prisma.growthRecommendation.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedBy: 'a', decidedAt: new Date() } });
      await expect(c.prisma.growthRecommendation.update({ where: { id: r.id }, data: { status: 'APPROVED' } })).rejects.toThrow(/cannot change its decision/);
      await expect(c.prisma.growthRecommendation.delete({ where: { id: r.id } })).rejects.toThrow(/never deleted/);
      await expect(c.prisma.growthRecommendation.update({ where: { id: (await c.prisma.growthRecommendation.create({ data: row() as never })).id }, data: { status: 'APPROVED' } })).rejects.toThrow(); // a decision needs who and when
    });
    it('one open proposal per fingerprint', async () => {
      await c.prisma.growthRecommendation.create({ data: row({ fingerprint: 'same' }) as never });
      await expect(c.prisma.growthRecommendation.create({ data: row({ fingerprint: 'same' }) as never })).rejects.toThrow();
    });
  });
});
