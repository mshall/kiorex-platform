/**
 * Segment allowlist (GRW-P2-E). A segment is a rule over NON-CLINICAL attributes only, evaluated for ONE person at the moment of a send; it never produces a list of
 * people for an ad platform. The attribute set equals the LIFECYCLE_POLICY schema enum (contracts 1.12.0). Anything else (specialty, doctor, reason for visit,
 * prescription, lab, pharmacy, diagnosis, medication) is rejected, at the type level and at runtime.
 */
export const SEGMENT_ATTRIBUTES = ['stage', 'platform', 'language', 'city', 'district', 'registeredDaysAgo', 'lastBookingDaysAgo', 'hasDependants', 'referralStatus'] as const;
export type SegmentAttribute = (typeof SEGMENT_ATTRIBUTES)[number];

/** Keys that must never appear in a segment, named so a reviewer reading a rejection sees why. */
export const FORBIDDEN_SEGMENT_HINTS = ['specialty', 'doctor', 'clinician', 'provider', 'reason', 'visitreason', 'diagnosis', 'icd', 'prescription', 'medication', 'drug', 'pharmacy', 'condition', 'symptom', 'insur', 'gender', 'dateofbirth', 'nationalid'] as const;
/** Short words that are clinical or identifying only as a WHOLE key (as a substring they hit `stage`, `language`, `lab` in `label`...). */
export const FORBIDDEN_SEGMENT_EXACT = ['age', 'lab', 'labs', 'rx', 'test', 'tests', 'sex'] as const;
export const isClinicalSegmentKey = (k: string) => { const l = k.toLowerCase(); return (FORBIDDEN_SEGMENT_EXACT as readonly string[]).includes(l) || FORBIDDEN_SEGMENT_HINTS.some((h) => l.includes(h)) || /^lab[A-Z_]/.test(k) || /^rx[A-Z_]/.test(k) || /^test[A-Z_]/.test(k); };

export type SegmentRule = Partial<{
  stage: string[]; platform: string[]; language: string[]; city: string[]; district: string[];
  registeredDaysAgo: { min?: number; max?: number }; lastBookingDaysAgo: { min?: number; max?: number };
  hasDependants: boolean; referralStatus: string[];
}>;
/** Compile-time guard: only allowlisted keys can be written in a typed segment. */
export type StrictSegment<T extends SegmentRule> = T & { [K in Exclude<keyof T, SegmentAttribute>]: never };

export interface SegmentFacts { stage: string; platform: string; language: string; city?: string | null; district?: string | null; registeredDaysAgo: number; lastBookingDaysAgo: number | null; hasDependants: boolean; referralStatus: string }

export function validateSegmentRule(input: unknown): { valid: true; value: SegmentRule } | { valid: false; errors: string[] } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['/: a segment is an object of allowlisted attributes'] };
  const o = input as Record<string, unknown>; const errors: string[] = []; const out: SegmentRule = {};
  for (const k of Object.keys(o)) {
    if (!(SEGMENT_ATTRIBUTES as readonly string[]).includes(k)) {
      const clinical = isClinicalSegmentKey(k);
      errors.push(`/${k}: ${clinical ? 'clinical or identifying attribute, never allowed in a segment' : 'not an allowed segment attribute'} (allowed: ${SEGMENT_ATTRIBUTES.join(', ')})`);
    }
  }
  const strList = (k: 'stage' | 'platform' | 'language' | 'city' | 'district' | 'referralStatus', re: RegExp, max: number) => {
    if (o[k] === undefined) return;
    const v = o[k];
    if (!Array.isArray(v) || v.length === 0 || v.length > max || !v.every((x) => typeof x === 'string' && re.test(x))) errors.push(`/${k}: a non-empty list of at most ${max} valid values is required`);
    else out[k] = [...new Set(v as string[])];
  };
  strList('stage', /^[A-Z][A-Z0-9_]{1,31}$/, 10); strList('platform', /^(web|ios|android)$/, 3); strList('language', /^(ar|en)$/, 2);
  strList('city', /^[\p{L}\p{N} .'’-]{1,60}$/u, 50); strList('district', /^[\p{L}\p{N} .'’-]{1,60}$/u, 100); strList('referralStatus', /^[A-Z][A-Z0-9_]{1,31}$/, 10);
  for (const k of ['registeredDaysAgo', 'lastBookingDaysAgo'] as const) {
    if (o[k] === undefined) continue;
    const r = o[k] as { min?: unknown; max?: unknown };
    const ok = r && typeof r === 'object' && Object.keys(r).every((x) => x === 'min' || x === 'max') && [r.min, r.max].every((n) => n === undefined || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 3650));
    if (!ok || (r.min === undefined && r.max === undefined)) errors.push(`/${k}: { min?, max? } whole days between 0 and 3650`);
    else if (r.min !== undefined && r.max !== undefined && (r.min as number) > (r.max as number)) errors.push(`/${k}: min must not exceed max`);
    else out[k] = r as { min?: number; max?: number };
  }
  if (o.hasDependants !== undefined) { if (typeof o.hasDependants === 'boolean') out.hasDependants = o.hasDependants; else errors.push('/hasDependants: true or false'); }
  return errors.length ? { valid: false, errors } : { valid: true, value: out };
}

/** Is one person inside the segment right now? Unknown facts fail a restriction that needs them (never guessed). An empty rule matches nobody: a segment must say something. */
export function inSegment(rule: SegmentRule, f: SegmentFacts): boolean {
  const keys = Object.keys(rule) as SegmentAttribute[];
  if (!keys.length) return false;
  const inList = (list: string[] | undefined, v: string | null | undefined) => !list || (!!v && list.includes(v));
  const inRange = (r: { min?: number; max?: number } | undefined, n: number | null) => !r || (n !== null && (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max));
  return inList(rule.stage, f.stage) && inList(rule.platform, f.platform) && inList(rule.language, f.language) && inList(rule.city, f.city) && inList(rule.district, f.district) && inList(rule.referralStatus, f.referralStatus)
    && inRange(rule.registeredDaysAgo, f.registeredDaysAgo) && inRange(rule.lastBookingDaysAgo, f.lastBookingDaysAgo) && (rule.hasDependants === undefined || rule.hasDependants === f.hasDependants);
}

/** Validate every segment of a LIFECYCLE_POLICY payload: attribute lists must stay inside the allowlist. */
export function validatePolicySegments(segments: unknown): string[] {
  if (segments === undefined) return [];
  if (segments === null || typeof segments !== 'object' || Array.isArray(segments)) return ['/segments: object expected'];
  const errors: string[] = [];
  for (const [name, def] of Object.entries(segments as Record<string, unknown>)) {
    const attrs = (def as { attributes?: unknown })?.attributes;
    if (!Array.isArray(attrs)) { errors.push(`/segments/${name}/attributes: list expected`); continue; }
    for (const a of attrs) if (!(SEGMENT_ATTRIBUTES as readonly string[]).includes(String(a))) errors.push(`/segments/${name}/attributes: "${String(a)}" is not an allowed segment attribute`);
  }
  return errors;
}
