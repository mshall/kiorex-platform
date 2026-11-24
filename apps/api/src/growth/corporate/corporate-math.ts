/**
 * The size of one corporate benefit (GRW-P4-C). Pure. The benefit covers a share of the DEPOSIT Kiorex collects for a booking (never the visit fee, never anything the clinic is paid:
 * it reduces what the patient pays Kiorex, like every platform-funded line, so a provider's income never falls because of it). It is bounded by four things at once and by the deposit
 * itself, and the card always keeps at least one minor unit (the PSP never sees a zero charge). Any bound that is missing means 0: an account without terms funds nothing.
 */
export interface BenefitInput { depositMinor: number; coverBp: number | null; perVisitMaxMinor: number | null; memberRemainingMinor: number; accountRemainingMinor: number; minCardMinor?: number }

export function benefitFor(i: BenefitInput): number {
  const ints = [i.depositMinor, i.memberRemainingMinor, i.accountRemainingMinor];
  if (ints.some((v) => !Number.isInteger(v) || v < 0)) throw new RangeError('amounts must be non-negative integers');
  if (!i.coverBp || i.coverBp < 1 || i.coverBp > 10000) return 0;
  const room = Math.max(0, i.depositMinor - Math.max(i.minCardMinor ?? 1, 1));
  const byShare = Math.floor((i.depositMinor * i.coverBp) / 10000);
  const bounds = [room, byShare, i.memberRemainingMinor, i.accountRemainingMinor];
  if (i.perVisitMaxMinor !== null && i.perVisitMaxMinor !== undefined) bounds.push(Math.max(0, i.perVisitMaxMinor));
  return Math.max(0, Math.min(...bounds));
}
