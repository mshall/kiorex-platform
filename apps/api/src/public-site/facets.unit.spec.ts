import { buildFacets, facetKey } from './facets';
import type { IndexedProvider } from './site-index.service';
import { mergeSeoConfig, type SeoConfig } from './seo-config.service';
import { GROWTH_DEFAULT_PAYLOADS } from '../growth/growth-public';
import { slugifyPlace, specialtyFromSegment, specialtySegment, placeLabel } from './geo';

const P = { minLiveProviders: 3, minUniqueBlocks: 3, maxSiblingSimilarityPercent: 70 };
const prov = (i: number, o: Partial<IndexedProvider> = {}): IndexedProvider => ({
  id: `p${i}`, tenantId: 't', clinicId: 'c', market: 'EG', status: 'LIVE', careType: 'DOCTORS', profession: null, nameEn: `Dr ${i}`, nameAr: `د ${i}`, clinicNameEn: 'C', clinicNameAr: 'ع', specialty: 'cardiology', languages: ['ar'],
  governorate: 'Cairo', area: 'Maadi', minFeeMinor: 30000, maxFeeMinor: 30000, currency: 'EGP', ratingAvg: 0, ratingCount: 0, nextSlotAt: null, serviceLocations: ['IN_CLINIC'], coverageDistricts: [], lastModified: new Date(2026, 10, i + 1), syncedAt: new Date(), listed: true, ...o,
});
const care = new Set(['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING']);

describe('facet table (the pages the guard and the sitemap share)', () => {
  it('builds hub, city and district facets for LIVE listed providers and applies the guard', () => {
    const t = buildFacets([prov(1), prov(2), prov(3), prov(4, { specialty: 'dermatology' })], P, care);
    expect(t.byKey.get('hub:cardiology')!.providers).toHaveLength(3);
    expect(t.byKey.get('city:cardiology/cairo')!.guard.indexable).toBe(true);
    expect(t.byKey.get('district:cardiology/cairo/maadi')!.guard.indexable).toBe(true);
    expect(t.byKey.get('city:dermatology/cairo')!.guard).toEqual({ indexable: false, reasons: ['LIVE_PROVIDERS_BELOW_3'] });
    expect(t.byKey.get('hub:dermatology')!.guard.indexable).toBe(true);
    expect(t.byKey.get('hub:cardiology')!.lastModified).toEqual(new Date(2026, 10, 4));
  });
  it('excludes PAUSED, unlisted (clinic.kiorex_listing OFF) and disabled care types from every facet', () => {
    const t = buildFacets([prov(1), prov(2, { status: 'PAUSED' }), prov(3, { listed: false }), prov(4, { careType: 'HOME_NURSING', specialty: null })], P, new Set(['DOCTORS']));
    expect(t.byKey.get('hub:cardiology')!.providers.map((p) => p.id)).toEqual(['p1']);
    expect([...t.byKey.keys()].some((k) => k.startsWith('care:'))).toBe(false);
    expect(t.visible.map((p) => p.id)).toEqual(['p1']);
  });
  it('care-type pages use coverage districts and the sibling-overlap rule marks near-duplicate districts', () => {
    const nurses = [1, 2, 3, 4].map((i) => prov(i, { careType: 'HOME_NURSING', specialty: null, area: null, serviceLocations: ['HOME'], coverageDistricts: ['maadi', 'zamalek'] }));
    const t = buildFacets(nurses, P, care);
    const f = t.byKey.get('care:home-nursing/cairo/maadi')!;
    expect(f.providers).toHaveLength(4);
    expect(f.overlapPercent).toBe(100);
    expect(f.guard.reasons).toContain('SIBLING_OVERLAP_ABOVE_70');
    expect(f.guard.indexable).toBe(false);
  });
  it('districtPagesEnabled=false drops district and care-district facets', () => {
    const t = buildFacets([prov(1), prov(2), prov(3)], P, care, false);
    expect([...t.byKey.keys()].some((k) => k.startsWith('district:') || k.startsWith('care:'))).toBe(false);
  });
});

