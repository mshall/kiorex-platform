/**
 * Growth formulas exactly as KX-32 section 05 defines them. PURE and unit-tested against the worked examples of KX-32 section 08.
 * Money is integer minor units (piastres). A ratio with a zero denominator is `null` (not zero, not infinity).
 *
 * Revenue is what Kiorex keeps: CONFIRMED or BILLED commission charges net of reversals. Gross booking value (GBV), deposits, held funds, promotional credits,
 * taxes (VAT lines) and provider settlements are NEVER revenue; `kiorexRevenue` accepts only charge facts so nothing else can leak in by construction.
 */
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
export const pct = (num: number, den: number): number | null => { const r = ratio(num, den); return r === null ? null : Math.round(r * 10000) / 100; };

/** ANP_total(t) = T * L * d * a (listed providers times attended new patients per listed provider), rounded once at the end. */
export const anpTotal = (i: { tenants: number; listedShare: number; listedPerTenant: number; anpPerListed: number }) => Math.round(i.tenants * i.listedShare * i.listedPerTenant * i.anpPerListed);
/** ANP_fee_bearing(t) = ANP_total * (1 - p), p = provider-led share. */
export const anpFeeBearing = (anp: number, providerLedShare: number) => Math.round(anp * (1 - providerLedShare));
/** KiorexFeeRevenue(t) = ANP_fee_bearing * f * (1 - r). `feeMinor` per attended new patient, r = dispute and reversal rate. */
export const feeRevenue = (feeBearingAnp: number, feeMinor: number, disputeRate: number) => Math.round(feeBearingAnp * feeMinor * (1 - disputeRate));
/** LTV = f * (1 - r) + PayMargin_per_patient. Pay margin is not modelled (0). */
export const ltvMinor = (feeMinor: number, disputeRate: number, payMarginMinor = 0) => Math.round(feeMinor * (1 - disputeRate) + payMarginMinor);

export interface ChargeFact { kind: 'CHARGE' | 'REVERSAL'; status: string; amountMinor: number }
export const REVENUE_STATUSES = ['CONFIRMED', 'BILLED'] as const;
/** Kiorex revenue = CONFIRMED or BILLED charges minus reversals. PENDING, DISPUTED and WAIVED charges are not revenue yet (or ever). */
export function kiorexRevenue(facts: readonly ChargeFact[]) {
  const charged = facts.filter((f) => f.kind === 'CHARGE' && (REVENUE_STATUSES as readonly string[]).includes(f.status)).reduce((s, f) => s + f.amountMinor, 0);
  const reversed = facts.filter((f) => f.kind === 'REVERSAL').reduce((s, f) => s + f.amountMinor, 0);
  const pending = facts.filter((f) => f.kind === 'CHARGE' && f.status === 'PENDING').reduce((s, f) => s + f.amountMinor, 0);
  return { revenueMinor: charged - reversed, chargedMinor: charged, reversedMinor: reversed, pendingMinor: pending };
}

/** No approved spend means there is no CAC to report (null), not a CAC of zero. */
export const blendedCac = (spendMinor: number, anp: number) => (spendMinor > 0 ? ratio(spendMinor, anp) : null);
export const paidCac = (campaignSpendMinor: number, anpAttributedToCampaign: number) => (campaignSpendMinor > 0 ? ratio(campaignSpendMinor, anpAttributedToCampaign) : null);
export const roas = (attributedRevenueMinor: number, spendMinor: number) => ratio(attributedRevenueMinor, spendMinor); // spend 0 => null
export const mer = (revenueMinor: number, totalMarketingMinor: number) => ratio(revenueMinor, totalMarketingMinor);
export const ltvToCac = (ltv: number, cac: number | null) => (cac && cac > 0 ? ltv / cac : null);
export const providerLedShare = (b: { providerLed: number; marketplace: number; unattributed: number }) => ratio(b.providerLed, b.providerLed + b.marketplace + b.unattributed);
export const searchToBooking = (confirmed: number, searches: number) => ratio(confirmed, searches);
export const bookingToAttended = (attended: number, confirmed: number) => ratio(attended, confirmed);
export const disputeRate = (disputed: number, charges: number) => ratio(disputed, charges);

