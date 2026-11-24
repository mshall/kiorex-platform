import { TEMPLATE_KEYS, type TemplateKey } from '../seo/seo-public';

/**
 * `SEO_AUTOMATION` growth configuration (contracts 1.13.0 kind; validated here until the contract schema joins, like the SEO extension keys). Defaults are PROPOSED_DEFAULT.
 * `autoNoindex` is false by default: a failed gate raises an ops item and a `SeoQualityGateFailed` event but never changes a page until a human switched it on.
 */
export const CHECK_IDS = ['thin-content', 'similarity', 'parity-ar-en', 'title-meta', 'structured-data', 'canonical', 'hreflang', 'orphan', 'claims', 'empty-page', 'review-markup', 'available-providers'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface SeoAutomationConfig {
  autoNoindex: boolean;
  /**
   * minimum unique words of visible text per template (unique = not boilerplate shared with most pages of the template). Calibrated on the eight-provider seed: a profile page is a data page
   * (name, clinic, area, fees, languages, rating) with 20 to 50 unique words, so the entity floors catch an EMPTY profile; the generated listing pages carry the real thin-content rule.
   */
  minUniqueWords: Record<TemplateKey, number>;
  /** a page whose unique shingles overlap its parent hub or a sibling by more than this percent is a near duplicate */
  maxSimilarityPercent: number;
  shingleSize: number;
  title: { min: number; max: number };
  description: { min: number; max: number };
  /** checks whose failure makes a page `noindex` when autoNoindex is on; the others only warn */
  blocking: CheckId[];
  forbiddenClaims: { en: string[]; ar: string[] };
  links: {
    maxPerPage: number;
    /** cross-links (neighbour districts, related specialties, parents) per page and anchor kind */
    maxPerAnchorKind: number;
    topDoctors: number;
    clinicDoctors: number;
    /** distinct anchor texts over links of a page with more than ten links */
    minAnchorVariety: number;
    /** curated related specialties (slug to slugs). Navigation only; the Arabic and English labels come from the specialty table. CMO review before launch (NEEDS_HUMAN). */
    relatedSpecialties: Record<string, string[]>;
  };
  /** Core Web Vitals budgets: lab and field p75 (the same numbers as apps/web/lighthouserc.json) */
  vitals: { lcpMs: number; inpMs: number; cls: number; tbtMs: number; perfScore: number };
  alertTargets: string[];
}

const words = (n: number): Record<TemplateKey, number> => Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, n])) as Record<TemplateKey, number>;

