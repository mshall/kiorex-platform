"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rLtReplay = void 0;
const signals_1 = require("../signals");
exports.rLtReplay = {
    id: 'r_lt_replay', kind: 'TOUCH', surfaces: ['TOUCH', 'REFERRAL_CLAIM'],
    evaluate(f, t) {
        if (f.ltSignatureInvalid)
            return { strength: 1, reason: 'link token signature does not verify', evidence: ['lt-signature-invalid'] };
        const ev = [];
        let s = 0;
        if ((f.ltDistinctSubjects ?? 0) >= t.ltDistinctSubjectsLimit) {
            s = Math.max(s, 0.85);
            ev.push('lt-many-subjects');
        }
        if ((f.ltUseCount ?? 0) > t.ltUseCountLimit) {
            s = Math.max(s, 0.6 + Math.min(0.2, ((f.ltUseCount ?? 0) - t.ltUseCountLimit) * 0.02));
            ev.push('lt-replayed');
        }
        if (f.ltUsedAfterExpiry) {
            s = Math.max(s, 0.7);
            ev.push('lt-after-expiry');
        }
        return s > 0 ? { strength: (0, signals_1.clamp01)(s + 0.05 * (ev.length - 1)), reason: 'link token replay or forgery pattern', evidence: ev } : null;
    },
};
//# sourceMappingURL=r_lt_replay.js.map