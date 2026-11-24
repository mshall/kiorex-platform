/**
 * Refund allocation (GRW-P2-B2, KX-30 section 14). Pure; minor units; Math.round half up on every share, the residual goes to the card line so the parts always add up.
 *
 * A booking was paid as: price D = sponsored discount S (provider-funded, P2-S) + patient credit C + card K + held deposit H, so K + H = D - S - C.
 * With refundable amount R of the price, the ratio is r = R / D:
 *   patient-paid refundable  = round(r x (C + K + H))
 *   credit restored          = round(r x C)        (to the same lots while unexpired, otherwise to a new RESTORED lot: the ledger decides, this only counts)
 *   card refund              = patient-paid refundable - credit restored      (to the original method by default, or a REFUND_CREDIT lot when the patient chose it)
 *   sponsored voided         = round(r x S)        (never refunded to the patient as cash or credit)
 * RC-4 holds by construction: creditRestored + cardRefund = patientPaidRefundable.
 */
export interface RefundAllocationInput { priceMinor: number; sponsoredMinor: number; creditMinor: number; cardMinor: number; heldDepositMinor: number; refundableMinor: number }
export interface RefundAllocation { patientPaidRefundableMinor: number; creditRestoredMinor: number; cardRefundMinor: number; sponsoredVoidedMinor: number }

export function allocateRefund(i: RefundAllocationInput): RefundAllocation {
  for (const [k, v] of Object.entries(i)) if (!Number.isInteger(v) || v < 0) throw new RangeError(`${k} must be a non-negative integer`);
  if (i.priceMinor === 0) throw new RangeError('priceMinor must be positive');
  if (i.refundableMinor > i.priceMinor) throw new RangeError('refundableMinor exceeds the price');
  const r = i.refundableMinor / i.priceMinor;
  const paid = i.creditMinor + i.cardMinor + i.heldDepositMinor;
  const patientPaidRefundableMinor = Math.min(paid, Math.round(r * paid));
  const creditRestoredMinor = Math.min(i.creditMinor, patientPaidRefundableMinor, Math.round(r * i.creditMinor));
  return { patientPaidRefundableMinor, creditRestoredMinor, cardRefundMinor: patientPaidRefundableMinor - creditRestoredMinor, sponsoredVoidedMinor: Math.min(i.sponsoredMinor, Math.round(r * i.sponsoredMinor)) };
}

/**
 * GRW-P2-S: the sponsored share a refund voids, by the CARD fraction refunded (the same basis the credit restore uses): cumulative `round(S x cardRefundedAfter / card)`, exactly S once the whole card amount is
 * refunded, never less than what earlier refunds already voided. Returns the share voided by THIS refund. Pure, integer minor units. Agrees with `allocateRefund` (sponsoredVoidedMinor) for a single refund.
 */
export function sponsoredVoidedByRefund(i: { sponsoredMinor: number; cardMinor: number; cardRefundedAfterMinor: number; alreadyVoidedMinor: number }): number {
  for (const [k, v] of Object.entries(i)) if (!Number.isInteger(v) || v < 0) throw new RangeError(`${k} must be a non-negative integer`);
  if (i.sponsoredMinor === 0 || i.cardMinor === 0) return 0;
  const after = i.cardRefundedAfterMinor >= i.cardMinor ? i.sponsoredMinor : Math.min(i.sponsoredMinor, Math.round((i.sponsoredMinor * i.cardRefundedAfterMinor) / i.cardMinor));
  return Math.max(0, after - i.alreadyVoidedMinor);
}