export const SEO_AUTOMATION_DEFAULTS = (): SeoAutomationConfig => ({
  autoNoindex: false,
  minUniqueWords: { ...words(80), home: 60, hub: 100, city: 90, district: 70, 'care-district': 70, 'city-hub': 90, 'district-hub': 70, 'same-day': 60, telemedicine: 60, doctor: 15, nurse: 15, clinic: 12, pharmacy: 10, lab: 10 },
  maxSimilarityPercent: 85,
  shingleSize: 4,
  title: { min: 12, max: 70 },
  description: { min: 40, max: 200 },
  blocking: ['thin-content', 'similarity', 'parity-ar-en', 'structured-data', 'canonical', 'hreflang', 'claims', 'empty-page', 'review-markup', 'available-providers'],
  // Marketing claims a health marketplace must not make about care (no medical claims, no superlatives that cannot be verified, no guarantees)
  forbiddenClaims: {
    en: ['guaranteed cure', 'cure guaranteed', '100% safe', '100% cure', 'best doctor', 'best doctors in', 'no.1 doctor', 'miracle', 'risk-free treatment', 'we cure', 'treats all', 'instant relief', 'painless guaranteed'],
    ar: ['علاج مضمون', 'شفاء تام', 'شفاء مضمون', 'أفضل دكتور', 'أفضل طبيب', 'أفضل دكاترة', 'نضمن الشفاء', 'نتيجة مضمونة', 'بدون أي مخاطر', 'معجزة', 'نعالج كل'],
  },
  links: {
    maxPerPage: 50, maxPerAnchorKind: 3, topDoctors: 6, clinicDoctors: 12, minAnchorVariety: 0.6,
    relatedSpecialties: { cardiology: ['internal-medicine', 'vascular-surgery'], dermatology: ['allergy', 'cosmetology'], paediatrics: ['neonatology', 'paediatric-surgery'], orthopaedics: ['physiotherapy', 'rheumatology'] },
  },
  vitals: { lcpMs: 2500, inpMs: 200, cls: 0.1, tbtMs: 200, perfScore: 90 },
  alertTargets: ['ops'],
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const strs = (v: unknown, max = 60): string[] | undefined => (Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && s.trim().length >= 2 && s.length <= 80 && !/[<>]/.test(s)) ? v.map((s: string) => s.trim()) : undefined);

export function validateSeoAutomation(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(payload)) return { valid: false, errors: ['payload must be an object'] };
  if (payload.autoNoindex !== undefined && typeof payload.autoNoindex !== 'boolean') errors.push('autoNoindex must be a boolean');
  if (payload.minUniqueWords !== undefined) {
    if (!isObj(payload.minUniqueWords)) errors.push('minUniqueWords must be an object');
    else for (const [k, v] of Object.entries(payload.minUniqueWords)) { if (!(TEMPLATE_KEYS as readonly string[]).includes(k)) errors.push(`minUniqueWords: unknown template ${k}`); else if (int(v, 0, 5000) === undefined) errors.push(`minUniqueWords.${k} must be an integer 0 to 5000`); }
  }
  if (payload.maxSimilarityPercent !== undefined && int(payload.maxSimilarityPercent, 30, 100) === undefined) errors.push('maxSimilarityPercent must be an integer 30 to 100');
  if (payload.shingleSize !== undefined && int(payload.shingleSize, 2, 8) === undefined) errors.push('shingleSize must be an integer 2 to 8');
  for (const k of ['title', 'description'] as const) {
    const v = payload[k]; if (v === undefined) continue;
    if (!isObj(v) || int(v.min, 1, 400) === undefined || int(v.max, 1, 600) === undefined || (v.min as number) >= (v.max as number)) errors.push(`${k} needs integers min < max`);
  }
  if (payload.blocking !== undefined && !(Array.isArray(payload.blocking) && payload.blocking.every((c) => (CHECK_IDS as readonly string[]).includes(c as string)))) errors.push(`blocking must list check ids from: ${CHECK_IDS.join(', ')}`);
  if (payload.forbiddenClaims !== undefined) { if (!isObj(payload.forbiddenClaims) || (payload.forbiddenClaims.en !== undefined && !strs(payload.forbiddenClaims.en)) || (payload.forbiddenClaims.ar !== undefined && !strs(payload.forbiddenClaims.ar))) errors.push('forbiddenClaims.en and .ar must be lists of short plain phrases'); }
  if (payload.links !== undefined) {
    if (!isObj(payload.links)) errors.push('links must be an object');
    else {
      const l = payload.links;
      for (const [k, lo, hi] of [['maxPerPage', 1, 200], ['maxPerAnchorKind', 1, 20], ['topDoctors', 0, 50], ['clinicDoctors', 0, 50]] as const) if (l[k] !== undefined && int(l[k], lo, hi) === undefined) errors.push(`links.${k} must be an integer ${lo} to ${hi}`);
      if (l.minAnchorVariety !== undefined && num(l.minAnchorVariety, 0, 1) === undefined) errors.push('links.minAnchorVariety must be a number 0 to 1');
      if (l.relatedSpecialties !== undefined && !(isObj(l.relatedSpecialties) && Object.values(l.relatedSpecialties).every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && /^[a-z0-9-]{2,60}$/.test(s))))) errors.push('links.relatedSpecialties must map a specialty slug to a list of slugs');
    }
  }
  if (payload.vitals !== undefined) {
    if (!isObj(payload.vitals)) errors.push('vitals must be an object');
    else for (const [k, lo, hi] of [['lcpMs', 500, 10_000], ['inpMs', 50, 2000], ['cls', 0, 1], ['tbtMs', 0, 2000], ['perfScore', 0, 100]] as const) if (payload.vitals[k] !== undefined && num(payload.vitals[k], lo, hi) === undefined) errors.push(`vitals.${k} must be a number ${lo} to ${hi}`);
  }
  if (payload.alertTargets !== undefined && !strs(payload.alertTargets, 10)) errors.push('alertTargets must be a short list of names');
  return { valid: errors.length === 0, errors };
}

