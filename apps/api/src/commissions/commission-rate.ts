/**
 * COM-2 commission RATES: pure domain (no I/O), deterministic and unit-tested.
 *
 * Founder decision (binding): the fee / commission rate is set by default PER ORGANISATION TYPE (product: clinic, pharmacy, lab) and the super admin may override it for one organisation.
 * Both are money-affecting, so both are maker-checker, append-only and effective-dated. NO numeric rate is shipped: an unset default means NO CHARGE and a visible "rate not set" state
 * (never invent prices / fees; the numbers are a founder / finance decision, LG-COM-4).
 *
 * Resolution at an instant: the newest ACTIVE row of the organisation whose effectiveFrom <= at decides. An override row sets the organisation's own rate; an INHERIT row ends the override and the
 * organisation follows the product default again. With no organisation row the product default applies; with no default the state is NOT_SET.
 */
import { COLLECTION_MODES, type CollectionMode } from './commission-collect';
import { dunningBounds } from './commission-bounds';

export const RATE_PRODUCTS = ['CLINIC', 'PHARMACY', 'LAB'] as const;
export type RateProduct = (typeof RATE_PRODUCTS)[number];
export const FEE_TYPES = ['PERCENT', 'FLAT'] as const;
export type FeeType = (typeof FEE_TYPES)[number];
export const RATE_SCOPES = ['DEFAULT', 'ORG'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];
export const RATE_KINDS = ['RATE', 'INHERIT'] as const;
export type RateKind = (typeof RATE_KINDS)[number];

export interface RateSpec {
  feeType: FeeType;
  /** PERCENT only: basis points of the fee basis (1 bp = 0.01%), 0..10000. */
  percentBps: number | null;
  /** FLAT only: a fixed amount per charge in minor units. */
  flatMinor: number | null;
  /** Floor and cap of the computed commission per charge in minor units; null = none. */
  minMinor: number | null;
  maxMinor: number | null;
  /** Collection mode for the organisation; null = follow the collection settings (COM-1). */
  mode: CollectionMode | null;
  /**
   * COM-3 (all optional, null = not set here, the collection settings of the market / organisation (COM-1) answer; NO value is shipped):
   * currency the commission is charged in; rounding of a percent charge (null = HALF_UP, what always shipped); the collection timeline (grace, dunning retries, invoice due, reminders);
   * the dispute window; the minimum total to collect in a period; whether a provider saved-method (token) charge is permitted for the organisation.
   */
  currency: string | null;
  rounding: Rounding | null;
  minCollectMinor: number | null;
  graceDays: number | null;
  retryDays: number[] | null;
  invoiceDueDays: number | null;
  /** Reminder cadence of the collection timeline: whole days relative to the invoice due date (negative = before), ascending, at most 8. */
  reminderDays: number[] | null;
  disputeWindowDays: number | null;
  savedMethodChargeAllowed: boolean | null;
}
export const ROUNDINGS = ['HALF_UP', 'DOWN', 'UP'] as const;
export type Rounding = (typeof ROUNDINGS)[number];

const KEYS: (keyof RateSpec)[] = ['feeType', 'percentBps', 'flatMinor', 'minMinor', 'maxMinor', 'mode', 'currency', 'rounding', 'minCollectMinor', 'graceDays', 'retryDays', 'invoiceDueDays', 'reminderDays', 'disputeWindowDays', 'savedMethodChargeAllowed'];
const dayList = (v: unknown, min: number, max: number, maxLen: number): v is number[] => Array.isArray(v) && v.length <= maxLen && v.every((n, i, a) => isInt(n, min, max) && (i === 0 || n > (a[i - 1] as number)));
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const MAX_MINOR = 100_000_000;

