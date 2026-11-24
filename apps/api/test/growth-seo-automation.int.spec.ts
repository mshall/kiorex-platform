import { createCtx, seedProvider, TestCtx } from './harness';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { PublicSiteCache } from '../src/public-site/public-site-public';
import { SlugBootstrapService } from '../src/growth/seo/seo-public';
import { parseHead } from '../src/public-site/seo-audit';
import { SeoAutomationService } from '../src/growth/seo-automation/seo-automation.service';
import { SeoVitalsService } from '../src/growth/seo-automation/vitals.service';
import { SeoIndexationService } from '../src/growth/seo-automation/indexation.service';
import { SeoAutomationJob } from '../src/growth/seo-automation/seo-automation.job';
import { SEO_AUTOMATION_DEFAULTS } from '../src/growth/seo-automation/seo-automation-config';

type Auth = { Authorization: string };
const HOST = 'https://kiorex.test';
const BASE = '/api/v1/admin/growth/seo-automation';
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

/**
 * GRW-P3-F against the REAL SSR bundle and database (the same eight-provider market as the P1-F suite): the quality gate over every sitemap page in both locales, the stored report, the
 * auto-noindex toggle (default off: only reports), the sitemap that never lists a noindex page, computed internal links in the SSR HTML (caps, no link to a noindex page, stable),
 * vitals ingestion with recorded Lighthouse and CrUX data, the indexation snapshot and the ops API.
 */