/** KX-32 section 09 guardrails: scale at LTV/CAC >= 3, sustain at >= 1, below 1 for two weeks stop. */
export function campaignVerdict(ltvOverCac: number | null): 'NO_DATA' | 'SCALE' | 'SUSTAIN' | 'REVIEW' {
  if (ltvOverCac === null) return 'NO_DATA';
  return ltvOverCac >= 3 ? 'SCALE' : ltvOverCac >= 1 ? 'SUSTAIN' : 'REVIEW';
}

// ───────────── GRW-P2-F advanced acquisition analytics ─────────────
/** A ratio resting on less than this much approved spend is noise: it is hidden and its denominators are printed (EGP 500 in piastres; market config can raise it, never lower it). */
export const SPEND_FLOOR_MINOR = 50_000;
export const ctrPct = (clicks: number, impressions: number) => pct(clicks, impressions);
export const cpc = (spendMinor: number, clicks: number) => (spendMinor > 0 && clicks > 0 ? Math.round(spendMinor / clicks) : null);
export const cpm = (spendMinor: number, impressions: number) => (spendMinor > 0 && impressions > 0 ? Math.round((spendMinor * 1000) / impressions) : null);
/** Install to registration and registration to first completed booking (percentages with two decimals). */
export const installToRegistration = (registrations: number, installs: number) => pct(registrations, installs);
export const registrationToFirstBooking = (firstBookings: number, registrations: number) => pct(firstBookings, registrations);
/** Blended CAC: marketing spend plus the reward cost the rewards actually cost (redeemed minus reversed), divided by attended new patients. Both variants are shown, never one alone. */
export const blendedCacWithRewards = (spendMinor: number, rewardCostMinor: number, anp: number) => (anp > 0 && spendMinor + rewardCostMinor > 0 ? ratio(spendMinor + rewardCostMinor, anp) : null);
export type HiddenReason = 'K_ANONYMITY' | 'SPEND_FLOOR' | 'NO_DENOMINATOR' | null;
/** The only way a money ratio reaches a screen: hidden under k < 10, under the spend floor, or without a denominator; the denominators travel with it. */
export function guardRatio(value: number | null, g: { people: number; spendMinor: number; floor?: number }): { value: number | null; hidden: HiddenReason } {
  if (g.people > 0 && g.people < 10) return { value: null, hidden: 'K_ANONYMITY' };
  if (g.spendMinor < (g.floor ?? SPEND_FLOOR_MINOR)) return { value: null, hidden: 'SPEND_FLOOR' };
  if (value === null || g.people === 0) return { value: null, hidden: 'NO_DENOMINATOR' };
  return { value, hidden: null };
}
/** Reconciliation of an external (adapter) spend figure with approved manual spend: the adapter wins on conflict (more than `toleranceBp` apart) and the note says so. */
export function reconcileSpend(externalMinor: number | null, approvedMinor: number, toleranceBp = 500): { usedMinor: number; source: 'ADAPTER' | 'APPROVED' | 'NONE'; deltaBp: number | null; conflict: boolean; note: string } {
  if (externalMinor === null || externalMinor <= 0) return { usedMinor: approvedMinor, source: approvedMinor > 0 ? 'APPROVED' : 'NONE', deltaBp: null, conflict: false, note: externalMinor === null ? 'NOT_CONNECTED' : 'NO_EXTERNAL_SPEND' };
  if (approvedMinor <= 0) return { usedMinor: externalMinor, source: 'ADAPTER', deltaBp: null, conflict: false, note: 'ADAPTER_ONLY' };
  const deltaBp = Math.round(((externalMinor - approvedMinor) * 10_000) / approvedMinor);
  const conflict = Math.abs(deltaBp) > toleranceBp;
  return { usedMinor: conflict ? externalMinor : approvedMinor, source: conflict ? 'ADAPTER' : 'APPROVED', deltaBp, conflict, note: conflict ? 'ADAPTER_WINS' : 'WITHIN_TOLERANCE' };
}
