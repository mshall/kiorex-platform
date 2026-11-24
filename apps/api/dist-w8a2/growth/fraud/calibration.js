"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.precisionOf = exports.MIN_LABELLED = void 0;
exports.shadowReport = shadowReport;
exports.proposeWeights = proposeWeights;
exports.fairnessRows = fairnessRows;
const signals_1 = require("./signals");
exports.MIN_LABELLED = 20;
const precisionOf = (s) => (s.confirmed + s.dismissed === 0 ? null : s.confirmed / (s.confirmed + s.dismissed));
exports.precisionOf = precisionOf;
function shadowReport(cfg, stats) {
    return signals_1.FRAUD_RULE_IDS.map((id) => {
        const s = stats[id] ?? { flagged: 0, confirmed: 0, dismissed: 0 };
        const labelled = s.confirmed + s.dismissed;
        return { ruleId: id, flagged: s.flagged, labelled, confirmed: s.confirmed, dismissed: s.dismissed, precision: labelled >= exports.MIN_LABELLED ? Math.round((s.confirmed / labelled) * 1000) / 1000 : null, pending: Math.max(0, s.flagged - labelled), weight: cfg.rules[id].weight, enforce: cfg.rules[id].enforce };
    });
}
function proposeWeights(cfg, stats, minLabelled = exports.MIN_LABELLED) {
    const changes = [];
    for (const id of signals_1.FRAUD_RULE_IDS) {
        const s = stats[id];
        if (!s)
            continue;
        const labelled = s.confirmed + s.dismissed;
        const p = (0, exports.precisionOf)(s);
        if (p === null || labelled < minLabelled)
            continue;
        const factor = p >= 0.9 ? 1.1 : p >= 0.7 ? 1 : p >= 0.5 ? 0.9 : 0.75;
        const from = cfg.rules[id].weight;
        const to = Math.min(100, Math.max(0, Math.round(from * factor)));
        if (to !== from)
            changes.push({ ruleId: id, from, to, precision: Math.round(p * 1000) / 1000, labelled });
    }
    return { changes, payload: { rules: Object.fromEntries(changes.map((c) => [c.ruleId, { weight: c.to }])) } };
}
function fairnessRows(groups, o = {}) {
    const k = o.k ?? 10;
    const ratio = o.ratio ?? 2;
    const visible = groups.filter((g) => g.total >= k);
    const rates = visible.map((g) => g.held / g.total);
    const lowest = rates.length ? Math.min(...rates.filter((r) => r > 0), ...(rates.every((r) => r === 0) ? [0] : [])) : 0;
    return groups.map((g) => {
        if (g.total < k)
            return { group: g.group, total: '<10', held: '<10', rate: null, flagged: false };
        const r = g.held / g.total;
        return { group: g.group, total: g.total, held: g.held < k && g.held > 0 ? '<10' : g.held, rate: Math.round(r * 1000) / 1000, flagged: visible.length >= 2 && lowest > 0 && r >= lowest * ratio };
    });
}
//# sourceMappingURL=calibration.js.map