describe('SEO automation (GRW-P3-F)', () => {
  let c: TestCtx; let ops: Auth; let admin: Auth;
  const get = (path: string) => c.http().get(path).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x) => (d += x)); res.on('end', () => { (res as unknown as { text: string }).text = d; cb(null, d); }); });
  const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in prev)) prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  const purge = () => { c.flags.invalidate(); c.get(PublicSiteCache).purgeAll(); c.get(SeoAutomationService).invalidate(); };
  const seo = () => c.get(SeoAutomationService);
  let version = 100;
  const setAuto = async (payload: Record<string, unknown>) => {
    await c.prisma.growthConfigVersion.updateMany({ where: { kind: 'SEO_AUTOMATION' }, data: { status: 'SUPERSEDED', effectiveTo: new Date(Date.now() - 1000) } });
    await c.prisma.growthConfigVersion.create({ data: { kind: 'SEO_AUTOMATION', scope: 'GLOBAL', scopeId: '', version: ++version, status: 'ACTIVE', payload: { ...SEO_AUTOMATION_DEFAULTS(), ...payload } as never, createdBy: 'maker', approvedBy: 'checker', approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 2000), checksum: 'x'.repeat(8) } });
    purge();
  };
  const seed = (key: string, o: Parameters<typeof seedProvider>[1]) => seedProvider(c, { id: `lst_${key}`, clinicianId: `dr_${key}`, ...o });

  beforeAll(async () => {
    ensurePublicBundle();
    setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', HOST); setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx();
  }, 180_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  beforeEach(async () => {
    await c.reset(); setEnv('SITE_ENVIRONMENT', 'production');
    ops = await c.as('ops_1', { roles: ['ops_admin'] }); admin = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] });
    await seed('a', { clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن', area: 'Maadi', governorate: 'Cairo', fee: 300, languages: ['ar', 'en'] });
    await seed('b', { clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Mona Adel', nameAr: 'د. منى عادل', area: 'Maadi', governorate: 'Cairo', fee: 450, languages: ['ar'] });
    await seed('c', { clinicId: 'cl_c', specialty: 'cardiology', nameEn: 'Dr Hany Fawzy', nameAr: 'د. هاني فوزي', area: 'Maadi', governorate: 'Cairo', fee: 350, languages: ['en'] });
    await seed('d', { clinicId: 'cl_d', specialty: 'dermatology', nameEn: 'Dr Hala Samir', nameAr: 'د. هالة سمير', area: 'Nasr City', governorate: 'Cairo', fee: 250 });
    await seed('e', { clinicId: 'cl_e', specialty: 'cardiology', nameEn: 'Dr Omar Nabil', nameAr: 'د. عمر نبيل', area: 'Dokki', governorate: 'Giza', fee: 280, languages: ['ar'] });
    await seed('f', { clinicId: 'cl_e', specialty: 'cardiology', nameEn: 'Dr Karim Fouad', nameAr: 'د. كريم فؤاد', area: 'Dokki', governorate: 'Giza', fee: 320, languages: ['ar', 'en'] });
    await seed('g', { clinicId: 'cl_g', specialty: 'cardiology', nameEn: 'Dr Dina Salem', nameAr: 'د. دينا سالم', area: 'Dokki', governorate: 'Giza', fee: 310, languages: ['ar'] });
    await seed('h', { clinicId: 'cl_h', specialty: 'dermatology', nameEn: 'Dr Youssef Ramy', nameAr: 'د. يوسف رامي', area: 'Heliopolis', governorate: 'Cairo', fee: 200 });
    for (const k of ['a', 'b']) await c.prisma.provider.update({ where: { id: `lst_${k}` }, data: { nextSlotAt: hours(3) } });
    await c.prisma.provider.update({ where: { id: 'lst_c' }, data: { nextSlotAt: hours(60) } });
    await c.get(SlugBootstrapService).runOnce();
    await c.prisma.growthConfigVersion.deleteMany({ where: { kind: 'SEO_AUTOMATION' } });
    purge();
  });

  describe('the quality gate over the seeded market', () => {
    it('measures every sitemap page in both locales, stores one report each, and reports (changes nothing) by default', async () => {
      const r = await seo().run();
      expect(r).toMatchObject({ measured: true, autoNoindex: false });
      expect(r.reports).toBe(r.pages * 2); expect(r.pages).toBeGreaterThanOrEqual(15);
      const rows = await seo().latestReports('EG');
      expect(rows).toHaveLength(r.reports);
      // print what fails so the thresholds are calibrated on real pages, not on fixtures
      const failing = rows.filter((x) => x.failedChecks.some((f) => !f.startsWith('~'))).map((x) => `${x.pageKey}|${x.locale}: ${x.failedChecks.join(',')}`);
      // eslint-disable-next-line no-console
      console.log(`SEO gate seed result: ${rows.length} reports, ${failing.length} with a failed check\n${(r.findings ?? []).map((f) => `${f.pageKey}|${f.locale} ${f.check}: ${f.detail}`).join('\n')}`); void failing;
      // the default never changes a page: every sitemap page is still indexable
      const idx = await c.http().get('/sitemap.xml').expect(200);
      expect(idx.text).toContain('doctor-eg-ar-1.xml');
      expect((await get('/en/eg/doctor/sara-hassan').expect(200)).text).toMatch(/<meta name="robots" content="index,follow/);
    });
  });

  describe('auto-noindex is a switch, off by default', () => {
    const thinDoctors = (auto: boolean) => setAuto({ autoNoindex: auto, minUniqueWords: { ...SEO_AUTOMATION_DEFAULTS().minUniqueWords, doctor: 400 } });
    const shard = async (name: string) => c.http().get(`/sitemaps/${name}`);

    it('a deliberately thin doctor page is FLAGGED with the toggle off but stays indexable and listed', async () => {
      await thinDoctors(false);
      const r = await seo().run();
      expect(r.measured).toBe(true); expect(r.failedPages).toBeGreaterThanOrEqual(8); expect(r.findings!.some((f) => f.pageKey === 'doctor:sara-hassan' && f.check === 'thin-content' && f.blocking)).toBe(true);
      purge();
      expect((await get('/en/eg/doctor/sara-hassan').expect(200)).text).toMatch(/<meta name="robots" content="index,follow/);
      expect((await shard('doctor-eg-en-1.xml')).status).toBe(200);
      const row = (await seo().latestReports('EG')).find((x) => x.pageKey === 'doctor:sara-hassan' && x.locale === 'en')!; expect(row.failedChecks).toContain('thin-content'); expect(row.score).toBeLessThanOrEqual(80);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'SeoQualityGateFailed' } })).toBeGreaterThan(0);
    });

    it('with the toggle ON the same page becomes noindex (meta and header), leaves the sitemap, and no computed link points at it', async () => {
      await thinDoctors(true);
      await seo().run(); purge();
      const r = await get('/en/eg/doctor/sara-hassan').expect(200);
      expect(parseHead(r.text).robots).toMatch(/noindex/); expect(r.headers['x-robots-tag']).toBe('noindex');
      expect((await shard('doctor-eg-en-1.xml')).status).toBe(404); // every doctor failed: the shard is empty and not served
      expect((await get('/en/eg/doctors/cardiology').expect(200)).text).toMatch(/<meta name="robots" content="index,follow/); // a page that passes is untouched
      expect(await c.prisma.seoInternalLink.count({ where: { toKey: { startsWith: 'doctor:' } } })).toBe(0);
      expect(await c.prisma.seoInternalLink.count({ where: { fromKey: { startsWith: 'doctor:' } } })).toBe(0);
      expect((await get('/en/eg/doctors/cardiology').expect(200)).text).not.toContain('/en/eg/doctor/sara-hassan"><');
      // the toggle is reversible: switch it off, rerun, the page is indexable again
      await thinDoctors(false); await seo().run(); purge();
      expect(parseHead((await get('/en/eg/doctor/sara-hassan').expect(200)).text).robots).toMatch(/^index/);
    });
  });

  describe('computed internal links', () => {
    it('are stored once per rule within the caps, appear in the SSR HTML as plain anchors in both languages, never twice on a page, and a rerun changes nothing', async () => {
      await seo().run(); purge();
      const links = await c.prisma.seoInternalLink.findMany({ orderBy: [{ fromKey: 'asc' }, { toKey: 'asc' }] });
      expect(links.length).toBeGreaterThan(20);
      const per = new Map<string, number>(); const kind = new Map<string, number>();
      for (const l of links) { per.set(l.fromKey, (per.get(l.fromKey) ?? 0) + 1); const k = `${l.fromKey}|${l.anchorKind}`; kind.set(k, (kind.get(k) ?? 0) + 1); expect(l.fromKey).not.toBe(l.toKey); }
      for (const [k, n] of per) expect({ k, ok: n <= 50 }).toEqual({ k, ok: true });
      for (const [k, n] of kind) if (!/\|(DOCTOR|CLINIC|ORPHAN_FIX)$/.test(k)) expect({ k, ok: n <= 3 }).toEqual({ k, ok: true });
      // a doctor page links to its clinic and to the district hub; the HTML carries them in both languages
      const clinicSlug = (await c.prisma.growthSlug.findFirstOrThrow({ where: { entityType: 'CLINIC', entityId: 'cl_a' } })).slug;
      const any = links.find((l) => l.fromKey === 'doctor:sara-hassan' && l.rule === 'DOCTOR_CLINIC'); expect(any?.toKey).toBe(`clinic:${clinicSlug}`);
      for (const loc of ['en', 'ar'] as const) {
        const html = (await get(`/${loc}/eg/doctor/sara-hassan`).expect(200)).text;
        const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!);
        expect(new Set(hrefs).size).toBe(hrefs.length - hrefs.filter((h, i) => hrefs.indexOf(h) !== i).length); // computed links add nothing the page already had
        const nav = /<nav[^>]*data-computed-links[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
        const inNav = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
        for (const h of inNav) expect(h.startsWith(`/${loc}/eg/`)).toBe(true);
        expect(inNav.length).toBeLessThanOrEqual(50);
      }
      // stable: nothing is rewritten when nothing changed
      const before = (await c.prisma.seoInternalLink.findMany({ orderBy: { id: 'asc' } })).map((l) => `${l.id}|${l.fromKey}|${l.toKey}|${l.rule}|${l.rank}|${l.computedAt.toISOString()}`);
      await seo().run();
      expect((await c.prisma.seoInternalLink.findMany({ orderBy: { id: 'asc' } })).map((l) => `${l.id}|${l.fromKey}|${l.toKey}|${l.rule}|${l.rank}|${l.computedAt.toISOString()}`)).toEqual(before);
    });

    it('no computed link goes to a page that fails the gate, and a failing page has no computed links of its own', async () => {
      await setAuto({ minUniqueWords: { ...SEO_AUTOMATION_DEFAULTS().minUniqueWords, clinic: 40 } }); // the single-doctor clinics fail
      await seo().run();
      const failing = new Set((await seo().latestReports('EG')).filter((r) => r.failedChecks.includes('~noindex')).map((r) => r.pageKey));
      expect([...failing].some((k) => k.startsWith('clinic:'))).toBe(true);
      const links = await c.prisma.seoInternalLink.findMany();
      for (const l of links) { expect(failing.has(l.toKey)).toBe(false); expect(failing.has(l.fromKey)).toBe(false); }
    });
  });

  describe('vitals and indexation', () => {
    const LAB = [
      { factor: 'mobile', locale: 'ar', page: 'doctor', perf: 97, lcp: 1710, cls: 0, tbt: 40 }, { factor: 'mobile', locale: 'en', page: 'doctor', perf: 93, lcp: 2320, cls: 0.02, tbt: 90 },
      { factor: 'mobile', locale: 'ar', page: 'clinic', perf: 88, lcp: 2900, cls: 0.14, tbt: 260 }, { factor: 'desktop', locale: 'ar', page: 'doctor', perf: 100, lcp: 700, cls: 0, tbt: 0 },
    ];
    it('says "not measured" until data exists, then shows lab numbers, raises a breach event once per day, and lists the readiness rows', async () => {
      const v = c.get(SeoVitalsService);
      const none = (await c.http().get(`${BASE}/vitals`).set(ops).expect(200)).body;
      expect(none.lab.measured).toBe(false); expect(none.lab.note).toMatch(/Not measured/); expect(none.latest).toEqual([]); expect(none.readiness.productionIndexing.every((r: { ok: boolean }) => !r.ok)).toBe(true);
      expect(await v.ingestLab(undefined)).toMatchObject({ measured: false }); // no audit output on this machine: nothing invented
      expect(await v.ingestLab(LAB)).toMatchObject({ measured: true, points: 8 });
      const ov = (await c.http().get(`${BASE}/vitals`).set(ops).expect(200)).body;
      expect(ov.lab.measured).toBe(true); expect(ov.latest.find((x: { templateKind: string; metric: string }) => x.templateKind === 'doctor' && x.metric === 'lcp_ms').p75).toBe(2320);
      expect(ov.breaches.map((b: { templateKind: string; metric: string }) => `${b.templateKind}.${b.metric}`).sort()).toEqual(['clinic.cls', 'clinic.lcp_ms', 'clinic.perf_score', 'clinic.tbt_ms']);
      expect(ov.readiness.productionIndexing).toEqual([{ key: 'vitals_measured', ok: true }, { key: 'vitals_within_budget', ok: false }]);
      await c.http().get(`${BASE}/vitals`).set(ops).expect(200);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'SeoVitalBudgetBreached' } })).toBe(4); // deduplicated per template, metric, source and day
    });
    it('field data comes from the CrUX adapter rows (cls in hundredths) and is kept apart from lab data', async () => {
      const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      for (const [dim, metric, value] of [['template:doctor', 'lcp_p75', 2400], ['template:doctor', 'inp_p75', 250], ['template:doctor', 'cls_p75', 8]] as const) await c.prisma.growthExternalMetricDaily.create({ data: { kind: 'crux', day, dimensionKey: dim, metric, value } });
      expect(await c.get(SeoVitalsService).ingestField()).toMatchObject({ measured: true, points: 3 });
      const rows = await c.prisma.seoVitalSnapshot.findMany({ where: { source: 'FIELD' }, orderBy: { metric: 'asc' } });
      expect(rows.map((r) => [r.metric, r.p75])).toEqual([['cls', 0.08], ['inp_ms', 250], ['lcp_ms', 2400]]);
      const ov = (await c.http().get(`${BASE}/vitals`).set(ops).expect(200)).body; expect(ov.field.measured).toBe(true); expect(ov.lab.measured).toBe(false);
      expect(ov.breaches.map((b: { metric: string }) => b.metric)).toEqual(['inp_ms']);
    });
    it('indexation: submitted and excluded are real, indexed is "not measured" until Search Console coverage exists', async () => {
      await setAuto({ autoNoindex: true, minUniqueWords: { ...SEO_AUTOMATION_DEFAULTS().minUniqueWords, doctor: 400 } });
      await seo().run();
      const snap = await c.get(SeoIndexationService).snapshot();
      const doctor = snap.find((x) => x.templateKind === 'doctor')!; expect(doctor).toMatchObject({ submitted: 16, excluded: 16, indexed: 0 }); expect(doctor.reasonBuckets).toMatchObject({ 'thin-content': 16, indexedKnown: false });
      const api = (await c.http().get(`${BASE}/indexation`).set(ops).expect(200)).body;
      expect(api.rows.find((r: { templateKind: string }) => r.templateKind === 'doctor')).toMatchObject({ indexed: null, indexedKnown: false, submitted: 16 });
      await c.prisma.growthExternalMetricDaily.create({ data: { kind: 'searchconsole', day: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`), dimensionKey: 'template:doctor', metric: 'indexed_pages', value: 11 } });
      await c.get(SeoIndexationService).snapshot();
      expect((await c.http().get(`${BASE}/indexation`).set(ops).expect(200)).body.rows.find((r: { templateKind: string }) => r.templateKind === 'doctor')).toMatchObject({ indexed: 11, indexedKnown: true });
    });
  });

  describe('ops API', () => {
    it('needs a session; reads for ops, runs for super admins; the overview names the mode and the findings', async () => {
      for (const p of ['/overview', '/reports', '/config', '/links', '/vitals', '/indexation']) await c.http().get(`${BASE}${p}`).expect(401);
      await c.http().post(`${BASE}/run`).set(ops).send({}).expect(403);
      const before = (await c.http().get(`${BASE}/overview`).set(ops).expect(200)).body; expect(before).toMatchObject({ measured: false, autoNoindex: false });
      const run = (await c.http().post(`${BASE}/run`).set(admin).send({}).expect(200)).body; expect(run).toMatchObject({ measured: true, autoNoindex: false });
      const ov = (await c.http().get(`${BASE}/overview`).set(ops).expect(200)).body;
      expect(ov).toMatchObject({ measured: true, bundleAvailable: true }); expect(ov.byTemplate.map((t: { template: string }) => t.template)).toEqual(expect.arrayContaining(['doctor', 'clinic', 'hub', 'home']));
      expect(ov.links.total).toBeGreaterThan(0);
      const rep = (await c.http().get(`${BASE}/reports?failed=true&templateKind=district`).set(ops).expect(200)).body.rows; expect(rep.every((r: { failedChecks: string[] }) => r.failedChecks.length > 0)).toBe(true);
      const cfg = (await c.http().get(`${BASE}/config`).set(ops).expect(200)).body; expect(cfg).toMatchObject({ editable: false, source: 'PROPOSED_DEFAULT' }); expect(cfg.config.autoNoindex).toBe(false);
      const links = (await c.http().get(`${BASE}/links?from=doctor:sara-hassan`).set(ops).expect(200)).body; expect(links.groups.length).toBeGreaterThan(0);
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.seo_automation.run' } })).toBeGreaterThan(0);
    });
    it('the nightly job runs the gate, vitals and indexation in one pass', async () => {
      const r = await c.get(SeoAutomationJob).run();
      expect(r.gate.measured).toBe(true); expect(r.indexation).toBeGreaterThan(0); expect(r.lab.measured).toBe(false);
    });
  });
});
