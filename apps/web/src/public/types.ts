/**
 * Shared types of the public site (GRW-P1-E). `PageData` mirrors apps/api/src/public-site/site-data.types.ts (the API loaders produce it, the SSR
 * bundle renders it and the client hydrates the same object). Everything is PUBLIC marketplace data: no patient field, no phone number, no street
 * address, no coordinates.
 */
export type Locale = "ar" | "en";
export interface Bilingual { en: string; ar: string }
export interface Crumb { label: Bilingual; path: string | null }

export interface ProviderCard {
  id: string;
  slug: string | null;
  kind: "doctor" | "nurse";
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
export interface HomeData {
  kind: "home"; liveProviders: number; specialties: FacetLink[]; cities: FacetLink[]; crumbs: Crumb[];
  cityHubs: FacetLink[]; availability: FacetLink[]; careTypes: FacetLink[]; partners: { pharmacies: number; labs: number };
}
export interface ListLinks { districts: FacetLink[]; cities: FacetLink[]; relatedSpecialties: FacetLink[]; availability: FacetLink[]; parents: FacetLink[] }
export interface RatingBucket { stars: 1 | 2 | 3 | 4 | 5; count: number }
export interface PaginationData { page: number; pages: number; prevPath: string | null; nextPath: string | null }
export interface ListData {
  kind: "hub" | "city" | "district" | "care-district" | "city-hub" | "district-hub" | "same-day" | "telemedicine";
  title: Bilingual;
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
  links: ListLinks;
  ratingDistribution: RatingBucket[];
  sameDayCount: number;
  specialtyMix: FacetLink[];
  pagination: PaginationData;
}
export interface DoctorData {
  kind: "doctor" | "nurse";
  provider: ProviderCard & { subSpecialties: string[]; gender: string | null; photoUrl: string | null; title: Bilingual | null; acceptsDeposit: boolean; homeVisit: boolean; coverageDistricts: string[] };
  bookable: boolean;
  reviews: { rating: number; text: string | null; createdAt: string }[];
  bookPath: string;
  related: FacetLink[];
  crumbs: Crumb[];
  similar: ProviderCard[];
  ratingMarkup: boolean;
  homonym: string | null;
}
export interface ClinicData {
  kind: "clinic";
  clinic: { id: string; slug: string | null; name: Bilingual; area: string | null; governorate: string | null };
  providers: ProviderCard[];
  liveProviders: number;
  crumbs: Crumb[];
  specialties: { code: string; label: Bilingual }[];
  facets: ListData["facets"];
  links: FacetLink[];
  homonym: string | null;
}
export interface PartnerData {
  kind: "pharmacy" | "lab";
  partner: { id: string; slug: string; name: Bilingual };
  others: FacetLink[];
  crumbs: Crumb[];
}
export interface NotFoundData { kind: "not-found"; reason: string }
export type PageData = HomeData | ListData | DoctorData | ClinicData | PartnerData | NotFoundData;

export type PublicPageType = "home" | "hub" | "city" | "district" | "care-district" | "city-hub" | "district-hub" | "same-day" | "telemedicine" | "doctor" | "clinic" | "nurse" | "pharmacy" | "lab" | "static" | "not-found";
export interface PageQuery { page: number; sort: "rating" | "fee" | "earliest" | null }

/** What the API sends to `render()` and embeds in the HTML for hydration. */
export interface SsrInput {
  locale: Locale; cc: string; type: PublicPageType; path: string; query: PageQuery; data: PageData;
  site: { canonicalHost: string; reviewMarkup: boolean; templates?: MetaTemplates; imageCdn?: string | null };
}
/** Versioned SEO configuration: title and description templates per locale and page type (see seo/meta-templates.ts). */
export type MetaTemplates = Partial<Record<Locale, Record<string, { title?: string; description?: string }>>>;

export interface SsrOutput {
  html: string;
  meta: { title: string; description: string; ogImage?: string | null };
  jsonLd: unknown[];
}
export type PublicState = Omit<SsrInput, "site"> & { site?: SsrInput["site"] };

export interface TemplateCtx {
  locale: Locale;
  cc: string;
  path: string;
  canonicalHost: string;
  reviewMarkup: boolean;
  templates: MetaTemplates;
  imageCdn: string | null;
  query: PageQuery;
  /** Translate a key of the `public` catalogue. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Pick the AR or EN half of a bilingual value. */
  pick: (b: Bilingual) => string;
}

export interface PageMeta { title: string; description: string; ogImage?: string | null }
