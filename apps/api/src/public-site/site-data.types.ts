/**
 * Page data contract between the API loaders and the SSR bundle (apps/web/src/public/types.ts mirrors it). Everything here is PUBLIC marketplace
 * data: no patient field, no phone number (providers have not opted in yet), no street address, no coordinates. JSON-serialisable on purpose:
 * it is embedded in the HTML for hydration.
 */
export interface Bilingual { en: string; ar: string }
export interface Crumb { label: Bilingual; path: string | null }

export interface ProviderCard {
  id: string;
  /** Slug-table slug; null until GRW-P1-F's bootstrap created one (the card then renders without a link). */
  slug: string | null;
  /** Page route the card links to. */
  kind: 'doctor' | 'nurse';
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

export interface HomeData { kind: 'home'; liveProviders: number; specialties: FacetLink[]; cities: FacetLink[]; crumbs: Crumb[] }
export interface ListData {
  kind: 'hub' | 'city' | 'district' | 'care-district';
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
}
export interface DoctorData {
  kind: 'doctor' | 'nurse';
  provider: ProviderCard & { subSpecialties: string[]; gender: string | null; photoUrl: string | null; title: Bilingual | null; acceptsDeposit: boolean; homeVisit: boolean; coverageDistricts: string[] };
  /** LIVE and listed. false = PAUSED listing: page stays (200, noindex) with the booking CTA replaced. */
  bookable: boolean;
  reviews: { rating: number; text: string | null; createdAt: string }[];
  /** SPA deep link used by the booking island (full navigation into the authenticated app). */
  bookPath: string;
  related: FacetLink[];
  crumbs: Crumb[];
}
export interface ClinicData {
  kind: 'clinic';
  clinic: { id: string; slug: string | null; name: Bilingual; area: string | null; governorate: string | null };
  providers: ProviderCard[];
  liveProviders: number;
  crumbs: Crumb[];
}
export interface NotFoundData { kind: 'not-found'; reason: string }
export type PageData = HomeData | ListData | DoctorData | ClinicData | NotFoundData;

/** Loader outcome: what the controller turns into 200/301/404/410. */
export type LoadResult =
  | { status: 200; data: PageData; indexable: boolean; noindexReasons: string[]; lastModified: Date | null; tags: string[]; canonicalPath?: string }
  | { status: 301; to: string }
  | { status: 404 | 410; reason: string };
