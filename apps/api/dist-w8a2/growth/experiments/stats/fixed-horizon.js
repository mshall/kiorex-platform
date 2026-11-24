"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wilson = wilson;
exports.newcombeDiff = newcombeDiff;
exports.twoProportion = twoProportion;
exports.holm = holm;
const normal_1 = require("./normal");
function wilson(x, n, confidence = 0.95) {
    if (n <= 0)
        return { low: 0, high: 1 };
    const z = (0, normal_1.normInv)(1 - (1 - confidence) / 2);
    const p = x / n;
    const z2 = z * z;
    const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}
function newcombeDiff(t, c, confidence = 0.95) {
    const pt = t.x / t.n, pc = c.x / c.n;
    const wt = wilson(t.x, t.n, confidence), wc = wilson(c.x, c.n, confidence);
    return { low: pt - pc - Math.sqrt((pt - wt.low) ** 2 + (wc.high - pc) ** 2), high: pt - pc + Math.sqrt((wt.high - pt) ** 2 + (pc - wc.low) ** 2) };
}
function twoProportion(t, c, confidence = 0.95) {
    if (t.n <= 0 || c.n <= 0)
        throw new RangeError('both arms need at least one unit');
    const pt = t.x / t.n, pc = c.x / c.n;
    const pool = (t.x + c.x) / (t.n + c.n);
    const se = Math.sqrt(pool * (1 - pool) * (1 / t.n + 1 / c.n));
    const z = se === 0 ? 0 : (pt - pc) / se;
    return { pControl: pc, pTreatment: pt, diff: pt - pc, relativeLift: pc > 0 ? (pt - pc) / pc : null, z, pValue: Math.min(1, 2 * (0, normal_1.normSf)(Math.abs(z))), ci: newcombeDiff(t, c, confidence), wilsonControl: wilson(c.x, c.n, confidence), wilsonTreatment: wilson(t.x, t.n, confidence) };
}
function holm(p) {
    const idx = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array(p.length);
    let run = 0;
    idx.forEach((e, k) => { run = Math.max(run, Math.min(1, (p.length - k) * e.v)); out[e.i] = run; });
    return out;
}
//# sourceMappingURL=fixed-horizon.js.map