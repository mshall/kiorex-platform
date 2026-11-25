"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxWindowMs = exports.FirstTouchNotForCommissionError = exports.PROVIDER_OWNED_KINDS = void 0;
exports.decide = decide;
const contracts_1 = require("@kiorex/contracts");
exports.PROVIDER_OWNED_KINDS = ['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET'];
const DAY_MS = 86_400_000;
class FirstTouchNotForCommissionError extends Error {
    constructor() { super('FIRST_TOUCH precedence is reporting only and cannot decide a commission origin'); this.name = 'FirstTouchNotForCommissionError'; }
}
exports.FirstTouchNotForCommissionError = FirstTouchNotForCommissionError;
const ms = (iso) => Date.parse(iso);
const cmp = (a, b) => { const d = ms(a.occurredAt) - ms(b.occurredAt); return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
const latest = (ts) => ts.reduce((best, t) => {
    if (!best)
        return t;
    const d = ms(t.occurredAt) - ms(best.occurredAt);
    return d > 0 || (d === 0 && t.id < best.id) ? t : best;
}, null);
function classify(t, b, p) {
    if (exports.PROVIDER_OWNED_KINDS.includes(t.kind))
        return t.providerOrgRef && t.providerOrgRef === b.orgId ? 'PROVIDER' : 'IGNORED';
    if (t.kind === 'OFFLINE')
        return p.allowOfflineEvidence && t.providerOrgRef === b.orgId ? 'PROVIDER' : 'IGNORED';
    if (t.kind === 'REFERRAL')
        return 'REFERRAL';
    if (t.kind === 'CAMPAIGN')
        return 'CAMPAIGN';
    if (t.kind === 'DIRECT')
        return 'DIRECT';
    return 'MARKETPLACE';
}
const windowMs = (c, p) => {
    switch (c) {
        case 'REFERRAL': return p.patientReferralWindowDays * DAY_MS;
        case 'CAMPAIGN': return p.campaignClickWindowDays * DAY_MS;
        default: return p.providerTouchWindowDays * DAY_MS;
    }
};
const maxWindowMs = (p) => Math.max(p.providerTouchWindowDays, p.patientReferralWindowDays, p.campaignClickWindowDays) * DAY_MS;
exports.maxWindowMs = maxWindowMs;
function decide(booking, touches, policy) {
    if (policy.precedence === 'FIRST_TOUCH')
        throw new FirstTouchNotForCommissionError();
    const at = ms(booking.createdAt);
    if (!Number.isFinite(at))
        throw new TypeError('booking.createdAt must be an ISO timestamp');
    const seen = new Set();
    const considered = touches
        .filter((t) => Number.isFinite(ms(t.occurredAt)) && ms(t.occurredAt) < at && at - ms(t.occurredAt) <= (0, exports.maxWindowMs)(policy) && !seen.has(t.id) && !!seen.add(t.id))
        .sort(cmp);
    const inWindow = (t) => at - ms(t.occurredAt) <= windowMs(classify(t, booking, policy), policy);
    const rendered = (t) => t.kind === 'OFFLINE' || (typeof t.dwellMs === 'number' && t.dwellMs >= policy.minDwellMsForProviderTouch);
    const eligible = considered.filter((t) => { const c = classify(t, booking, policy); return c !== 'IGNORED' && inWindow(t) && (c !== 'PROVIDER' || rendered(t)); });
    const byCls = (c) => eligible.filter((t) => classify(t, booking, policy) === c);
    const nonDirect = eligible.filter((t) => classify(t, booking, policy) !== 'DIRECT');
    const pointers = { firstTouchId: eligible[0]?.id ?? null, lastTouchId: eligible[eligible.length - 1]?.id ?? null, lastNonDirectTouchId: latest(nonDirect)?.id ?? null };
    const providerTouch = latest(byCls('PROVIDER'));
    const hasLt = booking.ltValidForOrg === true;
    const inputsHash = (0, contracts_1.computeAttributionInputsHash)({
        booking: { id: booking.id, orgId: booking.orgId, ...(booking.clinicId ? { clinicId: booking.clinicId } : {}), ...(booking.doctorId ? { doctorId: booking.doctorId } : {}), createdAt: booking.createdAt, channel: booking.channel, hasValidLt: hasLt },
        touches: considered.map((t) => ({ id: t.id, occurredAt: t.occurredAt })),
        policyVersion: policy.versionId,
        precedence: policy.precedence,
    });
    const done = (origin, reasonCode, winning) => ({
        origin, reasonCode, winningTouchId: winning?.id ?? null, consideredTouchIds: considered.map((t) => t.id), ...pointers, inputsHash, precedence: policy.precedence,
    });
    if (booking.channel === 'CLINIC_LINK' || hasLt)
        return done('PROVIDER_LED', 'EXPLICIT_PROVIDER_CHANNEL', providerTouch);
    if (providerTouch) {
        if (policy.precedence === 'PROVIDER_FIRST')
            return done('PROVIDER_LED', 'PRIOR_PROVIDER_TOUCH', providerTouch);
        const lastNd = latest(nonDirect);
        if (lastNd && classify(lastNd, booking, policy) === 'PROVIDER')
            return done('PROVIDER_LED', 'PRIOR_PROVIDER_TOUCH', lastNd);
    }
    const referral = latest(byCls('REFERRAL'));
    if (referral)
        return done('MARKETPLACE', 'PATIENT_REFERRAL', referral);
    const marketplace = latest(eligible.filter((t) => classify(t, booking, policy) !== 'PROVIDER'));
    if (marketplace)
        return done('MARKETPLACE', 'MARKETPLACE_TOUCH', marketplace);
    return done('UNATTRIBUTED', 'NO_PROVIDER_EVIDENCE', null);
}
//# sourceMappingURL=decide.js.map