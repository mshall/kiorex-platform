"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateExperiment = evaluateExperiment;
const experiment_types_1 = require("../experiment.types");
const fixed_horizon_1 = require("./fixed-horizon");
const guardrails_1 = require("./guardrails");
const msprt_1 = require("./msprt");
const srm_1 = require("./srm");
const daysBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 86_400_000);
function evaluateExperiment(i) {
    const minDays = i.minRunDays ?? experiment_types_1.EXPERIMENT_POLICY.minRunDays;
    const alpha = i.alphaBp / 10_000;
    const dayNumber = Math.max(0, daysBetween(i.startedAt, i.now) + 1);
    const control = i.variants[0].key;
    const total = (v, f) => i.rows.filter((r) => r.variant === v).reduce((a, r) => a + f(r), 0);
    const arms = i.variants.map((v) => { const n = total(v.key, (r) => r.exposures), x = total(v.key, (r) => r.conversions); return { variant: v.key, n, x, rate: n ? x / n : 0 }; });
    const weights = i.variants.map((v) => v.weightBp);
    const s = (0, srm_1.srm)(arms.map((a) => a.n), weights, i.srmAlpha ?? experiment_types_1.EXPERIMENT_POLICY.srmAlpha);
    const base = { dayNumber, srm: s, arms, treatments: [], guardrails: [], winner: null, blockers: [] };
    if (s.detected)
        return { ...base, verdict: 'SRM_DETECTED', hidden: true, stopReason: 'SRM', blockers: ['SRM'] };
    const days = [...new Set(i.rows.map((r) => r.day))].sort();
    const cum = (variant, upTo, f) => i.rows.filter((r) => r.variant === variant && r.day <= upTo).reduce((a, r) => a + f(r), 0);
    const gv = [];
    for (const g of i.guardrails)
        for (const t of i.variants.slice(1)) {
            const history = days.map((d) => ({ t: { n: cum(t.key, d, (r) => r.exposures), x: cum(t.key, d, (r) => r.guardrails[g.metric] ?? 0) }, c: { n: cum(control, d, (r) => r.exposures), x: cum(control, d, (r) => r.guardrails[g.metric] ?? 0) } }));
            gv.push({ ...(0, guardrails_1.evaluateGuardrail)({ metric: `${g.metric}:${t.key}`, marginAbs: g.marginAbs, history }, alpha, i.guardrailMinEvents ?? experiment_types_1.EXPERIMENT_POLICY.guardrailMinEvents) });
        }
    base.guardrails = gv;
    const breach = gv.find((g) => g.breach);
    if (breach)
        return { ...base, verdict: 'GUARDRAIL_BREACH', hidden: false, stopReason: 'GUARDRAIL', blockers: [`GUARDRAIL:${breach.metric}`] };
    const c = arms[0];
    const k = Math.max(1, i.variants.length - 1);
    const raw = arms.slice(1).map((a) => (a.n > 0 && c.n > 0 ? (0, fixed_horizon_1.twoProportion)({ n: a.n, x: a.x }, { n: c.n, x: c.x }) : null));
    const adj = (0, fixed_horizon_1.holm)(raw.map((r) => r?.pValue ?? 1));
    const treatments = arms.slice(1).map((a, idx) => {
        const r = raw[idx];
        const pav = a.n > 0 && c.n > 0 ? ((0, msprt_1.msprtSeries)(days.map((d) => ({ t: { n: cum(a.variant, d, (x) => x.exposures), x: cum(a.variant, d, (x) => x.conversions) }, c: { n: cum(control, d, (x) => x.exposures), x: cum(control, d, (x) => x.conversions) } }))).at(-1) ?? 1) : 1;
        const significant = i.mode === 'FIXED' ? adj[idx] < alpha : pav < alpha / k;
        const diff = r?.diff ?? 0;
        return { variant: a.variant, diff, relativeLift: r?.relativeLift ?? null, ci: r?.ci ?? { low: 0, high: 0 }, pValue: r?.pValue ?? 1, pAdjusted: adj[idx], pAlwaysValid: i.mode === 'SEQUENTIAL' ? pav : null, significant, direction: diff > 0 ? 'UP' : diff < 0 ? 'DOWN' : 'FLAT' };
    });
    base.treatments = treatments;
    const blockers = [];
    if (dayNumber < minDays)
        blockers.push('MIN_DAYS');
    if (arms.some((a) => a.n < i.minSample))
        blockers.push('MIN_SAMPLE');
    if (i.mode === 'FIXED' && dayNumber < i.plannedDays)
        blockers.push('FIXED_HORIZON_NOT_REACHED');
    base.blockers = blockers;
    const endLate = dayNumber > i.plannedDays * experiment_types_1.EXPERIMENT_POLICY.maxRunFactor && arms.some((a) => a.n < i.minSample);
    if (endLate)
        return { ...base, verdict: 'INCONCLUSIVE', hidden: false, stopReason: 'END_DATE_INSUFFICIENT_SAMPLE' };
    if (blockers.length)
        return { ...base, verdict: 'COLLECTING', hidden: true };
    const best = treatments.filter((t) => t.significant && t.direction === 'UP').sort((a, b) => b.diff - a.diff)[0];
    if (best)
        return { ...base, verdict: 'WINNER', hidden: false, winner: best.variant };
    return { ...base, verdict: 'NO_WINNER', hidden: false };
}
//# sourceMappingURL=evaluate.js.map