/**
 * GRW-P2-S quote arithmetic (PURE): the Kiorex side of "find the single best eligible active promotion and show the sponsored line". Money in minor units.
 * The Clinic re-checks everything at reserve and at booking (it is the system of record of the budget and the wallet); this only decides what to OFFER and display.
 */
export type CareType = 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT';
export interface PromoFacts {
  status: string; startsAt: Date | null; endsAt: Date | null; budgetCapMinor: number;
  scope: { doctorIds?: string[]; appointmentTypeIds?: string[]; careTypes?: string[] };
  discount: { kind?: 'FIXED_MINOR' | 'PERCENT_BP'; value?: number; maxPerBookingMinor?: number | null };
  eligibility: { newPatientsOnly?: boolean; firstBookingOnly?: boolean; minLeadHours?: number; kiorexOnly?: boolean };
}
export interface QuoteFacts { doctorId: string; appointmentTypeId: string; careType: CareType; startsAt: Date; visitFeeMinor: number; isNewToClinic: boolean; kiorexBookingsBefore: number; channelIsKiorex: boolean }

/** FIXED: value; PERCENT_BP: floor(fee * bp / 10000); capped by the per-booking maximum and by the visit fee (a discount never exceeds the fee it discounts). */
export function discountMinor(d: PromoFacts['discount'], visitFeeMinor: number): number {
  if (!Number.isInteger(visitFeeMinor) || visitFeeMinor <= 0 || !d.kind || !Number.isInteger(d.value) || (d.value as number) <= 0) return 0;
  let v = d.kind === 'FIXED_MINOR' ? (d.value as number) : Math.floor((visitFeeMinor * (d.value as number)) / 10_000);
  if (d.maxPerBookingMinor != null) v = Math.min(v, d.maxPerBookingMinor);
  return Math.max(0, Math.min(v, visitFeeMinor));
}

export type Ineligible = 'NOT_ACTIVE' | 'OUTSIDE_WINDOW' | 'DOCTOR' | 'TYPE' | 'CARE_TYPE' | 'NOT_KIOREX' | 'NOT_NEW_TO_CLINIC' | 'NOT_FIRST_BOOKING' | 'LEAD_TIME' | 'NO_FEE';
export function eligibility(p: PromoFacts, f: QuoteFacts, now: Date): { ok: true; amountMinor: number } | { ok: false; reason: Ineligible } {
  if (p.status !== 'ACTIVE') return { ok: false, reason: 'NOT_ACTIVE' };
  if (!p.startsAt || !p.endsAt || now < p.startsAt || now >= p.endsAt) return { ok: false, reason: 'OUTSIDE_WINDOW' };
  const s = p.scope; const e = p.eligibility;
  if (s.doctorIds?.length && !s.doctorIds.includes(f.doctorId)) return { ok: false, reason: 'DOCTOR' };
  if (s.appointmentTypeIds?.length && !s.appointmentTypeIds.includes(f.appointmentTypeId)) return { ok: false, reason: 'TYPE' };
  if (!s.careTypes?.includes(f.careType)) return { ok: false, reason: 'CARE_TYPE' };
  if (e.kiorexOnly !== false && !f.channelIsKiorex) return { ok: false, reason: 'NOT_KIOREX' };
  if (e.newPatientsOnly && !f.isNewToClinic) return { ok: false, reason: 'NOT_NEW_TO_CLINIC' };
  if (e.firstBookingOnly && f.kiorexBookingsBefore > 0) return { ok: false, reason: 'NOT_FIRST_BOOKING' };
  if (f.startsAt.getTime() - now.getTime() < (e.minLeadHours ?? 0) * 3_600_000) return { ok: false, reason: 'LEAD_TIME' };
  const amountMinor = discountMinor(p.discount, f.visitFeeMinor);
  return amountMinor > 0 ? { ok: true, amountMinor } : { ok: false, reason: 'NO_FEE' };
}