/** Problems with a submitted spec (field names and reasons only). Empty = valid. */
export function rateProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['spec must be an object'];
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(KEYS as string[]).includes(k)) out.push(`unknown field ${k}`);
  if (!FEE_TYPES.includes(o.feeType as FeeType)) { out.push('feeType must be PERCENT or FLAT'); return out; }
  if (o.feeType === 'PERCENT') {
    if (!isInt(o.percentBps, 0, 10_000)) out.push('percentBps must be an integer 0..10000');
    if (o.flatMinor != null) out.push('flatMinor is not allowed for PERCENT');
  } else {
    if (!isInt(o.flatMinor, 0, MAX_MINOR)) out.push('flatMinor must be a non-negative integer (minor units)');
    if (o.percentBps != null) out.push('percentBps is not allowed for FLAT');
  }
  for (const k of ['minMinor', 'maxMinor'] as const) if (o[k] != null && !isInt(o[k], 0, MAX_MINOR)) out.push(`${k} must be a non-negative integer (minor units)`);
  if (isInt(o.minMinor, 0, MAX_MINOR) && isInt(o.maxMinor, 0, MAX_MINOR) && o.minMinor > o.maxMinor) out.push('minMinor must not exceed maxMinor');
  if (o.mode != null && !COLLECTION_MODES.includes(o.mode as CollectionMode)) out.push('mode is not a collection mode');
  if (o.currency != null && !(typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency))) out.push('currency must be a 3-letter ISO 4217 code in capitals');
  if (o.rounding != null && !ROUNDINGS.includes(o.rounding as Rounding)) out.push('rounding must be HALF_UP, DOWN or UP');
  if (o.minCollectMinor != null && !isInt(o.minCollectMinor, 0, MAX_MINOR)) out.push('minCollectMinor must be a non-negative integer (minor units)');
  const b = dunningBounds();
  if (o.graceDays != null && !isInt(o.graceDays, 0, b.graceDaysMax)) out.push(`graceDays must be an integer 0..${b.graceDaysMax}`);
  if (o.invoiceDueDays != null && !isInt(o.invoiceDueDays, 1, b.invoiceDueDaysMax)) out.push(`invoiceDueDays must be an integer 1..${b.invoiceDueDaysMax}`);
  if (o.disputeWindowDays != null && !isInt(o.disputeWindowDays, 0, 365)) out.push('disputeWindowDays must be an integer 0..365');
  if (o.retryDays != null && !dayList(o.retryDays, 1, b.retryDayMax, b.retryMaxCount)) out.push(`retryDays must be ascending whole days 1..${b.retryDayMax}, at most ${b.retryMaxCount}`);
  if (o.reminderDays != null && !dayList(o.reminderDays, -30, 90, 8)) out.push('reminderDays must be ascending whole days -30..90, at most 8');
  if (o.savedMethodChargeAllowed != null && typeof o.savedMethodChargeAllowed !== 'boolean') out.push('savedMethodChargeAllowed must be true or false');
  return out;
}

/** Strict parse of a VALID spec (call rateProblems first); unknown keys are dropped. */
export function parseRate(raw: unknown): RateSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const days = (v: unknown, min: number, max: number, len: number) => (dayList(v, min, max, len) ? [...(v as number[])] : null);
  const b = dunningBounds();
  return {
    feeType: o.feeType as FeeType, percentBps: o.feeType === 'PERCENT' ? n(o.percentBps) : null, flatMinor: o.feeType === 'FLAT' ? n(o.flatMinor) : null, minMinor: n(o.minMinor), maxMinor: n(o.maxMinor),
    mode: COLLECTION_MODES.includes(o.mode as CollectionMode) ? (o.mode as CollectionMode) : null,
    currency: typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null, rounding: ROUNDINGS.includes(o.rounding as Rounding) ? (o.rounding as Rounding) : null,
    minCollectMinor: n(o.minCollectMinor), graceDays: n(o.graceDays), retryDays: days(o.retryDays, 1, b.retryDayMax, b.retryMaxCount), invoiceDueDays: n(o.invoiceDueDays), reminderDays: days(o.reminderDays, -30, 90, 8),
    disputeWindowDays: n(o.disputeWindowDays), savedMethodChargeAllowed: typeof o.savedMethodChargeAllowed === 'boolean' ? o.savedMethodChargeAllowed : null,
  };
}

/** Commission for one charge in minor units: percent of the fee basis (rounded per `rounding`, half up when unset: what always shipped) or the flat amount, then the floor and the cap. */
export function computeCommissionMinor(basisMinor: number, spec: RateSpec): number {
  const exact = basisMinor * (spec.percentBps ?? 0);
  const pct = spec.rounding === 'DOWN' ? Math.floor(exact / 10_000) : spec.rounding === 'UP' ? Math.ceil(exact / 10_000) : Math.floor((exact * 2 + 10_000) / 20_000);
  let v = spec.feeType === 'FLAT' ? (spec.flatMinor ?? 0) : pct;
  if (spec.minMinor != null) v = Math.max(v, spec.minMinor);
  if (spec.maxMinor != null) v = Math.min(v, spec.maxMinor);
  return v;
}

export interface RateRowLite { id: string; scope: RateScope; kind: RateKind; version: number; status: string; spec: unknown; effectiveFrom: Date; reason: string | null }
export type RateSource = 'OVERRIDE' | 'DEFAULT';
export interface EffectiveRate {
  state: 'SET' | 'NOT_SET';
  source: RateSource | null;
  policyId: string | null;
  version: number | null;
  effectiveFrom: Date | null;
  reason: string | null;
  spec: RateSpec | null;
}
export const NOT_SET: EffectiveRate = { state: 'NOT_SET', source: null, policyId: null, version: null, effectiveFrom: null, reason: null, spec: null };

/** Newest ACTIVE row that is already in force at `at` (ties on effectiveFrom: the higher version). */
export function inForce(rows: readonly RateRowLite[], at: Date): RateRowLite | null {
  const live = rows.filter((r) => r.status === 'ACTIVE' && r.effectiveFrom.getTime() <= at.getTime());
  live.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version);
  return live[0] ?? null;
}

