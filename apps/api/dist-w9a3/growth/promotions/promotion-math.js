"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discountMinor = discountMinor;
exports.eligibility = eligibility;
exports.bestOffer = bestOffer;
exports.highValueReasons = highValueReasons;
exports.reviewOutcome = reviewOutcome;
exports.sponsoredPayoutHoldMinor = sponsoredPayoutHoldMinor;
exports.sponsoredLabel = sponsoredLabel;
function discountMinor(d, visitFeeMinor) {
    if (!Number.isInteger(visitFeeMinor) || visitFeeMinor <= 0 || !d.kind || !Number.isInteger(d.value) || d.value <= 0)
        return 0;
    let v = d.kind === 'FIXED_MINOR' ? d.value : Math.floor((visitFeeMinor * d.value) / 10_000);
    if (d.maxPerBookingMinor != null)
        v = Math.min(v, d.maxPerBookingMinor);
    return Math.max(0, Math.min(v, visitFeeMinor));
}
function eligibility(p, f, now) {
    if (p.status !== 'ACTIVE')
        return { ok: false, reason: 'NOT_ACTIVE' };
    if (!p.startsAt || !p.endsAt || now < p.startsAt || now >= p.endsAt)
        return { ok: false, reason: 'OUTSIDE_WINDOW' };
    const s = p.scope;
    const e = p.eligibility;
    if (s.doctorIds?.length && !s.doctorIds.includes(f.doctorId))
        return { ok: false, reason: 'DOCTOR' };
    if (s.appointmentTypeIds?.length && !s.appointmentTypeIds.includes(f.appointmentTypeId))
        return { ok: false, reason: 'TYPE' };
    if (!s.careTypes?.includes(f.careType))
        return { ok: false, reason: 'CARE_TYPE' };
    if (e.kiorexOnly !== false && !f.channelIsKiorex)
        return { ok: false, reason: 'NOT_KIOREX' };
    if (e.newPatientsOnly && !f.isNewToClinic)
        return { ok: false, reason: 'NOT_NEW_TO_CLINIC' };
    if (e.firstBookingOnly && f.kiorexBookingsBefore > 0)
        return { ok: false, reason: 'NOT_FIRST_BOOKING' };
    if (f.startsAt.getTime() - now.getTime() < (e.minLeadHours ?? 0) * 3_600_000)
        return { ok: false, reason: 'LEAD_TIME' };
    const amountMinor = discountMinor(p.discount, f.visitFeeMinor);
    return amountMinor > 0 ? { ok: true, amountMinor } : { ok: false, reason: 'NO_FEE' };
}
function bestOffer(cands, f, now) {
    let best = null;
    for (const c of cands) {
        const r = eligibility(c.promo, f, now);
        if (!r.ok)
            continue;
        const better = !best || r.amountMinor > best.amountMinor || (r.amountMinor === best.amountMinor && ((c.promo.endsAt.getTime() < best.cand.promo.endsAt.getTime()) || (c.promo.endsAt.getTime() === best.cand.promo.endsAt.getTime() && c.id < best.cand.id)));
        if (better)
            best = { cand: c, amountMinor: r.amountMinor };
    }
    return best;
}
function highValueReasons(p, policy) {
    const r = [];
    if (p.budgetCapMinor >= policy.highValueBudgetMinor)
        r.push('BUDGET_AT_OR_ABOVE_THRESHOLD');
    const per = p.discount.kind === 'FIXED_MINOR' ? Math.min(p.discount.value ?? 0, p.discount.maxPerBookingMinor ?? Infinity) : (p.discount.maxPerBookingMinor ?? Infinity);
    if (per >= policy.highValuePerBookingMinor)
        r.push('PER_BOOKING_AT_OR_ABOVE_THRESHOLD');
    if (p.discount.kind === 'PERCENT_BP' && (p.discount.value ?? 0) > policy.maxDiscountBp)
        r.push('PERCENT_ABOVE_MAXIMUM');
    return r;
}
function reviewOutcome(required, rows) {
    const by = new Map(rows.map((r) => [r.kind, r]));
    if (rows.some((r) => r.decision === 'REJECTED'))
        return 'REJECTED';
    if (rows.some((r) => r.decision === 'NEEDS_CHANGES'))
        return 'NEEDS_CHANGES';
    if (required.some((k) => !by.get(k)?.decision))
        return 'PENDING';
    if (rows.some((r) => r.decidedBy && r.decidedBy === r.requestedBy))
        return 'INVALID';
    const hv = by.get('HIGH_VALUE');
    if (hv && rows.some((r) => r.kind !== 'HIGH_VALUE' && r.decidedBy && r.decidedBy === hv.decidedBy))
        return 'INVALID';
    return 'APPROVED';
}
function sponsoredPayoutHoldMinor(line) {
    if (!line)
        return 0;
    return line.state === 'DEBITED' ? 0 : line.state === 'RELEASED' || line.state === 'REVERSED' ? 0 : line.amountMinor;
}
function sponsoredLabel(clinicName, endsAt, copy) {
    const d = endsAt.toISOString().slice(0, 10);
    return { ar: `خصم برعاية ${clinicName.ar} حتى ${d}`, en: `Discount sponsored by ${clinicName.en} until ${d}`, copy };
}
//# sourceMappingURL=promotion-math.js.map