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
export interface HomeData { kind: "home"; liveProviders: number; specialties: FacetLink[]; cities: FacetLink[]; crumbs: Crumb[] }
export interface ListData {
  kind: "hub" | "city" | "district" | "care-district";
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
}
export interface DoctorData {
  kind: "doctor" | "nurse";
  provider: ProviderCard & { subSpecialties: string[]; gender: string | null; photoUrl: string | null; title: Bilingual | null; acceptsDeposit: boolean; homeVisit: boolean; coverageDistricts: string[] };
  bookable: boolean;
  reviews: { rating: number; text: string | null; createdAt: string }[];
  bookPath: string;
  related: FacetLink[];
  crumbs: Crumb[];
}
export interface ClinicData {
  kind: "clinic";
  clinic: { id: string; slug: string | null; name: Bilingual; area: string | null; governorate: string | null };
  providers: ProviderCard[];
  liveProviders: number;
  crumbs: Crumb[];
}
export interface NotFoundData { kind: "not-found"; reason: string }
export type PageData = HomeData | ListData | DoctorData | ClinicData | NotFoundData;

export type PublicPageType = "home" | "hub" | "city" | "district" | "care-district" | "doctor" | "clinic" | "nurse" | "pharmacy" | "lab" | "static" | "not-found";
export interface PageQuery { page: number; sort: "rating" | "fee" | "earliest" | null }

/** What the API sends to `render()` and embeds in the HTML for hydration. */
export interface SsrInput {
  locale: Locale; cc: string; type: PublicPageType; path: string; query: PageQuery; data: PageData;
  site: { canonicalHost: string; reviewMarkup: boolean };
}
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
  query: PageQuery;
  /** Translate a key of the `public` catalogue. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Pick the AR or EN half of a bilingual value. */
  pick: (b: Bilingual) => string;
}

export interface PageMeta { title: string; description: string; ogImage?: string | null }
