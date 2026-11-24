import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog-public';
import { PrismaService } from '../prisma/prisma.service';
import { isSpecialtyCode, SPECIALTY_LABELS } from '../safety/safety-public';
import { TrustService } from '../trust/trust-public';
import { buildFacets, facetKey, type Facet, type FacetTable } from './facets';
import { slugifyPlace, specialtyFromSegment, specialtySegment } from './geo';
import { RedirectsService } from './redirects.service';
import { SeoConfigService, type SeoConfig } from './seo-config.service';
import { SiteIndexService, type IndexedProvider, type SiteIndex } from './site-index.service';
import type { Bilingual, ClinicData, Crumb, DoctorData, FacetLink, HomeData, ListData, LoadResult, ProviderCard } from './site-data.types';
import { buildPath, type Locale, type PageQuery, type ParsedPath } from './url-policy';

export const PAGE_SIZE = 12;
const CARE_TYPES = ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] as const;
const CARE_LABELS: Record<string, Bilingual> = { 'home-nursing': { en: 'Home nursing', ar: 'التمريض المنزلي' }, physiotherapy: { en: 'Physiotherapy', ar: 'العلاج الطبيعي' } };

export interface SiteSnapshot { index: SiteIndex; seo: SeoConfig; facets: FacetTable; enabled: Set<string> }

/**
 * Public page data. Reads ONLY public marketplace projections (Provider, reviews, slugs, flags): never the session, never patient data.
 * Every loader returns plain JSON so the same object is rendered on the server and hydrated on the client.
 */
@Injectable()
export class SiteDataService {
  private snap = new Map<string, { at: number; value: SiteSnapshot }>();
  constructor(
    private readonly index: SiteIndexService, private readonly seo: SeoConfigService, private readonly redirects: RedirectsService,
    private readonly catalog: CatalogService, private readonly trust: TrustService, private readonly prisma: PrismaService,
  ) {}

  invalidate(): void { this.snap.clear(); this.index.invalidate(); this.seo.invalidate(); }

  /** One consistent snapshot per market (index + SEO config + facet table), cached briefly; the sitemap and the renderer share it. */
  async snapshot(market: string): Promise<SiteSnapshot> {
    const hit = this.snap.get(market);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const [index, seo] = await Promise.all([this.index.get(market), this.seo.get(market)]);
    const enabled = new Set<string>();
    for (const ct of CARE_TYPES) if ((await this.catalog.careTypeEnabled(ct, market)).enabled) enabled.add(ct);
    const facets = buildFacets(index.providers, { minLiveProviders: seo.minLiveProviders, minUniqueBlocks: seo.minUniqueBlocks, maxSiblingSimilarityPercent: seo.maxSiblingSimilarityPercent }, enabled, seo.districtPagesEnabled);
    const value = { index, seo, facets, enabled };
    this.snap.set(market, { at: Date.now(), value });
    return value;
  }

  // ── cards ────────────────────────────────────────────────────────────────────────────────────────────────────

  private card(p: IndexedProvider, slugs: Map<string, string>): ProviderCard {
    const spec = p.specialty && isSpecialtyCode(p.specialty) ? { code: p.specialty, label: SPECIALTY_LABELS[p.specialty] } : p.specialty ? { code: p.specialty, label: { en: p.specialty, ar: p.specialty } } : null;
    return {
      id: p.id, slug: slugs.get(p.id) ?? null, kind: p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor',
      name: { en: p.nameEn ?? p.nameAr ?? '', ar: p.nameAr ?? p.nameEn ?? '' }, specialty: spec,
      clinicName: { en: p.clinicNameEn ?? p.clinicNameAr ?? '', ar: p.clinicNameAr ?? p.clinicNameEn ?? '' },
      area: p.area, governorate: p.governorate, rating: { average: Math.round(p.ratingAvg * 10) / 10, count: p.ratingCount },
      fee: p.minFeeMinor != null ? { minMinor: p.minFeeMinor, maxMinor: p.maxFeeMinor ?? p.minFeeMinor, currency: p.currency } : null,
      languages: p.languages, nextSlotAt: p.nextSlotAt && p.nextSlotAt > new Date() ? p.nextSlotAt.toISOString() : null,
    };
  }

