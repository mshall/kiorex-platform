"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOODWILL_REASONS = void 0;
exports.checkGoodwill = checkGoodwill;
exports.GOODWILL_REASONS = ['PROVIDER_LATE_CANCEL', 'LONG_WAIT', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED'];
function checkGoodwill(rules, r, f) {
    if (f.actorIsTarget)
        return { ok: false, code: 'SELF_GRANT' };
    if (!exports.GOODWILL_REASONS.includes(r.reason) || !rules.reasons.includes(r.reason))
        return { ok: false, code: 'REASON_NOT_ALLOWED' };
    if (!r.bookingId && !r.ticketRef)
        return { ok: false, code: 'REFERENCE_REQUIRED' };
    if (!Number.isInteger(r.amountMinor) || r.amountMinor <= 0)
        return { ok: false, code: 'AMOUNT_INVALID' };
    if (r.amountMinor > rules.perReasonMaxMinor)
        return { ok: false, code: 'REASON_MAX_EXCEEDED' };
    if (f.actorGrantedTodayMinor + r.amountMinor > rules.perAgentDailyCapMinor)
        return { ok: false, code: 'AGENT_DAILY_CAP' };
    if (f.patientGranted90dMinor + r.amountMinor > rules.perPatient90dCapMinor)
        return { ok: false, code: 'PATIENT_90D_CAP' };
    return { ok: true, needsSecondApprover: r.amountMinor > rules.approvalAboveMinor };
}
//# sourceMappingURL=goodwill-limits.js.map