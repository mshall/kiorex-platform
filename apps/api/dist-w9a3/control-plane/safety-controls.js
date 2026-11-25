"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_CONTROL_TOKENS = void 0;
exports.isSafetyControlKey = isSafetyControlKey;
const contracts_1 = require("@kiorex/contracts");
const LOCAL_TOKENS = ['emergency_routing', 'emergency.routing', 'emergency_detection', 'consent_enforcement', 'tenant_isolation', 'breach_response', 'privileged_mfa', 'pharmacist_signoff'];
exports.SAFETY_CONTROL_TOKENS = [...new Set([...contracts_1.SAFETY_NEVER_FLAGS.flatMap((s) => [...s.forbiddenKeyTokens]), ...LOCAL_TOKENS])];
function isSafetyControlKey(key) {
    const k = key.toLowerCase();
    return exports.SAFETY_CONTROL_TOKENS.some((t) => k.includes(t));
}
//# sourceMappingURL=safety-controls.js.map