  private async cards(market: string, ps: IndexedProvider[]): Promise<ProviderCard[]> {
    const slugs = await this.redirects.slugsFor(market, 'DOCTOR', ps.map((p) => p.id));
    return ps.map((p) => this.card(p, slugs));
  }

  private sortProviders(ps: IndexedProvider[], sort: PageQuery['sort']): IndexedProvider[] {
    const arr = [...ps];
    const byId = (a: IndexedProvider, b: IndexedProvider) => (a.id < b.id ? -1 : 1);
    if (sort === 'fee') return arr.sort((a, b) => (a.minFeeMinor ?? Infinity) - (b.minFeeMinor ?? Infinity) || byId(a, b));
    if (sort === 'earliest') return arr.sort((a, b) => (a.nextSlotAt?.getTime() ?? Infinity) - (b.nextSlotAt?.getTime() ?? Infinity) || byId(a, b));
    return arr.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount || byId(a, b));
  }

  private facetsOf(ps: IndexedProvider[]): ListData['facets'] {
    const withFee = ps.filter((p) => p.minFeeMinor != null);
    const rated = ps.filter((p) => p.ratingCount > 0);
    const slots = ps.map((p) => p.nextSlotAt).filter((d): d is Date => !!d && d > new Date()).sort((a, b) => a.getTime() - b.getTime());
    const total = rated.reduce((s, p) => s + p.ratingCount, 0);
    return {
      feeRange: withFee.length ? { minMinor: Math.min(...withFee.map((p) => p.minFeeMinor!)), maxMinor: Math.max(...withFee.map((p) => p.maxFeeMinor ?? p.minFeeMinor!)), currency: withFee[0]!.currency } : null,
      languages: [...new Set(ps.flatMap((p) => p.languages))].sort(),
      rating: total ? { average: Math.round((rated.reduce((s, p) => s + p.ratingAvg * p.ratingCount, 0) / total) * 10) / 10, count: total } : null,
      nextSlotAt: slots[0]?.toISOString() ?? null,
    };
  }

  private homeCrumb(locale: Locale, cc: string): Crumb { return { label: { en: 'Kiorex', ar: 'كيوركس' }, path: buildPath(locale, cc, 'home') }; }

  private spLabel(code: string): Bilingual { return isSpecialtyCode(code) ? SPECIALTY_LABELS[code] : { en: code, ar: code }; }

  private link(f: Facet, locale: Locale, cc: string, label: Bilingual): FacetLink {
    return { label, path: buildPath(locale, cc, f.type, f.params), count: f.providers.length };
  }

  // ── loaders ──────────────────────────────────────────────────────────────────────────────────────────────────

  async load(route: ParsedPath, q: PageQuery): Promise<LoadResult> {
    const market = route.cc.toUpperCase();
    const snap = await this.snapshot(market);
    switch (route.type) {
      case 'home': return this.home(route, snap);
      case 'hub': case 'city': case 'district': case 'care-district': return this.list(route, q, snap);
      case 'doctor': case 'nurse': return this.provider(route, snap);
      case 'clinic': return this.clinic(route, snap);
      default: return { status: 404, reason: 'ROUTE_NOT_ENABLED' };
    }
  }

  private home(route: ParsedPath, s: SiteSnapshot): LoadResult {
    const { locale, cc } = route;
    const ok = s.facets.all.filter((f) => f.guard.indexable);
    const specialties = ok.filter((f) => f.type === 'hub').sort((a, b) => b.providers.length - a.providers.length || (a.key < b.key ? -1 : 1)).slice(0, 12)
      .map((f) => this.link(f, locale, cc, this.spLabel(f.specialtyCode!)));
    const cityCounts = new Map<string, { label: Bilingual; ids: Set<string>; spec: string }>();
    for (const f of ok.filter((x) => x.type === 'city')) {
      const c = cityCounts.get(f.params.city!) ?? { label: f.city!, ids: new Set<string>(), spec: f.params.specialty! };
      f.providers.forEach((p) => c.ids.add(p.id));
      cityCounts.set(f.params.city!, c);
    }
    const cities: FacetLink[] = [...cityCounts.entries()].map(([slug, c]) => ({ label: c.label, count: c.ids.size, path: `${buildPath(locale, cc, 'hub', { specialty: c.spec })}/${slug}` })).sort((a, b) => b.count - a.count).slice(0, 12);
    const data: HomeData = { kind: 'home', liveProviders: s.facets.visible.length, specialties, cities, crumbs: [] };
    return { status: 200, data, indexable: true, noindexReasons: [], lastModified: s.facets.visible.reduce<Date | null>((m, p) => (!m || p.lastModified > m ? p.lastModified : m), null), tags: ['list', `market:${cc}`] };
  }

  private async list(route: ParsedPath, q: PageQuery, s: SiteSnapshot): Promise<LoadResult> {
    const { locale, cc, type, params } = route;
    if (type === 'care-district') {
      if (!s.enabled.has(params.care === 'physiotherapy' ? 'PHYSIOTHERAPY' : 'HOME_NURSING')) return { status: 404, reason: 'CARE_TYPE_NOT_LIVE' };
    } else if (!isSpecialtyCode(specialtyFromSegment(params.specialty!))) return { status: 404, reason: 'UNKNOWN_SPECIALTY' };
    const key = facetKey(type as Facet['type'], params);
    const facet = s.facets.byKey.get(key);
    if (!facet) {
      // known parent but no listing under it: 200 noindex on an empty page would be a doorway; unknown geography is a plain 404
      return { status: 404, reason: 'NO_PROVIDERS_FOR_FACET' };
    }
    const sorted = this.sortProviders(facet.providers, q.sort);
    const pageItems = sorted.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE);
    if (q.page > 1 && !pageItems.length) return { status: 404, reason: 'PAGE_OUT_OF_RANGE' };
    const specLabel = facet.specialtyCode ? this.spLabel(facet.specialtyCode) : null;
    const careLabel = params.care ? CARE_LABELS[params.care]! : null;
    const place = facet.district ?? facet.city;
    const title: Bilingual = specLabel
      ? { en: place ? `${specLabel.en} doctors in ${place.en}` : `${specLabel.en} doctors`, ar: place ? `أطباء ${specLabel.ar} في ${place.ar}` : `أطباء ${specLabel.ar}` }
      : { en: `${careLabel!.en} in ${place!.en}`, ar: `${careLabel!.ar} في ${place!.ar}` };
    // related links: only to pages that pass the guard (no internal links to thin pages)
    const sibs = s.facets.all.filter((f) => f.guard.indexable && f.key !== key);
    const related: FacetLink[] = [];
    if (type === 'hub') for (const f of sibs.filter((x) => x.type === 'city' && x.params.specialty === params.specialty)) related.push(this.link(f, locale, cc, f.city!));
    if (type === 'city') {
      for (const f of sibs.filter((x) => x.type === 'district' && x.params.specialty === params.specialty && x.params.city === params.city)) related.push(this.link(f, locale, cc, f.district!));
      for (const f of sibs.filter((x) => x.type === 'city' && x.params.specialty !== params.specialty && x.params.city === params.city).slice(0, 6)) related.push(this.link(f, locale, cc, this.spLabel(f.specialtyCode!)));
    }
    if (type === 'district') for (const f of sibs.filter((x) => x.type === 'district' && x.params.specialty === params.specialty && x.params.city === params.city)) related.push(this.link(f, locale, cc, f.district!));
    if (type === 'care-district') for (const f of sibs.filter((x) => x.type === 'care-district' && x.params.care === params.care && x.params.city === params.city)) related.push(this.link(f, locale, cc, f.district!));
    const crumbs: Crumb[] = [this.homeCrumb(locale, cc)];
    if (specLabel) {
      crumbs.push({ label: specLabel, path: buildPath(locale, cc, 'hub', { specialty: params.specialty! }) });
      if (facet.city) crumbs.push({ label: facet.city, path: type === 'city' ? null : buildPath(locale, cc, 'city', { specialty: params.specialty!, city: params.city! }) });
      if (facet.district) crumbs.push({ label: facet.district, path: null });
    } else {
      crumbs.push({ label: careLabel!, path: null }, { label: facet.city!, path: null });
      if (facet.district) crumbs.push({ label: facet.district, path: null });
    }
    const data: ListData = {
      kind: type as ListData['kind'], title, specialty: facet.specialtyCode ? { code: facet.specialtyCode, label: specLabel! } : null, city: facet.city, district: facet.district, careType: facet.careType,
      liveProviders: facet.providers.length, page: q.page, pageSize: PAGE_SIZE, providers: await this.cards(route.cc.toUpperCase(), pageItems), facets: this.facetsOf(facet.providers), related, crumbs,
    };
    const reasons = [...facet.guard.reasons, ...(q.page > 1 ? ['PAGINATED'] : [])];
    return { status: 200, data, indexable: reasons.length === 0, noindexReasons: reasons, lastModified: facet.lastModified, tags: ['list', ...pageItems.map((p) => `provider:${p.id}`)] };
  }

  private async provider(route: ParsedPath, s: SiteSnapshot): Promise<LoadResult> {
    const { locale, cc, params, type } = route;
    const market = cc.toUpperCase();
    const r = await this.redirects.resolve(market, 'DOCTOR', params.slug!);
    if (r.kind === 'unknown') return { status: 404, reason: 'UNKNOWN_SLUG' };
    const row = await this.prisma.provider.findUnique({ where: { id: r.entityId } });
    if (!row || row.market !== market) return { status: 404, reason: 'PROVIDER_NOT_FOUND' };
    const kind: 'doctor' | 'nurse' = row.careType === 'HOME_NURSING' ? 'nurse' : 'doctor';
    if (r.kind === 'moved' || kind !== type) return { status: 301, to: buildPath(locale, cc, kind, { slug: r.slug }) };
    const ip = s.index.providers.find((x) => x.id === row.id);
    const listed = ip?.listed ?? true;
    const careOn = s.enabled.has(row.careType);
    if (!careOn) return { status: 404, reason: 'CARE_TYPE_NOT_LIVE' };
    if (!listed) return { status: 404, reason: 'NOT_LISTED' };
    if (row.status !== 'LIVE' && row.status !== 'PAUSED') {
      // DELISTED: 301 to the specialty hub when it exists and is indexable, else 404 and 410 once the retention window passed (ARCH 4.1 rule 8)
      const hub = row.specialty ? s.facets.byKey.get(`hub:${specialtySegment(row.specialty)}`) : undefined;
      if (hub?.guard.indexable && row.careType === 'DOCTORS') return { status: 301, to: buildPath(locale, cc, 'hub', hub.params) };
      const days = (Date.now() - row.syncedAt.getTime()) / 86_400_000;
      return { status: days >= s.seo.delistedGoneAfterDays ? 410 : 404, reason: 'DELISTED' };
    }
    const raw = (row.raw ?? {}) as { provider?: { titleEn?: string; titleAr?: string; photoUrl?: string } };
    const prov = raw.provider ?? {};
    const reviews = (await this.trust.forProvider(row.id)).reviews.slice(0, 3).map((x) => ({ rating: x.rating, text: x.text ?? null, createdAt: x.createdAt.toISOString() }));
    const base = ip ?? ({ ...row, listed: true, lastModified: new Date(row.sourceVersion) } as unknown as IndexedProvider);
    const [card] = await this.cards(market, [base]);
    const sp = row.specialty ? specialtySegment(row.specialty) : null;
    const hub = sp ? s.facets.byKey.get(`hub:${sp}`) : undefined;
    const citySlug = slugifyPlace(row.governorate);
    const cityFacet = sp && citySlug ? s.facets.byKey.get(`city:${sp}/${citySlug}`) : undefined;
    const related: FacetLink[] = [];
    if (hub?.guard.indexable && row.careType === 'DOCTORS') related.push(this.link(hub, locale, cc, this.spLabel(row.specialty!)));
    if (cityFacet?.guard.indexable) related.push(this.link(cityFacet, locale, cc, { en: `${this.spLabel(row.specialty!).en} in ${cityFacet.city!.en}`, ar: `${this.spLabel(row.specialty!).ar} في ${cityFacet.city!.ar}` }));
    const crumbs: Crumb[] = [this.homeCrumb(locale, cc)];
    for (const l of related) crumbs.push({ label: l.label, path: l.path });
    const nameLabel = card!.name;
    crumbs.push({ label: nameLabel, path: null });
    const bookable = row.status === 'LIVE';
    const data: DoctorData = {
      kind,
      provider: {
        ...card!, subSpecialties: row.subSpecialties, gender: row.gender, acceptsDeposit: row.acceptsDeposit,
        photoUrl: typeof prov.photoUrl === 'string' && /^https:\/\//.test(prov.photoUrl) ? prov.photoUrl : null,
        title: prov.titleEn || prov.titleAr ? { en: prov.titleEn ?? prov.titleAr ?? '', ar: prov.titleAr ?? prov.titleEn ?? '' } : null,
        homeVisit: row.serviceLocations.includes('HOME'),
        // coverage DISTRICTS only (KXMDS05): the provider's home address is never part of the projection
        coverageDistricts: row.serviceLocations.includes('HOME') ? row.coverageDistricts : [],
      },
      bookable, reviews, bookPath: `/doctors/${row.id}?book=1`, related, crumbs,
    };
    return { status: 200, data, indexable: bookable, noindexReasons: bookable ? [] : ['PAUSED_LISTING'], lastModified: base.lastModified, tags: [`provider:${row.id}`, `clinic:${row.clinicId}`] };
  }

  private async clinic(route: ParsedPath, s: SiteSnapshot): Promise<LoadResult> {
    const { locale, cc, params } = route;
    const market = cc.toUpperCase();
    const r = await this.redirects.resolve(market, 'CLINIC', params.slug!);
    if (r.kind === 'unknown') return { status: 404, reason: 'UNKNOWN_SLUG' };
    if (r.kind === 'moved') return { status: 301, to: buildPath(locale, cc, 'clinic', { slug: r.slug }) };
    const all = s.index.providers.filter((p) => p.clinicId === r.entityId && p.listed && s.enabled.has(p.careType));
    if (!all.length) return { status: 404, reason: 'CLINIC_NOT_FOUND' };
    const live = all.filter((p) => p.status === 'LIVE');
    const first = all[0]!;
    const sorted = this.sortProviders(live, null);
    const data: ClinicData = {
      kind: 'clinic',
      clinic: { id: r.entityId, slug: r.slug, name: { en: first.clinicNameEn ?? first.clinicNameAr ?? '', ar: first.clinicNameAr ?? first.clinicNameEn ?? '' }, area: first.area, governorate: first.governorate },
      providers: await this.cards(market, sorted), liveProviders: live.length,
      crumbs: [this.homeCrumb(locale, cc), { label: { en: first.clinicNameEn ?? first.clinicNameAr ?? '', ar: first.clinicNameAr ?? first.clinicNameEn ?? '' }, path: null }],
    };
    return { status: 200, data, indexable: live.length >= 1, noindexReasons: live.length >= 1 ? [] : ['NO_LIVE_DOCTOR'], lastModified: all.reduce<Date | null>((m, p) => (!m || p.lastModified > m ? p.lastModified : m), null), tags: [`clinic:${r.entityId}`, ...sorted.map((p) => `provider:${p.id}`)] };
  }
}
