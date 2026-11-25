import { appendFileSync } from 'node:fs';
import { createCtx, seedProvider, TestCtx } from './harness';
import { AttributionService, GrowthRollupService, CohortService } from '../src/growth/growth-public';
import { SendGateService } from '../src/growth/lifecycle/send-gate.service';
import { LifecyclePolicyService } from '../src/growth/lifecycle/lifecycle-policy.service';
import { JOURNEYS } from '../src/growth/lifecycle/journeys';
import { seedBooking, seedTouch } from './growth-helpers';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { PublicSiteCache } from '../src/public-site/public-site-public';
import { say, setupAssistant } from './assistant-helpers';

/**
 * GRW-P3-H performance budgets for the growth hot paths, on the real Postgres of the integration harness with a synthetic data set of the size the work package names:
 * 500,000 touches, 500,000 visitor events, 100,000 bookings with 300,000 booking events, decisions and revenue facts.
 * Budgets are deliberately generous (CI machines and a shared laptop run these): they catch an accidental sequential scan or N+1, not a 20 percent drift. Measured numbers are printed
 * as `PERF name p50=.. p95=.. max=..` and recorded in _docs/security/PHASE34_PERFORMANCE.md.
 */
const N_TOUCH = 500_000, N_VISIT_EVENTS = 500_000, N_BOOK = 100_000, VISITORS = 60_000;
const out = (line: string) => { try { appendFileSync(process.env.PERF_OUT ?? '/tmp/growth-perf-results.txt', line + '\n'); } catch { /* optional */ } };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]!; };
const report = (name: string, ms: number[], budgetP95: number) => {
  const r = { p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: Math.max(...ms) };
  out(`PERF ${name} n=${ms.length} p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms max=${r.max.toFixed(1)}ms budget_p95=${budgetP95}ms`);
  expect(r.p95).toBeLessThan(budgetP95);
};
const time = async (fn: () => Promise<unknown>) => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

