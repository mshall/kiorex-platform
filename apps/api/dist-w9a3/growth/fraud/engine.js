"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionFor = void 0;
exports.evaluateFraud = evaluateFraud;
const rules_1 = require("./rules");
const scoring_1 = require("./scoring");
const actionFor = (cfg, surface, band) => (band === 'ALLOW' ? 'NONE' : cfg.actions[surface][band] ?? 'OPEN_CASE');
exports.actionFor = actionFor;
function evaluateFraud(cfg, surface, f) {
    const signals = [];
    for (const r of rules_1.FRAUD_RULES_LIST) {
        if (!r.surfaces.includes(surface) || !cfg.rules[r.id].enabled)
            continue;
        try {
            const o = r.evaluate(f, cfg.thresholds);
            if (o && o.strength > 0)
                signals.push({ ruleId: r.id, kind: r.kind, strength: o.strength, reason: o.reason, evidence: o.evidence });
        }
        catch { }
    }
    const both = (0, scoring_1.scoreBoth)(cfg, signals);
    const strongest = [...signals].sort((a, b) => b.strength - a.strength)[0];
    const kind = signals.some((s) => s.kind === 'PROVIDER') && strongest?.kind === 'PROVIDER' ? 'PROVIDER' : strongest?.kind ?? 'REFERRAL';
    const effSurface = kind === 'PROVIDER' ? 'PROVIDER_REVIEW' : surface;
    return { signals, ...both, kind, action: (0, exports.actionFor)(cfg, effSurface, both.enforced.band), shadowAction: (0, exports.actionFor)(cfg, effSurface, both.shadow.band) };
}
//# sourceMappingURL=engine.js.map