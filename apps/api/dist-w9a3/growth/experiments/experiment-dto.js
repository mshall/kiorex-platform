"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDraft = parseDraft;
exports.plannedSample = plannedSample;
const errors_1 = require("../../common/errors");
const assignment_1 = require("./assignment");
const eligibility_1 = require("./eligibility");
const experiment_types_1 = require("./experiment.types");
const power_1 = require("./stats/power");
const bad = (m) => new errors_1.ApiError(400, 'EXPERIMENT_INVALID', m);
const str = (v, max, what, min = 1) => { if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw bad(`${what} must be a string of ${min} to ${max} characters`); return v.trim(); };
const int = (v, lo, hi, what) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi)
    throw bad(`${what} must be an integer from ${lo} to ${hi}`); return v; };
function parseDraft(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw bad('Body must be a JSON object');
    const b = body;
    const out = {};
    const need = (k) => { if (!partial && b[k] === undefined)
        throw bad(`${k} is required`); return b[k] !== undefined; };
    if (need('key')) {
        const k = str(b.key, 63, 'key', 2);
        if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(k))
            throw bad('key must match [a-z0-9][a-z0-9_-]{1,62}');
        out.key = k;
    }
    if (need('name'))
        out.name = str(b.name, 120, 'name');
    if (need('surface'))
        out.surface = str(b.surface, 63, 'surface');
    if (need('hypothesis'))
        out.hypothesis = str(b.hypothesis, 600, 'hypothesis', 10);
    if (b.market !== undefined) {
        if (typeof b.market !== 'string' || !/^[A-Z]{2}$/.test(b.market))
            throw bad('market must be an ISO country code');
        out.market = b.market;
    }
    if (need('variants')) {
        const e = (0, assignment_1.validateVariants)(b.variants, experiment_types_1.EXPERIMENT_POLICY.maxVariants);
        if (e)
            throw bad(e);
        out.variants = b.variants.map((v) => ({ key: v.key, weightBp: v.weightBp }));
    }
    if (b.allocationBp !== undefined)
        out.allocationBp = int(b.allocationBp, 1, 10000, 'allocationBp');
    if (b.eligibility !== undefined) {
        const e = (0, eligibility_1.validateEligibility)(b.eligibility);
        if (e)
            throw bad(e);
        out.eligibility = b.eligibility;
    }
    if (need('primaryMetric')) {
        const m = (0, experiment_types_1.metricByKey)(String(b.primaryMetric));
        if (!m || m.kind === 'GUARDRAIL')
            throw bad(`primaryMetric must be one of the first-party funnel metrics`);
        out.primaryMetric = m.key;
    }
    if (b.guardrails !== undefined) {
        if (!Array.isArray(b.guardrails) || b.guardrails.length > 6)
            throw bad('guardrails must be a list of up to 6');
        out.guardrails = b.guardrails.map((g) => {
            const o = g;
            const m = (0, experiment_types_1.metricByKey)(String(o?.metric));
            if (!m || m.kind === 'PRIMARY')
                throw bad('each guardrail needs a guardrail metric');
            if (typeof o.marginAbs !== 'number' || !(o.marginAbs > 0 && o.marginAbs <= 0.2))
                throw bad('guardrail marginAbs must be a rate between 0 and 0.2 (absolute, e.g. 0.005)');
            return { metric: m.key, marginAbs: o.marginAbs };
        });
    }
    if (b.mode !== undefined) {
        if (b.mode !== 'FIXED' && b.mode !== 'SEQUENTIAL')
            throw bad('mode must be FIXED or SEQUENTIAL');
        out.mode = b.mode;
    }
    if (b.alphaBp !== undefined)
        out.alphaBp = int(b.alphaBp, 1, 2000, 'alphaBp');
    if (b.minSample !== undefined)
        out.minSample = int(b.minSample, 1, 100_000_000, 'minSample');
    if (b.plannedDays !== undefined)
        out.plannedDays = int(b.plannedDays, experiment_types_1.EXPERIMENT_POLICY.minRunDays, 90, `plannedDays (at least ${experiment_types_1.EXPERIMENT_POLICY.minRunDays})`);
    if (b.flagKey !== undefined && b.flagKey !== null)
        out.flagKey = str(b.flagKey, 80, 'flagKey');
    if (b.baselineRate !== undefined) {
        if (typeof b.baselineRate !== 'number' || !(b.baselineRate > 0 && b.baselineRate < 1))
            throw bad('baselineRate must be in (0,1)');
        out.baselineRate = b.baselineRate;
    }
    if (b.mdeAbs !== undefined) {
        if (typeof b.mdeAbs !== 'number' || !(b.mdeAbs > 0 && b.mdeAbs < 1))
            throw bad('mdeAbs must be in (0,1)');
        out.mdeAbs = b.mdeAbs;
    }
    return out;
}
function plannedSample(d) {
    if (d.baselineRate && d.mdeAbs)
        return (0, power_1.sampleSizePerArm)({ baseline: d.baselineRate, mde: d.mdeAbs, alpha: (d.alphaBp ?? 500) / 10_000 });
    return d.minSample ?? 1000;
}
//# sourceMappingURL=experiment-dto.js.map