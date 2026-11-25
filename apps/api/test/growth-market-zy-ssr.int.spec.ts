import { createCtx, TestCtx } from './harness';
import { AttributionService } from '../src/growth/growth-public';
import { LifecyclePolicyService } from '../src/growth/lifecycle/lifecycle-policy.service';
import { PreferenceCentreService } from '../src/patient/consent/preference-centre.service';
import { MarketProfileService, MarketService, marketFacts, marketProfile, marketTimezone, setMarketProfileSnapshot } from '../src/market/market-public';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { seedProvider } from './harness';

const BASE = '/api/v1/admin/growth/market-onboarding';
const CFG = '/api/v1/ops/growth/config';
type Auth = Record<string, string>;
const csv = (rows: string[]) => ['level,key,parentKey,nameAr,nameEn,slugAr,slugEn', ...rows].join('\n');
const GEO = csv(['CITY,amman,,عمّان,Amman,amman,amman', 'CITY,irbid,,إربد,Irbid,irbid,irbid', 'DISTRICT,abdoun,amman,عبدون,Abdoun,abdoun,abdoun', 'DISTRICT,sweileh,amman,صويلح,Sweileh,sweileh,sweileh']);
const identity = { name: { ar: 'زد واي', en: 'Zeta Yankee' }, currency: 'JOD', minorUnits: 3, phoneCode: '+962', timezone: 'Asia/Amman', locales: ['ar', 'en'], defaultLocale: 'ar', quietHours: { start: '22:00', end: '08:00' }, workingWeek: [0, 1, 2, 3, 4] };
const regulation = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'zy-regime-v0', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: false, dataExportRuleId: 'zy-export-v0' };
const consent = { textVersionIds: { analytics: 'TODO_NEEDS_HUMAN_v0', marketing: 'TODO_NEEDS_HUMAN_v0' }, maxMarketingPerDay: 1, maxMarketingPerWeek: 2 };


const HOST = 'https://kiorex.test';
const get = (c: TestCtx, path: string) => c.http().get(path).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x) => (d += x)); res.on('end', () => cb(null, d)); });
const doc = (html: string) => ({
  canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '',
  alternates: [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]] as const),
  lang: /<html lang="([^"]+)" dir="([^"]+)"/.exec(html)?.slice(1) ?? [],
});

/**
 * Gap closure (ZY readiness): the public SSR page of a LIVE second market. ZY is created through the wizard only; once a person records the gate the doctor page renders with the ZY canonical
 * path, hreflang alternates inside /zy, the JOD currency with three minor units in the markup and the sitemap, and nothing of the default market leaks into it. Real Vite SSR bundle, real database.
 */
