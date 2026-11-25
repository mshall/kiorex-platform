import { createCtx, seedProvider, TestCtx } from './harness';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { PublicSiteCache, SiteRenderer } from '../src/public-site/public-site-public';
import { CdnPurger } from '../src/public-site/cache-tags';

/**
 * GRW-P1-E: public site SSR infrastructure against the REAL Vite SSR bundle and the real database: status matrix, head tags, JSON-LD, canonical and
 * hreflang, slug history redirects, thin-page guard, sitemaps, robots, flag OFF and render-failure fallbacks, cache and purge, and that no private
 * data can reach a public page.
 */
const HOST = 'https://kiorex.test';
const doc = (html: string) => ({
  title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '',
  description: /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '',
  robots: /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? '',
  canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '',
  alternates: [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  h1: /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? '',
  jsonLd: [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]!.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'))),
  lang: /<html lang="([^"]+)" dir="([^"]+)"/.exec(html)?.slice(1) ?? [],
});

describe('public site SSR (GRW-P1-E)', () => {
  let c: TestCtx;
  const get = (path: string, headers: Record<string, string> = {}) => c.http().get(path).set(headers).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x) => (d += x)); res.on('end', () => { (res as unknown as { text: string }).text = d; cb(null, d); }); });
  const ids = { a: 'lst_a', b: 'lst_b', c: 'lst_c', d: 'lst_d' };
  const slug = async (entityType: string, entityId: string, s: string) => c.prisma.growthSlug.create({ data: { entityType, entityId, slug: s } });
  const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in prev)) prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };

  beforeAll(async () => {
    ensurePublicBundle();
    setEnv('SITE_ENVIRONMENT', 'production');
    setEnv('SITE_CANONICAL_HOST', HOST);
    setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx();
  }, 180_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  beforeEach(async () => {
    await c.reset();
    setEnv('SITE_ENVIRONMENT', 'production');
    // three cardiologists in Cairo/Maadi (guard passes), one dermatologist (thin: 1 provider)
    await seedProvider(c, { id: ids.a, clinicianId: 'dr_a', clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن', area: 'Maadi', governorate: 'Cairo', fee: 300, languages: ['ar', 'en'] });
    await seedProvider(c, { id: ids.b, clinicianId: 'dr_b', clinicId: 'cl_a', specialty: 'cardiology', nameEn: 'Dr Omar Nabil', nameAr: 'د. عمر نبيل', area: 'Maadi', governorate: 'Cairo', fee: 450, languages: ['ar'] });
    await seedProvider(c, { id: ids.c, clinicianId: 'dr_c', clinicId: 'cl_c', specialty: 'cardiology', nameEn: 'Dr Mona Adel', nameAr: 'د. منى عادل', area: 'Maadi', governorate: 'Cairo', fee: 350, languages: ['en'] });
    await seedProvider(c, { id: ids.d, clinicianId: 'dr_d', clinicId: 'cl_d', specialty: 'dermatology', nameEn: 'Dr Hala Samir', nameAr: 'د. هالة سمير', area: 'Nasr City', governorate: 'Cairo', fee: 250 });
    await slug('DOCTOR', ids.a, 'sara-hassan'); await slug('DOCTOR', ids.b, 'omar-nabil'); await slug('DOCTOR', ids.c, 'mona-adel'); await slug('DOCTOR', ids.d, 'hala-samir');
    await slug('CLINIC', 'cl_a', 'nile-clinic');
    c.flags.invalidate();
    // the SSR layer caches per process: start every test from an empty cache
    c.get(PublicSiteCache).purgeAll();
  });

  describe('G-18 landing page edits', () => {
    const A = { sub: 'adm_a', roles: ['super_admin'] }; const B = { sub: 'adm_b', roles: ['super_admin'] };
    it('an approved edit replaces the title and description of a listing page in that locale only; the body, canonical and indexing stay; a withdrawal restores the generated text', async () => {
      const { LandingEditService } = await import('../src/growth/seo-automation/landing-edit.service');
      const svc = c.get(LandingEditService);
      const before = doc((await get('/en/eg/doctors/cardiology').expect(200)).text);
      const d = await svc.createDraft(A, { pageKey: 'hub:cardiology', locale: 'en', title: 'Cardiologists in Egypt, book online | Kiorex', description: 'Compare verified cardiologists across Egypt and book a visit with live availability on Kiorex.' });
      await svc.submit(A, d.id); await svc.approve(B, d.id);
      c.get(PublicSiteCache).purgeAll();
      const after = doc((await get('/en/eg/doctors/cardiology').expect(200)).text);
      expect(after.title).toBe('Cardiologists in Egypt, book online | Kiorex'); expect(after.description).toMatch(/^Compare verified cardiologists/);
      expect(after.h1).toBe(before.h1); expect(after.canonical).toBe(before.canonical); expect(after.robots).toBe(before.robots); expect(after.alternates).toEqual(before.alternates);
      expect(doc((await get('/ar/eg/doctors/cardiology').expect(200)).text).title).not.toBe(after.title); // the other locale is untouched
      expect(doc((await get('/en/eg/doctors/cardiology/cairo').expect(200)).text).title).not.toBe(after.title); // so is another page
      await svc.withdraw(B, d.id, 'wording under review again'); c.get(PublicSiteCache).purgeAll();
      expect(doc((await get('/en/eg/doctors/cardiology').expect(200)).text).title).toBe(before.title);
    });
  });

  describe('doctor page', () => {
    it('renders title, description, h1, content, JSON-LD, canonical and hreflang without JavaScript', async () => {
      const r = await get('/en/eg/doctor/sara-hassan').expect(200);
      const d = doc(r.text);
      expect(d.title).toMatch(/^Dr Sara Hassan, Cardiology \| Kiorex$/);
      expect(d.description).toMatch(/Book Dr Sara Hassan, Cardiology/);
      expect(d.description.length).toBeLessThanOrEqual(155);
      expect(d.h1).toBe('Dr Sara Hassan');
      expect(d.robots).toMatch(/^index,follow/);
      expect(d.canonical).toBe(`${HOST}/en/eg/doctor/sara-hassan`);
      expect(d.alternates).toEqual([['ar', `${HOST}/ar/eg/doctor/sara-hassan`], ['en', `${HOST}/en/eg/doctor/sara-hassan`], ['x-default', `${HOST}/ar/eg/doctor/sara-hassan`]]);
      expect(d.lang).toEqual(['en', 'ltr']);
      const types = d.jsonLd.map((j) => j['@type']);
      expect(types).toEqual(expect.arrayContaining(['Physician', 'BreadcrumbList']));
      const phys = d.jsonLd.find((j) => j['@type'] === 'Physician')!;
      expect(phys.address).toMatchObject({ addressLocality: 'Maadi', addressRegion: 'Cairo', addressCountry: 'EG' });
      expect(JSON.stringify(phys)).not.toMatch(/telephone|streetAddress|geo/);
      expect(r.text).toContain('Maadi, Cairo');
      expect(r.text).not.toContain('+20221234567'); // the clinic phone is never public (no opt-in yet)
      expect(r.text).not.toContain('1 Street Maadi'); // no street address
      expect(r.text).toContain('id="kx-public-state"');
      expect(r.text).toContain('<script type="module" src="/_p/assets/entry-client-');
    });

    it('Arabic is RTL with Arabic metadata and the same canonical pair', async () => {
      const r = await get('/ar/eg/doctor/sara-hassan').expect(200);
      const d = doc(r.text);
      expect(d.lang).toEqual(['ar', 'rtl']);
      expect(d.h1).toBe('د. سارة حسن');
      expect(d.title).toContain('كيوركس');
      expect(d.canonical).toBe(`${HOST}/ar/eg/doctor/sara-hassan`);
      expect(r.headers['content-language']).toBe('ar');
    });

    it('sends CloudFront-friendly caching, an ETag, security headers consistent with ADR-038, and answers 304', async () => {
      const r = await get('/en/eg/doctor/sara-hassan').expect(200);
      expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
      expect(r.headers.vary).toBe('Accept-Encoding');
      expect(r.headers.etag).toMatch(/^W\//);
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(r.headers['content-security-policy']).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
      expect(r.headers['content-security-policy']).toContain("script-src 'self'");
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['strict-transport-security']).toContain('max-age=');
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.headers['x-robots-tag']).toBeUndefined();
      await get('/en/eg/doctor/sara-hassan', { 'If-None-Match': r.headers.etag! }).expect(304);
    });

    it('serves the second request from the cache (X-Site-Cache HIT)', async () => {
      const a = await get('/en/eg/doctor/sara-hassan').expect(200);
      const b = await get('/en/eg/doctor/sara-hassan?utm_source=whatsapp&fbclid=abc').expect(200);
      expect(a.headers['x-site-cache']).toBe('MISS');
      expect(b.headers['x-site-cache']).toBe('HIT'); // tracking parameters are not part of the cache key
      expect(doc(b.text).canonical).toBe(`${HOST}/en/eg/doctor/sara-hassan`);
    });

    it('HEAD returns headers without a body', async () => {
      const r = await c.http().head('/en/eg/doctor/sara-hassan').expect(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.text ?? '').toBe('');
    });
  });

  describe('listings and the thin-page guard', () => {
    it('hub, city and district pages list providers and are indexable above the threshold', async () => {
      for (const path of ['/en/eg/doctors/cardiology', '/en/eg/doctors/cardiology/cairo', '/en/eg/doctors/cardiology/cairo/maadi']) {
        const r = await get(path).expect(200);
        const d = doc(r.text);
        expect(d.robots).toMatch(/^index,follow/);
        expect(d.canonical).toBe(`${HOST}${path}`);
        expect(r.text).toContain('Dr Sara Hassan');
        expect(r.text).toContain('Dr Omar Nabil');
        expect(d.jsonLd.map((j) => j['@type'])).toEqual(expect.arrayContaining(['BreadcrumbList', 'ItemList']));
      }
    });

    it('a page below minLiveProviders is 200 noindex,follow with X-Robots-Tag and is absent from the sitemaps', async () => {
      const r = await get('/en/eg/doctors/dermatology/cairo').expect(200);
      expect(doc(r.text).robots).toBe('noindex,follow');
      expect(r.headers['x-robots-tag']).toBe('noindex');
      const idx = await get('/sitemap.xml').expect(200);
      const shards = [...idx.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.replace(HOST, ''));
      const all = (await Promise.all(shards.map((s) => get(s)))).map((x) => x.text).join('\n');
      expect(all).toContain('/en/eg/doctors/cardiology/cairo');
      expect(all).not.toContain('/doctors/dermatology/cairo');
      expect(all).toContain('/en/eg/doctor/sara-hassan'); // the dermatologist's own profile is a LIVE entity page and stays indexable
    });

    it('unknown specialty, unknown city and a page beyond the last page are 404 with noindex', async () => {
      for (const path of ['/en/eg/doctors/astrology', '/en/eg/doctors/cardiology/atlantis', '/en/eg/doctors/cardiology?page=9']) {
        const r = await get(path).expect(404);
        expect(r.headers['x-robots-tag']).toBe('noindex');
        expect(doc(r.text).robots).toBe('noindex,follow');
        expect(r.text).not.toContain('<link rel="canonical"');
      }
    });

    it('page 2 is noindex and self-canonical; sort is not part of the canonical', async () => {
      for (let i = 0; i < 12; i++) {
        await seedProvider(c, { id: `lst_x${i}`, clinicianId: `dr_x${i}`, clinicId: 'cl_x', specialty: 'cardiology', nameEn: `Dr Filler ${i}`, nameAr: `د. فيلر ${i}`, area: 'Maadi', governorate: 'Cairo' });
      }
      const p2 = await get('/en/eg/doctors/cardiology?page=2&sort=fee').expect(200);
      expect(doc(p2.text).robots).toBe('noindex,follow');
      expect(doc(p2.text).canonical).toBe(`${HOST}/en/eg/doctors/cardiology?page=2`);
      const p1 = await get('/en/eg/doctors/cardiology?sort=fee').expect(200);
      expect(doc(p1.text).canonical).toBe(`${HOST}/en/eg/doctors/cardiology`);
    });
  });

  describe('redirects, 404 and 410', () => {
    it('301 from an old slug to the current one (GrowthSlugHistory), and from non-canonical spellings', async () => {
      await c.prisma.growthSlugHistory.create({ data: { entityType: 'DOCTOR', entityId: ids.a, slug: 'dr-sara', replacedBy: 'sara-hassan' } });
      const moved = await get('/en/eg/doctor/dr-sara').redirects(0).expect(301);
      expect(moved.headers.location).toBe('/en/eg/doctor/sara-hassan');
      expect((await get('/en/eg/doctor/Sara-Hassan').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/sara-hassan');
      expect((await get('/en/eg/doctor/sara-hassan/').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/sara-hassan');
      expect((await get('/EN/eg/doctors/cardiology?page=2').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctors/cardiology?page=2');
    });

    it('a renamed slug keeps working after two renames (history resolves to the CURRENT slug)', async () => {
      await c.prisma.growthSlug.update({ where: { market_entityType_entityId: { market: 'EG', entityType: 'DOCTOR', entityId: ids.a } }, data: { slug: 'sara-h-hassan' } });
      await c.prisma.growthSlugHistory.createMany({ data: [{ entityType: 'DOCTOR', entityId: ids.a, slug: 'dr-sara', replacedBy: 'sara-hassan' }, { entityType: 'DOCTOR', entityId: ids.a, slug: 'sara-hassan', replacedBy: 'sara-h-hassan' }] });
      expect((await get('/en/eg/doctor/dr-sara').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/sara-h-hassan');
      expect((await get('/en/eg/doctor/sara-hassan').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/sara-h-hassan');
    });

    it('unknown slug and not-live market are 404; a delisted provider is 301 to its hub, or 404 then 410 when no hub exists', async () => {
      expect((await get('/en/eg/doctor/nobody-here').expect(404)).headers['x-robots-tag']).toBe('noindex');
      await get('/en/xx/doctor/sara-hassan').expect(404);
      await c.prisma.provider.update({ where: { id: ids.a }, data: { status: 'DELISTED' } });
        await c.get(PublicSiteCache).onListingChanged([ids.a]);
      expect((await get('/en/eg/doctor/sara-hassan').redirects(0).expect(301)).headers.location).toBe('/en/eg/doctors/cardiology');
      await c.prisma.provider.update({ where: { id: ids.d }, data: { status: 'DELISTED' } });
      await c.get(PublicSiteCache).onListingChanged([ids.d]);
      await get('/en/eg/doctor/hala-samir').expect(404);
      await c.prisma.provider.update({ where: { id: ids.d }, data: { syncedAt: new Date(Date.now() - 40 * 86_400_000) } });
      await c.get(PublicSiteCache).onListingChanged([ids.d]);
      await get('/en/eg/doctor/hala-samir').expect(410);
    });

    it('a PAUSED listing stays reachable (200) but is noindex and replaces the booking CTA', async () => {
      await c.prisma.provider.update({ where: { id: ids.b }, data: { status: 'PAUSED' } });
        await c.get(PublicSiteCache).onListingChanged([ids.b]);
      const r = await get('/en/eg/doctor/omar-nabil').expect(200);
      expect(doc(r.text).robots).toBe('noindex,follow');
      expect(r.text).toContain('not accepting bookings');
      expect(r.text).not.toContain('Book an appointment');
    });

    it('legacy /doctors/:id answers 301 to the slug URL in the negotiated locale, else serves the SPA shell', async () => {
      expect((await get(`/doctors/${ids.a}`).redirects(0).expect(301)).headers.location).toBe('/ar/eg/doctor/sara-hassan');
      expect((await get(`/doctors/${ids.a}`, { 'Accept-Language': 'en-GB,en;q=0.9' }).redirects(0).expect(301)).headers.location).toBe('/en/eg/doctor/sara-hassan');
      const withCookie = await get(`/doctors/${ids.a}`, { Cookie: 'kx-lang=en', 'Accept-Language': 'ar' }).redirects(0).expect(301);
      expect(withCookie.headers.location).toBe('/en/eg/doctor/sara-hassan');
      expect(withCookie.headers['cache-control']).toBe('private, no-cache'); // locale-negotiated: never shared
      const book = await get(`/doctors/${ids.a}?book=1`).expect(200); // the public page's own booking link must not loop
      expect(book.text).toContain('Kiorex SPA shell');
      const noSlug = await c.prisma.growthSlug.deleteMany({ where: { entityId: ids.b } });
      expect(noSlug.count).toBe(1);
      expect((await get(`/doctors/${ids.b}`).expect(200)).text).toContain('Kiorex SPA shell');
    });
  });

  describe('flag, fallback and private routes', () => {
    it('flag growth.ssr_public_pages OFF returns the SPA shell (noindex) and keeps robots and sitemaps', async () => {
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.ssr_public_pages/values').set(admin).send({ reason: 'test', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
      c.flags.invalidate();
      const r = await get('/en/eg/doctor/sara-hassan').expect(200);
      expect(r.text).toContain('Kiorex SPA shell');
      expect(r.headers['x-robots-tag']).toBe('noindex');
      expect(r.headers['x-site-fallback']).toBe('FLAG_OFF');
      await get('/robots.txt').expect(200);
      await get('/sitemap.xml').expect(200);
    });

    it('a render failure falls back to the SPA shell (no 5xx), counts the error and never caches it', async () => {
      const renderer = c.get(SiteRenderer as unknown as new (...a: any[]) => SiteRenderer);
      const spy = jest.spyOn(renderer, 'render').mockRejectedValue(new Error('boom'));
      try {
        const r = await get('/en/eg/doctor/sara-hassan').expect(200);
        expect(r.text).toContain('Kiorex SPA shell');
        expect(r.headers['x-site-fallback']).toBe('RENDER_ERROR');
        expect(r.headers['cache-control']).toBe('no-store');
      } finally { spy.mockRestore(); }
      expect((await get('/en/eg/doctor/sara-hassan').expect(200)).text).toContain('Dr Sara Hassan');
      const h = await get('/_site/health').expect(200);
      expect(JSON.parse(h.text).counts.render_errors).toBeGreaterThanOrEqual(1);
    });

    it('private and transactional paths under the public namespace are 404 noindex and never render user data', async () => {
      for (const path of ['/ar/eg/account', '/en/eg/appointments/apt_1', '/en/eg/checkout/bk_1', '/en/eg/records', '/en/eg/visit-status/abc']) {
        const r = await get(path).expect(404);
        expect(r.headers['x-robots-tag']).toBe('noindex');
        expect(r.text).toContain('data-testid="public-not-found"');
      }
    });

    it('the SPA-rendered preference centre inside the namespace gets the SPA shell (noindex), not a 404', async () => {
      const r = await get('/ar/eg/preferences').expect(200);
      expect(r.text).toContain('Kiorex SPA shell');
      expect(r.headers['x-robots-tag']).toBe('noindex');
      expect(r.headers['x-site-fallback']).toBe('SPA_PAGE');
    });

    it('requests that carry a session render byte-identical pages with no personal data and set no cookie', async () => {
      const auth = await c.as('sub_amira');
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Zzyzx Privatename', email: 'zzyzx@example.test' }).expect(200);
      for (const path of ['/en/eg/doctor/sara-hassan', '/en/eg/doctors/cardiology', '/en/eg/account']) {
        const anon = await get(path);
            c.get(PublicSiteCache).purgeAll();
        const authed = await get(path, { ...auth, Cookie: 'sid=secret-session; kx-lang=en' });
        expect(authed.text).toBe(anon.text);
        expect(authed.text).not.toMatch(/Zzyzx|zzyzx@example|secret-session/);
        expect(authed.headers['set-cookie']).toBeUndefined();
        expect(authed.headers['vary']).not.toMatch(/Cookie|Authorization/i);
      }
    });
  });

  describe('robots.txt', () => {
    it('production allows the public namespaces, disallows every private route and references the sitemap index', async () => {
      const r = await get('/robots.txt').expect(200);
      expect(r.headers['content-type']).toContain('text/plain');
      expect(r.text).toContain('Allow: /ar/');
      expect(r.text).toContain('Allow: /en/');
      expect(r.text).toContain(`Sitemap: ${HOST}/sitemap.xml`);
      for (const p of ['/api/', '/auth/', '/account', '/appointments', '/checkout/', '/records', '/search', '/visit-status/']) expect(r.text).toContain(`Disallow: ${p}`);
      expect(r.text).not.toMatch(/^Disallow: \/$/m);
    });

    it('staging and development block everything and send noindex on pages', async () => {
      setEnv('SITE_ENVIRONMENT', 'staging');
      const r = await get('/robots.txt').expect(200);
      expect(r.text).toMatch(/^Disallow: \/$/m);
      expect(r.text).not.toContain('Sitemap:');
      const page = await get('/en/eg/doctor/sara-hassan').expect(200);
      expect(page.headers['x-robots-tag']).toBe('noindex');
      expect(doc(page.text).robots).toBe('noindex,follow');
      expect((await get('/sitemap.xml').expect(200)).text).not.toContain('<loc>');
      setEnv('SITE_ENVIRONMENT', undefined);
      expect((await get('/robots.txt')).text).toMatch(/^Disallow: \/$/m); // unset environment is never indexable
    });
  });

  describe('sitemaps', () => {
    it('index lists per-type per-locale shards with lastmod; shards carry hreflang alternates and the real provider update time', async () => {
      const when = '2026-11-20T10:00:00.000Z';
      await c.prisma.provider.update({ where: { id: ids.a }, data: { sourceVersion: when } });
        await c.get(PublicSiteCache).onListingChanged([ids.a]);
      const idx = await get('/sitemap.xml').expect(200);
      expect(idx.headers['content-type']).toContain('application/xml');
      expect(idx.text).toContain('<sitemapindex');
      for (const name of ['doctor-eg-ar-1.xml', 'doctor-eg-en-1.xml', 'clinic-eg-en-1.xml', 'city-eg-ar-1.xml', 'hub-eg-en-1.xml', 'home-eg-en-1.xml']) expect(idx.text).toContain(`${HOST}/sitemaps/${name}`);
      expect(idx.text).toMatch(/<lastmod>2026-11-\d\dT/);
      const shard = await get('/sitemaps/doctor-eg-en-1.xml').expect(200);
      expect(shard.text).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
      expect(shard.text).toContain(`<loc>${HOST}/en/eg/doctor/sara-hassan</loc><lastmod>${when}</lastmod>`);
      expect(shard.text).toContain(`<xhtml:link rel="alternate" hreflang="ar" href="${HOST}/ar/eg/doctor/sara-hassan"/>`);
      expect(shard.text).toContain(`hreflang="x-default" href="${HOST}/ar/eg/doctor/sara-hassan"`);
      expect(shard.headers.etag).toBeTruthy();
      expect(shard.headers['cache-control']).toMatch(/s-maxage=\d+/);
      await get('/sitemaps/doctor-eg-en-9.xml').expect(404);
      await get('/sitemaps/../../etc/passwd').expect(404);
      await get('/sitemaps/doctor-xx-en-1.xml').expect(404);
    });

    it('splits into several shards at the configured size (SEO config sitemapShardSize)', async () => {
      await c.prisma.growthConfigVersion.create({ data: { kind: 'SEO', scope: 'GLOBAL', scopeId: '', version: 1, status: 'ACTIVE', payload: { sitemapShardSize: 2 }, createdBy: 'a', approvedBy: 'b', approvedAt: new Date(), checksum: 'x' } });
        c.get(PublicSiteCache).purgeAll();
      const idx = await get('/sitemap.xml').expect(200);
      expect(idx.text).toContain('/sitemaps/doctor-eg-en-1.xml');
      expect(idx.text).toContain('/sitemaps/doctor-eg-en-2.xml');
      const s2 = await get('/sitemaps/doctor-eg-en-2.xml').expect(200);
      expect((s2.text.match(/<url>/g) ?? []).length).toBe(2);
    });
  });

  describe('purge consumer, assets, health', () => {
    it('PROVIDER_PROFILE_UPDATED re-syncs and purges: the page shows the new name at once', async () => {
      expect((await get('/en/eg/doctor/sara-hassan').expect(200)).text).toContain('Dr Sara Hassan');
      const dto = c.kiorly.providers.find((p: any) => p.listingId === ids.a) as any;
      dto.provider.displayNameEn = 'Dr Sara Hassan-Ali';
      dto.updatedAt = new Date(Date.now() + 1000).toISOString();
      await c.webhook('PROVIDER_PROFILE_UPDATED', { clinicianId: 'dr_a', listingId: ids.a }, { aggregateType: 'Provider', aggregateId: ids.a }).then((r) => expect(r.status).toBe(200));
      const after = await get('/en/eg/doctor/sara-hassan').expect(200);
      expect(after.text).toContain('Dr Sara Hassan-Ali');
      expect(after.headers['x-site-cache']).toBe('MISS');
      expect(c.get(CdnPurger).recent.at(-1)?.paths).toEqual(expect.arrayContaining(['/sitemap.xml']));
    });

    it('serves hashed public assets immutable, refuses traversal, and exposes health and metrics', async () => {
      const page = await get('/en/eg').expect(200);
      const js = /src="(\/_p\/assets\/entry-client-[^"]+\.js)"/.exec(page.text)![1]!;
      const a = await c.http().get(js).expect(200);
      expect(a.headers['cache-control']).toContain('immutable');
      expect(a.headers['content-type']).toContain('javascript');
      await c.http().get('/_p/../package.json').expect(404);
      await c.http().get('/_p/.vite/manifest.json').expect(404);
      const h = JSON.parse((await get('/_site/health').expect(200)).text);
      expect(h).toMatchObject({ status: 'ok', role: 'all', environment: 'production', bundle: { available: true, clientAssets: true } });
      expect(h.render.count).toBeGreaterThan(0);
      expect(h.cache.hits + h.cache.misses).toBeGreaterThan(0);
      const m = await get('/_site/metrics').expect(200);
      expect(m.text).toContain('kx_site_cache_hits_total');
      expect(m.text).toContain('kx_site_render_ms{quantile="0.95"}');
    });

    it('inline critical CSS: the page has no render-blocking stylesheet or third-party font request and preloads the self-hosted fonts', async () => {
      const r = await get('/ar/eg/doctors/cardiology').expect(200);
      expect(r.text).toContain('<style>');
      expect(r.text).not.toMatch(/<link[^>]+rel="stylesheet"/);
      expect(r.text).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
      expect(r.text).toMatch(/<link rel="preload" as="font" type="font\/woff2" href="\/_p\/assets\/plex-arabic-400-[^"]+\.woff2" crossorigin>/);
      expect(r.text).toMatch(/<link rel="modulepreload"|<script type="module" src="\/_p\/assets\/entry-client-/);
      expect(r.text).not.toMatch(/<img(?![^>]*width=)/); // no <img> without explicit dimensions
    });
  });
});
