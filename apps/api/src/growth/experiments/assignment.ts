import { createHmac } from 'node:crypto';
import type { VariantSpec } from './experiment.types';

/**
 * Deterministic assignment (GRW-P3-A). digest = HMAC-SHA256(salt, unitKey); the first 4 bytes decide membership of the allocation (`mod 10000 < allocationBp`, the rest is the holdback and
 * sees control without a record), the next 4 bytes pick the variant by cumulative weight. Two independent words keep the weights exact inside the allocation. The salt is per experiment,
 * so an assignment in one experiment says nothing about another. PURE: no clock, no I/O, no randomness.
 */
export const BP = 10_000;
export const digestOf = (salt: string, unitKey: string): Buffer => createHmac('sha256', salt).update(unitKey, 'utf8').digest();
export const unitHashOf = (salt: string, unitKey: string): string => digestOf(salt, unitKey).toString('hex');
export const bucketsOf = (digest: Buffer) => ({ allocation: digest.readUInt32BE(0) % BP, variant: digest.readUInt32BE(4) % BP });

export interface AssignInput { variants: readonly VariantSpec[]; allocationBp: number; salt: string; status: string }
export interface Assignment { enrolled: boolean; variant: string; control: string; unitHash: string | null; reason: 'ASSIGNED' | 'HOLDBACK' | 'NOT_RUNNING' }

export const controlOf = (variants: readonly VariantSpec[]): string => variants[0]!.key;

export function assign(exp: AssignInput, unitKey: string): Assignment {
  const control = controlOf(exp.variants);
  // stopping reverts every unit to control at once: the status is checked here, not cached anywhere
  if (exp.status !== 'RUNNING') return { enrolled: false, variant: control, control, unitHash: null, reason: 'NOT_RUNNING' };
  const d = digestOf(exp.salt, unitKey);
  const b = bucketsOf(d);
  const unitHash = d.toString('hex');
  if (b.allocation >= exp.allocationBp) return { enrolled: false, variant: control, control, unitHash: null, reason: 'HOLDBACK' };
  let acc = 0;
  for (const v of exp.variants) { acc += v.weightBp; if (b.variant < acc) return { enrolled: true, variant: v.key, control, unitHash, reason: 'ASSIGNED' }; }
  return { enrolled: true, variant: exp.variants[exp.variants.length - 1]!.key, control, unitHash, reason: 'ASSIGNED' }; // unreachable when weights sum to BP
}

/** Variant list rules: 2..max variants, first is `control`, keys unique and short, weights positive integers summing to 10000. Returns an error text or null. */
export function validateVariants(variants: unknown, max = 5): string | null {
  if (!Array.isArray(variants) || variants.length < 2 || variants.length > max) return `variants must be a list of 2 to ${max}`;
  const seen = new Set<string>(); let sum = 0;
  for (const [i, v] of variants.entries()) {
    if (!v || typeof v !== 'object') return 'each variant must be an object';
    const { key, weightBp, ...rest } = v as Record<string, unknown>;
    if (Object.keys(rest).length) return 'a variant carries only key and weightBp (no payload that could change money, policy or content)';
    if (typeof key !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(key)) return 'variant key must match [a-z0-9_-]{1,32}';
    if (i === 0 && key !== 'control') return 'the first variant must be "control"';
    if (seen.has(key)) return `duplicate variant key ${key}`;
    seen.add(key);
    if (!Number.isInteger(weightBp) || (weightBp as number) < 1) return 'weightBp must be a positive integer';
    sum += weightBp as number;
  }
  return sum === BP ? null : `variant weights must sum to ${BP} (got ${sum})`;
}
