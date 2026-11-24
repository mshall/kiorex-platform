import { createHash } from 'node:crypto';
import { createCtx, seedProvider, TestCtx } from './harness';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { PublicSiteCache } from '../src/public-site/public-site-public';
import { SlugBootstrapService } from '../src/growth/seo/seo-public';
import { auditPages, locsOf, parseHead, type AuditPage } from '../src/public-site/seo-audit';

/**
 * GRW-P1-F against the REAL SSR bundle and database: slug bootstrap, every page template in AR and EN, the thin-page guard rules of the new hubs,
 * pagination policy, versioned templates, pharmacy and lab gating, JSON-LD and review policy, images, Arabic loose URLs, verification, ops endpoints,
 * a crawl of every sitemap URL with the SEO audit, and that no private data reaches any page.
 */
const HOST = 'https://kiorex.test';
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

describe('SEO templates, slugs and structured data (GRW-P1-F)', () => {
  let c: TestCtx;
  const get = (path: string, headers: Record<string, string> = {}) => c.http().get(path).set(headers).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x) => (d += x)); res.on('end', () => { (res as unknown as { text: string }).text = d; cb(null, d); }); });
  const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in prev)) prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  const purge = () => { c.flags.invalidate(); c.get(PublicSiteCache).purgeAll(); };
  const meta = (html: string) => parseHead(html);
  const unlock = async (key: string) => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); c.flags.invalidate(); };
  const partner = (id: string, kind: 'PHARMACY' | 'LAB', name: string, nameAr: string | null, status = 'LIVE') => c.prisma.partnerConnection.create({ data: { id, kind, orgRef: `org_${id}`, name, nameAr, market: 'EG', statusTokenHash: 'x'.repeat(64), status } });
  const activateSeo = (payload: Record<string, unknown>) => c.prisma.growthConfigVersion.create({ data: { kind: 'SEO', scope: 'GLOBAL', scopeId: '', version: 90 + Math.floor(Math.random() * 1000), status: 'ACTIVE', payload: payload as never, createdBy: 'TEST_FIXTURE', effectiveFrom: new Date(Date.now() - 60_000), checksum: 'test' } });
  const providers: Record<string, string> = {};

  const seed = async (key: string, o: Parameters<typeof seedProvider>[1]) => { providers[key] = await seedProvider(c, { id: `lst_${key}`, clinicianId: `dr_${key}`, ...o }); };

  beforeAll(async () => {
    ensurePublicBundle();
    setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', HOST); setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx();
  }, 180_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  beforeEach(async () => {
    await c.reset();
    setEnv('SITE_ENVIRONMENT', 'production');
    for (const k of ['SITE_GOOGLE_SITE_VERIFICATION', 'SITE_BING_SITE_VERIFICATION', 'SITE_GOOGLE_VERIFICATION_FILE', 'SITE_BING_AUTH_USER', 'SITE_IMAGE_CDN']) setEnv(k, undefined);
    // Cairo / Maadi: three cardiologists (two with a slot today, two declaring video); Giza / Dokki: three more; one dermatologist in Nasr City; a nurse
    await seed('a', { clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن', area: 'Maadi', governorate: 'Cairo', fee: 300, languages: ['ar', 'en'] });
    await seed('b', { clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن', area: 'Maadi', governorate: 'Cairo', fee: 450, languages: ['ar'] });
    await seed('c', { clinicId: 'cl_c', specialty: 'cardiology', nameEn: 'Dr Mona Adel', nameAr: 'د. منى عادل', area: 'Maadi', governorate: 'Cairo', fee: 350, languages: ['en'] });
    await seed('d', { clinicId: 'cl_d', specialty: 'dermatology', nameEn: 'Dr Hala Samir', nameAr: 'د. هالة سمير', area: 'Nasr City', governorate: 'Cairo', fee: 250 });
    await seed('e', { clinicId: 'cl_e', specialty: 'cardiology', nameEn: 'Dr Omar Nabil', nameAr: 'د. عمر نبيل', area: 'Dokki', governorate: 'Giza', fee: 280, languages: ['ar'] });
    await seed('f', { clinicId: 'cl_e', specialty: 'cardiology', nameEn: 'Dr Karim Fouad', nameAr: 'د. كريم فؤاد', area: 'Dokki', governorate: 'Giza', fee: 320, languages: ['ar', 'en'] });
    await seed('g', { clinicId: 'cl_g', specialty: 'cardiology', nameEn: 'Dr Dina Salem', nameAr: 'د. دينا سالم', area: 'Dokki', governorate: 'Giza', fee: 310, languages: ['ar'] });
    await seed('h', { clinicId: 'cl_h', specialty: 'dermatology', nameEn: '', nameAr: 'د. محمد أحمد', area: 'Heliopolis', governorate: 'Cairo', fee: 200 });
    for (const k of ['a', 'b']) await c.prisma.provider.update({ where: { id: `lst_${k}` }, data: { nextSlotAt: hours(3) } });
    await c.prisma.provider.update({ where: { id: 'lst_c' }, data: { nextSlotAt: hours(60) } });
    for (const k of ['a', 'b']) {
      const row = await c.prisma.provider.findUniqueOrThrow({ where: { id: `lst_${k}` } });
      await c.prisma.provider.update({ where: { id: row.id }, data: { raw: { ...(row.raw as object), provider: { ...((row.raw as { provider: object }).provider), telemedicine: true } } as never } });
    }
    await c.get(SlugBootstrapService).runOnce();
    purge();
  });

  // ── slugs ────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('slug bootstrap and backfill', () => {
    it('gives every LIVE provider and clinic an ASCII slug: English name, collision suffix, Arabic-only fallback', async () => {
      const slugs = await c.prisma.growthSlug.findMany({ where: { entityType: 'DOCTOR' }, orderBy: { slug: 'asc' } });
      expect(slugs).toHaveLength(8);
      for (const s of slugs) expect(s.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
      const byId = new Map(slugs.map((s) => [s.entityId, s.slug]));
      expect(byId.get('lst_a')).toBe('sara-hassan');
      expect(byId.get('lst_b')).toBe('sara-hassan-2'); // same name: -2, never the same slug twice
      expect(byId.get('lst_c')).toBe('mona-adel');
      expect(byId.get('lst_h')).toBe('mohamed-ahmed'); // Arabic-only name, transliterated with the conventional spelling
      const clinics = await c.prisma.growthSlug.findMany({ where: { entityType: 'CLINIC' } });
      expect(clinics.map((x) => x.entityId).sort()).toEqual(['cl_a', 'cl_c', 'cl_d', 'cl_e', 'cl_g', 'cl_h']);
    });
    it('is idempotent, never changes an existing slug and a dry run writes nothing', async () => {
      const before = await c.prisma.growthSlug.findMany({ orderBy: { id: 'asc' } });
      const again = await c.get(SlugBootstrapService).runOnce();
      expect(again.created).toEqual({ DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 });
      expect(await c.prisma.growthSlug.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
      await seed('i', { clinicId: 'cl_i', specialty: 'cardiology', nameEn: 'Dr New Person', nameAr: 'د. جديد', area: 'Maadi', governorate: 'Cairo' });
      const dry = await c.get(SlugBootstrapService).runOnce({ dryRun: true });
      expect(dry.created.DOCTOR).toBe(1);
      expect(await c.prisma.growthSlug.count({ where: { entityId: 'lst_i' } })).toBe(0);
      await c.get(SlugBootstrapService).runOnce();
      expect(await c.prisma.growthSlug.count({ where: { entityId: 'lst_i' } })).toBe(1);
    });
    it('covers LIVE pharmacies and labs only and ignores partners that are not live', async () => {
      await partner('pc_ph1', 'PHARMACY', 'Nile Pharmacy', 'صيدلية النيل'); await partner('pc_lab1', 'LAB', 'Delta Lab', 'معمل الدلتا'); await partner('pc_ph2', 'PHARMACY', 'Draft Pharmacy', null, 'SUBMITTED');
      const r = await c.get(SlugBootstrapService).runOnce();
      expect(r.created).toMatchObject({ PHARMACY: 1, LAB: 1 });
      expect((await c.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market: 'EG', entityType: 'PHARMACY', entityId: 'pc_ph1' } } }))!.slug).toBe('nile-pharmacy');
      expect(await c.prisma.growthSlug.count({ where: { entityId: 'pc_ph2' } })).toBe(0);
    });
    it('a slug change keeps the old URL alive as a 301 and the slug service never hands it to another provider', async () => {
      await c.get(SlugBootstrapService); // service exists
      const { SlugService } = await import('../src/growth/seo/seo-public');
      await c.get(SlugService).rename({ entityType: 'DOCTOR', entityId: 'lst_a', newSlug: 'dr-sara-hassan' });
      purge();
      expect((await get('/en/eg/doctor/sara-hassan').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/dr-sara-hassan');
      await get('/en/eg/doctor/dr-sara-hassan').expect(200);
      expect(await c.get(SlugService).ensure({ entityType: 'DOCTOR', entityId: 'lst_zz', name: 'Sara Hassan' })).toBe('sara-hassan-3'); // history reserves it
    });
  });

  // ── every template ──────────────────────────────────────────────────────────────────────────────────────────────

  describe('every page type renders in AR and EN with correct metadata, canonical and hreflang pairs', () => {
    const pages: [string, string][] = [
      ['home', ''], ['hub', '/doctors/cardiology'], ['city', '/doctors/cardiology/cairo'], ['district', '/doctors/cardiology/cairo/maadi'], ['city-hub', '/locations/cairo'], ['district-hub', '/locations/cairo/maadi'],
      ['same-day', '/same-day/cardiology'], ['telemedicine', '/telemedicine/cardiology'], ['doctor', '/doctor/sara-hassan'], ['clinic', '/clinic/nile-clinic'],
    ];
    it.each(pages)('%s', async (_t, rest) => {
      // the clinic slug comes from the clinic's own name
      const path = rest === '/clinic/nile-clinic' ? `/clinic/${(await c.prisma.growthSlug.findFirstOrThrow({ where: { entityType: 'CLINIC', entityId: 'cl_a' } })).slug}` : rest;
      const [ar, en] = await Promise.all([get(`/ar/eg${path}`).expect(200), get(`/en/eg${path}`).expect(200)]);
      for (const [loc, r] of [['ar', ar], ['en', en]] as const) {
        const h = meta(r.text);
        expect(h.robots).toMatch(/^index,follow/);
        expect(h.canonical).toBe(`${HOST}/${loc}/eg${path}`);
        expect(h.alternates).toEqual([{ hreflang: 'ar', href: `${HOST}/ar/eg${path}` }, { hreflang: 'en', href: `${HOST}/en/eg${path}` }, { hreflang: 'x-default', href: `${HOST}/ar/eg${path}` }]);
        expect([h.lang, h.dir]).toEqual([loc, loc === 'ar' ? 'rtl' : 'ltr']);
        expect(h.title.length).toBeGreaterThan(5); expect(h.title.length).toBeLessThanOrEqual(60);
        expect(h.description.length).toBeLessThanOrEqual(155);
        expect(h.h1).toHaveLength(1);
        expect(h.og).toMatchObject({ title: h.title, url: h.canonical, locale: loc === 'ar' ? 'ar_EG' : 'en_US' });
        expect(h.twitter).toMatchObject({ card: 'summary_large_image', title: h.title });
        expect(h.jsonLd.length).toBeGreaterThan(0);
        expect(r.text).toContain('<details'); // FAQ
      }
      expect(meta(ar.text).title).toMatch(/[؀-ۿ]/);
      expect(meta(en.text).title).not.toMatch(/[؀-ۿ]/);
    });

    it('the hubs show data-derived content: counts, fee range, languages, same-day count, nearby districts, related specialties', async () => {
      const r = await get('/en/eg/doctors/cardiology/cairo').expect(200);
      expect(r.text).toContain('3 verified Cardiology doctors take bookings in Cairo');
      expect(r.text).toMatch(/Fees from [^<]*300[^<]*450/);
      expect(r.text).toContain('Languages: ar, en');
      expect(r.text).toContain('2 with a slot in the next 24 hours');
      expect(r.text).toContain('href="/en/eg/doctors/cardiology/cairo/maadi"'); // districts of the city
      expect(r.text).toContain('href="/en/eg/doctors/cardiology/giza"'); // other cities for the specialty
      expect(r.text).toContain('href="/en/eg/same-day/cardiology"'); // availability hub
      const district = await get('/en/eg/doctors/cardiology/cairo/maadi').expect(200);
      expect(district.text).toContain('Cardiology doctors in Maadi, Cairo');
      const cityHub = await get('/en/eg/locations/cairo').expect(200);
      expect(cityHub.text).toContain('Specialties available here');
      expect(cityHub.text).toContain('href="/en/eg/doctors/cardiology/cairo"');
    });

    it('two sibling pages are not the same template with a name swapped: their facts and links differ', async () => {
      const a = (await get('/en/eg/doctors/cardiology/cairo').expect(200)).text; const b = (await get('/en/eg/doctors/cardiology/giza').expect(200)).text;
      expect(a).not.toBe(b);
      expect(a).toContain('Dr Mona Adel'); expect(a).not.toContain('Dr Karim Fouad');
      expect(b).toContain('Dr Karim Fouad'); expect(b).not.toContain('Dr Mona Adel');
    });
  });

  // ── thin-page guard rules of the new hubs ────────────────────────────────────────────────────────────────────

  describe('thin-page guard: minimum counts, availability, parent duplication', () => {
    const robots = async (p: string) => meta((await get(p).expect(200)).text).robots;
    const smaps = async () => { const idx = await get('/sitemap.xml').expect(200); return (await Promise.all(locsOf(idx.text).map((s) => get(s.replace(HOST, ''))))).map((x) => x.text).join('\n'); };

    it('a district hub below the minimum, or identical to its city hub, is noindex,follow and absent from the sitemaps', async () => {
      expect(await robots('/en/eg/locations/cairo')).toMatch(/^index/); // 5 providers, parent = whole market (8)
      expect(await robots('/en/eg/locations/cairo/maadi')).toMatch(/^index/); // 3 of 5
      expect(await robots('/en/eg/locations/cairo/nasr-city')).toBe('noindex,follow'); // 1 provider
      expect(await robots('/en/eg/locations/giza')).toMatch(/^index/);
      expect(await robots('/en/eg/locations/giza/dokki')).toBe('noindex,follow'); // the same three providers as the Giza hub: a copy of its parent
      const all = await smaps();
      expect(all).toContain('/en/eg/locations/cairo/maadi');
      expect(all).not.toContain('locations/cairo/nasr-city');
      expect(all).not.toContain('locations/giza/dokki');
    });
    it('same-day needs real availability: with fewer than the minimum providers it is noindex and leaves the sitemap', async () => {
      expect(await robots('/en/eg/same-day/cardiology')).toMatch(/^index/);
      expect(await smaps()).toContain('/en/eg/same-day/cardiology');
      await c.prisma.provider.update({ where: { id: 'lst_b' }, data: { nextSlotAt: hours(72) } });
      purge();
      const r = await get('/en/eg/same-day/cardiology').expect(200);
      expect(meta(r.text).robots).toBe('noindex,follow'); expect(r.headers['x-robots-tag']).toBe('noindex');
      expect(await smaps()).not.toContain('same-day/cardiology');
      await c.prisma.provider.update({ where: { id: 'lst_a' }, data: { nextSlotAt: hours(72) } });
      purge();
      await get('/en/eg/same-day/cardiology').expect(404); // nobody has a slot: no empty doorway page
    });
    it('telemedicine lists only providers that declared video, and needs the minimum of them', async () => {
      const r = await get('/en/eg/telemedicine/cardiology').expect(200);
      expect(r.text).toContain('Dr Sara Hassan'); expect(r.text).not.toContain('Dr Mona Adel');
      await c.prisma.provider.update({ where: { id: 'lst_b' }, data: { raw: { provider: { telemedicine: false } } as never } });
      purge();
      expect(meta((await get('/en/eg/telemedicine/cardiology').expect(200)).text).robots).toBe('noindex,follow');
    });
    it('a noindex page gets no internal links from the navigation of its neighbours', async () => {
      const r = await get('/en/eg/locations/cairo').expect(200);
      expect(r.text).not.toContain('href="/en/eg/locations/cairo/nasr-city"');
      const g = await get('/en/eg/locations/giza').expect(200);
      expect(g.text).not.toContain('href="/en/eg/locations/giza/dokki"'); // the Giza district hub is a copy of the city hub
    });
  });

  // ── pagination ───────────────────────────────────────────────────────────────────────────────────────────────────

  describe('pagination', () => {
    beforeEach(async () => {
      for (let i = 0; i < 12; i++) await seed(`p${i}`, { clinicId: 'cl_p', specialty: 'cardiology', nameEn: `Dr Filler ${i}`, nameAr: `د. فيلر ${i}`, area: 'Maadi', governorate: 'Cairo', fee: 200 + i });
      await c.get(SlugBootstrapService).runOnce(); purge();
    });
    it('page 2 is self-canonical, noindex by default, has no rel prev/next and is not in the sitemaps', async () => {
      const r = await get('/en/eg/doctors/cardiology?page=2&utm_source=x').expect(200);
      const h = meta(r.text);
      expect(h.robots).toBe('noindex,follow');
      expect(h.canonical).toBe(`${HOST}/en/eg/doctors/cardiology?page=2`);
      expect(r.text).not.toMatch(/rel="(prev|next)"/);
      expect(r.text).toContain('Page 2 of 2');
      expect(r.text).toContain('href="/en/eg/doctors/cardiology"'); // link back to page 1
      const idx = await get('/sitemap.xml'); const all = (await Promise.all(locsOf(idx.text).map((s) => get(s.replace(HOST, ''))))).map((x) => x.text).join('');
      expect(all).not.toContain('page=2');
    });
    it('the SEO config can make paginated pages indexable (still self-canonical, still outside the sitemaps)', async () => {
      await activateSeo({ paginatedIndexable: true });
      c.get(PublicSiteCache).purgeAll(); await new Promise((res) => setTimeout(res, 10));
      // the SEO config is cached for 30 s per market: drop it through the ops rebuild path
      const { SeoConfigService } = await import('../src/public-site/seo-config.service');
      c.get(SeoConfigService).invalidate(); purge();
      const h = meta((await get('/en/eg/doctors/cardiology?page=2').expect(200)).text);
      expect(h.robots).toMatch(/^index/);
      expect(h.canonical).toBe(`${HOST}/en/eg/doctors/cardiology?page=2`);
    });
  });

  // ── versioned metadata templates ────────────────────────────────────────────────────────────────────────────

  describe('title and description templates from the versioned SEO configuration', () => {
    it('an ACTIVE SEO version overrides one locale and one page type; everything else keeps the defaults; invalid entries are ignored', async () => {
      await activateSeo({ templates: { ar: { city: { title: 'قلب {city} ({count})' }, hub: { title: '{nme}' } }, en: { doctor: { title: '<b>{name}</b>' } } } });
      const { SeoConfigService } = await import('../src/public-site/seo-config.service');
      c.get(SeoConfigService).invalidate(); purge();
      expect(meta((await get('/ar/eg/doctors/cardiology/cairo').expect(200)).text).title).toBe('قلب القاهرة (3) | كيوركس');
      expect(meta((await get('/en/eg/doctors/cardiology/cairo').expect(200)).text).title).toBe('Cardiology doctors in Cairo | Kiorex'); // English untouched
      expect(meta((await get('/ar/eg/doctors/cardiology').expect(200)).text).title).toBe('أطباء القلب | كيوركس'); // invalid placeholder: default kept
      expect(meta((await get('/en/eg/doctor/mona-adel').expect(200)).text).title).toBe('Dr Mona Adel, Cardiology | Kiorex'); // markup refused
    });
  });

  // ── JSON-LD, review policy, images ──────────────────────────────────────────────────────────────────────────────

  describe('structured data and review policy', () => {
    const ld = (html: string) => meta(html).jsonLd.map((x) => x.value as Record<string, unknown>);
    it('doctor: Physician + BreadcrumbList; clinic: MedicalClinic; listings: CollectionPage, ItemList, BreadcrumbList', async () => {
      expect(ld((await get('/en/eg/doctor/mona-adel').expect(200)).text).map((x) => x['@type'])).toEqual(['Physician', 'BreadcrumbList']);
      const clinicSlug = (await c.prisma.growthSlug.findFirstOrThrow({ where: { entityType: 'CLINIC', entityId: 'cl_c' } })).slug;
      expect(ld((await get(`/en/eg/clinic/${clinicSlug}`).expect(200)).text).map((x) => x['@type'])).toEqual(['MedicalClinic', 'BreadcrumbList']);
      expect(ld((await get('/en/eg/doctors/cardiology/cairo').expect(200)).text).map((x) => x['@type'])).toEqual(['CollectionPage', 'BreadcrumbList', 'ItemList']);
      expect(ld((await get('/en/eg').expect(200)).text).map((x) => x['@type'])).toEqual(['Organization', 'WebSite']);
    });
    it('aggregateRating only with enough VISIBLE verified reviews shown on the page; the threshold is configurable', async () => {
      const phys = async () => ld((await get('/en/eg/doctor/mona-adel').expect(200)).text).find((x) => x['@type'] === 'Physician')!;
      expect((await phys()).aggregateRating).toBeUndefined(); // no reviews at all
      await c.prisma.provider.update({ where: { id: 'lst_c' }, data: { ratingAvg: 4.5, ratingCount: 3 } });
      await c.prisma.review.create({ data: { bookingId: 'bk_1', sub: 'sub_secret_patient', providerId: 'lst_c', clinicId: 'cl_c', clinicianId: 'dr_c', kiorlyAppointmentId: 'apt_1', rating: 5, text: 'Very kind', status: 'VISIBLE', editableUntil: new Date() } });
      purge();
      expect((await phys()).aggregateRating).toBeUndefined(); // 3 reviews < the default minimum of 5
      await activateSeo({ reviewMarkupMinCount: 2 });
      const { SeoConfigService } = await import('../src/public-site/seo-config.service');
      c.get(SeoConfigService).invalidate(); purge();
      expect((await phys()).aggregateRating).toMatchObject({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 3, bestRating: 5, worstRating: 1 });
      await c.prisma.review.update({ where: { bookingId: 'bk_1' }, data: { status: 'HIDDEN' } }); purge();
      expect((await phys()).aggregateRating).toBeUndefined(); // nothing visible on the page: no markup
    });
    it('no page carries a telephone, e-mail, street address, coordinates, review text outside the visible list or opening hours in JSON-LD', async () => {
      for (const p of ['/en/eg/doctor/sara-hassan', '/ar/eg/doctors/cardiology/cairo', '/en/eg/locations/cairo']) {
        const text = JSON.stringify(ld((await get(p).expect(200)).text));
        expect(text).not.toMatch(/telephone|email|streetAddress|latitude|longitude|geo|openingHours|"review"/);
      }
    });
    it('photos render as responsive pictures with dimensions and alt when an image CDN is configured', async () => {
      const row = await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_c' } });
      await c.prisma.provider.update({ where: { id: 'lst_c' }, data: { raw: { ...(row.raw as object), provider: { ...((row.raw as { provider: object }).provider), photoUrl: 'https://img.kiorly.test/c.jpg' } } as never } });
      setEnv('SITE_IMAGE_CDN', 'https://img.kiorex.test'); purge();
      const h = (await get('/en/eg/doctor/mona-adel').expect(200)).text;
      expect(h).toContain('<picture>'); expect(h).toContain('image/avif'); expect(h).toContain('image/webp');
      expect(h).toMatch(/<img[^>]*alt="Dr Mona Adel, Cardiology, Maadi, Cairo"/);
      expect(h).toMatch(/fetchPriority="high"|fetchpriority="high"/i);
      setEnv('SITE_IMAGE_CDN', undefined); purge();
      expect((await get('/en/eg/doctor/mona-adel').expect(200)).text).not.toContain('<picture>');
    });
  });

  // ── pharmacy and lab ──────────────────────────────────────────────────────────────────────────────────────────

  describe('pharmacy and lab pages', () => {
    it('are gated by the partner registry AND the launch-locked feature flags (404 and absent from sitemaps while locked)', async () => {
      await partner('pc_ph1', 'PHARMACY', 'Nile Pharmacy', 'صيدلية النيل'); await partner('pc_lab1', 'LAB', 'Delta Lab', 'معمل الدلتا');
      await c.get(SlugBootstrapService).runOnce(); purge();
      await get('/en/eg/pharmacy/nile-pharmacy').expect(404);
      await get('/en/eg/lab/delta-lab').expect(404);
      await unlock('kiorex.pharmacy_orders'); await unlock('kiorex.lab_bookings'); purge();
      const ph = await get('/ar/eg/pharmacy/nile-pharmacy').expect(200);
      expect(meta(ph.text).h1).toEqual(['صيدلية النيل']);
      expect(meta(ph.text).jsonLd.map((x) => (x.value as { '@type': string })['@type'])).toEqual(['Pharmacy', 'BreadcrumbList']);
      expect(meta(ph.text).canonical).toBe(`${HOST}/ar/eg/pharmacy/nile-pharmacy`);
      const lab = await get('/en/eg/lab/delta-lab').expect(200);
      expect(meta(lab.text).jsonLd.map((x) => (x.value as { '@type': string })['@type'])).toEqual(['MedicalBusiness', 'BreadcrumbList']);
      expect(meta(lab.text).title).toBe('Delta Lab, medical lab | Kiorex');
      const idx = await get('/sitemap.xml'); const all = (await Promise.all(locsOf(idx.text).map((s) => get(s.replace(HOST, ''))))).map((x) => x.text).join('');
      expect(all).toContain('/en/eg/pharmacy/nile-pharmacy'); expect(all).toContain('/ar/eg/lab/delta-lab');
      await c.prisma.partnerConnection.update({ where: { id: 'pc_ph1' }, data: { status: 'PAUSED' } }); purge();
      await get('/en/eg/pharmacy/nile-pharmacy').expect(404); // no longer live: no public page
    });
  });

  // ── Arabic loose URLs ───────────────────────────────────────────────────────────────────────────────────────────

  describe('Arabic and variant URLs', () => {
    it('301 once to the clean canonical URL, which then answers 200', async () => {
      const r = await get('/ar/eg/doctors/' + encodeURIComponent('القلب') + '/' + encodeURIComponent('القاهرة')).redirects(0).expect(301);
      expect(r.headers.location).toBe('/ar/eg/doctors/cardiology/cairo');
      await get(r.headers.location!).expect(200);
      expect((await get('/ar/eg/doctor/' + encodeURIComponent('سارة حسن')).redirects(0).expect(301)).headers.location).toBe('/ar/eg/doctor/sara-hassan');
    });
  });

  // ── search engine verification ──────────────────────────────────────────────────────────────────────────────────

  describe('Search Console and Bing verification from configuration', () => {
    it('renders meta tags on the home page only and serves the verification files; nothing without configuration', async () => {
      expect(meta((await get('/en/eg').expect(200)).text).title).toBeTruthy();
      expect((await get('/en/eg')).text).not.toContain('google-site-verification');
      await get('/google0123456789abcdef.html').expect(404);
      setEnv('SITE_GOOGLE_SITE_VERIFICATION', 'tok_google_0123456789'); setEnv('SITE_BING_SITE_VERIFICATION', 'BING0123456789ABCDEF');
      setEnv('SITE_GOOGLE_VERIFICATION_FILE', 'google0123456789abcdef.html'); setEnv('SITE_BING_AUTH_USER', '0123456789ABCDEF0123456789ABCDEF'); purge();
      const home = (await get('/en/eg').expect(200)).text;
      expect(home).toContain('<meta name="google-site-verification" content="tok_google_0123456789">');
      expect(home).toContain('<meta name="msvalidate.01" content="BING0123456789ABCDEF">');
      expect((await get('/en/eg/doctors/cardiology').expect(200)).text).not.toContain('google-site-verification');
      expect((await get('/google0123456789abcdef.html').expect(200)).text).toBe('google-site-verification: google0123456789abcdef.html');
      expect((await get('/BingSiteAuth.xml').expect(200)).text).toContain('<user>0123456789ABCDEF0123456789ABCDEF</user>');
      await get('/google00000000other.html').expect(404);
    });
  });

  // ── ops API ──────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('ops SEO management API', () => {
    const ops = async () => c.as('ops_1', { roles: ['ops_admin'] });
    const api = (p: string) => `/api/v1/ops/growth/seo${p}`;
    it('requires an ops role', async () => {
      await c.http().get(api('/overview')).expect(401);
      await c.http().get(api('/overview')).set(await c.as('sub_p', { roles: ['patient'] })).expect(403);
    });
    it('lists pages with guard results, slugs, redirects and the resolved config (read-only)', async () => {
      const o = (await c.http().get(api('/overview')).set(await ops()).expect(200)).body;
      expect(o.pages.total).toBeGreaterThan(5); expect(o.slugs).toMatchObject({ providersLive: 8, providersWithSlug: 8, clinicsLive: 6, clinicsWithSlug: 6, missingProviderIds: [] });
      expect(o.sitemap.urlsByType).toMatchObject({ home: 1, doctor: 8, clinic: 6 });
      expect(o.searchEngines.mode).toBe('mock');
      const pages = (await c.http().get(api('/pages?type=district-hub&indexable=false')).set(await ops()).expect(200)).body;
      expect(pages.items.map((p: { key: string }) => p.key).sort()).toEqual(['district-hub:cairo/heliopolis', 'district-hub:cairo/nasr-city', 'district-hub:giza/dokki']);
      expect(pages.items.find((p: { key: string }) => p.key === 'district-hub:giza/dokki').reasons).toEqual(['PARENT_OVERLAP_AT_OR_ABOVE_100']);
      const slugs = (await c.http().get(api('/slugs?entityType=DOCTOR&q=sara')).set(await ops()).expect(200)).body;
      expect(slugs.items.map((s: { slug: string }) => s.slug).sort()).toEqual(['sara-hassan', 'sara-hassan-2']);
      const cfg = (await c.http().get(api('/config')).set(await ops()).expect(200)).body;
      expect(cfg.resolved.paginatedIndexable).toBe(false); expect(cfg.templateKeys).toContain('same-day'); expect(cfg.placeholders).toContain('specialty');
      const red = (await c.http().get(api('/redirects')).set(await ops()).expect(200)).body;
      expect(red.goneAfterDays).toBe(30);
    });
    it('the config hook validates SEO extension keys without storing anything', async () => {
      const bad = (await c.http().post(api('/config/validate')).set(await ops()).send({ templates: { en: { hub: { title: '{nme}' } } }, paginatedIndexable: 'x' }).expect(200)).body;
      expect(bad.valid).toBe(false); expect(bad.errors.length).toBe(2);
      expect((await c.http().post(api('/config/validate')).set(await ops()).send({ templates: { en: { hub: { title: '{specialty} doctors' } } } }).expect(200)).body).toEqual({ valid: true, errors: [] });
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'SEO', status: 'ACTIVE', ticket: null } })).toBe(0);
    });
    it('rebuild records the guard result per page and locale (GrowthLandingPage) and is audited; bootstrap is idempotent and audited', async () => {
      const r = (await c.http().post(api('/rebuild')).set(await ops()).expect(200)).body;
      expect(r.landingRowsWritten).toBe(r.pages * 2);
      const row = await c.prisma.growthLandingPage.findFirstOrThrow({ where: { pageType: 'DISTRICT_HUB', paramsKey: 'district-hub:giza/dokki', locale: 'en' } });
      expect(row.indexable).toBe(false); expect(row.guardResult).toMatchObject({ reasons: ['PARENT_OVERLAP_AT_OR_ABOVE_100'] });
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.seo.rebuild', actor: 'ops_1' } })).toBe(1);
      const b = (await c.http().post(api('/slugs/bootstrap')).set(await ops()).send({}).expect(200)).body;
      expect(b.created).toEqual({ DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 });
    });
    it('search engine endpoints run through the mock adapter and say so', async () => {
      const s = (await c.http().post(api('/search-engines/submit-sitemap')).set(await ops()).expect(200)).body;
      expect(s.mode).toBe('mock'); expect(s.results.map((x: { engine: string }) => x.engine)).toEqual(['google', 'bing']);
      expect((await c.http().get(api('/search-engines/performance')).set(await ops()).expect(200)).body.rows.every((x: { sample: boolean }) => x.sample)).toBe(true);
    });
  });

  // ── crawl ────────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('crawl: every sitemap URL', () => {
    const crawl = async () => {
      const idx = await get('/sitemap.xml').expect(200);
      const shards = locsOf(idx.text);
      const urls: string[] = [];
      for (const s of shards) { const r = await get(s.replace(HOST, '')).expect(200); urls.push(...locsOf(r.text)); }
      const pages: AuditPage[] = [];
      for (const u of urls) { const r = await get(u.replace(HOST, '')); pages.push({ url: u, status: r.status, headers: r.headers as Record<string, string>, html: r.text }); }
      return { urls, pages, shards };
    };
    beforeEach(async () => {
      await partner('pc_ph1', 'PHARMACY', 'Nile Pharmacy', 'صيدلية النيل'); await partner('pc_lab1', 'LAB', 'Delta Lab', 'معمل الدلتا');
      await unlock('kiorex.pharmacy_orders'); await unlock('kiorex.lab_bookings');
      const row = await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_a' } });
      await c.prisma.provider.update({ where: { id: 'lst_a' }, data: { raw: { ...(row.raw as object), provider: { ...((row.raw as { provider: object }).provider), photoUrl: 'https://img.kiorly.test/a.jpg' } } as never } });
      await c.get(SlugBootstrapService).runOnce(); purge();
    });
    it('every URL answers 200 and the SEO audit (head tags, canonical, hreflang, JSON-LD, duplicate titles, broken links, CWV hygiene) finds no error', async () => {
      const { urls, pages } = await crawl();
      expect(urls.length).toBeGreaterThan(30);
      const types = new Set(urls.map((u) => u.replace(HOST, '').split('/').slice(3, 4)[0] ?? 'home'));
      for (const t of ['doctors', 'locations', 'same-day', 'telemedicine', 'doctor', 'clinic', 'pharmacy', 'lab']) expect(types).toContain(t);
      expect(urls.some((u) => u === `${HOST}/ar/eg` || u === `${HOST}/en/eg`)).toBe(true);
      const issues = await auditPages(pages, { host: HOST, sitemapUrls: urls, statusOf: async (p) => (await get(p).redirects(0)).status });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
    it('every sitemap URL is indexable and every noindex generated page is outside the sitemaps', async () => {
      const { urls, pages } = await crawl();
      for (const p of pages) { expect(p.status).toBe(200); expect(meta(p.html).robots).toMatch(/^index/); expect(p.headers['x-robots-tag']).toBeUndefined(); }
      const inventory = (await c.http().get('/api/v1/ops/growth/seo/pages?limit=500').set(await c.as('ops_1', { roles: ['ops_admin'] })).expect(200)).body.items as { indexable: boolean; path: { ar: string; en: string } }[];
      const wrong = inventory.flatMap((p) => (['ar', 'en'] as const).filter((l) => urls.includes(`${HOST}${p.path[l]}`) !== p.indexable).map((l) => p.path[l]));
      expect(wrong).toEqual([]);
    });
    it('sitemap lastmod and shard naming per type, market and locale', async () => {
      const { shards } = await crawl();
      expect(shards.map((s) => s.replace(HOST, ''))).toEqual(expect.arrayContaining(['/sitemaps/city-hub-eg-ar-1.xml', '/sitemaps/same-day-eg-en-1.xml', '/sitemaps/pharmacy-eg-en-1.xml', '/sitemaps/lab-eg-ar-1.xml', '/sitemaps/telemedicine-eg-en-1.xml', '/sitemaps/district-hub-eg-ar-1.xml']));
    });
    it('no authenticated or private data appears: pages are byte-identical with a session or cookies, set no cookie, and hold no contact, address, patient or hidden-review data', async () => {
      await c.prisma.review.create({ data: { bookingId: 'bk_h', sub: 'sub_secret_patient', providerId: 'lst_a', clinicId: 'cl_a', clinicianId: 'dr_a', kiorlyAppointmentId: 'apt_h', rating: 1, text: 'SECRET HIDDEN COMPLAINT', status: 'HIDDEN', editableUntil: new Date() } });
      purge();
      const { urls, pages } = await crawl();
      const session = { ...(await c.as('sub_secret_patient')), Cookie: 'kx-session=abc; sid=1' };
      for (const p of pages.slice(0, 12)) {
        const authed = await get(p.url.replace(HOST, ''), session);
        expect(createHash('sha256').update(authed.text).digest('hex')).toBe(createHash('sha256').update(p.html).digest('hex'));
        expect(authed.headers['set-cookie']).toBeUndefined();
      }
      for (const p of pages) {
        expect(p.html).not.toMatch(/\+20221234567|1 Street Maadi|شارع ١ المعادي|sub_secret_patient|SECRET HIDDEN COMPLAINT|29\.96|31\.25|tel:|mailto:|"telephone"|"streetAddress"|"geo"|Authorization|Bearer /);
      }
      expect(urls.length).toBeGreaterThan(30);
    });
  });
});
