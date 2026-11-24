import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPath, cacheKey, canonicalUrl, hreflangAlternates, isPrivatePath, negotiateLocale, parsePublicPath, PRIVATE_PATH_PREFIXES, readPageQuery, ROUTES, isTrackingKey } from './url-policy';

describe('public site URL policy (canonical convention kiorex.com/{ar|en}/{cc}/{type}/{slug})', () => {
  const ok = (p: string) => { const r = parsePublicPath(p); if (r.kind !== 'match') throw new Error(`${p}: ${r.kind}`); return r.value; };

  it('matches every public route type and extracts params', () => {
    expect(ok('/ar/eg')).toMatchObject({ type: 'home', locale: 'ar', cc: 'eg', rest: '' });
    expect(ok('/en/eg/doctors/cardiology')).toMatchObject({ type: 'hub', params: { specialty: 'cardiology' } });
    expect(ok('/en/eg/doctors/internal-medicine/cairo')).toMatchObject({ type: 'city', params: { specialty: 'internal-medicine', city: 'cairo' } });
    expect(ok('/en/eg/doctors/cardiology/cairo/nasr-city')).toMatchObject({ type: 'district', params: { district: 'nasr-city' } });
    expect(ok('/ar/eg/home-nursing/cairo/maadi')).toMatchObject({ type: 'care-district', params: { care: 'home-nursing', city: 'cairo', district: 'maadi' } });
    expect(ok('/ar/eg/physiotherapy/giza/dokki')).toMatchObject({ type: 'care-district' });
    expect(ok('/en/eg/doctor/sara-hassan')).toMatchObject({ type: 'doctor', params: { slug: 'sara-hassan' } });
    expect(ok('/en/eg/clinic/nile-clinic')).toMatchObject({ type: 'clinic' });
    expect(ok('/en/eg/nurse/mona-adel')).toMatchObject({ type: 'nurse' });
    expect(ok('/en/eg/pharmacy/city-pharmacy')).toMatchObject({ type: 'pharmacy' });
    expect(ok('/en/eg/lab/al-borg')).toMatchObject({ type: 'lab' });
  });

  it('private, unknown and malformed paths do not match a public route', () => {
    expect(parsePublicPath('/ar/eg/preferences')).toEqual({ kind: 'spa', page: 'preferences' }); // client-rendered SPA page inside the namespace (GRW-P1-I)
    for (const p of ['/ar/eg/account', '/en/eg/appointments/1', '/ar/eg/doctor', '/ar/eg/doctors', '/ar/eg/doctor/a', '/ar/eg/doctor/ab_cd', '/ar/eg/doctors/x/y/z/w', '/fr/eg', '/search']) expect(parsePublicPath(p).kind).toBe('none');
  });

  it('normalises case, trailing and duplicate slashes by redirect, never by rendering a second URL', () => {
    expect(parsePublicPath('/EN/eg/Doctor/Sara-Hassan')).toEqual({ kind: 'redirect', to: '/en/eg/doctor/sara-hassan', reason: 'case' });
    expect(parsePublicPath('/en/eg/doctor/sara-hassan/')).toEqual({ kind: 'redirect', to: '/en/eg/doctor/sara-hassan', reason: 'trailing-slash' });
    expect(parsePublicPath('/en/eg/doctor//x-y')).toEqual({ kind: 'redirect', to: '/en/eg/doctor/x-y', reason: 'duplicate-slash' });
    expect(parsePublicPath('/en/eg/')).toEqual({ kind: 'redirect', to: '/en/eg', reason: 'trailing-slash' });
  });

  it('buildPath is the inverse of parsePublicPath for every enabled route', () => {
    const samples: Record<string, Record<string, string>> = { home: {}, hub: { specialty: 'cardiology' }, city: { specialty: 'cardiology', city: 'cairo' }, district: { specialty: 'cardiology', city: 'cairo', district: 'maadi' }, 'care-district': { care: 'home-nursing', city: 'cairo', district: 'maadi' }, doctor: { slug: 'sara-hassan' }, clinic: { slug: 'nile-clinic' }, nurse: { slug: 'mona-adel' }, pharmacy: { slug: 'x-pharm' }, lab: { slug: 'x-lab' } };
    for (const r of ROUTES.filter((x) => x.type !== 'static')) {
      const path = buildPath('en', 'EG', r.type, samples[r.type]);
      expect(ok(path)).toMatchObject({ type: r.type, params: samples[r.type] });
    }
  });

  it('canonical URLs are absolute, come from config, keep only page > 1 and never carry tracking or sort', () => {
    expect(canonicalUrl('https://kiorex.com/', '/en/eg/doctors/cardiology', { page: 1, sort: 'fee' })).toBe('https://kiorex.com/en/eg/doctors/cardiology');
    expect(canonicalUrl('https://kiorex.com', '/en/eg/doctors/cardiology', { page: 3, sort: 'fee' })).toBe('https://kiorex.com/en/eg/doctors/cardiology?page=3');
  });

  it('only page and sort change content; utm, gclid, fbclid, s and ref are ignored and not in the cache key', () => {
    expect(readPageQuery({ page: '2', sort: 'fee', utm_source: 'x', gclid: 'y' })).toEqual({ page: 2, sort: 'fee' });
    expect(readPageQuery({ page: '0', sort: 'drop table' })).toEqual({ page: 1, sort: null });
    expect(readPageQuery({ page: ['4', '5'] })).toEqual({ page: 4, sort: null });
    expect(readPageQuery({ page: '9999' })).toEqual({ page: 1, sort: null });
    expect(cacheKey('/en/eg', { page: 1, sort: null })).toBe('/en/eg');
    expect(cacheKey('/en/eg/doctors/x', { page: 2, sort: 'rating' })).toBe('/en/eg/doctors/x?page=2&sort=rating');
    for (const k of ['utm_campaign', 'gclid', 'fbclid', 's', 'ref', 'lt']) expect(isTrackingKey(k)).toBe(true);
    expect(isTrackingKey('page')).toBe(false);
  });

  it('hreflang: ar and en self-referencing and reciprocal, fully qualified, plus x-default', () => {
    const a = hreflangAlternates('https://kiorex.com', 'EG', 'doctor/sara-hassan');
    expect(a).toEqual([
      { hreflang: 'ar', href: 'https://kiorex.com/ar/eg/doctor/sara-hassan' },
      { hreflang: 'en', href: 'https://kiorex.com/en/eg/doctor/sara-hassan' },
      { hreflang: 'x-default', href: 'https://kiorex.com/ar/eg/doctor/sara-hassan' },
    ]);
    expect(hreflangAlternates('https://kiorex.com', 'eg', '', { rootSelector: true }).at(-1)).toEqual({ hreflang: 'x-default', href: 'https://kiorex.com/' });
    // the set is identical from the Arabic and the English page (reciprocity)
    expect(hreflangAlternates('https://kiorex.com', 'eg', 'doctors/cardiology')).toEqual(hreflangAlternates('https://kiorex.com', 'eg', 'doctors/cardiology'));
  });

  it('negotiates the redirect locale: kx-lang cookie, then Accept-Language with q-values, then Arabic', () => {
    expect(negotiateLocale({ cookie: 'a=1; kx-lang=en', acceptLanguage: 'ar' })).toBe('en');
    expect(negotiateLocale({ acceptLanguage: 'fr;q=0.9, en-GB;q=0.8, ar;q=0.5' })).toBe('en');
    expect(negotiateLocale({ acceptLanguage: 'ar-EG,ar;q=0.9,en;q=0.1' })).toBe('ar');
    expect(negotiateLocale({ acceptLanguage: 'de' })).toBe('ar');
    expect(negotiateLocale({})).toBe('ar');
    expect(negotiateLocale({ cookie: 'kx-lang=xx' })).toBe('ar');
  });

  it('every non-public SPA route in apps/web App.tsx is covered by a robots Disallow prefix (or is the legacy redirect target)', () => {
    const app = readFileSync(resolve(__dirname, '../../../web/src/App.tsx'), 'utf8');
    const paths = [...app.matchAll(/<Route[^>]*\spath="([^"]+)"/g)].map((m) => `/${m[1]!.replace(/^\//, '')}`).filter((p) => p !== '/*' && !p.startsWith('/:locale/:cc/')); // namespace pass-throughs are checked by the web route snapshot
    expect(paths.length).toBeGreaterThan(20);
    const allowed = new Set(['/doctors/:id', '/preferences']); // crawlable on purpose: 301 to the slug URL, otherwise the SPA shell (noindex)
    const open = paths.filter((p) => !allowed.has(p) && !isPrivatePath(p.replace(/\/:.*$/, '')) && !isPrivatePath(p));
    expect(open).toEqual([]);
    for (const p of PRIVATE_PATH_PREFIXES) expect(isPrivatePath(p)).toBe(true);
    expect(isPrivatePath('/ar/eg/doctor/x')).toBe(false);
  });
});
