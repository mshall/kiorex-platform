/**
 * JSON-LD rules of the public site: the allowed schema.org types and the forbidden keys (contact data and anything that would publish a private fact). This list mirrors
 * `public-site/seo-audit.ts` and `apps/web/src/public/seo/jsonld.ts`; the unit test `jsonld-rules.unit.spec.ts` keeps the three identical.
 */
export const JSONLD_ALLOWED_TYPES = ['Organization', 'WebSite', 'BreadcrumbList', 'ListItem', 'CollectionPage', 'ItemList', 'Physician', 'Dentist', 'MedicalBusiness', 'MedicalClinic', 'Pharmacy', 'PostalAddress', 'AggregateRating', 'ImageObject'] as const;
export const JSONLD_FORBIDDEN_KEYS = ['telephone', 'email', 'faxNumber', 'streetAddress', 'postalCode', 'geo', 'latitude', 'longitude', 'hasMap', 'openingHours', 'openingHoursSpecification', 'review', 'priceRange', 'paymentAccepted', 'medicalAudience', 'healthPlanNetworkId', 'isAcceptingNewPatientsFrom', 'sameAs'] as const;

export function jsonLdIssues(block: unknown, host: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) { if ((JSONLD_FORBIDDEN_KEYS as readonly string[]).includes(k)) out.push(`${path}.${k} is forbidden`); walk(o[k], `${path}.${k}`); }
    const t = o['@type'];
    if (typeof t === 'string' && !(JSONLD_ALLOWED_TYPES as readonly string[]).includes(t)) out.push(`${path} type ${t} is not allowed`);
    if (t === 'AggregateRating' && !(Number(o.ratingValue) >= 1 && Number(o.ratingValue) <= 5 && Number(o.reviewCount) > 0)) out.push(`${path} AggregateRating is not valid`);
    for (const k of ['url', 'item']) if (typeof o[k] === 'string' && /^https?:\/\//.test(o[k] as string) && !(o[k] as string).startsWith(host)) out.push(`${path}.${k} points outside ${host}`);
  };
  const r = block as Record<string, unknown> | null;
  if (!r || r['@context'] !== 'https://schema.org') out.push('@context must be https://schema.org');
  if (!r || typeof r['@type'] !== 'string') out.push('@type is required');
  walk(block, '$');
  if (r?.['@type'] === 'BreadcrumbList' && !(Array.isArray(r.itemListElement) && r.itemListElement.length >= 2)) out.push('BreadcrumbList needs at least two items');
  return out;
}