describe('facets of the location, same-day and telemedicine hubs (GRW-P1-F)', () => {
  const now = new Date('2026-12-01T08:00:00Z');
  const soon = new Date(now.getTime() + 3 * 3_600_000); const later = new Date(now.getTime() + 60 * 3_600_000);
  const GP = { ...P, minAvailableProviders: 2, maxParentSimilarityPercent: 100 };
  const market = [
    prov(1, { nextSlotAt: soon, video: true }), prov(2, { nextSlotAt: soon, video: true }), prov(3, { nextSlotAt: later }),
    prov(4, { governorate: 'Giza', area: 'Dokki' }), prov(5, { governorate: 'Giza', area: 'Dokki' }), prov(6, { governorate: 'Giza', area: 'Dokki' }),
  ];
  const t = buildFacets(market, GP, care, true, { now });

  it('builds a city hub per governorate across care types and a district hub per area', () => {
    expect([...t.byKey.keys()].filter((k) => k.startsWith('city-hub:') || k.startsWith('district-hub:')).sort()).toEqual(['city-hub:cairo', 'city-hub:giza', 'district-hub:cairo/maadi', 'district-hub:giza/dokki']);
    expect(t.byKey.get('city-hub:cairo')!.providers).toHaveLength(3);
  });
  it('a district hub that lists exactly its city hub providers is a copy of its parent: noindex', () => {
    expect(t.byKey.get('city-hub:cairo')!.guard.indexable).toBe(true); // 3 of the market's 6
    expect(t.byKey.get('district-hub:cairo/maadi')!.guard).toEqual({ indexable: false, reasons: ['PARENT_OVERLAP_AT_OR_ABOVE_100'] });
    expect(t.byKey.get('district-hub:giza/dokki')!.parentOverlapPercent).toBe(100);
  });
  it('in a one-city market the city hub is a copy of the whole market page: noindex', () => {
    const one = buildFacets([prov(1), prov(2), prov(3)], GP, care, true, { now });
    expect(one.byKey.get('city-hub:cairo')!.guard.reasons).toContain('PARENT_OVERLAP_AT_OR_ABOVE_100');
  });
  it('same-day lists providers whose next slot is inside the window, with its own availability minimum', () => {
    const sd = t.byKey.get('same-day:cardiology')!;
    expect(sd.providers.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(sd.guard.indexable).toBe(true);
    const narrow = buildFacets(market, GP, care, true, { now, sameDayWindowHours: 1 });
    expect(narrow.byKey.has('same-day:cardiology')).toBe(false);
  });
  it('telemedicine lists only providers that declared video', () => {
    expect(t.byKey.get('telemedicine:cardiology')!.providers.map((p) => p.id)).toEqual(['p1', 'p2']);
    const one = buildFacets([prov(1, { video: true }), prov(2), prov(3)], GP, care, true, { now });
    expect(one.byKey.get('telemedicine:cardiology')!.guard.reasons).toEqual(['AVAILABLE_PROVIDERS_BELOW_2']);
  });
  it('facet keys round-trip through facetKey for every type', () => {
    for (const f of t.all) expect(facetKey(f.type, f.params)).toBe(f.key);
  });
});

describe('SEO config merge and geo helpers', () => {
  const base = GROWTH_DEFAULT_PAYLOADS.SEO as unknown as SeoConfig;
  it('an active payload overrides defaults; wrongly typed values are ignored', () => {
    const m = mergeSeoConfig(base, { minLiveProviders: 5, sitemapShardSize: 'big', unknownKey: 1, canonicalHost: 'https://x.test' });
    expect(m.minLiveProviders).toBe(5);
    expect(m.sitemapShardSize).toBe(base.sitemapShardSize);
    expect(m.canonicalHost).toBe('https://x.test');
    expect((m as unknown as Record<string, unknown>).unknownKey).toBeUndefined();
    expect(mergeSeoConfig(base, null)).toBe(base);
  });
  it('slugifyPlace, specialty segments and Arabic place labels', () => {
    expect(slugifyPlace('Nasr City')).toBe('nasr-city');
    expect(slugifyPlace('Zamalek ')).toBe('zamalek');
    expect(slugifyPlace('6th of October')).toBe('6th-of-october');
    expect(slugifyPlace('x')).toBeNull();
    expect(slugifyPlace('المعادي')).toBe('maadi'); // Arabic labels map to the English place slug
    expect(slugifyPlace('مدينة نصر')).toBe('nasr-city');
    expect(slugifyPlace('القاهرة')).toBe('cairo');
    expect(slugifyPlace('أَلمعادي')).toBe('maadi');
    expect(slugifyPlace(null)).toBeNull();
    expect(specialtySegment('internal_medicine')).toBe('internal-medicine');
    expect(specialtyFromSegment('internal-medicine')).toBe('internal_medicine');
    expect(placeLabel('city', 'Cairo')).toEqual({ en: 'Cairo', ar: 'القاهرة' });
    expect(placeLabel('district', 'Unknownville')).toEqual({ en: 'Unknownville', ar: 'Unknownville' });
  });
});