/** One sponsored promotion per booking (no stacking): the one with the largest discount; ties go to the earlier end (it is about to lapse), then the lower id. */
export function bestOffer<T extends { id: string; promo: PromoFacts }>(cands: readonly T[], f: QuoteFacts, now: Date): { cand: T; amountMinor: number } | null {
  let best: { cand: T; amountMinor: number } | null = null;
  for (const c of cands) {
    const r = eligibility(c.promo, f, now); if (!r.ok) continue;
    const better = !best || r.amountMinor > best.amountMinor || (r.amountMinor === best.amountMinor && ((c.promo.endsAt!.getTime() < best.cand.promo.endsAt!.getTime()) || (c.promo.endsAt!.getTime() === best.cand.promo.endsAt!.getTime() && c.id < best.cand.id)));
    if (better) best = { cand: c, amountMinor: r.amountMinor };
  }
  return best;
}

/** The thresholds that decide whether a version needs a second approver (SPONSORED_PROMOTION_POLICY). */
export function highValueReasons(p: { budgetCapMinor: number; discount: PromoFacts['discount'] }, policy: { highValueBudgetMinor: number; highValuePerBookingMinor: number; maxDiscountBp: number }): string[] {
  const r: string[] = [];
  if (p.budgetCapMinor >= policy.highValueBudgetMinor) r.push('BUDGET_AT_OR_ABOVE_THRESHOLD');
  const per = p.discount.kind === 'FIXED_MINOR' ? Math.min(p.discount.value ?? 0, p.discount.maxPerBookingMinor ?? Infinity) : (p.discount.maxPerBookingMinor ?? Infinity);
  if (per >= policy.highValuePerBookingMinor) r.push('PER_BOOKING_AT_OR_ABOVE_THRESHOLD');
  if (p.discount.kind === 'PERCENT_BP' && (p.discount.value ?? 0) > policy.maxDiscountBp) r.push('PERCENT_ABOVE_MAXIMUM');
  return r;
}

/** Review outcome of a version's review rows. APPROVED needs every required kind approved by people who are not the requester, and a HIGH_VALUE approver different from the CONTENT and SCOPE approvers. */
export function reviewOutcome(required: readonly string[], rows: ReadonlyArray<{ kind: string; requestedBy: string; decidedBy: string | null; decision: string | null }>): 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES' | 'PENDING' | 'INVALID' {
  const by = new Map(rows.map((r) => [r.kind, r]));
  if (rows.some((r) => r.decision === 'REJECTED')) return 'REJECTED';
  if (rows.some((r) => r.decision === 'NEEDS_CHANGES')) return 'NEEDS_CHANGES';
  if (required.some((k) => !by.get(k)?.decision)) return 'PENDING';
  if (rows.some((r) => r.decidedBy && r.decidedBy === r.requestedBy)) return 'INVALID';
  const hv = by.get('HIGH_VALUE');
  if (hv && rows.some((r) => r.kind !== 'HIGH_VALUE' && r.decidedBy && r.decidedBy === hv.decidedBy)) return 'INVALID';
  return 'APPROVED';
}

/** Payout gate predicate (for Kiorex Pay): the sponsored part of a deposit payout may be released to the clinic only after the Clinic has written the DEBIT (state DEBITED). A booking without a sponsored line is never held. */
export function sponsoredPayoutHoldMinor(line: { state: string; amountMinor: number } | null): number {
  if (!line) return 0;
  return line.state === 'DEBITED' ? 0 : line.state === 'RELEASED' || line.state === 'REVERSED' ? 0 : line.amountMinor;
}

/** Patient-facing label: always "sponsored by <clinic>", never a Kiorex discount; AR and EN. */
export function sponsoredLabel(clinicName: { ar: string; en: string }, endsAt: Date, copy: { ar: string; en: string }) {
  const d = endsAt.toISOString().slice(0, 10);
  return { ar: `خصم برعاية ${clinicName.ar} حتى ${d}`, en: `Discount sponsored by ${clinicName.en} until ${d}`, copy };
}
