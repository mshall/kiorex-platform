"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contributionOf = contributionOf;
exports.bandOf = bandOf;
exports.scoreSignals = scoreSignals;
exports.scoreBoth = scoreBoth;
const fraud_config_1 = require("./fraud-config");
const signals_1 = require("./signals");
function contributionOf(cfg, s) {
    const r = cfg.rules[s.ruleId];
    if (!r.enabled)
        return 0;
    return Math.min(r.cap, r.weight * (0, signals_1.clamp01)(s.strength));
}
function bandOf(score, bands) {
    return score >= bands.hold ? 'HOLD' : score >= bands.review ? 'REVIEW' : 'ALLOW';
}
function scoreSignals(cfg, signals, only) {
    const parts = signals.filter((s) => !only || only(s.ruleId)).map((s) => ({ ruleId: s.ruleId, contribution: contributionOf(cfg, s), enforced: (0, fraud_config_1.ruleEnforced)(cfg, s.ruleId) }))
        .filter((p) => p.contribution > 0).sort((a, b) => b.contribution - a.contribution || a.ruleId.localeCompare(b.ruleId));
    let total = 0;
    parts.forEach((p, i) => { total += p.contribution * Math.pow(cfg.diminishing, i); });
    const score = Math.min(100, Math.max(0, Math.round(total)));
    return { score, band: bandOf(score, cfg.bands), contributions: parts };
}
function scoreBoth(cfg, signals) {
    const shadow = scoreSignals(cfg, signals);
    const enforced = scoreSignals(cfg, signals, (id) => (0, fraud_config_1.ruleEnforced)(cfg, id));
    return { shadow, enforced, wouldHaveBeenHeld: shadow.band === 'HOLD' && enforced.band !== 'HOLD' };
}
//# sourceMappingURL=scoring.js.map