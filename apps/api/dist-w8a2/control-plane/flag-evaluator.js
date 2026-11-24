"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateFlag = evaluateFlag;
const contracts_1 = require("@kiorex/contracts");
const shapes = new WeakMap();
function evaluateFlag(flags, key, ctx = {}) {
    let shape = shapes.get(flags);
    if (!shape) {
        shape = { product: 'kiorex', version: 0, generatedAt: new Date(0).toISOString(), flags: [...flags.values()] };
        shapes.set(flags, shape);
    }
    const d = (0, contracts_1.evaluateFlag)(shape, key, { market: ctx.market, orgId: ctx.orgId });
    if (d.enabled)
        return { effective: true, reason: flags.has(key) ? 'ON' : 'UNKNOWN_FLAG' };
    switch (d.reason) {
        case 'global_off': return { effective: false, reason: 'OFF_GLOBAL', scope: 'GLOBAL' };
        case 'market_off': return { effective: false, reason: 'OFF_MARKET', scope: 'MARKET' };
        case 'org_off': return { effective: false, reason: 'OFF_ORG', scope: 'ORG' };
        case 'dependency_off': return { effective: false, reason: 'DEPENDENCY_OFF', scope: 'DEPENDENCY', blockedBy: d.blockedBy };
        default: return { effective: false, reason: 'AWAITING_GATE', scope: 'GATE' };
    }
}
//# sourceMappingURL=flag-evaluator.js.map