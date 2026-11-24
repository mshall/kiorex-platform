/**
 * Campaign eligibility (GRW-P2-A, ARCH section 9): structured and NON-CLINICAL ONLY. The validator is an allowlist: a key outside it is an error, so no specialty, provider,
 * diagnosis, medication or health attribute can ever enter a campaign. Eligibility is evaluated at the moment of a touch or a send for one person; it never builds a list
 * of patients for an ad platform. PURE.
 */
export const ELIGIBILITY_KEYS = ['markets', 'cities', 'districts', 'platforms', 'patientType', 'registrationAgeDaysMax', 'registrationAgeDaysMin', 'lifecycleStages', 'careTypes', 'languages'] as const;
export type EligibilityKey = (typeof ELIGIBILITY_KEYS)[number];
export const PLATFORMS = ['web', 'ios', 'android'] as const;
export const CARE_TYPES = ['IN_CLINIC', 'VIDEO', 'HOME_VISIT'] as const;
export const LANGUAGES = ['ar', 'en'] as const;
export const PATIENT_TYPES = ['ANY', 'NEW', 'RETURNING'] as const;

export interface Eligibility {
  markets?: string[]; cities?: string[]; districts?: string[]; platforms?: Array<(typeof PLATFORMS)[number]>; patientType?: (typeof PATIENT_TYPES)[number];
  registrationAgeDaysMax?: number; registrationAgeDaysMin?: number; lifecycleStages?: string[]; careTypes?: Array<(typeof CARE_TYPES)[number]>; languages?: Array<(typeof LANGUAGES)[number]>;
}
/** Facts about ONE person at the moment of the touch or send. Never contains specialty or any clinical field. */
export interface EligibilityFacts { market: string; city?: string; district?: string; platform?: string; registeredAt?: Date | null; lifecycleStage?: string | null; careType?: string | null; language?: string | null; hasBooking?: boolean }

const place = /^[\p{L}\p{N} .'’-]{1,60}$/u;
const stage = /^[A-Z][A-Z0-9_]{1,31}$/;
const list = (v: unknown, ok: (x: unknown) => boolean, path: string, max: number, errors: string[]): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > max || !v.every(ok)) { errors.push(`${path}: a list of at most ${max} valid values is required`); return undefined; }
  return [...new Set(v as string[])];
};

export function validateEligibility(input: unknown): { valid: true; value: Eligibility } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (input === undefined || input === null) return { valid: true, value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['/: eligibility must be an object'] };
  const o = input as Record<string, unknown>; const out: Eligibility = {};
  for (const k of Object.keys(o)) if (!(ELIGIBILITY_KEYS as readonly string[]).includes(k)) errors.push(`/${k}: not an allowed eligibility key (only non-clinical attributes: ${ELIGIBILITY_KEYS.join(', ')})`);
  const m = list(o.markets, (x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x), '/markets', 10, errors); if (m) out.markets = m;
  const ci = list(o.cities, (x) => typeof x === 'string' && place.test(x), '/cities', 50, errors); if (ci) out.cities = ci;
  const di = list(o.districts, (x) => typeof x === 'string' && place.test(x), '/districts', 100, errors); if (di) out.districts = di;
  const pl = list(o.platforms, (x) => (PLATFORMS as readonly unknown[]).includes(x), '/platforms', 3, errors); if (pl) out.platforms = pl as Eligibility['platforms'];
  const ct = list(o.careTypes, (x) => (CARE_TYPES as readonly unknown[]).includes(x), '/careTypes', 3, errors); if (ct) out.careTypes = ct as Eligibility['careTypes'];
  const la = list(o.languages, (x) => (LANGUAGES as readonly unknown[]).includes(x), '/languages', 2, errors); if (la) out.languages = la as Eligibility['languages'];
  const ls = list(o.lifecycleStages, (x) => typeof x === 'string' && stage.test(x), '/lifecycleStages', 20, errors); if (ls) out.lifecycleStages = ls;
  if (o.patientType !== undefined) { if ((PATIENT_TYPES as readonly unknown[]).includes(o.patientType)) out.patientType = o.patientType as Eligibility['patientType']; else errors.push('/patientType: ANY, NEW or RETURNING'); }
  for (const k of ['registrationAgeDaysMax', 'registrationAgeDaysMin'] as const) if (o[k] !== undefined) { if (Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) <= 3650) out[k] = o[k] as number; else errors.push(`/${k}: a whole number of days from 0 to 3650`); }
  if (out.registrationAgeDaysMin !== undefined && out.registrationAgeDaysMax !== undefined && out.registrationAgeDaysMin > out.registrationAgeDaysMax) errors.push('/registrationAgeDaysMin: must not exceed registrationAgeDaysMax');
  return errors.length ? { valid: false, errors } : { valid: true, value: out };
}

const day = 86_400_000;
/** Is one person eligible right now? Empty rule = everyone in the campaign's market. Unknown facts fail a restriction that needs them (never guessed). */
export function isEligible(rule: Eligibility, f: EligibilityFacts, now: Date): boolean {
  if (rule.markets?.length && !rule.markets.includes(f.market)) return false;
  if (rule.cities?.length && !(f.city && rule.cities.includes(f.city))) return false;
  if (rule.districts?.length && !(f.district && rule.districts.includes(f.district))) return false;
  if (rule.platforms?.length && !(f.platform && (rule.platforms as string[]).includes(f.platform))) return false;
  if (rule.languages?.length && !(f.language && (rule.languages as string[]).includes(f.language))) return false;
  if (rule.careTypes?.length && !(f.careType && (rule.careTypes as string[]).includes(f.careType))) return false;
  if (rule.lifecycleStages?.length && !(f.lifecycleStage && rule.lifecycleStages.includes(f.lifecycleStage))) return false;
  if (rule.patientType === 'NEW' && f.hasBooking === true) return false;
  if (rule.patientType === 'RETURNING' && f.hasBooking !== true) return false;
  if (rule.registrationAgeDaysMax !== undefined || rule.registrationAgeDaysMin !== undefined) {
    if (!f.registeredAt) return false;
    const age = Math.floor((now.getTime() - f.registeredAt.getTime()) / day);
    if (rule.registrationAgeDaysMax !== undefined && age > rule.registrationAgeDaysMax) return false;
    if (rule.registrationAgeDaysMin !== undefined && age < rule.registrationAgeDaysMin) return false;
  }
  return true;
}
