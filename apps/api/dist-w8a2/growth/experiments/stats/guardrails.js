"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateGuardrail = evaluateGuardrail;
const msprt_1 = require("./msprt");
function evaluateGuardrail(g, alpha, minEvents) {
    const last = g.history[g.history.length - 1];
    if (!last || last.t.n <= 0 || last.c.n <= 0)
        return { metric: g.metric, breach: false, pAlwaysValid: 1, observedDiff: 0, treatmentEvents: last?.t.x ?? 0 };
    const series = (0, msprt_1.msprtSeries)(g.history, undefined, g.marginAbs);
    const p = series[series.length - 1];
    const diff = last.t.x / last.t.n - last.c.x / last.c.n;
    return { metric: g.metric, breach: p < alpha && diff > g.marginAbs && last.t.x >= minEvents, pAlwaysValid: p, observedDiff: diff, treatmentEvents: last.t.x };
}
//# sourceMappingURL=guardrails.js.map