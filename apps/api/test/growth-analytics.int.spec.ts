import { signKiorlyRequest } from '@kiorex/contracts';
import { createCtx, seedProvider, TestCtx } from './harness';
import { GrowthEventsService, GrowthRevenueService, GrowthRollupService, GrowthMetricsService, parseFilters, VISITOR_STREAM_METRICS } from '../src/growth/growth-public';
import { seedBooking, DAY } from './growth-helpers';

const today = () => new Date().toISOString().slice(0, 10);
const F = () => parseFilters({ from: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10), to: today() });
let seq = 0;

/** GRW-P1-J: rollups, k-anonymity, funnel and unit-economics arithmetic, role-based reporting, isolation, CSV, spend maker-checker, cohorts. */
describe('growth analytics v1', () => {
  let c: TestCtx; let events: GrowthEventsService; let rollup: GrowthRollupService; let metrics: GrowthMetricsService; let revenue: GrowthRevenueService;
  beforeAll(async () => { c = await createCtx(); events = c.get(GrowthEventsService); rollup = c.get(GrowthRollupService); metrics = c.get(GrowthMetricsService); revenue = c.get(GrowthRevenueService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); seq = 0; });

  /** n confirmed bookings of one provider with their canonical facts; `attended` of them are attended new patients (charge PENDING, then confirmed on completion unless `pending`). */
  async function bookings(o: { n: number; providerId: string; org: string; origin?: string; attended?: number; channel?: string; platform?: string; market?: string }) {
    const ids: string[] = [];
    for (let i = 0; i < o.n; i++) {
      const b = await seedBooking(c, { providerId: o.providerId, tenantId: o.org, channel: o.channel });
      await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { acquisitionOrigin: o.origin ?? 'MARKETPLACE', feeMinor: 50_000, careType: 'DOCTORS' } });
      for (const name of ['SlotSelected', 'BookingInitiated', 'BookingConfirmed']) await events.recordFact({ name, naturalKey: b.id, bookingId: b.id, careType: 'DOCTORS', market: o.market, props: o.platform ? { platform: o.platform } : {} });
      if (i < (o.attended ?? 0)) await events.recordFact({ name: 'BookingAttended', naturalKey: b.id, bookingId: b.id, careType: 'DOCTORS', market: o.market, props: { bucket: 'new' } });
      ids.push(b.id);
    }
    return ids;
  }
  const stream = (name: string, n: number, extra: Record<string, unknown> = {}) => c.prisma.growthEvent.createMany({ data: Array.from({ length: n }, () => ({ name, careType: 'DOCTORS', dedupeKey: `t|${name}|${++seq}`, props: { platform: 'web', landingKind: 'HOME' }, ...extra })) });
  const charge = (bookingId: string, id: string, status = 'PENDING') => revenue.recordFromEvent('COMMISSION_CHARGE_CREATED', { chargeId: id, appointmentId: `apt_${id}`, amount: '40.00', currency: 'EGP', status }, new Date().toISOString()).then(async () => { await c.prisma.growthRevenueFact.updateMany({ where: { chargeId: id }, data: { bookingId } }); });
  const ops = { kind: 'OPS' as const };

  describe('rollup', () => {
    it('schema guard: the only unique index on GrowthMetricDaily is the full-dimension key (a narrower one makes distinct rollup rows collide; regression for the order-dependent failure after the migration replay test)', async () => {
      const idx = await c.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'GrowthMetricDaily' AND indexdef LIKE '%UNIQUE%' AND indexname <> 'GrowthMetricDaily_pkey'`;
      expect(idx.map((i) => i.indexname)).toEqual(['GrowthMetricDaily_dim_key']);
      for (const col of ['city', 'providerRef', 'doctorRef', 'branchRef', 'channel', 'platform', 'product']) expect(idx[0].indexdef).toContain(col);
    });

    it('is idempotent: running it three times (and concurrently) gives identical rows', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A', specialty: 'dermatology', governorate: 'Cairo', area: 'Maadi' });
      await bookings({ n: 12, providerId: 'lst_a', org: 'org_A', attended: 3 }); await stream('PageViewed', 5);
      await rollup.rollup(); const snap = async () => JSON.stringify((await c.prisma.growthMetricDaily.findMany({ orderBy: [{ metric: 'asc' }, { sourceKind: 'asc' }, { origin: 'asc' }, { careType: 'asc' }, { platform: 'asc' }] })).map(({ id, updatedAt, ...r }) => r));
      const first = await snap();
      await Promise.all([rollup.rollup(), rollup.rollup()]); await rollup.rollup();
      expect(await snap()).toBe(first);
      expect(await c.prisma.growthMetricDaily.count({ where: { metric: 'BookingConfirmed' } })).toBeGreaterThan(0);
    });

    it('booking facts carry city, district, specialty, provider (organisation), doctor, branch, origin, source, channel and platform; counts equal the facts', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A', specialty: 'dermatology', governorate: 'Cairo', area: 'Maadi', clinicId: 'cl_a', clinicianId: 'dr_a' });
      await bookings({ n: 12, providerId: 'lst_a', org: 'org_A', origin: 'PROVIDER_LED', platform: 'ios', channel: 'CLINIC_LINK' });
      await rollup.rollup();
      const r = await c.prisma.growthMetricDaily.findFirstOrThrow({ where: { metric: 'BookingConfirmed' } });
      expect(r).toMatchObject({ value: 12, city: 'Cairo', district: 'Maadi', specialty: 'dermatology', providerRef: 'org_A', origin: 'PROVIDER_LED', sourceKind: 'PROVIDER_LINK', channel: 'CLINIC_LINK', platform: 'ios', careType: 'DOCTORS', product: 'KIOREX_BOOKING', market: 'EG' });
      expect(r.branchRef).toBeTruthy(); expect(r.doctorRef).toBeTruthy();
    });

    it('the visitor stream never carries specialty, provider, doctor, branch, city or district, even when the same day has booking facts (no specialty-by-visitor join is possible)', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A', specialty: 'dermatology', governorate: 'Cairo', area: 'Maadi' });
      await bookings({ n: 12, providerId: 'lst_a', org: 'org_A' });
      await c.prisma.growthTouchpoint.create({ data: { visitorKey: 'kxv_visitoraaaaaaaaaaaaaa', sourceId: (await c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'CAMPAIGN', sourceRef: 'x' } })).id, kind: 'CAMPAIGN', utmCampaign: 'ramadan', landingKind: 'HOME', occurredAt: new Date(Date.now() - 3600_000) } });
      await stream('PageViewed', 12, { visitorKey: 'kxv_visitoraaaaaaaaaaaaaa' }); await stream('SearchStarted', 12);
      await rollup.rollup();
      const rows = await c.prisma.growthMetricDaily.findMany({ where: { metric: { in: [...VISITOR_STREAM_METRICS] } } });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect({ city: r.city, district: r.district, specialty: r.specialty, providerRef: r.providerRef, doctorRef: r.doctorRef, branchRef: r.branchRef, origin: r.origin, channel: r.channel }).toEqual({ city: '', district: '', specialty: '', providerRef: '', doctorRef: '', branchRef: '', origin: '', channel: '' });
      expect(rows.find((r) => r.metric === 'PageViewed' && r.campaign === 'ramadan')).toBeTruthy(); // consented visitor key joins the latest touch: source and campaign only
    });

    it('dependants never enter growth tables; another market stays in its market', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A' });
      const [id] = await bookings({ n: 1, providerId: 'lst_a', org: 'org_A' });
      await c.prisma.bookingIntent.update({ where: { id: id! }, data: { dependantId: 'dep_1' } });
      await bookings({ n: 11, providerId: 'lst_a', org: 'org_A' }); await bookings({ n: 12, providerId: 'lst_a', org: 'org_A', market: 'SA' });
      await rollup.rollup(); await rollup.rollup({ market: 'SA' });
      expect((await c.prisma.growthMetricDaily.aggregate({ where: { metric: 'BookingConfirmed', market: 'EG' }, _sum: { value: true } }))._sum.value).toBe(11);
      expect((await c.prisma.growthMetricDaily.aggregate({ where: { metric: 'BookingConfirmed', market: 'SA' }, _sum: { value: true } }))._sum.value).toBe(12);
      expect((await metrics.overview(F(), ops)).bookings).toBe(11);
      expect((await metrics.overview({ ...F(), market: 'SA' }, ops)).bookings).toBe(12);
    });
  });

  describe('definitions: revenue, GBV, CAC, MER, conversion', () => {
    it('reconciles to BookingIntent and commission charges; GBV is never revenue; PENDING is not revenue; confirmation on completion counts once; a reversal subtracts', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A' });
      const ids = await bookings({ n: 12, providerId: 'lst_a', org: 'org_A', attended: 12 });
      for (const [i, id] of ids.entries()) await charge(id, `chg_${i}`);
      await rollup.rollup();
      let o: any = await metrics.overview(F(), ops);
      expect(o.bookings).toBe(12); expect(o.attendedNewPatients).toBe(12);
      expect(o.kiorexRevenueMinor).toBe(0); expect(o.commissionPendingMinor).toBe(12 * 4000); // accrued but not revenue yet
      expect(o.grossBookingValueMinor).toBe(12 * 50_000); expect(o.grossBookingValue.isRevenue).toBe(false);
      for (const id of ids) await revenue.onBookingCompleted(id); await revenue.onBookingCompleted(ids[0]!); // repeat: still one confirmation each
      await revenue.recordFromEvent('COMMISSION_CHARGE_CREATED', { chargeId: 'chg_0', appointmentId: 'apt_chg_0', amount: '40.00', status: 'BILLED' }); await c.prisma.growthRevenueFact.updateMany({ where: { chargeId: 'chg_0' }, data: { bookingId: ids[0] } }); // BILLED after CONFIRMED: not a second revenue
      await revenue.recordFromEvent('COMMISSION_CHARGE_REVERSED', { chargeId: 'chg_1', appointmentId: 'apt_chg_1', amount: '40.00', status: 'REVERSED' }); await c.prisma.growthRevenueFact.updateMany({ where: { chargeId: 'chg_1', kind: 'REVERSAL' }, data: { bookingId: ids[1] } });
      await rollup.rollup(); o = await metrics.overview(F(), ops);
      expect(o.kiorexRevenueMinor).toBe(12 * 4000 - 4000); expect(o.commissionPendingMinor).toBe(0);
      expect(o.kiorexRevenueMinor).not.toBe(o.grossBookingValueMinor);
      expect(JSON.stringify(o)).not.toMatch(/sub_|\+20/);
    });

    it('blended CAC = approved spend / ANP; MER = revenue / spend; a pending spend line counts for nothing; maker-checker needs two people (also over HTTP)', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A' });
      const ids = await bookings({ n: 20, providerId: 'lst_a', org: 'org_A', attended: 20 });
      for (const [i, id] of ids.entries()) { await charge(id, `c${i}`); await revenue.onBookingCompleted(id); }
      await rollup.rollup();
      const a = await c.as('ops1', { roles: ['ops_admin'] }); const b = await c.as('ops2', { roles: ['ops_admin'] });
      const made = await c.http().post('/api/v1/ops/growth-analytics/spend').set(a).send({ day: today(), amountMinor: 200_000, campaign: 'ramadan', channel: 'meta', sourceKind: 'CAMPAIGN' }).expect(201);
      let o: any = await metrics.overview(F(), ops); expect(o.spendMinor).toBe(0); expect(o.blendedCacMinor).toBeNull();
      await c.http().post(`/api/v1/ops/growth-analytics/spend/${made.body.id}/approve`).set(a).expect(403); // the author cannot approve
      await c.http().post(`/api/v1/ops/growth-analytics/spend/${made.body.id}/approve`).set(b).expect(200);
      await c.http().post(`/api/v1/ops/growth-analytics/spend/${made.body.id}/approve`).set(b).expect(400); // already decided
      o = await metrics.overview(F(), ops);
      expect(o.spendMinor).toBe(200_000); expect(o.blendedCacMinor).toBe(10_000); expect(o.merRatio).toBeCloseTo((20 * 4000) / 200_000, 6);
      const ch: any = await metrics.channels(F(), ops);
      const camp = ch.rows.find((r: any) => r.sourceKind === 'CAMPAIGN'); expect(camp).toMatchObject({ spendMinor: 200_000 });
      await c.http().post('/api/v1/ops/growth-analytics/spend').set(await c.as('pat', { roles: [] })).send({ day: today(), amountMinor: 1 }).expect(403);
      await c.http().post('/api/v1/ops/growth-analytics/spend').set(a).send({ day: today(), amountMinor: 0 }).expect(400);
      await c.http().post('/api/v1/ops/growth-analytics/spend').set(a).send({ day: today(), amountMinor: 5, note: 'call 01001234567' }).expect(400);
    });

    it('funnel arithmetic on a seeded fixture, with step and cumulative conversion', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A' });
      await stream('PageViewed', 200); await stream('SearchStarted', 100); await stream('ResultsViewed', 80); await stream('ProviderViewed', 40);
      await bookings({ n: 30, providerId: 'lst_a', org: 'org_A', attended: 15 }); // 30 selected, 30 initiated, 30 confirmed, 15 attended (fixture)
      await rollup.rollup();
      const f: any = await metrics.funnel(F(), ops);
      expect(f.stages.map((s: any) => [s.stage, s.count])).toEqual([['PageViewed', 200], ['SearchStarted', 100], ['ResultsViewed', 80], ['ProviderViewed', 40], ['SlotSelected', 30], ['BookingInitiated', 30], ['BookingConfirmed', 30], ['BookingAttended', 15]]);
      expect(f.stages.map((s: any) => s.stepConversionPct)).toEqual([null, 50, 80, 50, 75, 100, 100, 50]);
      expect(f.stages[7].cumulativeConversionPct).toBe(7.5);
      const o: any = await metrics.overview(F(), ops); expect(o.searchToBooking).toBe(30); expect(o.bookingToAttended).toBe(50);
      const narrowed: any = await metrics.funnel({ ...F(), specialty: 'dermatology' }, ops); // a specialty filter removes the visitor stages
      expect(narrowed.stages.map((s: any) => s.stage)).toEqual(['SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended']); expect(narrowed.coverage.visitorStageAvailable).toBe(false);
    });
  });

  describe('k-anonymity (k >= 10) in every read', () => {
    it('masks small cells and everything derived from them; a single hidden cell also hides its smallest sibling; CSV agrees with the screen', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A', governorate: 'Cairo' }); await seedProvider(c, { id: 'lst_b', tenantId: 'org_B', governorate: 'Giza' }); await seedProvider(c, { id: 'lst_c', tenantId: 'org_C', governorate: 'Alexandria' });
      await bookings({ n: 30, providerId: 'lst_a', org: 'org_A' }); await bookings({ n: 12, providerId: 'lst_b', org: 'org_B' }); await bookings({ n: 3, providerId: 'lst_c', org: 'org_C', attended: 3 });
      await rollup.rollup();
      const br: any = await metrics.breakdown(F(), ops, 'city');
      const by = Object.fromEntries(br.rows.map((r: any) => [r.city, r]));
      expect(by.Alexandria.bookings).toBe('<10'); expect(by.Giza.bookings).toBe('<10'); // the 12 is hidden too: otherwise 45 - 30 - 12 would reveal 3
      expect(by.Cairo.bookings).toBe(30);
      const csv = await c.http().get(`/api/v1/ops/growth-analytics/export/breakdown.csv?dimension=city&from=${F().from}&to=${F().to}`).set(await c.as('ops1', { roles: ['ops_admin'] })).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toContain('Cairo,30'); expect(csv.text).toContain('Alexandria,<10'); expect(csv.text).not.toMatch(/Alexandria,3/);
      const only3: any = await metrics.overview({ ...F(), provider: 'org_C' }, ops);
      expect(only3.bookings).toBe('<10'); expect(only3.attendedNewPatients).toBe('<10'); expect(only3.grossBookingValueMinor).toBe('<10'); expect(only3.providerLedShare).toBe('<10'); expect(only3.kiorexRevenueMinor).toBe('<10');
      expect(JSON.stringify(only3.originMix)).not.toMatch(/"marketplace":3/);
    });
  });

  describe('role based reporting and tenant isolation', () => {
    const sign = (path: string, org?: string, nonce?: string) => { const s = signKiorlyRequest({ clientKey: 'kx_dev_client', clientSecret: 'kx_dev_webhook_secret', method: 'GET', path, nonce }); return { ...s.headers, ...(org ? { 'X-Kiorly-Org-Ref': org } : {}) }; };
    it('ops needs an ops role; a provider is a signed Clinic request locked to its own organisation and never sees Kiorex money', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A', governorate: 'Cairo' }); await seedProvider(c, { id: 'lst_b', tenantId: 'org_B', governorate: 'Giza' });
      await bookings({ n: 14, providerId: 'lst_a', org: 'org_A', origin: 'PROVIDER_LED' }); await bookings({ n: 25, providerId: 'lst_b', org: 'org_B', attended: 25 });
      await stream('PageViewed', 50); await rollup.rollup();
      await c.http().get('/api/v1/ops/growth-analytics/overview').expect(401);
      await c.http().get('/api/v1/ops/growth-analytics/overview').set(await c.as('pat1', { roles: [] })).expect(403);
      await c.http().get('/api/v1/ops/growth-analytics/overview').set(await c.as('ops1', { roles: ['ops_admin'] })).expect(200);
      const p = (org: string, n: string) => `/api/v1/growth/v1/provider-analytics/overview`;
      await c.http().get(p('x', 'n')).expect(401); // unsigned
      const a = await c.http().get(p('org_A', 'n1')).set(sign(p('org_A', 'n1'), 'org_A', 'n1')).expect(200);
      expect(a.body).toMatchObject({ audience: 'PROVIDER', bookings: 14 });
      expect(a.body.kiorexRevenueMinor).toBeUndefined(); expect(a.body.spendMinor).toBeUndefined(); expect(a.body.blendedCacMinor).toBeUndefined(); expect(a.body.grossBookingValueMinor).toBeUndefined(); expect(a.body.merRatio).toBeUndefined();
      expect(a.body.coverage.visitorStageAvailable).toBe(false);
      await c.http().get(p('org_A', 'n1')).set(sign(p('org_A', 'n1'), 'org_A', 'n1')).expect(401); // nonce replay
      const b = await c.http().get(p('org_B', 'n2')).set(sign(p('org_B', 'n2'), 'org_B', 'n2')).expect(200);
      expect(b.body.bookings).toBe(25);
      await c.http().get(p('', 'n3')).set(sign(p('', 'n3'), undefined, 'n3')).expect(401); // no org reference
      const fn = await metrics.funnel(F(), { kind: 'PROVIDER', orgId: 'org_A' }) as any;
      expect(fn.stages.find((s: any) => s.stage === 'BookingConfirmed').count).toBe(14); expect(fn.stages.map((s: any) => s.stage)).not.toContain('PageViewed');
      const br: any = await metrics.breakdown(F(), { kind: 'PROVIDER', orgId: 'org_A' }, 'city'); expect(br.rows.map((r: any) => r.city)).toEqual(['Cairo']);
    });
  });

  describe('cohorts', () => {
    it('retention at 30, 90 and 180 days for CLOSED windows only; a cohort under 10 is "<10"', async () => {
      await seedProvider(c, { id: 'lst_a', tenantId: 'org_A' });
      const old = new Date(Date.now() - 300 * DAY);
      for (let i = 0; i < 12; i++) {
        await seedBooking(c, { sub: `sub_c${i}`, providerId: 'lst_a', createdAt: old });
        if (i < 5) await seedBooking(c, { sub: `sub_c${i}`, providerId: 'lst_a', createdAt: new Date(old.getTime() + 20 * DAY) }); // 5 return within 30 days
        if (i < 8) await seedBooking(c, { sub: `sub_c${i}`, providerId: 'lst_a', createdAt: new Date(old.getTime() + 80 * DAY) }); // 8 within 90
      }
      const recent = new Date(Date.now() - 5 * DAY);
      for (let i = 0; i < 3; i++) await seedBooking(c, { sub: `sub_r${i}`, providerId: 'lst_a', createdAt: recent });
      const r: any = await metrics.cohorts({}, ops);
      const big = r.rows.find((x: any) => x.size === 12); const small = r.rows.find((x: any) => x.size === '<10');
      expect(big).toMatchObject({ retention30Pct: 41.67, retention90Pct: 66.67, retention180Pct: 66.67 });
      expect(small).toMatchObject({ masked: true, retention30Pct: '<10', retention90Pct: '<10' });
      const open: any = await metrics.cohorts({}, ops, new Date(old.getTime() + 40 * DAY)); // observed 40 days after the cohort month: 90 and 180 day windows are not closed
      expect(open.rows[0]).toBeTruthy();
    });
  });
});
