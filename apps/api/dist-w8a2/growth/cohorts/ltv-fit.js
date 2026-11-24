"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitLtv = fitLtv;
const bootstrap_1 = require("./bootstrap");
const ltv_model_1 = require("./ltv.model");
function fitLtv(patients, policy, key) {
    const n = patients.length;
    if (n < policy.minCohortPatients)
        return null;
    const seed = (0, bootstrap_1.hashSeed)(policy.seed, key);
    const rnd = (0, bootstrap_1.mulberry32)(seed);
    const point = (0, ltv_model_1.projectCurve)((0, ltv_model_1.monthMeans)(patients, policy.minPatientsPerObservedMonth, policy.horizonMonths), policy);
    if (point.note === 'NOT_ENOUGH_DATA')
        return null;
    const base = patients.length > policy.maxBootstrapPatients ? (0, bootstrap_1.subsample)(patients, policy.maxBootstrapPatients, rnd) : patients;
    const m = base.length;
    const H = policy.horizonMonths;
    const estimates = [];
    const sums = new Float64Array(H);
    const counts = new Int32Array(H);
    for (let b = 0; b < policy.bootstrapResamples; b++) {
        sums.fill(0);
        counts.fill(0);
        for (let i = 0; i < m; i++) {
            const p = base[Math.floor(rnd() * m)];
            const last = Math.min(p.age, H - 1);
            for (let k = 0; k <= last; k++) {
                sums[k] += p.contrib[k] ?? 0;
                counts[k]++;
            }
        }
        let last = -1;
        const means = [];
        for (let k = 0; k < H; k++) {
            if (counts[k] < policy.minPatientsPerObservedMonth)
                break;
            means.push(sums[k] / counts[k]);
            last = k;
        }
        const c = (0, ltv_model_1.projectCurve)({ means, counts: [], lastObserved: last }, policy);
        estimates.push(c.cumulative[H - 1] ?? 0);
    }
    estimates.sort((a, b) => a - b);
    const tail = (1 - policy.intervalPercent / 100) / 2;
    const est = point.cumulative[H - 1] ?? 0;
    const low = Math.min((0, bootstrap_1.percentile)(estimates, tail), est);
    const high = Math.max((0, bootstrap_1.percentile)(estimates, 1 - tail), est);
    return { n, horizonMonths: H, estimateMinor: Math.round(est), lowMinor: Math.round(Math.max(0, low)), highMinor: Math.round(high), observedMonths: point.observedMonths, projectedMonths: point.projectedMonths, decay: point.decay, note: point.note, cumulative: point.cumulative.map(Math.round), resamples: policy.bootstrapResamples, subsampled: patients.length > policy.maxBootstrapPatients, seed };
}
//# sourceMappingURL=ltv-fit.js.map