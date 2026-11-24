import { CARE_SEGMENTS, type CareSegment } from './url-policy';
import { evaluateGuard, overlapPercent, type GuardParams, type GuardResult } from './thin-page-guard';
import { placeLabel, slugifyPlace, specialtySegment } from './geo';
import type { Bilingual } from './site-data.types';
import type { IndexedProvider } from './site-index.service';

/**
 * Facet table: every generated listing page (specialty hub, specialty in city, specialty in district, care type in district) with its provider
 * set, data-derived content blocks and guard result. Pure. The render path and the sitemap both read THIS table, so a page that is `noindex`
 * is never in a sitemap and a sitemap page is never `noindex` (acceptance of GRW-P1-E/F).
 */
export interface Facet {
  key: string;
  type: 'hub' | 'city' | 'district' | 'care-district' | 'city-hub' | 'district-hub' | 'same-day' | 'telemedicine';
  params: Record<string, string>;
  providers: IndexedProvider[];
  city: Bilingual | null;
  district: Bilingual | null;
  specialtyCode: string | null;
  careType: string | null;
  uniqueBlocks: number;
  overlapPercent: number | null;
  /** Overlap with the parent page's provider set (see GuardInput.parentOverlapPercent); null = no parent rule for this type. */
  parentOverlapPercent: number | null;
  guard: GuardResult;
  lastModified: Date | null;
}

export interface FacetTable { byKey: Map<string, Facet>; all: Facet[]; visible: IndexedProvider[] }

const maxDate = (ps: IndexedProvider[]): Date | null => ps.reduce<Date | null>((m, p) => (!m || p.lastModified > m ? p.lastModified : m), null);

/** Number of data-derived blocks a page can render from real data (ARCH 4.1 rule 9). */
export function countUniqueBlocks(ps: IndexedProvider[], hasRelated: boolean): number {
  let n = 1; // provider count is always real data
  if (ps.some((p) => p.minFeeMinor != null)) n++;
  if (ps.some((p) => p.languages.length)) n++;
  if (ps.some((p) => p.nextSlotAt && p.nextSlotAt > new Date())) n++;
  if (ps.some((p) => p.ratingCount > 0)) n++;
  if (hasRelated) n++;
  return n;
}

const titleCase = (slug: string): string => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export interface FacetOptions { now?: Date; sameDayWindowHours?: number }

