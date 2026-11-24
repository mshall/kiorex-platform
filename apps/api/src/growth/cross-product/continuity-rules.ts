/**
 * Pure rules of the cross-product journeys (GRW-P4-A, ADR-056 proposed). Nothing here reads a database, a clock or a secret.
 *
 *  1. A downstream order or booking is attributed on its OWN evidence (the P4-B2 decision).
 *  2. Created through a Kiorex continuity entry point of the patient's own clinic booking: origin CROSS_PRODUCT, `parentDecisionId` = the clinic decision,
 *     so reports show continuity without counting the first acquisition twice. Own PROVIDER_LED evidence still wins.
 *  3. Provider-led protection continues: the link records `parentOrigin` (PROVIDER_LED stays visible) so a future rate can exempt it; no charge exists today.
 *  4. A downstream fact never creates a reward and never counts as a referral qualification. (Enforced by construction: this module has no reward or referral dependency; a test scans for it.)
 *  5. The growth tables never hold items, test names, diagnoses, specialty or clinic: only the product pair, keyed hashes, decision ids, origins and timestamps.
 */
export const CONTINUITY_ENTRY_KINDS = ['RX_TO_PHARMACY', 'LAB_ORDER_TO_LAB', 'CARE_PLAN_TO_HOME_VISIT'] as const;
export type ContinuityEntryKind = (typeof CONTINUITY_ENTRY_KINDS)[number];
export type ContinuityProduct = 'PHARMACY' | 'LAB' | 'NURSE';
export type ContinuityFactKind = 'ORDER' | 'LAB_BOOKING' | 'CARE_PLAN_BOOKING';

/** Closed flag key of the package (contracts 1.14.0 `growth.cross_product`, launch-locked; mirrored locally until that version is published). */
export const FLAG_CROSS_PRODUCT = 'growth.cross_product';

export interface EntryMeta { toProduct: ContinuityProduct; factKind: ContinuityFactKind; /** product flags that must be effective for the card to show (gates open) */ gateFlags: readonly string[]; ttlDays: number; lookbackDays: number; cta: string }
export const ENTRY_META: Readonly<Record<ContinuityEntryKind, EntryMeta>> = {
  RX_TO_PHARMACY: { toProduct: 'PHARMACY', factKind: 'ORDER', gateFlags: ['kiorex.pharmacy_orders'], ttlDays: 30, lookbackDays: 7, cta: '/pharmacy' },
  LAB_ORDER_TO_LAB: { toProduct: 'LAB', factKind: 'LAB_BOOKING', gateFlags: ['kiorex.lab_bookings'], ttlDays: 30, lookbackDays: 7, cta: '/lab' },
  CARE_PLAN_TO_HOME_VISIT: { toProduct: 'NURSE', factKind: 'CARE_PLAN_BOOKING', gateFlags: ['kiorex.home_visits', 'nurse.care_plans'], ttlDays: 30, lookbackDays: 30, cta: '/care-plans' },
};
export const entryKindOfProduct = (p: ContinuityProduct): ContinuityEntryKind => (Object.keys(ENTRY_META) as ContinuityEntryKind[]).find((k) => ENTRY_META[k].toProduct === p)!;
export const isEntryKind = (v: unknown): v is ContinuityEntryKind => typeof v === 'string' && (CONTINUITY_ENTRY_KINDS as readonly string[]).includes(v);

export type ClinicOrigin = 'PROVIDER_LED' | 'MARKETPLACE' | 'UNATTRIBUTED';
export const CLINIC_ORIGINS: readonly string[] = ['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'];
export const asClinicOrigin = (v: unknown): ClinicOrigin | null => (typeof v === 'string' && CLINIC_ORIGINS.includes(v) ? (v as ClinicOrigin) : null);

export interface ParentCandidate { id: string; clinicId: string; startsAt: Date; status: string; dependantId: string | null }
/** Bookings that count as "the visit": the patient attended or is attending. A cancelled, expired or no-show booking is never a parent. */
export const PARENT_STATUSES: readonly string[] = ['COMPLETED', 'CHECKED_IN'];

/**
 * The clinic booking a shared prescription, lab order or home-visit prompt follows: the patient's own booking (never a dependant's), attended, at the same clinic when the clinic is
 * known, whose start lies within `lookbackDays` before `at` (the share time) and at most one day after it. The latest start wins; ties break on id so the choice is reproducible.
 */
export function pickParent(candidates: readonly ParentCandidate[], o: { at: Date; lookbackDays: number; clinicId?: string | null }): ParentCandidate | null {
  const from = o.at.getTime() - o.lookbackDays * 86_400_000; const to = o.at.getTime() + 86_400_000;
  const ok = candidates.filter((c) => !c.dependantId && PARENT_STATUSES.includes(c.status) && (!o.clinicId || c.clinicId === o.clinicId) && c.startsAt.getTime() >= from && c.startsAt.getTime() <= to);
  return ok.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1))[0] ?? null;
}

export interface ContinuityInput { flagOn: boolean; consent: boolean; hasParent: boolean; ownOrigin: string; parentOrigin: string | null }
export interface ContinuityVerdict {
  /** a link row is written and the decision may become CROSS_PRODUCT */
  linked: boolean;
  origin: string;
  reason: 'CONTINUITY_ENTRY_POINT' | 'NO_CONSENT' | 'FLAG_OFF' | 'NO_PARENT' | 'OWN_PROVIDER_EVIDENCE';
  parentOrigin: ClinicOrigin | null;
  /** future-rate exemption marker (rule 3): informational only, no charge exists */
  providerLedProtected: boolean;
}
export function evaluateContinuity(i: ContinuityInput): ContinuityVerdict {
  if (!i.flagOn) return { linked: false, origin: i.ownOrigin, reason: 'FLAG_OFF', parentOrigin: null, providerLedProtected: false };
  if (!i.consent) return { linked: false, origin: i.ownOrigin, reason: 'NO_CONSENT', parentOrigin: null, providerLedProtected: false };
  if (!i.hasParent) return { linked: false, origin: i.ownOrigin, reason: 'NO_PARENT', parentOrigin: null, providerLedProtected: false };
  const parentOrigin = asClinicOrigin(i.parentOrigin);
  const protectedParent = parentOrigin === 'PROVIDER_LED';
  if (i.ownOrigin === 'PROVIDER_LED') return { linked: true, origin: 'PROVIDER_LED', reason: 'OWN_PROVIDER_EVIDENCE', parentOrigin, providerLedProtected: protectedParent };
  return { linked: true, origin: 'CROSS_PRODUCT', reason: 'CONTINUITY_ENTRY_POINT', parentOrigin, providerLedProtected: protectedParent };
}

/** Whole hours from the visit to the downstream fact; never negative (a fact created before the visit start counts as 0). */
export const lagHoursBetween = (visitAt: Date, factAt: Date): number => Math.max(0, Math.floor((factAt.getTime() - visitAt.getTime()) / 3_600_000));
export const LAG_BUCKETS = ['LT_24H', 'D1_3', 'D3_7', 'GT_7D'] as const;
export type LagBucket = (typeof LAG_BUCKETS)[number];
export const lagBucket = (hours: number): LagBucket => (hours < 24 ? 'LT_24H' : hours < 72 ? 'D1_3' : hours < 168 ? 'D3_7' : 'GT_7D');