export function resolveRate(defaults: readonly RateRowLite[], orgRows: readonly RateRowLite[], at: Date): EffectiveRate {
  const o = inForce(orgRows, at);
  if (o && o.kind === 'RATE') return { state: 'SET', source: 'OVERRIDE', policyId: o.id, version: o.version, effectiveFrom: o.effectiveFrom, reason: o.reason, spec: parseRate(o.spec) };
  const d = inForce(defaults, at);
  if (d && d.kind === 'RATE') return { state: 'SET', source: 'DEFAULT', policyId: d.id, version: d.version, effectiveFrom: d.effectiveFrom, reason: d.reason, spec: parseRate(d.spec) };
  return NOT_SET;
}

/** What a charge would be under an effective rate; null while the rate is not set (no charge). */
export function expectedCommissionMinor(basisMinor: number, rate: EffectiveRate): number | null {
  return rate.state === 'SET' && rate.spec ? computeCommissionMinor(basisMinor, rate.spec) : null;
}

/** A proposal may not rewrite the past: never earlier than one minute ago (clock skew); an approval after that moment moves the start to the approval time. */
export const SKEW_MS = 60_000;
export const effectiveFromProblem = (requested: Date, now: Date): string | null =>
  Number.isNaN(requested.getTime()) ? 'effectiveFrom is not a date' : requested.getTime() < now.getTime() - SKEW_MS ? 'effectiveFrom must not be in the past' : null;
export const effectiveFromAtApproval = (requested: Date, decidedAt: Date): Date => (requested.getTime() < decidedAt.getTime() ? decidedAt : requested);

/** The part of an effective rate an order keeps (pharmacy order, lab booking): never rewritten afterwards. */
export interface RateSnapshot { source: RateSource; policyId: string | null; version: number | null; effectiveFrom: string | null; spec: RateSpec }
export const snapshotOf = (r: EffectiveRate): RateSnapshot | null => (r.state === 'SET' && r.spec && r.source ? { source: r.source, policyId: r.policyId, version: r.version, effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString() : null, spec: r.spec } : null);

/**
 * Kiorex's fee on a pharmacy order or lab booking at release (the marketplace take, netted from the payout: no collection run).
 * The snapshot taken at creation decides (percent or flat, floor and cap); without one the legacy take rate applies (0 while unset: nothing is invented).
 */
export function orderFeeMinor(goodsMinor: number, snapshot: unknown, legacyBps: number): number {
  const s = snapshot as { spec?: RateSpec } | null;
  if (s && s.spec && rateProblems(s.spec).length === 0) return computeCommissionMinor(goodsMinor, parseRate(s.spec));
  return Math.round((goodsMinor * legacyBps) / 10000);
}

/** The part of a commission claim the rate reconciliation needs. */
export interface RateCheckClaim { id: string; orgRef: string; amountMinor: number; chargeStatus: string; feeBasisMinor: number | null; rateSnapshot: unknown }

/**
 * Reconciliation finding "claim differs from the rate" (CLAIM_NE_RATE): the claim keeps the resolved CommissionRatePolicy it was reported under (default or override, version, spec).
 * What that policy yields on the claim's own fee basis must equal what the Clinic charged. Recomputed from the stored spec (not the stored `expectedMinor`, which is only the fallback),
 * so a damaged snapshot cannot hide a difference. Not a finding: reversed or waived claims, claims reported while no rate was set (no snapshot), claims without a fee basis (nothing to recompute).
 */
export function claimRateFinding(c: RateCheckClaim): import('./commission-collect').Finding | null {
  if (c.chargeStatus === 'REVERSED' || c.chargeStatus === 'WAIVED') return null;
  const snap = c.rateSnapshot as { spec?: unknown; expectedMinor?: unknown; version?: number | null; source?: string } | null;
  if (!snap || typeof snap !== 'object') return null;
  let expected: number | null = null;
  if (c.feeBasisMinor != null && snap.spec && rateProblems(snap.spec).length === 0) expected = computeCommissionMinor(c.feeBasisMinor, parseRate(snap.spec));
  else if (typeof snap.expectedMinor === 'number') expected = snap.expectedMinor;
  if (expected === null || expected === c.amountMinor) return null;
  return { code: 'CLAIM_NE_RATE', orgRef: c.orgRef, ref: c.id, expectedMinor: expected, actualMinor: c.amountMinor, message: `charged amount differs from the commission rate that applied (${snap.source ?? 'rate'} v${snap.version ?? '?'})` };
}
export const reconcileClaimRates = (claims: readonly RateCheckClaim[]) => claims.map(claimRateFinding).filter((f): f is NonNullable<typeof f> => f !== null);
