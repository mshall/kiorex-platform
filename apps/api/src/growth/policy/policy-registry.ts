import { POLICY_SCHEMAS } from './policy-schemas.generated';
import { POLICY_DEFAULTS } from './policy-defaults';
import { deepMerge, schemaDefaults, validateAgainst, type SchemaNode } from './schema-validate';

/**
 * Policy configuration registry (configurability sweep). Numbers that used to be code constants are read through `livePolicy(kind, defaults)`: an object whose properties are
 * getters over (code default) merged with (the ACTIVE maker-checker version of the kind, GLOBAL scope). With no stored version the defaults answer, so behaviour is exactly
 * what shipped. `PolicyService` keeps the registry fresh (interval and on every config transition); a bad stored payload is ignored, never half-applied.
 *
 * SAFETY CONTROLS ARE NOT HERE. Nothing in this file can switch off a consent gate, a PHI filter, a k-anonymity floor below 10, the two-person rule or a launch lock:
 * those are code, and the schemas bound every number the registry accepts (e.g. k >= 10).
 */
export const POLICY_KINDS = ['EXPERIMENT_POLICY', 'AUTOMATION_POLICY', 'ATTRIBUTION_MODELS', 'RECOMMENDATION_POLICY', 'REWARD_GUARDS', 'LIFECYCLE_STAGES', 'CROSS_PRODUCT_POLICY', 'INTEGRATION_RUNTIME', 'INTEGRATION_MODES'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export const isPolicyKind = (k: string): k is PolicyKind => (POLICY_KINDS as readonly string[]).includes(k);
/** These kinds are read by process-wide synchronous code, so they exist at GLOBAL scope only (a MARKET row would be silently ignored, which is worse than refusing it). */
export const POLICY_GLOBAL_ONLY: readonly string[] = POLICY_KINDS;
/** Kinds whose change is announced (10+ characters) like the other marketing and messaging kinds. None moves money; INTEGRATION_MODES is the founder's go-live approval. */
export const POLICY_ANNOUNCEMENT_KINDS: readonly string[] = ['RECOMMENDATION_POLICY', 'INTEGRATION_MODES'];

const DEFAULTS = new Map<string, Record<string, unknown>>(Object.entries(POLICY_DEFAULTS));
const OVERRIDES = new Map<string, { payload: Record<string, unknown>; version: number | null }>();

export const policySchema = (kind: string): SchemaNode | undefined => POLICY_SCHEMAS[kind];

/** Cross-field rules JSON Schema cannot express. Run on write and on read (on the payload merged over the defaults). */
function crossChecks(kind: string, merged: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (kind === 'LIFECYCLE_STAGES' && !(Number(merged.churnedDays) > Number(merged.dormantDays))) e.push('/churnedDays must be greater than dormantDays');
  if (kind === 'ATTRIBUTION_MODELS') {
    const first = Number(merged.positionFirstBp ?? 4000); const last = Number(merged.positionLastBp ?? 4000);
    if (first + last > 10_000) e.push('/positionFirstBp plus positionLastBp must be at most 10000');
  }
  if (kind === 'EXPERIMENT_POLICY' && Number(merged.kAnonymity ?? 10) < 10) e.push('/kAnonymity must be at least 10');
  if (kind === 'RECOMMENDATION_POLICY' && Number(merged.k ?? 10) < 10) e.push('/k must be at least 10');
  return e;
}

export function defaultsOf(kind: string): Record<string, unknown> {
  const reg = DEFAULTS.get(kind); if (reg) return reg;
  const s = policySchema(kind); return s ? schemaDefaults(s) : {};
}
export function validatePolicy(kind: string, payload: unknown): string[] {
  const s = policySchema(kind); if (!s) return [`no policy schema for ${kind}`];
  const errors = validateAgainst(s, payload);
  if (errors.length) return errors;
  return crossChecks(kind, deepMerge(defaultsOf(kind), payload as Record<string, unknown>));
}

/** Sets (or, with null, clears) the stored payload of a kind. A payload that fails validation is refused and the previous state stays. */
export function setPolicyOverride(kind: string, payload: Record<string, unknown> | null, version: number | null = null): boolean {
  if (payload === null) { OVERRIDES.delete(kind); return true; }
  if (validatePolicy(kind, payload).length) return false;
  OVERRIDES.set(kind, { payload, version }); return true;
}
export function clearPolicyOverrides(): void { OVERRIDES.clear(); }
export function policyVersion(kind: string): number | null { return OVERRIDES.get(kind)?.version ?? null; }

/** The value now in force: defaults merged with the stored payload. Pure read, safe on hot paths. */
export function policyNow<T = Record<string, unknown>>(kind: PolicyKind, fallback?: Record<string, unknown>): T {
  const base = DEFAULTS.get(kind) ?? fallback ?? defaultsOf(kind);
  const o = OVERRIDES.get(kind);
  return (o ? deepMerge(base, o.payload) : base) as T;
}

/**
 * A drop-in for a former code constant: `export const X = livePolicy('KIND', { a: 1, b: 2 } as const)` keeps every `X.a` call site and every test untouched.
 * `defaults` must be the kind's entry of `POLICY_DEFAULTS` (the parity test fails otherwise), so the catalogue, the ops console and the validator agree with the code.
 */
export function livePolicy<T extends Record<string, unknown>>(kind: PolicyKind, defaults: T = DEFAULTS.get(kind) as T): Readonly<T> {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(defaults)) Object.defineProperty(out, key, { enumerable: true, get: () => (policyNow(kind) as Record<string, unknown>)[key] ?? defaults[key] });
  return Object.freeze(out) as Readonly<T>;
}
