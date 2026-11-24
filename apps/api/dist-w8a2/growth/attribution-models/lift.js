"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalCdf = exports.K_MIN_LIFT = void 0;
exports.liftOf = liftOf;
exports.K_MIN_LIFT = 10;
const normalCdf = (z) => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2); return 0.5 * (1 + (z < 0 ? -y : y)); };
exports.normalCdf = normalCdf;
function liftOf(holdout, exposed, alpha = 0.05) {
    if (holdout.exposures <= 0 || exposed.exposures <= 0)
        return { suppressed: true, reason: 'NO_DATA' };
    if (holdout.exposures < exports.K_MIN_LIFT || exposed.exposures < exports.K_MIN_LIFT)
        return { suppressed: true, reason: 'K_FLOOR' };
    const p1 = holdout.conversions / holdout.exposures;
    const p2 = exposed.conversions / exposed.exposures;
    const pooled = (holdout.conversions + exposed.conversions) / (holdout.exposures + exposed.exposures);
    const se0 = Math.sqrt(pooled * (1 - pooled) * (1 / holdout.exposures + 1 / exposed.exposures));
    const z = se0 === 0 ? 0 : (p2 - p1) / se0;
    const pValue = 2 * (1 - (0, exports.normalCdf)(Math.abs(z)));
    const se1 = Math.sqrt((p1 * (1 - p1)) / holdout.exposures + (p2 * (1 - p2)) / exposed.exposures);
    const zc = 1.959964;
    const d = p2 - p1;
    const r = (x) => Math.round(x * 1e4) / 1e4;
    return { label: 'experiment-based lift', holdout: { ...holdout, rate: r(p1) }, exposed: { ...exposed, rate: r(p2) }, absoluteLiftPp: r(d * 100), relativeLiftPct: p1 > 0 ? r((d / p1) * 100) : null, ciLowPp: r((d - zc * se1) * 100), ciHighPp: r((d + zc * se1) * 100), z: r(z), pValue: r(pValue), significant: pValue < alpha, alpha };
}
//# sourceMappingURL=lift.js.map