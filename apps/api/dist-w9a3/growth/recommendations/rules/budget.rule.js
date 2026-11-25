"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.budgetRule = budgetRule;
const recommendation_types_1 = require("../recommendation.types");
const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));
const usable = (c) => c.attendedNew >= recommendation_types_1.RECOMMENDATION_POLICY.k && c.spendMinor >= recommendation_types_1.RECOMMENDATION_POLICY.spendFloorMinor && c.cacMinor !== null && c.cacMinor > 0;
function budgetRule(i) {
    const rows = i.channels.filter(usable);
    if (rows.length < 2)
        return [];
    const withLtv = rows.every((r) => r.ltvMinor !== null && r.ltvMinor > 0);
    const score = (r) => (withLtv ? r.ltvMinor / r.cacMinor : 1 / r.cacMinor);
    const sorted = [...rows].sort((a, b) => score(b) - score(a) || (a.channel < b.channel ? -1 : 1));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const ratioBp = Math.round((score(best) / score(worst)) * 10_000);
    if (ratioBp < recommendation_types_1.RECOMMENDATION_POLICY.minRatioBp)
        return [];
    const shiftBp = Math.min(recommendation_types_1.RECOMMENDATION_POLICY.maxShiftBp, Math.max(500, Math.round(((ratioBp - 10_000) / ratioBp) * recommendation_types_1.RECOMMENDATION_POLICY.maxShiftBp)));
    const shiftMinor = Math.floor((worst.spendMinor * shiftBp) / 10_000);
    const basis = withLtv ? 'LTV_CAC' : 'CAC';
    const confidence = Math.min(90, 40 + Math.min(30, Math.floor(Math.min(best.attendedNew, worst.attendedNew) / 5)) + (withLtv ? 20 : 0));
    return [{
            kind: 'REALLOCATE_BUDGET', fingerprint: `realloc:${worst.channel}>${best.channel}`,
            payload: { fromChannel: worst.channel, toChannel: best.channel, shiftBp, shiftMinor, basis, fromCacMinor: worst.cacMinor, toCacMinor: best.cacMinor, fromAttended: worst.attendedNew, toAttended: best.attendedNew, fromSpendMinor: worst.spendMinor, window: i.window },
            rationale: {
                en: `${best.channel} acquires new patients at ${pct(best.cacMinor, worst.cacMinor)}% of the cost of ${worst.channel} (cost per attended new patient ${best.cacMinor / 100} against ${worst.cacMinor / 100} EGP). Consider moving up to ${shiftBp / 100}% of ${worst.channel} spend to ${best.channel}.`,
                ar: `${best.channel} بتجيب مرضى جدد بتكلفة ${pct(best.cacMinor, worst.cacMinor)}% من تكلفة ${worst.channel} (تكلفة المريض الجديد اللي حضر ${best.cacMinor / 100} مقابل ${worst.cacMinor / 100} جنيه). فكّر تنقل لحد ${shiftBp / 100}% من إنفاق ${worst.channel} إلى ${best.channel}.`,
            },
            evidenceRefs: [{ source: 'channel-performance', ref: best.channel, window: `${i.window.from}..${i.window.to}` }, { source: 'channel-performance', ref: worst.channel, window: `${i.window.from}..${i.window.to}` }],
            confidence,
        }];
}
//# sourceMappingURL=budget.rule.js.map