/** Merge a stored payload over `base`; invalid pieces are ignored one by one. */
export function mergeSeoAutomation(base: SeoAutomationConfig, payload: unknown): SeoAutomationConfig {
  if (!isObj(payload)) return base;
  const o: SeoAutomationConfig = { ...base, minUniqueWords: { ...base.minUniqueWords }, title: { ...base.title }, description: { ...base.description }, forbiddenClaims: { ...base.forbiddenClaims }, links: { ...base.links, relatedSpecialties: { ...base.links.relatedSpecialties } }, vitals: { ...base.vitals } };
  if (typeof payload.autoNoindex === 'boolean') o.autoNoindex = payload.autoNoindex;
  if (isObj(payload.minUniqueWords)) for (const k of TEMPLATE_KEYS) o.minUniqueWords[k] = int(payload.minUniqueWords[k], 0, 5000) ?? o.minUniqueWords[k];
  o.maxSimilarityPercent = int(payload.maxSimilarityPercent, 30, 100) ?? o.maxSimilarityPercent;
  o.shingleSize = int(payload.shingleSize, 2, 8) ?? o.shingleSize;
  for (const k of ['title', 'description'] as const) { const v = payload[k]; if (isObj(v)) { const min = int(v.min, 1, 400); const max = int(v.max, 1, 600); if (min !== undefined && max !== undefined && min < max) o[k] = { min, max }; } }
  if (Array.isArray(payload.blocking) && payload.blocking.every((c) => (CHECK_IDS as readonly string[]).includes(c as string))) o.blocking = payload.blocking as CheckId[];
  if (isObj(payload.forbiddenClaims)) { o.forbiddenClaims = { en: strs(payload.forbiddenClaims.en) ?? o.forbiddenClaims.en, ar: strs(payload.forbiddenClaims.ar) ?? o.forbiddenClaims.ar }; }
  if (isObj(payload.links)) {
    const l = payload.links;
    o.links = { maxPerPage: int(l.maxPerPage, 1, 200) ?? o.links.maxPerPage, maxPerAnchorKind: int(l.maxPerAnchorKind, 1, 20) ?? o.links.maxPerAnchorKind, topDoctors: int(l.topDoctors, 0, 50) ?? o.links.topDoctors, clinicDoctors: int(l.clinicDoctors, 0, 50) ?? o.links.clinicDoctors, minAnchorVariety: num(l.minAnchorVariety, 0, 1) ?? o.links.minAnchorVariety, relatedSpecialties: isObj(l.relatedSpecialties) && Object.values(l.relatedSpecialties).every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && /^[a-z0-9-]{2,60}$/.test(s))) ? (l.relatedSpecialties as Record<string, string[]>) : o.links.relatedSpecialties };
  }
  if (isObj(payload.vitals)) for (const [k, lo, hi] of [['lcpMs', 500, 10_000], ['inpMs', 50, 2000], ['cls', 0, 1], ['tbtMs', 0, 2000], ['perfScore', 0, 100]] as const) o.vitals[k] = num(payload.vitals[k], lo, hi) ?? o.vitals[k];
  if (strs(payload.alertTargets, 10)) o.alertTargets = payload.alertTargets as string[];
  return o;
}
