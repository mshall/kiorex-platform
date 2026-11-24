/**
 * Page data contract between the API loaders and the SSR bundle (apps/web/src/public/types.ts mirrors it). Everything here is PUBLIC marketplace
 * data: no patient field, no phone number (providers have not opted in yet), no street address, no coordinates. JSON-serialisable on purpose:
 * it is embedded in the HTML for hydration.
 */
import type { ComputedLinkGroup } from '../growth/seo-automation/seo-automation-public';
export type { ComputedLinkGroup };
export interface Bilingual { en: string; ar: string }
/** GRW-P3-F: links computed by the SEO automation (read from the stored graph by the request handler; absent from the loaders' own output). */
export interface WithComputedLinks { computedLinks?: ComputedLinkGroup[] }
export interface Crumb { label: Bilingual; path: string | null }

export interface ProviderCard {
  id: string;
  /** Slug-table slug; null until GRW-P1-F's bootstrap created one (the card then renders without a link). */
  slug: string | null;
  /** Page route the card links to. */
  kind: 'doctor' | 'nurse';
  /** PHYSICIAN | DENTIST | PHYSIOTHERAPIST | NURSE (null = legacy doctor): decides the honest schema.org type. */
  profession?: string | null;
  name: Bilingual;
  specialty: { code: string; label: Bilingual } | null;
  clinicName: Bilingual;
  area: string | null;
  governorate: string | null;
  rating: { average: number; count: number };
  fee: { minMinor: number; maxMinor: number; currency: string } | null;
  languages: string[];
  nextSlotAt: string | null;
}

export interface FacetLink { label: Bilingual; path: string; count: number }

export interface HomeData extends WithComputedLinks {
  kind: 'home'; liveProviders: number; specialties: FacetLink[]; cities: FacetLink[]; crumbs: Crumb[];
  /** GRW-P1-F: indexable city hubs (all care in a city), same-day and video hubs, and the partner counts that exist on the market. */
  cityHubs: FacetLink[]; availability: FacetLink[]; careTypes: FacetLink[]; partners: { pharmacies: number; labs: number };
}
/** Internal links of a listing page (only to pages that pass the thin-page guard). */
export interface ListLinks { districts: FacetLink[]; cities: FacetLink[]; relatedSpecialties: FacetLink[]; availability: FacetLink[]; parents: FacetLink[] }
export interface RatingBucket { stars: 1 | 2 | 3 | 4 | 5; count: number }
export interface PaginationData { page: number; pages: number; prevPath: string | null; nextPath: string | null }
export interface ListData extends WithComputedLinks {
  kind: 'hub' | 'city' | 'district' | 'care-district' | 'city-hub' | 'district-hub' | 'same-day' | 'telemedicine';
  title: Bilingual; // the facet (specialty, "specialty in city", ...)
  specialty: { code: string; label: Bilingual } | null;
  city: Bilingual | null;
  district: Bilingual | null;
  careType: string | null;
  liveProviders: number;
  page: number;
  pageSize: number;
  providers: ProviderCard[];
  facets: { feeRange: { minMinor: number; maxMinor: number; currency: string } | null; languages: string[]; rating: { average: number; count: number } | null; nextSlotAt: string | null };
  related: FacetLink[];
  crumbs: Crumb[];
  /** GRW-P1-F data blocks: real counts only (never invented). */
  links: ListLinks;
  ratingDistribution: RatingBucket[];
  sameDayCount: number;
  /** Specialties available here (location hubs): the real mix of this page's providers. */
  specialtyMix: FacetLink[];
  pagination: PaginationData;
}
export interface DoctorData extends WithComputedLinks {
  kind: 'doctor' | 'nurse';
  provider: ProviderCard & { subSpecialties: string[]; gender: string | null; photoUrl: string | null; title: Bilingual | null; acceptsDeposit: boolean; homeVisit: boolean; coverageDistricts: string[] };
  /** LIVE and listed. false = PAUSED listing: page stays (200, noindex) with the booking CTA replaced. */
  bookable: boolean;
  reviews: { rating: number; text: string | null; createdAt: string }[];
  /** SPA deep link used by the booking island (full navigation into the authenticated app). */
  bookPath: string;
  related: FacetLink[];
  crumbs: Crumb[];
  /** Other LIVE providers of the same specialty in the same city (max 4). */
  similar: ProviderCard[];
  /** aggregateRating is allowed only when verified, visible reviews meet the policy (SEO config reviewMarkupMinCount) and are shown on the page. */
  ratingMarkup: boolean;
  /** Set ("#2") when another listed provider has the same name and specialty: keeps titles and descriptions unique (duplicate-title rule). */
  homonym: string | null;
}
export interface ClinicData extends WithComputedLinks {
  kind: 'clinic';
  clinic: { id: string; slug: string | null; name: Bilingual; area: string | null; governorate: string | null };
  providers: ProviderCard[];
  liveProviders: number;
  crumbs: Crumb[];
  specialties: { code: string; label: Bilingual }[];
  facets: ListData['facets'];
  links: FacetLink[];
  /** "#2" when another listed clinic has the same name (keeps titles unique). */
  homonym: string | null;
}
export interface PartnerData extends WithComputedLinks {
  kind: 'pharmacy' | 'lab';
  partner: { id: string; slug: string; name: Bilingual };
  /** Other partners of the same kind on the market (names and links only). */
  others: FacetLink[];
  crumbs: Crumb[];
}
export interface NotFoundData { kind: 'not-found'; reason: string }
export type PageData = HomeData | ListData | DoctorData | ClinicData | PartnerData | NotFoundData;

/** Loader outcome: what the controller turns into 200/301/404/410. */
export type LoadResult =
  | { status: 200; data: PageData; indexable: boolean; noindexReasons: string[]; lastModified: Date | null; tags: string[]; canonicalPath?: string }
  | { status: 301; to: string }
  | { status: 404 | 410; reason: string };
