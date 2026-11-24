import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';

/**
 * GRW-P3 wave 7 schema (migrations 20270107090000 .. 20270107095000, owner lane A1). Real Postgres. Tables exist, the append-only and state triggers, the privacy CHECKs (k >= 10 as a database rule),
 * the never-experiment surface CHECK, maker-checker CHECKs, the erase and purge functions and idempotent replay of every migration.
 */
describe('growth Phase 3 schema (wave 7)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);
  let seq = 0; const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const V = [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }];
  const exp = (o: Record<string, unknown> = {}) => c.prisma.growthExperiment.create({ data: { key: `e-${uniq()}`, name: 'n', surface: 'landing.home.hero_copy', hypothesis: 'a hypothesis text', variants: V, primaryMetric: 'booking_started', salt: 's', createdBy: 'a', ...o } as any });
  const day = new Date('2027-02-01');

  it('every wave 7 table exists, the product column was added and GrowthMetricDaily already had product', async () => {
    const t = (await c.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`).map((r) => r.tablename);
    for (const n of ['GrowthExperiment', 'GrowthExperimentExposure', 'GrowthExperimentDaily', 'GrowthExperimentResult', 'GrowthExperimentEvent', 'GrowthAttributionModelResult', 'GrowthPathSnapshot', 'GrowthCohortMonthly', 'GrowthLtvEstimate',
      'FraudCase', 'FraudCaseSignal', 'FraudDecisionLog', 'FraudCalibration', 'SeoQualityReport', 'SeoInternalLink', 'SeoVitalSnapshot', 'SeoIndexationSnapshot', 'GrowthProductDecision', 'SponsoredPromotionProjection', 'BookingSponsoredDiscount', 'SponsoredPromotionReview']) expect(t).toContain(n);
    const cols = (await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'GrowthAcquisitionSource'`).map((r) => r.column_name);
    expect(cols).toContain('product');
  });

  describe('experiments', () => {
    it('surface wall in the database, key format, variant list shape, allocation and alpha ranges, maker-checker and approval CHECKs', async () => {
      for (const surface of ['emergency.banner', 'triage.intro', 'consent.banner', 'privacy.text', 'booking.price.table', 'checkout.fee.note', 'clinical.card', 'booking.cancellation.policy', 'pay.commission.copy']) await rejects(exp({ surface }), /surface_never_check/);
      await exp({ surface: 'landing.feedback.prompt' });
      await rejects(exp({ key: 'Bad Key' }), /key_check/);
      await rejects(exp({ variants: [{ key: 'control', weightBp: 10000 }] }), /variants_check/);
      await rejects(exp({ allocationBp: 10001 }), /allocation_check/);
      await rejects(exp({ alphaBp: 0 }), /alpha_check/);
      await rejects(exp({ status: 'LIVE', approvedBy: 'b' }), /status_check/);
      await rejects(exp({ approvedBy: 'a' }), /maker_checker/);
      await rejects(exp({ status: 'RUNNING' }), /approved_check/);
      await rejects(exp({ status: 'STOPPED', approvedBy: 'b' }), /stop_reason_check/);
    });
    it('(market, key) is unique; exposure (experiment, unit) is unique; counts cannot be negative; result and event rows are append-only', async () => {
      const e = await exp(); await rejects(exp({ key: e.key }), /Unique constraint/);
      const x = { experimentId: e.id, day, variant: 'b', unitKind: 'VISITOR', unitHash: 'h1' };
      await c.prisma.growthExperimentExposure.create({ data: x }); await rejects(c.prisma.growthExperimentExposure.create({ data: x }), /Unique constraint/);
      await rejects(c.prisma.growthExperimentExposure.create({ data: { ...x, unitHash: 'h2', unitKind: 'VISITOR', subRef: 'abc' } }), /sub_ref_check/);
      await rejects(c.prisma.growthExperimentDaily.create({ data: { experimentId: e.id, day, variant: 'b', exposures: -1 } }), /counts_check/);
      const r = await c.prisma.growthExperimentResult.create({ data: { experimentId: e.id, verdict: 'COLLECTING' } });
      await rejects(c.prisma.growthExperimentResult.update({ where: { id: r.id }, data: { verdict: 'WINNER' } }), /append-only/);
      await rejects(c.prisma.growthExperimentResult.create({ data: { experimentId: e.id, verdict: 'WON' } }), /verdict_check/);
      const ev = await c.prisma.growthExperimentEvent.create({ data: { experimentId: e.id, kind: 'CREATED', actor: 'a' } });
      await rejects(c.prisma.growthExperimentEvent.delete({ where: { id: ev.id } }), /append-only/);
      await rejects(c.prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT set_config('kx.growth_maintenance','on',true)`); await tx.$executeRawUnsafe(`DELETE FROM "GrowthExperimentEvent"`); }), /append-only/);
      await rejects(c.prisma.growthExperiment.delete({ where: { id: e.id } }), /append-only|not allowed/);
    });
    it('growth_erase_experiments deletes exactly the exposure rows of that person; growth_purge_experiments honours the cutoff', async () => {
      const e = await exp(); const { createHash } = await import('node:crypto'); const ref = createHash('sha256').update('sub_z').digest('hex');
      await c.prisma.growthExperimentExposure.createMany({ data: [
        { experimentId: e.id, day, variant: 'b', unitKind: 'SUB', unitHash: 'a1', subRef: ref }, { experimentId: e.id, day, variant: 'b', unitKind: 'SUB', unitHash: 'a2', subRef: createHash('sha256').update('other').digest('hex') },
        { experimentId: e.id, day, variant: 'b', unitKind: 'VISITOR', unitHash: 'a3', firstAt: new Date('2025-01-01') }] });
      expect(((await c.prisma.$queryRaw<{ r: any }[]>`SELECT growth_erase_experiments('sub_z') AS r`)[0]!.r).experimentExposuresDeleted).toBe(1);
      expect(await c.prisma.growthExperimentExposure.count()).toBe(2);
      expect(((await c.prisma.$queryRaw<{ r: any }[]>`SELECT growth_purge_experiments(now(), 13) AS r`)[0]!.r).experimentExposuresPurged).toBe(1);
      await rejects(c.prisma.$queryRaw`SELECT growth_purge_experiments(now(), 0)`, /months must be/); await rejects(c.prisma.$queryRaw`SELECT growth_erase_experiments('')`, /sub is required/);
    });
  });

  describe('attribution and cohort aggregates: k-anonymity is a database rule', () => {
    const cohort = (o: Record<string, unknown> = {}) => c.prisma.growthCohortMonthly.create({ data: { cohortMonth: day, monthIndex: 0, patients: 12, retainedPatients: 6, ...o } as any });
    it('a cohort cell needs k >= 10 people or is suppressed with every measure zero; retained cannot exceed patients; the floor cannot be lowered', async () => {
      await cohort(); await rejects(cohort({ monthIndex: 1, patients: 9 }), /k_check/);
      await rejects(cohort({ monthIndex: 1, k: 5 }), /k_check/);
      await cohort({ monthIndex: 2, patients: 0, retainedPatients: 0, suppressed: true });
      await rejects(cohort({ monthIndex: 3, patients: 4, retainedPatients: 0, suppressed: true }), /suppressed_check/); // even the small count is hidden
      await rejects(cohort({ monthIndex: 3, patients: 0, retainedPatients: 0, suppressed: true, revenueMinor: 100 }), /suppressed_check/);
      await rejects(cohort({ monthIndex: 4, retainedPatients: 13 }), /values_check/);
      await rejects(cohort(), /Unique constraint/);
    });
    it('path snapshots and LTV estimates: k >= 10, ordered interval, ESTIMATE label, no per-person rows', async () => {
      const p = { day, pathHash: 'ph', length: 2, conversions: 20 };
      await c.prisma.growthPathSnapshot.create({ data: p }); await rejects(c.prisma.growthPathSnapshot.create({ data: { ...p, pathHash: 'p2', conversions: 9 } }), /k_check/);
      const l = { cohortKey: 'k', horizonMonths: 12, estimateMinor: 100, lowMinor: 80, highMinor: 120, modelVersion: 'v1', n: 50 };
      await c.prisma.growthLtvEstimate.create({ data: l });
      await rejects(c.prisma.growthLtvEstimate.create({ data: { ...l, modelVersion: 'v2', lowMinor: 130 } }), /interval_check/); await rejects(c.prisma.growthLtvEstimate.create({ data: { ...l, modelVersion: 'v3', n: 9 } }), /n_check/);
      await rejects(c.prisma.growthLtvEstimate.create({ data: { ...l, modelVersion: 'v4', label: 'ACTUAL' } }), /label_check/);
      await rejects(c.prisma.growthAttributionModelResult.create({ data: { day, model: 'MAGIC', sourceKind: 'X' } }), /model_check/);
      const cols = (await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name IN ('GrowthCohortMonthly','GrowthLtvEstimate','GrowthPathSnapshot')`).map((r) => r.column_name).join(' ');
      expect(cols).not.toMatch(/sub|visitor|phone|email|patientId/i);
    });
  });

  describe('fraud', () => {
    it('one open case per subject and kind; signals and the decision log are append-only; a decided case cannot be re-opened silently, never deleted; subject is fixed', async () => {
      const mk = (o: Record<string, unknown> = {}) => c.prisma.fraudCase.create({ data: { subjectHash: 'sh1', kind: 'REFERRAL', ...o } as any });
      const k = await mk(); await rejects(mk(), /one_open|Unique constraint/); await mk({ kind: 'TOUCH' });
      const s = await c.prisma.fraudCaseSignal.create({ data: { caseId: k.id, ruleId: 'R1', weight: 20, evidenceRef: 'e1' } });
      await rejects(c.prisma.fraudCaseSignal.create({ data: { caseId: k.id, ruleId: 'R1', weight: 20, evidenceRef: 'e1' } }), /Unique constraint/);
      await rejects(c.prisma.fraudCaseSignal.update({ where: { id: s.id }, data: { weight: 1 } }), /append-only/);
      const lg = await c.prisma.fraudDecisionLog.create({ data: { caseId: k.id, action: 'OPENED', toStatus: 'OPEN', actor: 'system' } });
      await rejects(c.prisma.fraudDecisionLog.delete({ where: { id: lg.id } }), /append-only/);
      await rejects(c.prisma.fraudCase.update({ where: { id: k.id }, data: { status: 'CONFIRMED' } }), /decided_check/);
      await c.prisma.fraudCase.update({ where: { id: k.id }, data: { status: 'DISMISSED', decision: 'FALSE_POSITIVE', decidedBy: 'rev', decidedAt: new Date() } });
      await rejects(c.prisma.fraudCase.update({ where: { id: k.id }, data: { status: 'OPEN', decision: null } }), /is decided/);
      await c.prisma.fraudCase.update({ where: { id: k.id }, data: { status: 'APPEALED' } });
      await rejects(c.prisma.fraudCase.update({ where: { id: k.id }, data: { subjectHash: 'other' } }), /fixed/);
      await rejects(c.prisma.fraudCase.delete({ where: { id: k.id } }), /append-only|not allowed/);
      await rejects(mk({ score: 101 }), /score_check/); await rejects(mk({ kind: 'MAGIC', subjectHash: 'x' }), /kind_check/); await rejects(mk({ band: 'EXTREME', subjectHash: 'y' }), /band_check/);
    });
  });

  describe('SEO automation', () => {
    it('score range, locale, no self link, vital source and indexation counts', async () => {
      const q = (o: Record<string, unknown> = {}) => c.prisma.seoQualityReport.create({ data: { pageKey: `p-${uniq()}`, templateKind: 'DOCTOR', locale: 'ar', score: 80, contentHash: 'h', ...o } as any });
      await q(); await rejects(q({ score: 101 }), /score_check/); await rejects(q({ locale: 'fr' }), /locale_check/);
      await rejects(c.prisma.seoInternalLink.create({ data: { fromKey: 'a', toKey: 'a', anchorKind: 'X', rule: 'R' } }), /no_self_check/);
      await rejects(c.prisma.seoVitalSnapshot.create({ data: { templateKind: 'DOCTOR', metric: 'LCP', p75: 2.1, source: 'SYNTH', day } }), /source_check/);
      await rejects(c.prisma.seoIndexationSnapshot.create({ data: { day, templateKind: 'DOCTOR', submitted: 5, indexed: 6 } }), /counts_check/);
    });
  });

  describe('product decision and sponsored promotion projection', () => {
    it('a product decision is append-only, unique per fact and policy, with a real hash and known vocabulary', async () => {
      const d = { product: 'PHARMACY', factKind: 'ORDER', factId: 'o1', origin: 'PROVIDER_LED', reasonCode: 'X', policyVersionId: 'pv', inputsHash: 'a'.repeat(64) };
      const row = await c.prisma.growthProductDecision.create({ data: d });
      await rejects(c.prisma.growthProductDecision.create({ data: d }), /Unique constraint/);
      await rejects(c.prisma.growthProductDecision.update({ where: { id: row.id }, data: { origin: 'MARKETPLACE' } }), /append-only/);
      await rejects(c.prisma.growthProductDecision.create({ data: { ...d, factId: 'o2', inputsHash: 'short' } }), /inputs_hash_check/);
      await rejects(c.prisma.growthProductDecision.create({ data: { ...d, factId: 'o3', product: 'CAFE' } }), /product_check/);
      await rejects(c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'PROVIDER_LINK', sourceRef: 'zz', product: 'CAFE' } }), /product_check/);
      expect((await c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'PROVIDER_LINK', sourceRef: 'yy' } })).product).toBe('CLINIC');
    });
    it('one promotion per booking, forward-only line state, fixed amount, review maker-checker and immutability, no foreign key to patient credit', async () => {
      const l = { bookingIntentId: 'kx_bk_1', promotionId: 'pr1', promotionVersion: 1, amountMinor: 100, reservationRef: 'r1' };
      const row = await c.prisma.bookingSponsoredDiscount.create({ data: l });
      await rejects(c.prisma.bookingSponsoredDiscount.create({ data: { ...l, reservationRef: 'r2' } }), /Unique constraint/);
      await rejects(c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { amountMinor: 1 } }), /fixed/);
      await rejects(c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { state: 'REVERSED', debitRef: 'd' } }), /cannot move/);
      await rejects(c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { state: 'DEBITED' } }), /debit_check/);
      await c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { state: 'DEBITED', debitRef: 'wal_1' } });
      await c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { state: 'REVERSED' } });
      await rejects(c.prisma.bookingSponsoredDiscount.update({ where: { id: row.id }, data: { state: 'RESERVED' } }), /cannot move/);
      await rejects(c.prisma.bookingSponsoredDiscount.delete({ where: { id: row.id } }), /append-only/);
      const rv = await c.prisma.sponsoredPromotionReview.create({ data: { promotionId: 'pr1', promotionVersion: 1, kind: 'HIGH_VALUE', requestedBy: 'a' } });
      await rejects(c.prisma.sponsoredPromotionReview.update({ where: { id: rv.id }, data: { decidedBy: 'a', decision: 'APPROVED', decidedAt: new Date() } }), /maker_checker/);
      await rejects(c.prisma.sponsoredPromotionReview.update({ where: { id: rv.id }, data: { decidedBy: 'b' } }), /decided_check/);
      await c.prisma.sponsoredPromotionReview.update({ where: { id: rv.id }, data: { decidedBy: 'b', decision: 'APPROVED', decidedAt: new Date() } });
      await rejects(c.prisma.sponsoredPromotionReview.update({ where: { id: rv.id }, data: { reason: 'later' } }), /already decided/);
      const fks = await c.prisma.$queryRaw<{ ref: string }[]>`SELECT confrelid::regclass::text AS ref FROM pg_constraint WHERE contype='f' AND conrelid IN ('"BookingSponsoredDiscount"'::regclass, '"SponsoredPromotionProjection"'::regclass, '"SponsoredPromotionReview"'::regclass)`;
      expect(fks.map((f) => f.ref).join(' ')).not.toMatch(/Reward|Lot|Credit/);
      await c.prisma.sponsoredPromotionProjection.create({ data: { promotionId: 'pr1', orgRef: 'org_A', version: 1, status: 'ACTIVE' } });
      await rejects(c.prisma.sponsoredPromotionProjection.create({ data: { promotionId: 'pr2', orgRef: 'org_A', version: 1, status: 'LIVE' } }), /status_check/);
      await rejects(c.prisma.sponsoredPromotionProjection.create({ data: { promotionId: 'pr3', orgRef: 'org_A', version: 1, status: 'ACTIVE', startsAt: new Date('2027-02-02'), endsAt: new Date('2027-02-01') } }), /window_check/);
    });
  });

  it('every wave 7 migration is idempotent when replayed (twice, in order)', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations'); const files = readdirSync(dir).filter((f) => /^20270107\d{6}_/.test(f)).sort();
    expect(files.length).toBeGreaterThanOrEqual(6);
    const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { for (const f of files) { await cl.query(readFileSync(join(dir, f, 'migration.sql'), 'utf8')); await cl.query(readFileSync(join(dir, f, 'migration.sql'), 'utf8')); } } finally { await cl.end(); }
    await c.prisma.growthExperiment.count();
  });
  it('migration names sort strictly after every earlier migration and no two share a prefix', () => {
    const names = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).filter((f) => /^\d{14}_/.test(f)).sort();
    const prefixes = names.map((n) => n.slice(0, 14)); expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(names.filter((n) => n.startsWith('20270107')).every((n) => n > '20261217090000')).toBe(true);
  });
});
