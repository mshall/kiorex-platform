"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysNeeded = void 0;
exports.sampleSizePerArm = sampleSizePerArm;
const normal_1 = require("./normal");
function sampleSizePerArm(o) {
    const alpha = o.alpha ?? 0.05, power = o.power ?? 0.8;
    const p1 = o.baseline, p2 = o.baseline + o.mde;
    if (!(p1 > 0 && p1 < 1) || !(p2 > 0 && p2 < 1) || o.mde === 0)
        throw new RangeError('baseline and baseline + mde must be in (0,1) and mde must not be 0');
    const pbar = (p1 + p2) / 2;
    const a = (0, normal_1.normInv)(1 - alpha / 2) * Math.sqrt(2 * pbar * (1 - pbar));
    const b = (0, normal_1.normInv)(power) * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return Math.ceil((a + b) ** 2 / (p2 - p1) ** 2);
}
const daysNeeded = (perArm, variants, dailyExposures) => (dailyExposures <= 0 ? Infinity : Math.ceil((perArm * variants) / dailyExposures));
exports.daysNeeded = daysNeeded;
//# sourceMappingURL=power.js.map