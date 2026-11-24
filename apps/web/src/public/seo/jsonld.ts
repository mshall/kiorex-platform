import type { Bilingual, Crumb, DoctorData, ListData, Locale, ProviderCard } from "../types";

/**
 * JSON-LD builders (GRW-P1-E hook with conservative defaults; GRW-P1-F extends them and owns the schema validation tests). Rules (ARCH section 5):
 * one block per page, generated from the same data as the visible content, never data the user cannot see, no phone number, no street address,
 * rating markup only when the rating is shown and reviews exist.
 */
export type JsonLd = Record<string, unknown>;
const ctx = "https://schema.org";
const pick = (b: Bilingual, l: Locale): string => (l === "ar" ? b.ar || b.en : b.en || b.ar);
const abs = (host: string, path: string): string => `${host.replace(/\/+$/, "")}${path}`;

export function organization(host: string): JsonLd {
  return { "@context": ctx, "@type": "Organization", name: "Kiorex", alternateName: "كيوركس", url: host, logo: abs(host, "/apple-touch-icon.png") };
}
export function website(host: string, locale: Locale, cc: string): JsonLd {
  return { "@context": ctx, "@type": "WebSite", name: "Kiorex", url: abs(host, `/${locale}/${cc}`), inLanguage: locale };
}
export function breadcrumbs(host: string, crumbs: Crumb[], locale: Locale, selfPath: string): JsonLd | null {
  if (crumbs.length < 2) return null;
  return {
    "@context": ctx, "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: pick(c.label, locale), item: abs(host, c.path ?? selfPath) })),
  };
}

export function physician(p: DoctorData["provider"], host: string, locale: Locale, cc: string, url: string, opts: { reviewMarkup: boolean; bookable: boolean }): JsonLd {
  const o: JsonLd = {
    "@context": ctx, "@type": p.kind === "nurse" ? "MedicalBusiness" : "Physician", name: pick(p.name, locale), url,
    ...(p.specialty ? { medicalSpecialty: pick(p.specialty.label, "en") } : {}),
    ...(p.photoUrl ? { image: p.photoUrl } : {}),
    // locality level only: never a street address, coordinates or a phone number (provider opt-in comes with GRW-P1-F)
    address: { "@type": "PostalAddress", ...(p.area ? { addressLocality: p.area } : {}), ...(p.governorate ? { addressRegion: p.governorate } : {}), addressCountry: cc.toUpperCase() },
    ...(p.languages.length ? { knowsLanguage: p.languages } : {}),
    isAcceptingNewPatients: opts.bookable,
    ...(p.clinicName.en || p.clinicName.ar ? { worksFor: { "@type": "MedicalClinic", name: pick(p.clinicName, locale) } } : {}),
  };
  if (opts.reviewMarkup && p.rating.count > 0) o.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating.average, reviewCount: p.rating.count, bestRating: 5, worstRating: 1 };
  void host;
  return o;
}

export function itemList(cards: ProviderCard[], host: string, locale: Locale, cc: string): JsonLd | null {
  const linked = cards.filter((c) => c.slug);
  if (!linked.length) return null;
  return {
    "@context": ctx, "@type": "ItemList",
    itemListElement: linked.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(host, `/${locale}/${cc}/${c.kind}/${c.slug}`), name: pick(c.name, locale) })),
  };
}

export function listingBlocks(d: ListData, host: string, locale: Locale, cc: string, path: string): JsonLd[] {
  return [breadcrumbs(host, d.crumbs, locale, path), itemList(d.providers, host, locale, cc)].filter((x): x is JsonLd => !!x);
}
