import type { Bilingual, ClinicData, Crumb, DoctorData, ListData, Locale, PartnerData, ProviderCard } from "../types";

/**
 * JSON-LD builders (GRW-P1-F, ARCH section 5). Rules: one block per entity, generated from the same data the page shows, nothing the visitor cannot see,
 * NO phone, e-mail, street address, coordinates or opening hours (no provider has opted in), NO medical claims or `medicalSpecialty` beyond the visible
 * label, and rating markup only when the page passes the review policy (`ratingMarkup`: verified, visible reviews meeting the configured minimum, rating
 * shown on the page). No FakeRatings, no `review` objects (patient text is not republished as markup), no price markup (fees are indicative).
 * Types used: Organization, WebSite, BreadcrumbList, CollectionPage, ItemList, Physician, Dentist, MedicalBusiness, MedicalClinic, Pharmacy.
 * LocalBusiness is not emitted on its own: MedicalBusiness, MedicalClinic and Pharmacy are its subtypes and carry more precise meaning.
 */
export type JsonLd = Record<string, unknown>;
const ctx = "https://schema.org";
const pick = (b: Bilingual, l: Locale): string => (l === "ar" ? b.ar || b.en : b.en || b.ar);
const abs = (host: string, path: string): string => `${host.replace(/\/+$/, "")}${path}`;

/** Types the public site is allowed to emit (the validator in tests and the SEO audit reject anything else). */
export const ALLOWED_TYPES = ["Organization", "WebSite", "BreadcrumbList", "ListItem", "CollectionPage", "ItemList", "Physician", "Dentist", "MedicalBusiness", "MedicalClinic", "Pharmacy", "PostalAddress", "AggregateRating", "ImageObject"] as const;
/** Properties that would leak private data or make unverifiable claims. */
export const FORBIDDEN_KEYS = ["telephone", "email", "faxNumber", "streetAddress", "postalCode", "geo", "latitude", "longitude", "hasMap", "openingHours", "openingHoursSpecification", "review", "priceRange", "paymentAccepted", "medicalAudience", "healthPlanNetworkId", "isAcceptingNewPatientsFrom", "sameAs"] as const;

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

const address = (cc: string, area?: string | null, governorate?: string | null): JsonLd => ({ "@type": "PostalAddress", ...(area ? { addressLocality: area } : {}), ...(governorate ? { addressRegion: governorate } : {}), addressCountry: cc.toUpperCase() });

/** schema.org type by profession: only Physician for physicians, Dentist for dentists, MedicalBusiness for nurses and physiotherapists. */
export function providerType(p: Pick<ProviderCard, "kind" | "profession">): "Physician" | "Dentist" | "MedicalBusiness" {
  if (p.kind === "nurse" || p.profession === "NURSE" || p.profession === "PHYSIOTHERAPIST") return "MedicalBusiness";
  return p.profession === "DENTIST" ? "Dentist" : "Physician";
}

export function physician(p: DoctorData["provider"], host: string, locale: Locale, cc: string, url: string, opts: { ratingMarkup: boolean; bookable: boolean }): JsonLd {
  const type = providerType(p);
  const o: JsonLd = {
    "@context": ctx, "@type": type, name: pick(p.name, locale), url, inLanguage: locale,
    ...(p.specialty && type === "Physician" ? { medicalSpecialty: pick(p.specialty.label, "en") } : {}),
    ...(p.photoUrl ? { image: p.photoUrl } : {}),
    // locality level only: never a street address, coordinates or a phone number
    address: address(cc, p.area, p.governorate),
    ...(p.languages.length ? { knowsLanguage: p.languages } : {}),
    ...(type === "Physician" || type === "Dentist" ? { isAcceptingNewPatients: opts.bookable } : {}),
    ...(p.clinicName.en || p.clinicName.ar ? { worksFor: { "@type": "MedicalClinic", name: pick(p.clinicName, locale) } } : {}),
  };
  if (opts.ratingMarkup && p.rating.count > 0) o.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating.average, reviewCount: p.rating.count, bestRating: 5, worstRating: 1 };
  void host;
  return o;
}

export function medicalClinic(d: ClinicData, host: string, locale: Locale, cc: string, url: string): JsonLd {
  void host;
  return { "@context": ctx, "@type": "MedicalClinic", name: pick(d.clinic.name, locale), url, inLanguage: locale, address: address(cc, d.clinic.area, d.clinic.governorate) };
}

export function partnerBusiness(d: PartnerData, locale: Locale, cc: string, url: string): JsonLd {
  return { "@context": ctx, "@type": d.kind === "pharmacy" ? "Pharmacy" : "MedicalBusiness", name: pick(d.partner.name, locale), url, inLanguage: locale, address: { "@type": "PostalAddress", addressCountry: cc.toUpperCase() } };
}

export function itemList(cards: ProviderCard[], host: string, locale: Locale, cc: string): JsonLd | null {
  const linked = cards.filter((c) => c.slug);
  if (!linked.length) return null;
  return {
    "@context": ctx, "@type": "ItemList",
    itemListElement: linked.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(host, `/${locale}/${cc}/${c.kind}/${c.slug}`), name: pick(c.name, locale) })),
  };
}

export function collectionPage(name: string, description: string, url: string, locale: Locale): JsonLd {
  return { "@context": ctx, "@type": "CollectionPage", name, description, url, inLanguage: locale };
}

export function listingBlocks(d: ListData, host: string, locale: Locale, cc: string, path: string, meta: { title: string; description: string }): JsonLd[] {
  return [collectionPage(meta.title, meta.description, abs(host, path), locale), breadcrumbs(host, d.crumbs, locale, path), itemList(d.providers, host, locale, cc)].filter((x): x is JsonLd => !!x);
}

// ── validation (used by the unit tests here and mirrored by the API SEO audit) ─────────────────────────────────

export interface JsonLdIssue { path: string; message: string }
export function validateJsonLd(block: unknown): JsonLdIssue[] {
  const issues: JsonLdIssue[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(k)) issues.push({ path: `${path}.${k}`, message: `forbidden property ${k}` });
      walk(o[k], `${path}.${k}`);
    }
    const t = o["@type"];
    if (typeof t === "string" && !(ALLOWED_TYPES as readonly string[]).includes(t)) issues.push({ path, message: `type ${t} is not in the allowed set` });
    if (t === "AggregateRating") {
      const rv = Number(o.ratingValue); const rc = Number(o.reviewCount);
      if (!(rv >= 1 && rv <= 5) || !(Number.isInteger(rc) && rc > 0)) issues.push({ path, message: "AggregateRating needs ratingValue 1..5 and reviewCount > 0" });
    }
    if (t === "ListItem" && typeof o.position !== "number") issues.push({ path, message: "ListItem needs a numeric position" });
  };
  const root = block as Record<string, unknown> | null;
  if (!root || typeof root !== "object" || root["@context"] !== ctx) issues.push({ path: "$", message: "@context must be https://schema.org" });
  if (!root || typeof root["@type"] !== "string") issues.push({ path: "$", message: "@type is required" });
  walk(block, "$");
  if (root?.["@type"] === "BreadcrumbList" && !(Array.isArray(root.itemListElement) && root.itemListElement.length >= 2)) issues.push({ path: "$", message: "BreadcrumbList needs at least two items" });
  return issues;
}