describe('public site SSR for a live ZY', () => {
  let c: TestCtx; let A: Auth; let B: Auth; const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => { if (!(k in prev)) prev[k] = process.env[k]; process.env[k] = v; };
  beforeAll(async () => { ensurePublicBundle(); setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', HOST); setEnv('SITE_SPA_SHELL', writeSpaShell()); c = await createCtx(); }, 180_000);
  afterAll(async () => { setMarketProfileSnapshot([]); await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); setMarketProfileSnapshot([]); A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); });
  const step = (cc: string, s: string, body: unknown, who = A) => c.http().put(`${BASE}/plans/${cc}/steps/${s}`).set(who).send(body as object);
  async function planZy(create = true) {
    if (create) await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
    await step('ZY', 'identity', identity).expect(200); await step('ZY', 'regulation', regulation).expect(200); await step('ZY', 'consent', consent).expect(200);
    await step('ZY', 'residency', { dataCellId: 'frankfurt' }).expect(200); await step('ZY', 'providers', { importBatchId: 'imp_zy_batch_1' }).expect(200);
    await step('ZY', 'specialties', { enabled: [{ code: 'dermatology', nameAr: 'الجلدية', nameEn: 'Dermatology' }, { code: 'paediatrics', nameAr: 'الأطفال', nameEn: 'Paediatrics' }] }).expect(200);
    await step('ZY', 'integrations', { whatsappPhoneNumberIdRef: null }).expect(200);
    await c.http().post(`${BASE}/plans/ZY/geography`).set(A).send({ csv: GEO }).expect(200);
  }
  async function publishAndApprove() {
    const res = await c.http().post(`${BASE}/plans/ZY/publish`).set(A); if (res.status !== 200) throw new Error(JSON.stringify(res.body)); const pub = res.body;
    for (const k of ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS']) await c.http().post(`${CFG}/${pub.drafted[k].id}/approve`).set(B).expect(200);
    await c.get(MarketProfileService).refresh(); c.flags.invalidate(); return pub;
  }

    const gate = async () => { await c.flags.recordGate('test', 'market.zy.live', { gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' }); c.flags.invalidate(); };

  it('before the gate the ZY page and sitemap do not exist; after it the page carries the ZY canonical, hreflang and JOD, and no default-market value', async () => {
    await planZy(); await publishAndApprove();
    await seedProvider(c, { id: 'lst_zy1', clinicianId: 'dr_zy1', clinicId: 'cl_zy1', specialty: 'dermatology', nameEn: 'Dr Layla Haddad', nameAr: 'د. ليلى حداد', area: 'Abdoun', governorate: 'Amman', fee: 305 } as never);
    await c.prisma.provider.update({ where: { id: 'lst_zy1' }, data: { market: 'ZY', currency: 'JOD', minFeeMinor: 30500, maxFeeMinor: 30500 } });
    await c.prisma.growthSlug.create({ data: { market: 'ZY', entityType: 'DOCTOR', entityId: 'lst_zy1', slug: 'layla-haddad' } });
    c.flags.invalidate();
    const off = await get(c, '/en/zy/doctor/layla-haddad'); expect(off.status).toBe(404);
    await gate();
    const r = await get(c, '/en/zy/doctor/layla-haddad'); expect(r.status).toBe(200);
    const html = r.body as string; const d = doc(html);
    expect(d.canonical).toBe(`${HOST}/en/zy/doctor/layla-haddad`);
    expect(d.alternates.map(([l]) => l).sort()).toEqual(expect.arrayContaining(['ar', 'en']));
    for (const [, href] of d.alternates) { expect(href).toContain('/zy/'); expect(href).not.toContain('/eg/'); }
    expect(d.lang).toEqual(['en', 'ltr']);
    expect(html).toContain('JOD'); expect(html).toMatch(/30\.500|30\.5/); expect(html).not.toMatch(/\bEGP\b/); expect(html).not.toMatch(/\/eg\//);
    const ar = await get(c, '/ar/zy/doctor/layla-haddad'); expect(ar.status).toBe(200); expect(doc(ar.body as string).lang).toEqual(['ar', 'rtl']); expect(doc(ar.body as string).canonical).toBe(`${HOST}/ar/zy/doctor/layla-haddad`);
    const idx = await get(c, '/sitemap.xml'); expect(idx.status).toBe(200); expect(idx.body as string).toContain('zy');
  });

  it('the specialty subset chosen in the wizard is read by the catalogue and by search: ZY shows only dermatology and paediatrics, with its own names; EG keeps the whole catalogue', async () => {
    await planZy(); await publishAndApprove(); await gate();
    const mk = async (id: string, specialty: string, market: string) => {
      await seedProvider(c, { id, clinicianId: `dr_${id}`, clinicId: `cl_${id}`, specialty, nameEn: `Dr ${id}`, nameAr: `د. ${id}`, area: 'Abdoun', governorate: 'Amman', fee: 305 } as never);
      await c.prisma.provider.update({ where: { id }, data: { market, currency: market === 'ZY' ? 'JOD' : 'EGP' } });
    };
    await mk('lst_zd', 'dermatology', 'ZY'); await mk('lst_zc', 'cardiology', 'ZY'); await mk('lst_ec', 'cardiology', 'EG'); await mk('lst_ed', 'dermatology', 'EG');
    c.get(MarketService).invalidateSpecialties(); c.flags.invalidate();
    const names = (b: { items: { id: string }[] }) => b.items.map((x) => x.id).sort();
    const all = (await c.http().get('/api/v1/search/providers?pageSize=30').expect(200)).body;
    expect(names(all)).toEqual(['lst_ec', 'lst_ed', 'lst_zd']); // ZY cardiology is outside the market's subset; EG is untouched
    const zyCard = (await c.http().get('/api/v1/search/providers?specialty=cardiology').expect(200)).body; expect(names(zyCard)).toEqual(['lst_ec']);
    const cat = (await c.http().get('/api/v1/specialties').expect(200)).body as { code: string }[]; expect(cat.length).toBeGreaterThan(10);
    const zy = (await c.http().get('/api/v1/specialties?market=zy').expect(200)).body as { code: string; ar: string; en: string }[];
    expect(zy.map((x) => x.code).sort()).toEqual(['dermatology', 'paediatrics']); expect(zy.find((x) => x.code === 'dermatology')).toMatchObject({ ar: 'الجلدية', en: 'Dermatology' });
    expect((await c.http().get('/api/v1/specialties?market=eg').expect(200)).body.length).toBe(cat.length);
    expect((await c.http().get('/api/v1/specialties?market=xx').expect(200)).body.length).toBe(cat.length); // an unknown market is not a restriction
  });
});
