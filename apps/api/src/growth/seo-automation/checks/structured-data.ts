import { jsonLdIssues } from '../jsonld-rules';
import type { CheckContext, CheckResult, PageContent } from '../page-model';

/** Minimal local validator of the schema.org types the site uses: required properties per type (no network, no vendor validator). */
const REQUIRED: Record<string, string[]> = {
  Organization: ['name'], WebSite: ['name', 'url'], BreadcrumbList: ['itemListElement'], ListItem: ['position'], CollectionPage: ['name'], ItemList: ['itemListElement'],
  Physician: ['name'], Dentist: ['name'], MedicalBusiness: ['name'], MedicalClinic: ['name'], Pharmacy: ['name'], PostalAddress: [], AggregateRating: ['ratingValue', 'reviewCount'], ImageObject: ['url'],
};

export function requiredProps(block: unknown, path = '$'): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>; const t = o['@type'];
    if (typeof t === 'string' && REQUIRED[t]) for (const k of REQUIRED[t]!) if (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !(o[k] as unknown[]).length)) out.push(`${p} ${t} needs ${k}`);
    for (const [k, x] of Object.entries(o)) walk(x, `${p}.${k}`);
  };
  walk(block, path);
  return out;
}

const hasType = (v: unknown, type: string): boolean => (Array.isArray(v) ? v.some((x) => hasType(x, type)) : !!v && typeof v === 'object' && ((v as Record<string, unknown>)['@type'] === type || Object.values(v as object).some((x) => hasType(x, type))));

/**
 * JSON-LD must parse, use only allowed types, carry no forbidden key (contact data), have the required properties of each type, and only use review markup when the config allows it,
 * the visible review count meets the minimum and the reviews are on the page.
 */
export function structuredData(p: PageContent, c: CheckContext): CheckResult[] {
  const issues: string[] = [];
  if (!p.jsonLd.length && !['not-found'].includes(p.templateKind)) issues.push('no JSON-LD block');
  for (const b of p.jsonLd) { issues.push(...jsonLdIssues(b, c.host), ...requiredProps(b)); }
  const rating = hasType(p.jsonLd, 'AggregateRating');
  const review = [
    ...(rating && !c.reviewMarkupEnabled ? ['AggregateRating while review markup is switched off'] : []),
    ...(rating && p.visibleReviews < c.reviewMarkupMinCount ? [`AggregateRating with ${p.visibleReviews} visible reviews (${c.reviewMarkupMinCount} needed)`] : []),
  ];
  const out: CheckResult[] = [issues.length ? { id: 'structured-data', ok: false, severity: 'block', detail: issues.slice(0, 4).join('; ') } : { id: 'structured-data', ok: true, severity: 'block' }];
  out.push(review.length ? { id: 'review-markup', ok: false, severity: 'block', detail: review.join('; ') } : { id: 'review-markup', ok: true, severity: 'block' });
  return out;
}
