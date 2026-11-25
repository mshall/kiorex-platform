/**
 * How a deposit is split between the tenders (PAY-READY, KX-30 section 14, GRW-P4-C). Pure; integer minor units.
 *
 * Founder rule (H-27): a price reduction first, then the sponsor-funded benefits, then the patient's OWN money, and the card last:
 *   1. SPONSORED discount S  (provider-funded price reduction, taken off the price)
 *   2. CORPORATE benefit B   (employer-funded share of what is STILL payable after S; bounded by the account ceiling, the member cap and the cover share)
 *   3. patient CREDIT C      (the patient's own refund credit and promotional credit, on what is still payable after S and B)
 *   4. CARD K                (the rest, never less than one minor unit: a PSP never sees a zero charge)
 * Why this order: sponsor money has a ceiling and a cap, so it is used first and preserved for other bookings only by its cap, while the patient's own credit never pays for something an employer or provider would have paid.
 * Invariants (property-tested): S + B + C + K = price, every part >= 0, K >= 1, and each tender is bounded by what is left when it is applied.
 */
export interface DepositSplit { priceMinor: number; sponsoredMinor: number; corporateMinor: number; creditMinor: number; cardMinor: number }
export interface DepositLine { code: 'PRICE' | 'SPONSORED_DISCOUNT' | 'CORPORATE_BENEFIT' | 'PATIENT_CREDIT' | 'CARD'; amountMinor: number; labelKey: string }

export function splitDeposit(i: { priceMinor: number; sponsoredMinor?: number; corporateMinor?: number; creditMinor?: number; minCardMinor?: number }): DepositSplit {
  const vals = { priceMinor: i.priceMinor, sponsoredMinor: i.sponsoredMinor ?? 0, corporateMinor: i.corporateMinor ?? 0, creditMinor: i.creditMinor ?? 0 };
  for (const [k, v] of Object.entries(vals)) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${k} must be a non-negative integer`);
  const minCard = Math.max(i.minCardMinor ?? 1, 1);
  if (vals.priceMinor < minCard) throw new RangeError('priceMinor is below the minimum card amount');
  let room = vals.priceMinor - minCard;
  const sponsoredMinor = Math.min(vals.sponsoredMinor, room); room -= sponsoredMinor;
  const corporateMinor = Math.min(vals.corporateMinor, room); room -= corporateMinor;
  const creditMinor = Math.min(vals.creditMinor, room);
  return { priceMinor: vals.priceMinor, sponsoredMinor, corporateMinor, creditMinor, cardMinor: vals.priceMinor - sponsoredMinor - corporateMinor - creditMinor };
}

/** The ordered checkout lines of a split (every reduction shown, negative). Same codes and label keys as the rewards `composeCheckout` plus CORPORATE_BENEFIT (`checkout.corporate`). */
export function depositLines(d: Omit<DepositSplit, 'priceMinor'> & { priceMinor?: number }): DepositLine[] {
  const price = d.priceMinor ?? d.sponsoredMinor + d.corporateMinor + d.creditMinor + d.cardMinor;
  return [
    { code: 'PRICE', amountMinor: price, labelKey: 'checkout.price' },
    ...(d.sponsoredMinor > 0 ? [{ code: 'SPONSORED_DISCOUNT' as const, amountMinor: -d.sponsoredMinor, labelKey: 'checkout.sponsored' }] : []),
    ...(d.corporateMinor > 0 ? [{ code: 'CORPORATE_BENEFIT' as const, amountMinor: -d.corporateMinor, labelKey: 'checkout.corporate' }] : []),
    ...(d.creditMinor > 0 ? [{ code: 'PATIENT_CREDIT' as const, amountMinor: -d.creditMinor, labelKey: 'checkout.credit' }] : []),
    { code: 'CARD', amountMinor: d.cardMinor, labelKey: 'checkout.card' },
  ];
}
