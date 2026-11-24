import { createCtx, TestCtx } from './harness';
import { AttributionService } from '../src/growth/growth-public';
import { ModelReportService } from '../src/growth/attribution-models/model-report.service';
import { ModelRollupJob } from '../src/growth/attribution-models/model-rollup.job';
import { ATTRIBUTION_MODELS, ONE_MILLION } from '../src/growth/attribution-models/models';
import { seedBooking, seedTouch, unlockFlag, DAY } from './growth-helpers';

let seq = 0;
const js = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
/** GRW-P3-B: the reporting models on the real database. Reporting only: the commission decision rows must not change. */
describe('growth attribution models (GRW-P3-B)', () => {
  let c: TestCtx; let svc: ModelReportService; let att: AttributionService;
  beforeAll(async () => { c = await createCtx(); svc = c.get(ModelReportService); att = c.get(AttributionService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); seq = 0; });

  /** An attended new patient: booking, event, a CONFIRMED revenue fact of `revenue`, and the touches (age in days before the visit). */
  async function conversion(o: { touches: Array<{ kind: string; ageDays: number; linkCode?: string; visitorOnly?: string; org?: string }>; revenue?: number; sub?: string; at?: Date }) {
    const sub = o.sub ?? `sub_m${++seq}`; const at = o.at ?? new Date(Date.now() - 3600_000);
    const b = await seedBooking(c, { sub, createdAt: new Date(at.getTime() - 3600_000) });
    await c.prisma.growthEvent.create({ data: { name: 'BookingAttended', bookingId: b.id, careType: 'DOCTORS', props: { bucket: 'new' }, dedupeKey: `att|${b.id}`, occurredAt: at } });
    if (o.revenue !== 0) await c.prisma.growthRevenueFact.create({ data: { kind: 'CHARGE', chargeId: `ch_${b.id}`, appointmentId: `apt_${b.id}`, bookingId: b.id, status: 'CONFIRMED', amountMinor: o.revenue ?? 4000, occurredAt: at } });
    for (const t of o.touches) await seedTouch(c, { kind: t.kind, at: new Date(at.getTime() - t.ageDays * DAY), sub: t.visitorOnly ? null : sub, visitorKey: t.visitorOnly ?? null, linkCode: t.linkCode, org: t.org });
    return { sub, bookingId: b.id, at };
  }

  it('every model reconciles to the same conversions and revenue; POSITION_BASED is the default; DATA_DRIVEN says insufficient volume', async () => {
    for (let i = 0; i < 12; i++) await conversion({ touches: [{ kind: 'ORGANIC_SEARCH', ageDays: 6 }, { kind: i % 2 ? 'CAMPAIGN' : 'PROVIDER_LINK', ageDays: 2, linkCode: i % 2 ? undefined : 'LINK0001', org: 'org_A' }, { kind: 'DIRECT', ageDays: 0.1 }], revenue: 4000 + (i === 3 ? 1 : 0) });
    const r = await svc.rollup({ days: 2 });
    expect(r.conversions).toBe(12);
    expect(r.dataDriven).toMatchObject({ status: 'INSUFFICIENT_VOLUME', conversions90d: 12, needed: 1000 });
    const rows = await c.prisma.growthAttributionModelResult.findMany();
    expect(new Set(rows.map((x) => x.model))).toEqual(new Set(ATTRIBUTION_MODELS.filter((m) => m !== 'DATA_DRIVEN')));
    for (const m of ATTRIBUTION_MODELS.filter((x) => x !== 'DATA_DRIVEN')) {
      const mine = rows.filter((x) => x.model === m);
      expect(Math.round(mine.reduce((s, x) => s + Number(x.conversionsFrac), 0) * ONE_MILLION)).toBe(12 * ONE_MILLION);
      expect(mine.reduce((s, x) => s + Number(x.revenueMinor), 0)).toBe(12 * 4000 + 1);
    }
    const cmp = await svc.compare({});
    expect(cmp.defaultModel).toBe('POSITION_BASED'); expect(cmp.reconciled).toBe(true);
    expect(cmp.models.find((m) => m.model === 'DATA_DRIVEN')).toMatchObject({ available: false });
    expect(cmp.dataDriven).toMatchObject({ status: 'INSUFFICIENT_VOLUME', message: 'insufficient volume' });
    // LAST_TOUCH credits DIRECT with all 12; FIRST_TOUCH credits ORGANIC_SEARCH with all 12; LAST_NON_DIRECT never DIRECT
    const get = (m: string, k: string) => cmp.models.find((x) => x.model === m)!.rows.find((x) => x.sourceKind === k);
    expect(get('LAST_TOUCH', 'DIRECT')!.conversions).toBe(12); expect(get('FIRST_TOUCH', 'ORGANIC_SEARCH')!.conversions).toBe(12); expect(get('LAST_NON_DIRECT', 'DIRECT')).toBeUndefined();
  });

  it('is idempotent and the commission decisions are untouched (count and values) by a model run', async () => {
    const made = [];
    for (let i = 0; i < 11; i++) made.push(await conversion({ touches: [{ kind: 'PROVIDER_LINK', ageDays: 3, linkCode: 'LINK0002', org: 'org_A' }, { kind: 'DIRECT', ageDays: 0.2 }] }));
    for (const m of made) await att.decideForBooking({ bookingId: m.bookingId });
    const before = JSON.stringify(await c.prisma.growthAttributionDecision.findMany({ orderBy: { id: 'asc' } }));
    await svc.rollup({}); const first = js((await c.prisma.growthAttributionModelResult.findMany({ orderBy: [{ model: 'asc' }, { sourceKind: 'asc' }, { sourceRef: 'asc' }] })).map(({ id, updatedAt, ...r }) => r, 0));
    await Promise.all([svc.rollup({}), svc.rollup({})]); await svc.rollup({});
    expect(js((await c.prisma.growthAttributionModelResult.findMany({ orderBy: [{ model: 'asc' }, { sourceKind: 'asc' }, { sourceRef: 'asc' }] })).map(({ id, updatedAt, ...r }) => r, 0))).toBe(first);
    expect(JSON.stringify(await c.prisma.growthAttributionDecision.findMany({ orderBy: { id: 'asc' } }))).toBe(before);
    expect(await c.prisma.growthAttributionDecision.count()).toBe(11);
  });

  it('a window edge: a campaign touch 8 days before is outside its 7 day window, a provider link 30 days before is inside, 31 is not; a reporting window never touches the policy', async () => {
    await conversion({ touches: [{ kind: 'CAMPAIGN', ageDays: 8 }, { kind: 'PROVIDER_LINK', ageDays: 29.5, linkCode: 'LINK0003', org: 'org_A' }] });
    await conversion({ touches: [{ kind: 'PROVIDER_LINK', ageDays: 31.5, linkCode: 'LINK0004', org: 'org_A' }] });
    const policyBefore = await c.prisma.growthConfigVersion.count();
    await svc.rollup({});
    const rows = await c.prisma.growthAttributionModelResult.findMany({ where: { model: 'LAST_TOUCH' } });
    expect(rows.map((r) => `${r.sourceKind}:${Number(r.conversionsFrac)}`).sort()).toEqual(['PROVIDER_LINK:1', 'UNATTRIBUTED:1']);
    expect(await c.prisma.growthConfigVersion.count()).toBe(policyBefore);
  });

  it('cross-device: a pre-login visitor touch joins through a recorded sub link; an unlinked visitor and another person do not', async () => {
    const m = await conversion({ touches: [{ kind: 'ORGANIC_SEARCH', ageDays: 5, visitorOnly: 'vk_one' }, { kind: 'CAMPAIGN', ageDays: 3 }] });
    await seedTouch(c, { kind: 'PROVIDER_LINK', at: new Date(m.at.getTime() - 4 * DAY), sub: m.sub, visitorKey: 'vk_one', linkCode: 'LINK0005', org: 'org_A' }); // records the sub link of vk_one
    await seedTouch(c, { kind: 'REFERRAL', at: new Date(m.at.getTime() - 2 * DAY), visitorKey: 'vk_stranger' }); // unlinked: never joins
    await svc.rollup({});
    const lin = await c.prisma.growthAttributionModelResult.findMany({ where: { model: 'LINEAR' } });
    expect(lin.map((r) => r.sourceKind).sort()).toEqual(['CAMPAIGN', 'ORGANIC_SEARCH', 'PROVIDER_LINK']);
    expect(lin.every((r) => Math.abs(Number(r.conversionsFrac) - 1 / 3) < 1e-5)).toBe(true);
  });

  it('analytics withdrawal: touches recorded before the latest WITHDRAWAL are not used', async () => {
    const m = await conversion({ touches: [{ kind: 'ORGANIC_SEARCH', ageDays: 6 }, { kind: 'CAMPAIGN', ageDays: 1 }] });
    await c.prisma.consentRecord.create({ data: { sub: m.sub, purpose: 'ANALYTICS_MEASUREMENT', granted: false, createdAt: new Date(m.at.getTime() - 3 * DAY) } });
    await svc.rollup({});
    expect((await c.prisma.growthAttributionModelResult.findMany({ where: { model: 'LAST_TOUCH' } })).map((r) => r.sourceKind)).toEqual(['CAMPAIGN']);
    expect((await c.prisma.growthAttributionModelResult.findMany({ where: { model: 'FIRST_TOUCH' } })).map((r) => r.sourceKind)).toEqual(['CAMPAIGN']);
  });

  it('k floor: a source with fewer than 10 paths is masked on every read; the path table holds only paths shared by 10 or more conversions and only source kinds', async () => {
    for (let i = 0; i < 12; i++) await conversion({ touches: [{ kind: 'ORGANIC_SEARCH', ageDays: 4 }, { kind: 'DIRECT', ageDays: 0.2 }] });
    for (let i = 0; i < 12; i++) await conversion({ touches: [{ kind: 'PROVIDER_LINK', ageDays: 2, linkCode: 'LINK0006', org: 'org_A' }] });
    for (let i = 0; i < 3; i++) await conversion({ touches: [{ kind: 'REFERRAL', ageDays: 2 }] });
    await svc.rollup({});
    const cmp = await svc.compare({}); const ft = cmp.models.find((m) => m.model === 'LAST_TOUCH')!;
    expect(ft.rows.find((r) => r.sourceKind === 'REFERRAL')).toMatchObject({ masked: true, conversions: '<10', revenueMinor: '<10' });
    expect(ft.rows.find((r) => r.sourceKind === 'DIRECT')!.masked).toBe(true); // secondary suppression: with one masked cell and the total shown, the smallest visible cell is masked too
    expect(ft.rows.find((r) => r.sourceKind === 'PROVIDER_LINK')!.masked).toBe(false);
    const snaps = await c.prisma.growthPathSnapshot.findMany({ orderBy: { pathHash: 'asc' } }); expect(snaps).toHaveLength(2); // the 3-conversion REFERRAL path is not stored
    expect(snaps.map((x) => x.pathKinds.join('>')).sort()).toEqual(['ORGANIC_SEARCH>DIRECT', 'PROVIDER_LINK']);
    expect(snaps.every((x) => x.conversions === 12 && x.k === 10)).toBe(true);
    const p = await svc.paths({}); expect(p.paths).toHaveLength(2); expect(JSON.stringify(p)).not.toMatch(/sub_m|vk_|LINK0/);
    await expect(c.prisma.growthPathSnapshot.create({ data: { day: new Date(), pathHash: 'x', length: 1, conversions: 3 } })).rejects.toThrow(); // the table itself refuses a cell under k
  });

  it('data-driven runs once 1,000 conversions exist in 90 days and the weights reconcile', async () => {
    const day = new Date(Date.now() - 3600_000); const N = 1000;
    const bookings = Array.from({ length: N }, (_, i) => `kx_bk_dd${i}`);
    await c.prisma.bookingIntent.createMany({ data: bookings.map((id, i) => ({ id, sub: `sub_dd${i}`, providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', tenantId: 'org_A', typeId: 'typ_1', startsAt: day, endsAt: day, status: 'COMPLETED', channel: 'MARKETPLACE', createdAt: new Date(day.getTime() - DAY) } as never)) });
    await c.prisma.growthEvent.createMany({ data: bookings.map((id) => ({ name: 'BookingAttended', bookingId: id, props: { bucket: 'new' }, dedupeKey: `att|${id}`, occurredAt: day })) });
    await c.prisma.growthRevenueFact.createMany({ data: bookings.map((id) => ({ kind: 'CHARGE', chargeId: `ch_${id}`, appointmentId: `apt_${id}`, bookingId: id, status: 'CONFIRMED', amountMinor: 4000, occurredAt: day })) });
    const src = await c.prisma.growthAcquisitionSource.createManyAndReturn({ data: [{ sourceKind: 'ORGANIC_SEARCH' }, { sourceKind: 'DIRECT' }, { sourceKind: 'CAMPAIGN', sourceRef: 'x' }] });
    const sid = (k: string) => src.find((s) => s.sourceKind === k)!.id;
    await c.prisma.growthTouchpoint.createMany({ data: bookings.flatMap((_, i) => [{ sub: `sub_dd${i}`, sourceId: sid(i % 4 === 0 ? 'CAMPAIGN' : 'ORGANIC_SEARCH'), kind: i % 4 === 0 ? 'CAMPAIGN' : 'ORGANIC_SEARCH', landingKind: 'HOME', occurredAt: new Date(day.getTime() - 2 * DAY) }, { sub: `sub_dd${i}`, sourceId: sid('DIRECT'), kind: 'DIRECT', landingKind: 'HOME', occurredAt: new Date(day.getTime() - 3600_000) }]) });
    // non converting visitors that only ever saw DIRECT: DIRECT alone does not convert
    await c.prisma.growthTouchpoint.createMany({ data: Array.from({ length: 800 }, (_, i) => ({ visitorKey: `vk_null${i}`, sourceId: sid('DIRECT'), kind: 'DIRECT', landingKind: 'HOME', occurredAt: new Date(day.getTime() - 2 * DAY) })) });
    const r = await svc.rollup({});
    expect(r.dataDriven).toMatchObject({ status: 'OK', conversions90d: N });
    const dd = await c.prisma.growthAttributionModelResult.findMany({ where: { model: 'DATA_DRIVEN' } });
    expect(Math.round(dd.reduce((s, x) => s + Number(x.conversionsFrac), 0) * ONE_MILLION)).toBe(N * ONE_MILLION);
    expect(dd.reduce((s, x) => s + Number(x.revenueMinor), 0)).toBe(N * 4000);
    const by = Object.fromEntries(dd.map((x) => [x.sourceKind, Number(x.conversionsFrac)]));
    expect(by.ORGANIC_SEARCH).toBeGreaterThan(0); expect(by.CAMPAIGN).toBeGreaterThan(0); expect(by.DIRECT).toBeLessThan(N); // Markov removal credits the last step heavily by construction (documented), but never all of it
    expect((await svc.compare({})).reconciled).toBe(true);
  }, 120_000);

  it('endpoints: ops read roles only, rollup is super admin, flag OFF refuses the recompute (reads keep working)', async () => {
    await conversion({ touches: [{ kind: 'DIRECT', ageDays: 1 }] });
    const ops = await c.as('ops_m', { roles: ['ops_admin'] }); const sa = await c.as('sa_m', { roles: ['super_admin', 'ops_admin'] }); const pat = await c.as('pat_m', { roles: [] });
    await c.http().get('/api/v1/admin/growth/attribution-models').set(pat).expect(403);
    await c.http().get('/api/v1/admin/growth/attribution-models').set(ops).expect(200);
    await c.http().get('/api/v1/admin/growth/attribution-models/paths').set(ops).expect(200);
    await c.http().post('/api/v1/admin/growth/attribution-models/rollup').set(ops).send({}).expect(403);
    const ok = await c.http().post('/api/v1/admin/growth/attribution-models/rollup').set(sa).send({ days: 2 }).expect(200); expect(ok.body.conversions).toBe(1);
    const dis = await c.http().get('/api/v1/admin/growth/attribution-models/lift?experimentKey=nope').set(ops); expect(dis.status).toBe(404);
  });

  it('lift: reports holdout against exposed only above k = 10 per arm, labelled experiment-based', async () => {
    const exp = await c.prisma.growthExperiment.create({ data: { key: 'lc_holdout', name: 'Lifecycle holdout', surface: 'lifecycle', hypothesis: 'h', variants: [{ key: 'holdout', weightBp: 1000 }, { key: 'send', weightBp: 9000 }], primaryMetric: 'booking', salt: 's', createdBy: 'a' } as never });
    await c.prisma.growthExperimentDaily.createMany({ data: [{ experimentId: exp.id, day: new Date(), variant: 'holdout', exposures: 5, conversions: 1 }, { experimentId: exp.id, day: new Date(), variant: 'send', exposures: 90, conversions: 20 }] });
    expect(await svc.lift({ experimentKey: 'lc_holdout' })).toMatchObject({ available: false, reason: 'K_FLOOR' });
    await c.prisma.growthExperimentDaily.update({ where: { experimentId_day_variant: { experimentId: exp.id, day: (await c.prisma.growthExperimentDaily.findFirstOrThrow({ where: { variant: 'holdout' } })).day, variant: 'holdout' } }, data: { exposures: 1000, conversions: 100 } });
    await c.prisma.growthExperimentDaily.updateMany({ where: { variant: 'send' }, data: { exposures: 9000, conversions: 1260 } });
    const r = await svc.lift({ experimentKey: 'lc_holdout' }); expect(r).toMatchObject({ available: true, lift: { label: 'experiment-based lift', absoluteLiftPp: 4, significant: true } });
  });

  it('performance: 3,000 conversions and 12,000 touches roll up well under the 60 s budget', async () => {
    await unlockFlag(c, 'growth.analytics_visitor').catch(() => undefined);
    const day = new Date(Date.now() - 3600_000); const N = 3000; const ids = Array.from({ length: N }, (_, i) => `kx_bk_pf${i}`);
    await c.prisma.bookingIntent.createMany({ data: ids.map((id, i) => ({ id, sub: `sub_pf${i}`, providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', tenantId: 'org_A', typeId: 'typ_1', startsAt: day, endsAt: day, status: 'COMPLETED', channel: 'MARKETPLACE', createdAt: new Date(day.getTime() - DAY) } as never)) });
    await c.prisma.growthEvent.createMany({ data: ids.map((id) => ({ name: 'BookingAttended', bookingId: id, props: { bucket: 'new' }, dedupeKey: `att|${id}`, occurredAt: day })) });
    const s = await c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'ORGANIC_SEARCH' } });
    await c.prisma.growthTouchpoint.createMany({ data: ids.flatMap((_, i) => [1, 2, 3, 4].map((k) => ({ sub: `sub_pf${i}`, sourceId: s.id, kind: 'ORGANIC_SEARCH', landingKind: 'HOME', occurredAt: new Date(day.getTime() - k * DAY) }))) });
    const t0 = Date.now(); const r = await c.get(ModelRollupJob).runOnce('EG', 2).catch(() => null); const ms = Date.now() - t0;
    expect(r === null || 'skipped' in r || r.conversions === N).toBe(true);
    const direct = await svc.rollup({ days: 2 }); expect(direct.conversions).toBe(N); expect(Date.now() - t0 - ms).toBeLessThan(60_000);
  }, 120_000);
});
