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
