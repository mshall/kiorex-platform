"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ltvPoint = void 0;
exports.monthMeans = monthMeans;
exports.projectCurve = projectCurve;
exports.paybackMonth = paybackMonth;
function monthMeans(patients, minPatients, horizon) {
    const sums = new Array(horizon).fill(0);
    const counts = new Array(horizon).fill(0);
    for (const p of patients) {
        const last = Math.min(p.age, horizon - 1);
        for (let m = 0; m <= last; m++) {
            sums[m] += p.contrib[m] ?? 0;
            counts[m]++;
        }
    }
    let lastObserved = -1;
    const means = [];
    for (let m = 0; m < horizon; m++) {
        if (counts[m] < minPatients)
            break;
        means.push(sums[m] / counts[m]);
        lastObserved = m;
    }
    return { means, counts: counts.slice(0, means.length), lastObserved };
}
function projectCurve(mm, policy) {
    const H = policy.horizonMonths;
    const L = mm.lastObserved;
    if (L < 0)
        return { perMonth: new Array(H).fill(0), cumulative: new Array(H).fill(0), observedMonths: 0, projectedMonths: H, decay: null, note: 'NOT_ENOUGH_DATA' };
    const perMonth = [];
    let decay = null;
    let note = L >= H - 1 ? 'OBSERVED' : 'PROJECTED';
    if (L < H - 1) {
        const w = Math.min(policy.tailFitWindowMonths, L);
        if (w >= 1 && mm.means[L - w] > 0)
            decay = Math.min(1, Math.max(0, (mm.means[L] / mm.means[L - w]) ** (1 / w)));
        else {
            decay = 0;
            note = 'NO_DECAY_INFO';
        }
    }
    const d = policy.discountRateBp / 10_000;
    for (let m = 0; m < H; m++) {
        const raw = m <= L ? mm.means[m] : Math.min(mm.means[L], mm.means[L] * (decay ?? 0) ** (m - L));
        perMonth.push((d > 0 ? raw / (1 + d) ** (m / 12) : raw));
    }
    let s = 0;
    const cumulative = perMonth.map((v) => (s += v));
    return { perMonth, cumulative, observedMonths: Math.min(L + 1, H), projectedMonths: Math.max(0, H - (L + 1)), decay, note };
}
const ltvPoint = (patients, policy) => projectCurve(monthMeans(patients, policy.minPatientsPerObservedMonth, policy.horizonMonths), policy);
exports.ltvPoint = ltvPoint;
function paybackMonth(cumulative, cacMinor) {
    if (!(cacMinor > 0))
        return null;
    const i = cumulative.findIndex((c) => c >= cacMinor);
    return i < 0 ? null : i;
}
//# sourceMappingURL=ltv.model.js.map