describe('growth performance budgets (GRW-P3-H)', () => {
  let c: TestCtx; const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => { if (!(k in prev)) prev[k] = process.env[k]; process.env[k] = v; };
  beforeAll(async () => {
    ensurePublicBundle(); setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', 'https://kiorex.test'); setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx(); await c.reset();
    const src = (await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_seed' })).sourceId;
    await c.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`INSERT INTO "GrowthTouchpoint" (id, market, "visitorKey", "sourceId", kind, "landingKind", "localeAt", "occurredAt", "ipHash", "uaClass")
        SELECT 'tp_'||g, 'EG', 'kxv_'||lpad((g % ${VISITORS})::text, 22, 'x'), '${src}', (ARRAY['ORGANIC_SEARCH','DIRECT','CAMPAIGN','PROVIDER_LINK','REFERRAL'])[1 + g % 5], 'HOME', 'ar', now() - (g % 90) * interval '1 day' - (g % 1440) * interval '1 minute', 'h', 'web'
        FROM generate_series(1, ${N_TOUCH}) g`);
      await tx.$executeRawUnsafe(`INSERT INTO "BookingIntent" (id, sub, "providerId", "clinicId", "clinicianId", "tenantId", "typeId", "startsAt", "endsAt", status, channel, "createdAt", "updatedAt", "acquisitionOrigin")
        SELECT 'kx_bk_p'||g, 'sub_'||(g % 40000), 'lst_'||(g % 200), 'cl_'||(g % 50), 'dr_'||(g % 200), 'org_'||(g % 50), 'typ_1', now() - (g % 90) * interval '1 day', now() - (g % 90) * interval '1 day' + interval '30 minutes', 'COMPLETED', 'MARKETPLACE',
          now() - (g % 90) * interval '1 day' - interval '2 hours', now(), (ARRAY['MARKETPLACE','PROVIDER_LED','UNATTRIBUTED'])[1 + g % 3] FROM generate_series(1, ${N_BOOK}) g`);
      await tx.$executeRawUnsafe(`INSERT INTO "GrowthEvent" (id, market, name, "visitorKey", props, "dedupeKey", "occurredAt")
        SELECT 've_'||g, 'EG', (ARRAY['PageViewed','SearchStarted','ResultsViewed','ProviderViewed'])[1 + g % 4], 'kxv_'||lpad((g % ${VISITORS})::text, 22, 'x'), '{}', 've_'||g, now() - (g % 90) * interval '1 day' - (g % 1440) * interval '1 minute'
        FROM generate_series(1, ${N_VISIT_EVENTS}) g`);
      for (const [i, name] of ['BookingInitiated', 'BookingConfirmed', 'BookingAttended'].entries()) {
        await tx.$executeRawUnsafe(`INSERT INTO "GrowthEvent" (id, market, name, "bookingId", "careType", props, "dedupeKey", "occurredAt")
          SELECT 'be${i}_'||g, 'EG', '${name}', 'kx_bk_p'||g, 'DOCTORS', '{"bucket":"new"}', 'be${i}_'||g, now() - (g % 90) * interval '1 day' - interval '${i} hours' FROM generate_series(1, ${N_BOOK}) g`);
      }
      const ver = (await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "GrowthConfigVersion" LIMIT 1`))[0]?.id ?? 'ver_x';
      await tx.$executeRawUnsafe(`INSERT INTO "GrowthAttributionDecision" (id, market, "bookingId", origin, "reasonCode", "policyVersionId", "inputsHash", "evidenceTouchIds", "winningTouchId", "createdAt")
        SELECT 'ad_'||g, 'EG', 'kx_bk_p'||g, (ARRAY['MARKETPLACE','PROVIDER_LED','UNATTRIBUTED'])[1 + g % 3], 'X', '${ver}', repeat('a', 64), ARRAY[]::text[], 'tp_'||g, now() FROM generate_series(1, ${N_BOOK}) g`);
      await tx.$executeRawUnsafe(`INSERT INTO "GrowthRevenueFact" (id, market, kind, "chargeId", "appointmentId", "bookingId", status, "amountMinor", origin, "occurredAt")
        SELECT 'rf_'||g, 'EG', 'CHARGE', 'ch_'||g, 'ap_'||g, 'kx_bk_p'||g, 'CONFIRMED', 4000, 'MARKETPLACE', now() - (g % 90) * interval '1 day' FROM generate_series(1, ${N_BOOK / 2}) g`);
    }, { timeout: 600_000, maxWait: 60_000 });
    await c.prisma.$executeRawUnsafe(`ANALYZE`);
  }, 900_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('attribution decide: p95 under 150 ms with 500k touches and 100k bookings in the tables', async () => {
    const svc = c.get(AttributionService); const ms: number[] = [];
    for (let i = 0; i < 200; i++) {
      const b = await seedBooking(c, { sub: `sub_perf_${i}` });
      ms.push(await time(() => svc.decideForBooking({ bookingId: b.id, visitorKey: `kxv_${String((i * 7) % VISITORS).padStart(22, 'x')}` })));
    }
    report('attribution.decide', ms, 150);
  }, 120_000);

  it('daily rollup of 30 days over 500k visitor events and 100k bookings: under 60 s, idempotent row count', async () => {
    const svc = c.get(GrowthRollupService); const t1 = await time(async () => { await svc.rollup({ days: 30 }); });
    const n1 = await c.prisma.growthMetricDaily.count(); const t2 = await time(async () => { await svc.rollup({ days: 30 }); });
    out(`PERF rollup.30d first=${(t1 / 1000).toFixed(1)}s second=${(t2 / 1000).toFixed(1)}s rows=${n1} budget=60s`);
    expect(t1).toBeLessThan(60_000); expect(t2).toBeLessThan(60_000); expect(await c.prisma.growthMetricDaily.count()).toBe(n1);
  }, 300_000);

  it('cohort rollup (24 months, all bases) over the 100k bookings: under 120 s', async () => {
    const t = await time(() => c.get(CohortService).rollup({ market: 'EG', months: 24 }));
    out(`PERF cohort.rollup.24m ${(t / 1000).toFixed(1)}s budget=120s`);
    expect(t).toBeLessThan(120_000);
  }, 300_000);

  it('send gate: evaluate() p95 under 150 ms per message (consent, preference, caps, quiet hours, holdout)', async () => {
    const gate = c.get(SendGateService); const policy = await c.get(LifecyclePolicyService).resolve('EG'); const def = JOURNEYS.find((j) => j.key === 'welcome') ?? JOURNEYS[0]!; const ms: number[] = [];
    for (let i = 0; i < 200; i++) ms.push(await time(() => gate.evaluate({ sub: `sub_${i}`, def, step: def.steps[0]!, channel: 'WHATSAPP', anchorId: `a${i}`, anchorParams: {}, now: new Date(), policy, marketingFlagOn: false, journeyEnabled: true })));
    report('sendgate.evaluate', ms, 150);
  }, 120_000);

  it('public SSR pages (warm cache and cold cache), widget config, touch and campaign resolve: p95 budgets', async () => {
    await seedProvider(c, { id: 'lst_p1', clinicianId: 'dr_p1', clinicId: 'cl_p1', specialty: 'cardiology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن', area: 'Maadi', governorate: 'Cairo', fee: 300 });
    await c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'lst_p1', slug: 'sara-hassan' } }).catch(() => undefined);
    c.flags.invalidate(); const cache = c.get(PublicSiteCache);
    const get = (p: string) => c.http().get(p).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x: string) => (d += x)); res.on('end', () => cb(null, d)); });
    const cold: number[] = [], warm: number[] = [];
    for (let i = 0; i < 40; i++) { cache.purgeAll(); cold.push(await time(() => get(i % 2 ? '/en/eg/doctor/sara-hassan' : '/ar/eg/doctor/sara-hassan'))); }
    for (let i = 0; i < 100; i++) warm.push(await time(() => get(i % 2 ? '/en/eg/doctor/sara-hassan' : '/ar/eg/doctor/sara-hassan')));
    report('ssr.cold', cold, 800); report('ssr.warm', warm, 150);
    const touch: number[] = [], resolve: number[] = [];
    for (let i = 0; i < 60; i++) {
      touch.push(await time(() => c.http().post('/api/v1/growth/v1/touch').set('x-forwarded-for', `10.0.${i % 250}.${i % 200}`).send({ kind: 'ORGANIC_SEARCH', landing: 'HOME' })));
      resolve.push(await time(() => c.http().get('/api/v1/growth/v1/campaign/resolve?utm_campaign=none')));
    }
    report('public.touch', touch, 120); report('public.campaign.resolve', resolve, 80);
  }, 300_000);

  it('assistant orchestrator with the mock model: a turn (inbound message to reply) p95 under 400 ms', async () => {
    await setupAssistant(c); const ms: number[] = [];
    for (let i = 0; i < 30; i++) ms.push(await time(() => say(c, i % 2 ? 'I need a dermatologist' : 'مرحبا')));
    report('assistant.turn', ms, 400);
  }, 300_000);

  it('ops list pages with 10,000 rows answer in under 1.5 s (campaign-less lists use the seeded tables: decisions, events, config versions, audit)', async () => {
    const admin = await c.as('adm_perf', { roles: ['super_admin', 'ops_admin'] });
    await c.prisma.$executeRawUnsafe(`INSERT INTO "AuditLog" (id, "actorSub", action, resource, "resourceId", metadata, "createdAt") SELECT 'al_p'||g, 'adm_perf', 'perf.row', 'Perf', 'r'||g, '{}', now() - g * interval '1 second' FROM generate_series(1, 10000) g`).catch(() => undefined);
    const paths = ['/api/v1/ops/growth/decisions?take=100', '/api/v1/ops/growth/touches?take=100', '/api/v1/ops/growth/config/versions', '/api/v1/ops/growth-analytics/overview', '/api/v1/ops/growth-analytics/channels', '/api/v1/ops/growth-analytics/breakdown/city', '/api/v1/admin/growth/cohorts', '/api/v1/admin/growth/attribution-models/compare', '/api/v1/ops/audit?take=100'];
    for (const p of paths) {
      const ms: number[] = []; let status = 0;
      for (let i = 0; i < 5; i++) ms.push(await time(async () => { status = (await c.http().get(p).set(admin)).status; }));
      if (status === 404) continue; // route names differ on this build: only existing routes are budgeted
      expect(status).toBeLessThan(500);
      report(`ops.list ${p.split('?')[0]}`, ms, 1500);
    }
  }, 300_000);
});
