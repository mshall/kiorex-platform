"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffVariance = exports.MSPRT_TAU2_DEFAULT = void 0;
exports.msprtStep = msprtStep;
exports.msprtSeries = msprtSeries;
exports.MSPRT_TAU2_DEFAULT = 0.0004;
function msprtStep(prevP, o) {
    const tau2 = o.tau2 ?? exports.MSPRT_TAU2_DEFAULT;
    const V = o.variance;
    const th = o.theta - (o.theta0 ?? 0);
    if (!(V > 0))
        return { pAlwaysValid: prevP, lambda: 1 };
    const lambda = Math.sqrt(V / (V + tau2)) * Math.exp((tau2 * th * th) / (2 * V * (V + tau2)));
    return { pAlwaysValid: Math.min(prevP, Math.min(1, 1 / lambda)), lambda };
}
const diffVariance = (t, c) => {
    const pt = t.x / t.n, pc = c.x / c.n;
    return (pt * (1 - pt)) / t.n + (pc * (1 - pc)) / c.n;
};
exports.diffVariance = diffVariance;
function msprtSeries(history, tau2, theta0) {
    let p = 1;
    const out = [];
    for (const h of history) {
        if (h.t.n <= 0 || h.c.n <= 0) {
            out.push(p);
            continue;
        }
        const t = { n: h.t.n, x: h.t.x }, c = { n: h.c.n, x: h.c.x };
        const V = (0, exports.diffVariance)({ n: t.n + 2, x: t.x + 1 }, { n: c.n + 2, x: c.x + 1 });
        p = msprtStep(p, { theta: t.x / t.n - c.x / c.n, variance: V, tau2, theta0 }).pAlwaysValid;
        out.push(p);
    }
    return out;
}
//# sourceMappingURL=msprt.js.map