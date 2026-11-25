"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.srm = srm;
const normal_1 = require("./normal");
function srm(observed, weightsBp, alpha = 0.001) {
    if (observed.length !== weightsBp.length || observed.length < 2)
        throw new RangeError('observed and weights must have the same length (>= 2)');
    const total = observed.reduce((a, b) => a + b, 0);
    const wsum = weightsBp.reduce((a, b) => a + b, 0);
    if (total <= 0)
        return { chi2: 0, df: observed.length - 1, pValue: 1, detected: false };
    let chi2 = 0;
    observed.forEach((o, i) => { const e = (total * weightsBp[i]) / wsum; chi2 += (o - e) ** 2 / e; });
    const df = observed.length - 1;
    const pValue = (0, normal_1.chiSquareSf)(chi2, df);
    return { chi2, df, pValue, detected: pValue < alpha };
}
//# sourceMappingURL=srm.js.map