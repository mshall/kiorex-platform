/**
 * SEO configuration beyond the contract keys (GRW-P1-F). These keys ride inside the same versioned `SEO` GrowthConfigVersion payload (maker-checker,
 * per market through MARKET scope). Until kiorex-contracts adds them to SEO.schema.json (additive, optional) the maker-checker write path of package K
 * rejects them (the schema has additionalProperties false); the READ path here already honours them and validates them on its own, so a bad value never
 * reaches a page. Defaults are PROPOSED_DEFAULT.
 */
export const TEMPLATE_KEYS = ['home', 'hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine', 'doctor', 'nurse', 'clinic', 'pharmacy', 'lab'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATE_LOCALES = ['ar', 'en'] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

/** Placeholders a title or description template may use. Unknown placeholders are rejected so a typo never prints `{nme}` on a page. */
export const TEMPLATE_PLACEHOLDERS = ['name', 'specialty', 'city', 'district', 'country', 'clinic', 'count', 'fees', 'rating', 'where', 'care', 'brand'] as const;

export interface MetaTemplate { title?: string; description?: string }
export type MetaTemplates = Partial<Record<TemplateLocale, Partial<Record<TemplateKey, MetaTemplate>>>>;

export interface SeoExtensions {
  /** Title and description templates per locale and page type; absent entries use the built-in defaults (the Arabic copy needs CMO review). */
  templates: MetaTemplates;
  /** Page 2 and beyond of a listing are indexable (self-canonical). PROPOSED_DEFAULT false: they are `noindex,follow` and not in sitemaps. */
  paginatedIndexable: boolean;
  /** Visible, verified reviews needed before Physician or Pharmacy pages emit aggregateRating (and only when the rating text is on the page). */
  reviewMarkupMinCount: number;
  /** A provider counts as "same day" when its next slot starts within this many hours. */
  sameDayWindowHours: number;
  /** Same-day and telemedicine hubs need this many providers with real availability / declared video. */
  minAvailableProviders: number;
  /** A district or city-hub page whose provider set overlaps its parent by more than this percent is `noindex,follow` (doorway rule). */
  maxParentSimilarityPercent: number;
}

export const SEO_EXTENSION_DEFAULTS = (): SeoExtensions => ({ templates: {}, paginatedIndexable: false, reviewMarkupMinCount: 5, sameDayWindowHours: 24, minAvailableProviders: 2, maxParentSimilarityPercent: 100 });

const PH = /\{([a-zA-Z]+)\}/g;
const MAX = { title: 120, description: 320 };

export interface TemplateValidation { valid: boolean; errors: string[]; cleaned: MetaTemplates }

/** Validate and clean a `templates` value. Invalid entries are dropped (never partially applied) and reported. */
export function validateTemplates(input: unknown): TemplateValidation {
  const errors: string[] = []; const cleaned: MetaTemplates = {};
  if (input === undefined || input === null) return { valid: true, errors, cleaned };
  if (typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['templates must be an object'], cleaned };
  for (const [loc, byKey] of Object.entries(input as Record<string, unknown>)) {
    if (!(TEMPLATE_LOCALES as readonly string[]).includes(loc)) { errors.push(`unknown locale ${loc}`); continue; }
    if (!byKey || typeof byKey !== 'object' || Array.isArray(byKey)) { errors.push(`templates.${loc} must be an object`); continue; }
    for (const [key, t] of Object.entries(byKey as Record<string, unknown>)) {
      if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) { errors.push(`unknown page type ${loc}.${key}`); continue; }
      if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(`templates.${loc}.${key} must be an object`); continue; }
      const out: MetaTemplate = {}; let ok = true;
      for (const f of ['title', 'description'] as const) {
        const v = (t as Record<string, unknown>)[f];
        if (v === undefined) continue;
        if (typeof v !== 'string' || !v.trim()) { errors.push(`${loc}.${key}.${f} must be a non-empty string`); ok = false; continue; }
        if (v.length > MAX[f]) { errors.push(`${loc}.${key}.${f} is longer than ${MAX[f]} characters`); ok = false; continue; }
        if (/[<>]/.test(v)) { errors.push(`${loc}.${key}.${f} must not contain markup`); ok = false; continue; }
        const bad = [...v.matchAll(PH)].map((m) => m[1]!).filter((p) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(p));
        if (bad.length) { errors.push(`${loc}.${key}.${f} uses unknown placeholders: ${[...new Set(bad)].join(', ')}`); ok = false; continue; }
        if (/\{|\}/.test(v.replace(PH, ''))) { errors.push(`${loc}.${key}.${f} has an unbalanced brace`); ok = false; continue; }
        out[f] = v.trim();
      }
      if (ok && (out.title || out.description)) { (cleaned[loc as TemplateLocale] ??= {})[key as TemplateKey] = out; }
    }
  }
  return { valid: errors.length === 0, errors, cleaned };
}

const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

/** Merge a stored payload over `base`; wrongly typed or out-of-range values are ignored. */
export function mergeSeoExtensions(base: SeoExtensions, payload: unknown): SeoExtensions {
  if (!payload || typeof payload !== 'object') return base;
  const p = payload as Record<string, unknown>;
  const out: SeoExtensions = { ...base, templates: { ...base.templates } };
  if (p.templates !== undefined) {
    const v = validateTemplates(p.templates);
    for (const loc of Object.keys(v.cleaned) as TemplateLocale[]) out.templates[loc] = { ...(out.templates[loc] ?? {}), ...v.cleaned[loc] };
  }
  if (typeof p.paginatedIndexable === 'boolean') out.paginatedIndexable = p.paginatedIndexable;
  out.reviewMarkupMinCount = int(p.reviewMarkupMinCount, 1, 1000) ?? out.reviewMarkupMinCount;
  out.sameDayWindowHours = int(p.sameDayWindowHours, 1, 72) ?? out.sameDayWindowHours;
  out.minAvailableProviders = int(p.minAvailableProviders, 1, 50) ?? out.minAvailableProviders;
  out.maxParentSimilarityPercent = int(p.maxParentSimilarityPercent, 50, 100) ?? out.maxParentSimilarityPercent;
  return out;
}

/**
 * Validation hook for package K (Super Admin growth configuration): call it from the `SEO` create/patch path so a bad template or threshold is
 * rejected with a message BEFORE it is stored. Pure; it validates only the F extension keys (the contract keys are validated by validateGrowthConfig).
 */
export function validateSeoExtensions(payload: unknown): { valid: boolean; errors: string[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, errors: ['payload must be an object'] };
  const p = payload as Record<string, unknown>; const errors: string[] = [];
  if (p.templates !== undefined) errors.push(...validateTemplates(p.templates).errors);
  if (p.paginatedIndexable !== undefined && typeof p.paginatedIndexable !== 'boolean') errors.push('paginatedIndexable must be a boolean');
  for (const [k, min, max] of [['reviewMarkupMinCount', 1, 1000], ['sameDayWindowHours', 1, 72], ['minAvailableProviders', 1, 50], ['maxParentSimilarityPercent', 50, 100]] as const) {
    if (p[k] !== undefined && int(p[k], min, max) === undefined) errors.push(`${k} must be an integer from ${min} to ${max}`);
  }
  return { valid: errors.length === 0, errors };
}
