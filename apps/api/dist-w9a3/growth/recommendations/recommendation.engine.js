"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRules = runRules;
const assert_aggregate_only_1 = require("./assert-aggregate-only");
const rules_1 = require("./rules");
const recommendation_types_1 = require("./recommendation.types");
const health_terms_1 = require("../automation/health-terms");
function runRules(i) {
    const all = [...(0, rules_1.budgetRule)(i), ...(0, rules_1.campaignRule)(i), ...(0, rules_1.contentRule)(i), ...(0, rules_1.seoRule)(i), ...(0, rules_1.holdoutRule)(i)];
    const dropped = [];
    const keep = [];
    for (const p of all) {
        if (!recommendation_types_1.RECOMMENDATION_KINDS.includes(p.kind)) {
            dropped.push({ fingerprint: p.fingerprint, reason: 'UNKNOWN_KIND' });
            continue;
        }
        const v = (0, assert_aggregate_only_1.checkAggregateOnly)({ payload: p.payload, evidence: p.evidenceRefs });
        const word = (0, health_terms_1.healthWordIn)(`${p.rationale.en} ${p.rationale.ar}`);
        if (v.length || word) {
            dropped.push({ fingerprint: p.fingerprint, reason: v.length ? `${v[0].code}:${v[0].path}` : `HEALTH_WORD:${word}` });
            continue;
        }
        keep.push(p);
    }
    keep.sort((a, b) => b.confidence - a.confidence || (a.fingerprint < b.fingerprint ? -1 : 1));
    return { proposals: keep.slice(0, recommendation_types_1.RECOMMENDATION_POLICY.maxPerRun), dropped };
}
//# sourceMappingURL=recommendation.engine.js.map