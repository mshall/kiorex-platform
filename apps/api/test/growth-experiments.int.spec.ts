import { createCtx, TestCtx } from './harness';
import { unlockFlag } from './growth-helpers';
import { GrowthMaintenanceService } from '../src/growth/growth-public';
import { ExperimentEvaluatorJob } from '../src/growth/experiments/experiment-evaluator.job';
import { ExperimentService } from '../src/growth/experiments/experiment.service';
import { unitHashOf } from '../src/growth/experiments/assignment';
import { sha256hex } from '../src/growth/experiments/exposure.service';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/experiments';
const PUB = '/api/v1/growth/v1/experiments';
const DAY = 86_400_000;
const KXV = 'kxv_abcdefghijklmnopqrstuv';

/**
 * GRW-P3-A over the real HTTP stack and Postgres: lifecycle with the two-person rule, the never-experiment wall, consent matrix, eligibility, exposure idempotency, the rollup and the evaluator with a time-travelled clock
 * (winner, SRM, guardrail breach, end date), stop reverting to control at once, flag OFF contract, role matrix, history, ship-winner proposal, erasure of person-linked exposure rows.
 */
describe('growth experiments (GRW-P3-A)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth; let patient: Auth;
  const svc = () => c.get(ExperimentService); const job = () => c.get(ExperimentEvaluatorJob);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); await unlockFlag(c, 'growth.analytics_visitor');
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('p_1');
  });
  const body = (o: Record<string, unknown> = {}) => ({ key: `exp-${Math.random().toString(36).slice(2, 8)}`, name: 'Hero copy', surface: 'landing.home.hero_copy', hypothesis: 'A shorter headline raises booking starts', variants: [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }], primaryMetric: 'booking_started', minSample: 500, plannedDays: 14, guardrails: [{ metric: 'message_opt_out', marginAbs: 0.01 }], ...o });
  const create = async (o: Record<string, unknown> = {}) => (await c.http().post(BASE).set(A).send(body(o)).expect(201)).body;
  const start = async (o: Record<string, unknown> = {}, startedAt = new Date()) => { const e = await create(o); await c.http().post(`${BASE}/${e.id}/submit`).set(A).expect(200); await svc().approveAndStart({ sub: 'adm_b', kind: 'USER' }, e.id, startedAt); return (await c.prisma.growthExperiment.findUniqueOrThrow({ where: { id: e.id } })); };
  const consentGet = (extra: Record<string, string> = {}) => c.http().get(`${PUB}/assignments`).set({ 'X-KX-Consent': 'analytics', Cookie: `kxv=${KXV}`, ...extra });

  /** Seeds exposures and conversion events straight into the tables, as if the visitors had been served: `perDay` units per arm per day. */
  async function seedRun(e: { id: string; salt: string; startedAt: Date | null }, o: { days: number; perDay: number; rate: Record<string, number>; guard?: Record<string, number>; skew?: Record<string, number> }) {
    const ex: any[] = []; const ev: any[] = [];
    for (let d = 0; d < o.days; d++) for (const v of ['control', 'b']) {
      const n = Math.round(o.perDay * (o.skew?.[v] ?? 1));
      for (let i = 0; i < n; i++) {
        const vk = `kxv_${e.id.slice(-6)}_${v}_${d}_${i}`; const firstAt = new Date(e.startedAt!.getTime() + d * DAY + 3_600_000);
        ex.push({ experimentId: e.id, day: new Date(firstAt.toISOString().slice(0, 10)), variant: v, unitKind: 'VISITOR', unitHash: unitHashOf(e.salt, `v:${vk}`), firstAt });
        if (i < Math.round(o.perDay * o.rate[v]!)) ev.push({ name: 'BookingInitiated', visitorKey: vk, occurredAt: new Date(firstAt.getTime() + 3_600_000), dedupeKey: `bi|${e.id}|${vk}` });
        if (o.guard && i < Math.round(o.perDay * (o.guard[v] ?? 0))) ev.push({ name: 'MessageOptOut', visitorKey: vk, occurredAt: new Date(firstAt.getTime() + 7_200_000), dedupeKey: `oo|${e.id}|${vk}` });
      }
    }
    await c.prisma.growthExperimentExposure.createMany({ data: ex }); await c.prisma.growthEvent.createMany({ data: ev });
  }
  const fresh = (id: string) => c.prisma.growthExperiment.findUniqueOrThrow({ where: { id } });

  describe('lifecycle, wall and roles', () => {
    it('creates a DRAFT with a salt, a pre-registered sample and a CREATED history row; the list and catalog answer ops roles', async () => {
      const e = await create({ baselineRate: 0.1, mdeAbs: 0.02, minSample: undefined });
      expect(e.status).toBe('DRAFT'); expect(e.salt).toHaveLength(32); expect(Math.abs(e.minSample - 3841)).toBeLessThanOrEqual(8);
      expect((await c.http().get(BASE).set(ops).expect(200)).body).toHaveLength(1);
      const cat = (await c.http().get(`${BASE}/catalog`).set(ops).expect(200)).body; expect(cat.surfaces.length).toBeGreaterThan(5); expect(cat.policy.minRunDays).toBe(7);
      expect((await c.http().get(`${BASE}/${e.id}/history`).set(ops).expect(200)).body.map((x: any) => x.kind)).toEqual(['CREATED']);
    });
    it('a forbidden or unknown surface is refused with 422 EXPERIMENT_SURFACE_FORBIDDEN and no row exists', async () => {
      for (const surface of ['emergency.guidance.banner', 'triage.symptom_checker.intro', 'privacy.notice.text', 'consent.analytics.banner', 'booking.price.disclosure', 'checkout.fee.note', 'regulatory.disclaimer', 'clinical.content.card', 'booking.cancellation.policy_text', 'landing.unlisted']) {
        const r = await c.http().post(BASE).set(A).send(body({ surface })).expect(422); expect(r.body.code).toBe('EXPERIMENT_SURFACE_FORBIDDEN');
      }
      expect(await c.prisma.growthExperiment.count()).toBe(0);
    });
    it('variants cannot carry a payload, weights must sum to 10000, safety flags cannot be linked; the database repeats the surface wall', async () => {
      expect((await c.http().post(BASE).set(A).send(body({ variants: [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000, discountMinor: 5 }] })).expect(400)).body.code).toBe('EXPERIMENT_INVALID');
      await c.http().post(BASE).set(A).send(body({ variants: [{ key: 'control', weightBp: 6000 }, { key: 'b', weightBp: 5000 }] })).expect(400);
      expect((await c.http().post(BASE).set(A).send(body({ flagKey: 'growth.patient_credit' })).expect(422)).body.code).toBe('EXPERIMENT_FLAG_FORBIDDEN');
      await expect(c.prisma.growthExperiment.create({ data: { key: 'bypass-1', name: 'x', surface: 'consent.banner.copy', hypothesis: 'bypass attempt via prisma', variants: [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }], primaryMetric: 'booking_started', salt: 's', createdBy: 'x' } })).rejects.toThrow(/surface_never_check/);
    });
    it('roles: ops_admin reads but cannot create; a patient token cannot reach the admin API; unauthenticated is 401', async () => {
      await c.http().post(BASE).set(ops).send(body()).expect(403);
      await c.http().get(BASE).set(patient).expect(403);
      await c.http().get(BASE).expect(401);
    });
    it('two-person rule: the author cannot approve, a second super admin can; the experiment starts RUNNING with approver and start time; a self-approval is also refused by the database', async () => {
      const e = await create(); await c.http().post(`${BASE}/${e.id}/submit`).set(A).expect(200);
      expect((await c.http().post(`${BASE}/${e.id}/approve`).set(A).expect(403)).body.code).toBe('SECOND_APPROVER_REQUIRED');
      const r = (await c.http().post(`${BASE}/${e.id}/approve`).set(B).expect(200)).body;
      expect(r).toMatchObject({ status: 'RUNNING', approvedBy: 'adm_b' }); expect(r.startedAt).toBeTruthy();
      await expect(c.prisma.growthExperiment.update({ where: { id: e.id }, data: { approvedBy: 'adm_a' } })).rejects.toThrow(/maker_checker|frozen/);
    });
    it('a DRAFT is editable, a submitted one is not; only a PENDING_APPROVAL can start', async () => {
      const e = await create(); await c.http().patch(`${BASE}/${e.id}`).set(A).send({ name: 'Renamed', allocationBp: 5000 }).expect(200);
      await c.http().post(`${BASE}/${e.id}/approve`).set(B).expect(409);
      await c.http().post(`${BASE}/${e.id}/submit`).set(A).expect(200);
      expect((await c.http().patch(`${BASE}/${e.id}`).set(A).send({ name: 'Late' }).expect(409)).body.code).toBe('EXPERIMENT_NOT_EDITABLE');
    });
    it('one running experiment per surface and market: a second start is 409 EXPERIMENT_SURFACE_BUSY, also under 5 parallel starts', async () => {
      await start();
      const ids: string[] = []; for (let i = 0; i < 3; i++) { const e = await create(); await c.http().post(`${BASE}/${e.id}/submit`).set(A).expect(200); ids.push(e.id); }
      const res = await Promise.allSettled(ids.map((id) => svc().approveAndStart({ sub: 'adm_b', kind: 'USER' }, id)));
      expect(res.every((r) => r.status === 'rejected')).toBe(true);
      const other = await create({ surface: 'signup.value_proposition' }); await c.http().post(`${BASE}/${other.id}/submit`).set(A).expect(200); await c.http().post(`${BASE}/${other.id}/approve`).set(B).expect(200);
      // parallel starts on one fresh surface: exactly one wins
      const p: string[] = []; for (let i = 0; i < 4; i++) { const e = await create({ surface: 'landing.search.empty_state' }); await c.http().post(`${BASE}/${e.id}/submit`).set(A).expect(200); p.push(e.id); }
      const r2 = await Promise.allSettled(p.map((id) => svc().approveAndStart({ sub: 'adm_b', kind: 'USER' }, id)));
      expect(r2.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
    it('the design is frozen once started (weights, allocation, salt, surface, eligibility), terminal states are final, history cannot be edited or deleted', async () => {
      const e = await start();
      for (const data of [{ variants: [{ key: 'control', weightBp: 9000 }, { key: 'b', weightBp: 1000 }] }, { allocationBp: 100 }, { salt: 'new' }, { surface: 'signup.value_proposition' }, { eligibility: { stage: 'new' } }]) await expect(c.prisma.growthExperiment.update({ where: { id: e.id }, data: data as any })).rejects.toThrow(/frozen/);
      await expect(c.prisma.growthExperiment.delete({ where: { id: e.id } })).rejects.toThrow(/append-only|not allowed|referenc/);
      const ev = await c.prisma.growthExperimentEvent.findFirstOrThrow({ where: { experimentId: e.id } });
      await expect(c.prisma.growthExperimentEvent.update({ where: { id: ev.id }, data: { actor: 'x' } })).rejects.toThrow(/append-only/);
      await c.http().post(`${BASE}/${e.id}/stop`).set(A).send({ reason: 'test stop' }).expect(200);
      await expect(c.prisma.growthExperiment.update({ where: { id: e.id }, data: { status: 'RUNNING' } })).rejects.toThrow(/cannot leave/);
      await c.http().post(`${BASE}/${e.id}/archive`).set(A).expect(200);
      await expect(c.prisma.growthExperiment.update({ where: { id: e.id }, data: { name: 'x' } })).rejects.toThrow(/archived/);
    });
  });

  describe('assignment fetch, consent matrix, eligibility, exposure', () => {
    it('no consent header, or the header without the visitor cookie: no assignment, no Set-Cookie, control everywhere', async () => {
      await start();
      const a = await c.http().get(`${PUB}/assignments`).set({ Cookie: `kxv=${KXV}` }).expect(200); expect(a.body).toMatchObject({ assignments: [], unit: 'NONE' }); expect(a.headers['set-cookie']).toBeUndefined();
      const b = await c.http().get(`${PUB}/assignments`).set({ 'X-KX-Consent': 'analytics' }).expect(200); expect(b.body.assignments).toEqual([]); expect(b.headers['set-cookie']).toBeUndefined();
      const d = await c.http().get(`${PUB}/assignments`).set({ 'X-KX-Consent': 'marketing', Cookie: `kxv=${KXV}` }).expect(200); expect(d.body.assignments).toEqual([]);
      const forged = await c.http().get(`${PUB}/assignments`).set({ 'X-KX-Consent': 'analytics', Cookie: 'kxv=not-a-key' }).expect(200); expect(forged.body.assignments).toEqual([]);
    });
    it('with consent and the visitor key: a stable assignment, the kxe cookie, a private 10-minute cache header', async () => {
      const e = await start({ allocationBp: 10000 });
      const r = await consentGet().expect(200); expect(r.body.assignments).toHaveLength(1);
      expect(r.body.assignments[0]).toMatchObject({ experiment: e.key, surface: 'landing.home.hero_copy' }); expect(['control', 'b']).toContain(r.body.assignments[0].variant);
      expect(r.headers['cache-control']).toBe('private, max-age=600'); expect(String(r.headers['set-cookie'])).toMatch(/kxe=/);
      for (let i = 0; i < 5; i++) expect((await consentGet().expect(200)).body.assignments[0].variant).toBe(r.body.assignments[0].variant);
      expect(r.body.assignments[0]).not.toHaveProperty('salt');
    });
    it('consent withdrawn clears the kxe cookie', async () => {
      await start(); const r = await c.http().get(`${PUB}/assignments`).set({ Cookie: `kxe=exp%3Ab` }).expect(200);
      expect(String(r.headers['set-cookie'])).toMatch(/kxe=;.*Max-Age=0/);
    });
    it('market and locale eligibility: an ineligible visitor sees control and is never enrolled', async () => {
      await start({ eligibility: { markets: ['EG'], locales: ['en'] } });
      expect((await consentGet({ 'Accept-Language': 'ar' }).expect(200)).body.assignments).toEqual([]);
      expect((await consentGet({ 'Accept-Language': 'en' }).expect(200)).body.assignments).toHaveLength(1);
      expect((await consentGet({ 'Accept-Language': 'en', 'X-Kiorex-Market': 'SA' }).expect(200)).body.assignments).toEqual([]);
    });
    it('exposure is idempotent per unit, ignores any variant the client claims, and is recorded only for an enrolled unit', async () => {
      const e = await start(); const post = (h: Record<string, string> = {}) => c.http().post(`${PUB}/exposures`).set({ 'X-KX-Consent': 'analytics', Cookie: `kxv=${KXV}`, ...h });
      const first = (await post().send({ experiment: e.key, variant: 'b' }).expect(200)).body; const again = (await post().send({ experiment: e.key }).expect(200)).body;
      expect(first.recorded).toBe(true); expect(again.recorded).toBe(false); expect(again.variant).toBe(first.variant);
      const rows = await c.prisma.growthExperimentExposure.findMany({ where: { experimentId: e.id } });
      expect(rows).toHaveLength(1); expect(rows[0]!.variant).toBe(first.variant); expect(rows[0]!.unitHash).toBe(unitHashOf(e.salt, `v:${KXV}`)); expect(rows[0]!.subRef).toBeNull();
      expect((await c.http().post(`${PUB}/exposures`).send({ experiment: e.key }).expect(200)).body.recorded).toBe(false); // no consent: nothing written
      expect((await post().send({ experiment: 'unknown-exp' }).expect(200)).body.recorded).toBe(false);
      await post().send({}).expect(400);
      expect(await c.prisma.growthExperimentExposure.count()).toBe(1);
    });
    it('signed-in units: in-product surface assignments by sub with an exposure row carrying only sha256(sub); a visitor-only call cannot see a SUB-only surface', async () => {
      const e = await start({ surface: 'referral.invite_prompt', primaryMetric: 'booking_confirmed' });
      const r = (await c.http().get(`${PUB}/me/assignments`).set(patient).expect(200)).body; expect(r.unit).toBe('SUB'); expect(r.assignments).toHaveLength(1);
      expect((await c.http().post(`${PUB}/me/exposures`).set(patient).send({ experiment: e.key }).expect(200)).body.recorded).toBe(true);
      const row = await c.prisma.growthExperimentExposure.findFirstOrThrow({ where: { experimentId: e.id } }); expect(row.subRef).toBe(sha256hex('p_1')); expect(row.unitKind).toBe('SUB'); expect(JSON.stringify(row)).not.toContain('p_1');
      expect((await consentGet().expect(200)).body.assignments).toEqual([]);
      await c.http().get(`${PUB}/me/assignments`).expect(401);
    });
    it('weights hold at scale: 600 consented visitors split 50/50 within sampling noise, and the same visitor is always in the same arm', async () => {
      process.env.GROWTH_RATE_TOUCH_PER_MIN = '100000'; await start(); const n: Record<string, number> = { control: 0, b: 0 };
      for (let i = 0; i < 600; i++) { const r = await c.http().get(`${PUB}/assignments`).set({ 'X-KX-Consent': 'analytics', Cookie: `kxv=kxv_v${String(i).padStart(24, '0')}` }); n[r.body.assignments[0].variant]!++; }
      expect(n.control! + n.b!).toBe(600); expect(Math.abs(n.control! - 300)).toBeLessThan(45); delete process.env.GROWTH_RATE_TOUCH_PER_MIN;
    }, 60_000);
  });

  describe('evaluation with a time-travelled clock', () => {
    it('collecting before the minimum days (nothing is hidden or shown wrongly), then a WINNER after the planned days: concluded, interval above zero, history and snapshots written', async () => {
      const e = await start({}, new Date(Date.now() - 15 * DAY)); await seedRun(e, { days: 14, perDay: 100, rate: { control: 0.1, b: 0.16 }, guard: { control: 0.03, b: 0.03 } });
      const early = await job().runOnce(new Date(e.startedAt!.getTime() + 3 * DAY)); expect(early.evaluated).toBe(1); expect(early.concluded).toBe(0);
      let res = (await c.http().get(`${BASE}/${e.id}/results`).set(ops).expect(200)).body; expect(res[0].verdict).toBe('COLLECTING'); expect(res[0].payload.hidden).toBe(true); expect(res[0].payload.treatments).toBeUndefined();
      const out = await job().runOnce(new Date(e.startedAt!.getTime() + 14 * DAY)); expect(out.concluded).toBe(1);
      const done = await fresh(e.id); expect(done.status).toBe('CONCLUDED');
      res = (await c.http().get(`${BASE}/${e.id}/results`).set(ops).expect(200)).body; expect(res[0].verdict).toBe('WINNER'); expect(res[0].payload.winner).toBe('b'); expect(res[0].payload.srm.detected).toBe(false); expect(res[0].payload.treatments[0].ci.low).toBeGreaterThan(0);
      const daily = await c.prisma.growthExperimentDaily.findMany({ where: { experimentId: e.id } }); expect(daily).toHaveLength(28); expect(daily.reduce((a, d) => a + d.exposures, 0)).toBe(2800);
      expect(JSON.stringify(res)).not.toMatch(/kxv_/);
      const hist = (await c.http().get(`${BASE}/${e.id}/history`).set(ops).expect(200)).body.map((x: any) => x.kind); expect(hist).toEqual(expect.arrayContaining(['CREATED', 'APPROVED', 'STARTED', 'CONCLUDED']));
      expect((await c.http().get(`${BASE}/${e.id}`).set(ops).expect(200)).body.latestResult.verdict).toBe('WINNER');
    });
    it('ship-winner records a proposal and applies nothing; only a concluded WINNER; twice is a duplicate, not a second proposal', async () => {
      const x = await start({}, new Date(Date.now() - 15 * DAY));
      await c.http().post(`${BASE}/${x.id}/ship-winner`).set(A).expect(409);
      await seedRun(x, { days: 14, perDay: 100, rate: { control: 0.1, b: 0.16 } }); await job().runOnce(new Date(x.startedAt!.getTime() + 14 * DAY));
      const flagsBefore = await c.prisma.flagValue.count(); const cfgBefore = await c.prisma.growthConfigVersion.count();
      const r = (await c.http().post(`${BASE}/${x.id}/ship-winner`).set(A).expect(200)).body; expect(r).toMatchObject({ requested: true, duplicate: false }); expect(r.proposal).toMatchObject({ winner: 'b', autoApplied: false });
      expect((await c.http().post(`${BASE}/${x.id}/ship-winner`).set(A).expect(200)).body.duplicate).toBe(true);
      expect(await c.prisma.flagValue.count()).toBe(flagsBefore); expect(await c.prisma.growthConfigVersion.count()).toBe(cfgBefore);
      expect(await c.prisma.growthExperimentEvent.count({ where: { experimentId: x.id, kind: 'SHIP_REQUESTED' } })).toBe(1);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.experiment.ship_requested' } })).toBe(1);
    });
    it('SRM: results hidden, an SRM event and an outbox event are written, the experiment is stopped', async () => {
      const e = await start({}, new Date(Date.now() - 10 * DAY)); await seedRun(e, { days: 9, perDay: 100, rate: { control: 0.1, b: 0.16 }, skew: { b: 0.8 } });
      const out = await job().runOnce(new Date(e.startedAt!.getTime() + 9 * DAY)); expect(out.stopped).toBe(1);
      const s = await fresh(e.id); expect(s.status).toBe('STOPPED'); expect(s.stopReason).toMatch(/^SRM_DETECTED/);
      const res = (await c.http().get(`${BASE}/${e.id}/results`).set(ops).expect(200)).body; expect(res[0].verdict).toBe('SRM_DETECTED'); expect(res[0].payload.hidden).toBe(true); expect(JSON.stringify(res[0].payload)).not.toMatch(/winner|"ci"|treatments/);
      expect(await c.prisma.growthExperimentEvent.count({ where: { experimentId: e.id, kind: 'SRM' } })).toBe(1);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'ExperimentSrmDetected' } })).toBe(1);
    });
    it('guardrail breach auto-stops within 3 days at 400 exposures per arm per day (opt-out 9% vs 3%, margin 1 point); an in-margin rise does not', async () => {
      const bad = await start({}, new Date(Date.now() - 4 * DAY)); await seedRun(bad, { days: 3, perDay: 400, rate: { control: 0.1, b: 0.1 }, guard: { control: 0.03, b: 0.09 } });
      const jo = await job().runOnce(new Date(bad.startedAt!.getTime() + 3 * DAY));
      expect(jo.stopped).toBe(1);
      const s = await fresh(bad.id); expect(s.status).toBe('STOPPED'); expect(s.stopReason).toMatch(/GUARDRAIL_BREACH: GUARDRAIL:message_opt_out/);
      const ok = await start({ surface: 'signup.value_proposition' }, new Date(Date.now() - 4 * DAY)); await seedRun(ok, { days: 3, perDay: 400, rate: { control: 0.1, b: 0.1 }, guard: { control: 0.03, b: 0.034 } });
      const jo2 = await job().runOnce(new Date(ok.startedAt!.getTime() + 3 * DAY)); expect((await fresh(ok.id)).stopReason).toBeNull(); expect(jo2.stopped).toBe(0); expect((await fresh(ok.id)).status).toBe('RUNNING');
    });
    it('events that cannot be tied to the same unit key are dropped (another visitor key, or before the exposure)', async () => {
      const e = await start({}, new Date(Date.now() - 8 * DAY)); const firstAt = new Date(e.startedAt!.getTime() + 3_600_000);
      await c.prisma.growthExperimentExposure.createMany({ data: ['control', 'b'].map((v, i) => ({ experimentId: e.id, day: new Date(firstAt.toISOString().slice(0, 10)), variant: v, unitKind: 'VISITOR', unitHash: unitHashOf(e.salt, `v:kxv_u${i}`), firstAt })) });
      await c.prisma.growthEvent.createMany({ data: [{ name: 'BookingInitiated', visitorKey: 'kxv_stranger', occurredAt: new Date(firstAt.getTime() + 1000), dedupeKey: 'x1' }, { name: 'BookingInitiated', visitorKey: 'kxv_u0', occurredAt: new Date(firstAt.getTime() - 60_000), dedupeKey: 'x2' }, { name: 'BookingInitiated', visitorKey: 'kxv_u1', occurredAt: new Date(firstAt.getTime() + 60_000), dedupeKey: 'x3' }] });
      await job().runOnce(new Date(e.startedAt!.getTime() + 2 * DAY));
      const d = await c.prisma.growthExperimentDaily.findMany({ where: { experimentId: e.id } }); expect(d.find((x) => x.variant === 'control')!.conversions).toBe(0); expect(d.find((x) => x.variant === 'b')!.conversions).toBe(1);
    });
    it('too little sample far past the end: stopped INSUFFICIENT; the job writes a heartbeat and is idempotent', async () => {
      const e = await start({ minSample: 1_000_000 }, new Date(Date.now() - 31 * DAY)); await seedRun(e, { days: 5, perDay: 50, rate: { control: 0.1, b: 0.1 } });
      await job().runOnce(new Date(e.startedAt!.getTime() + 30 * DAY)); expect((await fresh(e.id)).stopReason).toBe('END_DATE_INSUFFICIENT_SAMPLE');
      expect((await job().runOnce()).evaluated).toBe(0); expect(await c.prisma.growthJobRun.count({ where: { job: 'experiment-evaluator', finishedAt: { not: null } } })).toBe(2);
    });
  });

  describe('stop, flag OFF and erasure', () => {
    it('stop needs a reason and reverts every unit to control immediately; the exposure endpoint then records nothing', async () => {
      const e = await start(); expect((await consentGet().expect(200)).body.assignments).toHaveLength(1);
      await c.http().post(`${BASE}/${e.id}/stop`).set(A).send({}).expect(400);
      await c.http().post(`${BASE}/${e.id}/stop`).set(ops).send({ reason: 'x y z' }).expect(403);
      await c.http().post(`${BASE}/${e.id}/stop`).set(A).send({ reason: 'copy under review' }).expect(200);
      expect((await consentGet().expect(200)).body.assignments).toEqual([]);
      expect((await c.http().post(`${PUB}/exposures`).set({ 'X-KX-Consent': 'analytics', Cookie: `kxv=${KXV}` }).send({ experiment: e.key }).expect(200)).body.recorded).toBe(false);
      expect(await c.prisma.growthExperimentEvent.findFirst({ where: { experimentId: e.id, kind: 'STOPPED' } })).toMatchObject({ actor: 'adm_a', reason: 'copy under review' });
    });
    it('flag OFF: the public fetch answers 200 with no assignments and writes nothing, writes are 403 FEATURE_DISABLED, reads work, stop still works, the evaluator stops running experiments (kill switch)', async () => {
      const e = await start();
      const off = await c.http().put('/api/v1/admin/flags/growth.experiments/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: false }); expect([200, 202]).toContain(off.status); c.flags.invalidate();
      expect((await consentGet().expect(200)).body.assignments).toEqual([]);
      expect((await c.http().post(`${PUB}/exposures`).set({ 'X-KX-Consent': 'analytics', Cookie: `kxv=${KXV}` }).send({ experiment: e.key }).expect(200)).body.recorded).toBe(false);
      const w = await c.http().post(BASE).set(A).send(body()).expect(403); expect(w.body.code).toBe('FEATURE_DISABLED'); expect(w.body.key).toBe('growth.experiments');
      await c.http().get(BASE).set(ops).expect(200); await c.http().get(`${BASE}/${e.id}`).set(ops).expect(200);
      expect((await job().runOnce()).killed).toBe(1); expect((await fresh(e.id)).stopReason).toMatch(/KILL_SWITCH/);
    });
    it('erasure deletes the exposure rows of an authenticated person and leaves visitor exposures and the aggregates; purge ages out old exposures', async () => {
      const e = await start({ surface: 'referral.invite_prompt', primaryMetric: 'booking_confirmed' });
      await c.http().post(`${PUB}/me/exposures`).set(patient).send({ experiment: e.key }).expect(200);
      await c.prisma.growthExperimentExposure.create({ data: { experimentId: e.id, day: new Date(), variant: 'control', unitKind: 'VISITOR', unitHash: 'v1', firstAt: new Date(Date.now() - 400 * DAY) } });
      await c.prisma.growthExperimentDaily.create({ data: { experimentId: e.id, day: new Date(), variant: 'control', exposures: 5 } });
      const m = c.get(GrowthMaintenanceService);
      expect((await m.eraseSubject('p_1')).experimentExposuresDeleted).toBe(1);
      expect(await c.prisma.growthExperimentExposure.count({ where: { experimentId: e.id } })).toBe(1); expect(await c.prisma.growthExperimentDaily.count()).toBe(1);
      expect((await m.purgeExpired()).experimentExposuresPurged).toBe(1);
      expect(await c.prisma.growthExperimentExposure.count()).toBe(0);
    });
  });
});
