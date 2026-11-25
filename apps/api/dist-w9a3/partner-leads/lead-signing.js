"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadSigningConfigError = exports.MIN_PROD_LEAD_SECRET_LENGTH = exports.DEV_LEAD_SIGNING_SECRET = void 0;
exports.leadSecrets = leadSecrets;
exports.leadSigningKeys = leadSigningKeys;
exports.leadSigningKey = leadSigningKey;
exports.leadSigningStatus = leadSigningStatus;
exports.verifyLeadSigningStartup = verifyLeadSigningStartup;
const contracts_1 = require("@kiorex/contracts");
exports.DEV_LEAD_SIGNING_SECRET = 'kiorex-dev-lead-signing-secret';
exports.MIN_PROD_LEAD_SECRET_LENGTH = 32;
function leadSecrets(env = process.env) {
    const prod = env.NODE_ENV === 'production';
    const parts = (env.PARTNER_LEAD_SIGNING_SECRET ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2);
    const usable = prod ? parts.filter((s) => s.length >= exports.MIN_PROD_LEAD_SECRET_LENGTH) : parts;
    if (usable.length)
        return usable;
    return prod ? [] : [exports.DEV_LEAD_SIGNING_SECRET];
}
function leadSigningKeys(env = process.env) {
    return leadSecrets(env).map(contracts_1.deriveIntakeSigningKey);
}
function leadSigningKey(env = process.env) {
    return leadSigningKeys(env)[0] ?? null;
}
function leadSigningStatus(env = process.env) {
    const n = leadSecrets(env).length;
    return { status: n > 0 ? 'configured' : 'not configured', previousAccepted: n > 1 };
}
class LeadSigningConfigError extends Error {
    constructor() {
        super(`PARTNER_LEAD_SIGNING_SECRET is missing or shorter than ${exports.MIN_PROD_LEAD_SECRET_LENGTH} characters (production). Run scripts/setup-partner-lead-secret.sh <env>; variable name only, no value.`);
        this.name = 'LeadSigningConfigError';
    }
}
exports.LeadSigningConfigError = LeadSigningConfigError;
function verifyLeadSigningStartup(env = process.env) {
    const s = leadSigningStatus(env);
    if (env.NODE_ENV === 'production' && s.status === 'not configured' && env.PARTNER_LEAD_SIGNING_OPTIONAL !== 'true')
        throw new LeadSigningConfigError();
    return s;
}
//# sourceMappingURL=lead-signing.js.map