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
  type: 'hub' | 'city' | 'district' | 'care-district';
  params: Record<string, string>;
  providers: IndexedProvider[];
  city: Bilingual | null;
  district: Bilingual | null;
  specialtyCode: string | null;
  careType: string | null;
  uniqueBlocks: number;
  overlapPercent: number | null;
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

export function buildFacets(all: IndexedProvider[], params: GuardParams, enabledCareTypes: ReadonlySet<string>, includeDistricts = true): FacetTable {
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
    if (p.careType === 'DOCTORS' && p.specialty) {
      const sp = specialtySegment(p.specialty);
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
  for (const [k, g] of groups) {
    const ids = g.providers.map((p) => p.id);
    const sibs = (bySibling.get(g.siblingKey) ?? []).filter((x) => x !== k);
    const overlap = g.type === 'hub' || !sibs.length ? null : Math.max(...sibs.map((s) => overlapPercent(ids, groups.get(s)!.providers.map((p) => p.id))));
    const blocks = countUniqueBlocks(g.providers, related(k));
    const guard = evaluateGuard({ type: g.type, liveProviders: g.providers.length, uniqueBlocks: blocks, siblingOverlapPercent: overlap }, params);
    byKey.set(k, { key: k, type: g.type, params: g.params, providers: g.providers, city: g.city, district: g.district, specialtyCode: g.specialtyCode, careType: g.careType, uniqueBlocks: blocks, overlapPercent: overlap, guard, lastModified: maxDate(g.providers) });
  }
  return { byKey, all: [...byKey.values()], visible };
}

export const facetKey = (type: Facet['type'], p: Record<string, string>): string =>
  type === 'hub' ? `hub:${p.specialty}` : type === 'city' ? `city:${p.specialty}/${p.city}` : type === 'district' ? `district:${p.specialty}/${p.city}/${p.district}` : `care:${p.care}/${p.city}/${p.district}`;