export function buildFacets(all: IndexedProvider[], params: GuardParams, enabledCareTypes: ReadonlySet<string>, includeDistricts = true, opts: FacetOptions = {}): FacetTable {
  const now = opts.now ?? new Date();
  const sameDayUntil = new Date(now.getTime() + (opts.sameDayWindowHours ?? 24) * 3_600_000);
  const visible = all.filter((p) => p.status === 'LIVE' && p.listed && enabledCareTypes.has(p.careType));
  const groups = new Map<string, { type: Facet['type']; params: Record<string, string>; providers: IndexedProvider[]; city: Bilingual | null; district: Bilingual | null; specialtyCode: string | null; careType: string | null; siblingKey: string }>();
  const add = (key: string, base: Omit<NonNullable<ReturnType<typeof groups.get>>, 'providers'>, p: IndexedProvider) => {
    const g = groups.get(key) ?? { ...base, providers: [] };
    g.providers.push(p);
    groups.set(key, g);
  };

  for (const p of visible) {
    const citySlug = slugifyPlace(p.governorate);
    const areaSlug = slugifyPlace(p.area);
    // location hubs (every care type): a city, and a district inside it
    if (citySlug) {
      add(`city-hub:${citySlug}`, { type: 'city-hub', params: { city: citySlug }, city: placeLabel('city', p.governorate!), district: null, specialtyCode: null, careType: null, siblingKey: 'city-hub' }, p);
      if (includeDistricts && areaSlug) add(`district-hub:${citySlug}/${areaSlug}`, { type: 'district-hub', params: { city: citySlug, district: areaSlug }, city: placeLabel('city', p.governorate!), district: placeLabel('district', p.area!), specialtyCode: null, careType: null, siblingKey: `district-hub:${citySlug}` }, p);
    }
    if (p.careType === 'DOCTORS' && p.specialty) {
      const sp = specialtySegment(p.specialty);
      // availability hubs (same day, video visits): only providers that really have it; the hub itself may not (they need their own threshold)
      if (p.nextSlotAt && p.nextSlotAt > now && p.nextSlotAt <= sameDayUntil) add(`same-day:${sp}`, { type: 'same-day', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'same-day' }, p);
      if (p.video) add(`telemedicine:${sp}`, { type: 'telemedicine', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'telemedicine' }, p);
      add(`hub:${sp}`, { type: 'hub', params: { specialty: sp }, city: null, district: null, specialtyCode: p.specialty, careType: null, siblingKey: 'hub' }, p);
      if (citySlug) {
        add(`city:${sp}/${citySlug}`, { type: 'city', params: { specialty: sp, city: citySlug }, city: placeLabel('city', p.governorate!), district: null, specialtyCode: p.specialty, careType: null, siblingKey: `city:${sp}` }, p);
        if (includeDistricts && areaSlug) {
          add(`district:${sp}/${citySlug}/${areaSlug}`, { type: 'district', params: { specialty: sp, city: citySlug, district: areaSlug }, city: placeLabel('city', p.governorate!), district: placeLabel('district', p.area!), specialtyCode: p.specialty, careType: null, siblingKey: `district:${sp}/${citySlug}` }, p);
        }
      }
    } else if (includeDistricts && citySlug) {
      const care = (Object.entries(CARE_SEGMENTS).find(([, v]) => v === p.careType)?.[0]) as CareSegment | undefined;
      if (!care) continue;
      const districts = new Set<string>([...(areaSlug ? [areaSlug] : []), ...p.coverageDistricts]);
      for (const d of districts) {
        add(`care:${care}/${citySlug}/${d}`, { type: 'care-district', params: { care, city: citySlug, district: d }, city: placeLabel('city', p.governorate!), district: placeLabel('district', d === areaSlug && p.area ? p.area : titleCase(d)), specialtyCode: null, careType: p.careType, siblingKey: `care:${care}/${citySlug}` }, p);
      }
    }
  }

  // sibling overlap: same level, same parent (other cities of one specialty, other districts of one city)
  const bySibling = new Map<string, string[]>();
  for (const [k, g] of groups) bySibling.set(g.siblingKey, [...(bySibling.get(g.siblingKey) ?? []), k]);
  const byKey = new Map<string, Facet>();
  const related = (k: string): boolean => {
    const g = groups.get(k)!;
    return g.type === 'hub' ? [...groups.values()].some((x) => x.type === 'city' && x.params.specialty === g.params.specialty) : (bySibling.get(g.siblingKey)?.length ?? 0) > 1;
  };
  const parentIds = (k: string, g: NonNullable<ReturnType<typeof groups.get>>): string[] | null => {
    if (g.type === 'city-hub') return visible.map((p) => p.id); // the whole market's page (home)
    if (g.type === 'district-hub') return (groups.get(`city-hub:${g.params.city}`)?.providers ?? []).map((p) => p.id);
    if (g.type === 'same-day' || g.type === 'telemedicine') return (groups.get(`hub:${g.params.specialty}`)?.providers ?? []).map((p) => p.id);
    void k;
    return null;
  };
  for (const [k, g] of groups) {
    const ids = g.providers.map((p) => p.id);
    const parent = parentIds(k, g);
    const parentOverlap = parent ? overlapPercent(parent, ids) : null; // share of the parent's providers that this page also lists (100 = a copy of the parent)
    const sibs = (bySibling.get(g.siblingKey) ?? []).filter((x) => x !== k);
    const overlap = g.type === 'hub' || !sibs.length ? null : Math.max(...sibs.map((s) => overlapPercent(ids, groups.get(s)!.providers.map((p) => p.id))));
    const blocks = countUniqueBlocks(g.providers, related(k));
    const guard = evaluateGuard({ type: g.type, liveProviders: g.providers.length, uniqueBlocks: blocks, siblingOverlapPercent: overlap, parentOverlapPercent: parentOverlap }, params);
    byKey.set(k, { key: k, type: g.type, params: g.params, providers: g.providers, city: g.city, district: g.district, specialtyCode: g.specialtyCode, careType: g.careType, uniqueBlocks: blocks, overlapPercent: overlap, parentOverlapPercent: parentOverlap, guard, lastModified: maxDate(g.providers) });
  }
  return { byKey, all: [...byKey.values()], visible };
}

export const facetKey = (type: Facet['type'], p: Record<string, string>): string => {
  switch (type) {
    case 'hub': return `hub:${p.specialty}`;
    case 'city': return `city:${p.specialty}/${p.city}`;
    case 'district': return `district:${p.specialty}/${p.city}/${p.district}`;
    case 'city-hub': return `city-hub:${p.city}`;
    case 'district-hub': return `district-hub:${p.city}/${p.district}`;
    case 'same-day': return `same-day:${p.specialty}`;
    case 'telemedicine': return `telemedicine:${p.specialty}`;
    default: return `care:${p.care}/${p.city}/${p.district}`;
  }
};
