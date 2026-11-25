"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.controlOf = exports.bucketsOf = exports.unitHashOf = exports.digestOf = exports.BP = void 0;
exports.assign = assign;
exports.validateVariants = validateVariants;
const node_crypto_1 = require("node:crypto");
exports.BP = 10_000;
const digestOf = (salt, unitKey) => (0, node_crypto_1.createHmac)('sha256', salt).update(unitKey, 'utf8').digest();
exports.digestOf = digestOf;
const unitHashOf = (salt, unitKey) => (0, exports.digestOf)(salt, unitKey).toString('hex');
exports.unitHashOf = unitHashOf;
const bucketsOf = (digest) => ({ allocation: digest.readUInt32BE(0) % exports.BP, variant: digest.readUInt32BE(4) % exports.BP });
exports.bucketsOf = bucketsOf;
const controlOf = (variants) => variants[0].key;
exports.controlOf = controlOf;
function assign(exp, unitKey) {
    const control = (0, exports.controlOf)(exp.variants);
    if (exp.status !== 'RUNNING')
        return { enrolled: false, variant: control, control, unitHash: null, reason: 'NOT_RUNNING' };
    const d = (0, exports.digestOf)(exp.salt, unitKey);
    const b = (0, exports.bucketsOf)(d);
    const unitHash = d.toString('hex');
    if (b.allocation >= exp.allocationBp)
        return { enrolled: false, variant: control, control, unitHash: null, reason: 'HOLDBACK' };
    let acc = 0;
    for (const v of exp.variants) {
        acc += v.weightBp;
        if (b.variant < acc)
            return { enrolled: true, variant: v.key, control, unitHash, reason: 'ASSIGNED' };
    }
    return { enrolled: true, variant: exp.variants[exp.variants.length - 1].key, control, unitHash, reason: 'ASSIGNED' };
}
function validateVariants(variants, max = 5) {
    if (!Array.isArray(variants) || variants.length < 2 || variants.length > max)
        return `variants must be a list of 2 to ${max}`;
    const seen = new Set();
    let sum = 0;
    for (const [i, v] of variants.entries()) {
        if (!v || typeof v !== 'object')
            return 'each variant must be an object';
        const { key, weightBp, ...rest } = v;
        if (Object.keys(rest).length)
            return 'a variant carries only key and weightBp (no payload that could change money, policy or content)';
        if (typeof key !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(key))
            return 'variant key must match [a-z0-9_-]{1,32}';
        if (i === 0 && key !== 'control')
            return 'the first variant must be "control"';
        if (seen.has(key))
            return `duplicate variant key ${key}`;
        seen.add(key);
        if (!Number.isInteger(weightBp) || weightBp < 1)
            return 'weightBp must be a positive integer';
        sum += weightBp;
    }
    return sum === exports.BP ? null : `variant weights must sum to ${exports.BP} (got ${sum})`;
}
//# sourceMappingURL=assignment.js.map