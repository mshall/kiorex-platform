import { computeAttributionInputsHash } from '@kiorex/contracts';
import { decide, type Decision, type DecisionBooking, type DecisionPolicy, type DecisionTouch } from '../attribution/decide';

/**
 * Pure part of the product ingest decision (GRW-P4-B2). The attribution rules are the Clinic rules, unchanged: this file only (1) lets an optional
 * `ATTRIBUTION_POLICY.products.<PRODUCT>.windows` override the windows of one product (absent = the clinic windows, so a policy without the key behaves exactly like the clinic),
 * and (2) maps the fact to the booking shape `decide()` reads. It never decides a charge: the commission link of products is inert (AD-13).
 */
export const PRODUCT_FACT_PRODUCTS = ['PHARMACY', 'LAB', 'NURSE'] as const;
export type ProductFactProduct = (typeof PRODUCT_FACT_PRODUCTS)[number];
export const PRODUCT_FACT_KINDS = ['ORDER', 'LAB_BOOKING', 'CARE_PLAN_BOOKING'] as const;
export type ProductFactKind = (typeof PRODUCT_FACT_KINDS)[number];
/** The product each fact kind belongs to (a decision for ORDER with product LAB is a programming error and is refused). */
export const FACT_KIND_PRODUCT: Record<ProductFactKind, ProductFactProduct> = { ORDER: 'PHARMACY', LAB_BOOKING: 'LAB', CARE_PLAN_BOOKING: 'NURSE' };

export interface ProductWindows { providerTouchWindowDays?: number; patientReferralWindowDays?: number; campaignClickWindowDays?: number }
const inRange = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 365;

/** Applies `products.<PRODUCT>.windows` of the policy payload on top of the clinic policy. Values outside 1..365 days are ignored (never a wider-than-validated window). */
export function policyForProduct(base: DecisionPolicy, payload: { products?: Record<string, { windows?: ProductWindows } | undefined> } | undefined, product: ProductFactProduct): DecisionPolicy {
  const w = payload?.products?.[product]?.windows;
  if (!w) return base;
  return {
    ...base,
    ...(inRange(w.providerTouchWindowDays) ? { providerTouchWindowDays: w.providerTouchWindowDays } : {}),
    ...(inRange(w.patientReferralWindowDays) ? { patientReferralWindowDays: w.patientReferralWindowDays } : {}),
    ...(inRange(w.campaignClickWindowDays) ? { campaignClickWindowDays: w.campaignClickWindowDays } : {}),
  };
}

export interface ProductFact { product: ProductFactProduct; factKind: ProductFactKind; factId: string; orgRef: string; createdAt: string }

export interface ProductDecisionResult extends Decision { product: ProductFactProduct; factKind: ProductFactKind; factId: string }

/**
 * Decides one fact. `ltValidForOrg` is always false for products (the signed `lt` is the Clinic's booking token). The fact id is hashed into `inputsHash` like a booking id
 * (kind-prefixed so an order and a lab booking with the same id can never share a hash), so a replay reproduces the stored decision byte for byte.
 */
export function decideProductFact(fact: ProductFact, touches: readonly DecisionTouch[], policy: DecisionPolicy): ProductDecisionResult {
  if (FACT_KIND_PRODUCT[fact.factKind] !== fact.product) throw new TypeError(`fact kind ${fact.factKind} does not belong to product ${fact.product}`);
  const booking: DecisionBooking = { id: `${fact.factKind}:${fact.factId}`, orgId: fact.orgRef, createdAt: fact.createdAt, channel: 'KIOREX', ltValidForOrg: false };
  const d = decide(booking, touches, policy);
  return { ...d, product: fact.product, factKind: fact.factKind, factId: fact.factId };
}

/** A continuity decision (ADR-056, proposed): the downstream fact came through a Kiorex continuity entry point of a clinic booking. Evidence hash covers the parent so it is reproducible. */
export function continuityHash(fact: ProductFact, parentDecisionId: string, parentOrigin: string, policyVersion: string): string {
  return computeAttributionInputsHash({ booking: { id: `${fact.factKind}:${fact.factId}`, orgId: fact.orgRef, createdAt: fact.createdAt, channel: 'CONTINUITY', hasValidLt: false }, touches: [{ id: parentDecisionId, occurredAt: parentOrigin }], policyVersion, precedence: 'PROVIDER_FIRST' });
}
