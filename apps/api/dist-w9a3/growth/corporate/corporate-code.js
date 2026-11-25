"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CODE_LENGTH = exports.CODE_ALPHABET = void 0;
exports.generateCode = generateCode;
exports.formatCode = formatCode;
exports.normaliseCode = normaliseCode;
exports.hashCode = hashCode;
exports.memberHashOf = memberHashOf;
exports.hrKeyHash = hrKeyHash;
exports.emailDomain = emailDomain;
const node_crypto_1 = require("node:crypto");
const privacy_hash_1 = require("../../common/privacy-hash");
exports.CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
exports.DEFAULT_CODE_LENGTH = 10;
function generateCode(format = { length: exports.DEFAULT_CODE_LENGTH, groupSize: 5 }, rnd = (n) => (0, node_crypto_1.randomInt)(n)) {
    if (!Number.isInteger(format.length) || format.length < 8 || format.length > 16)
        throw new RangeError('code length must be 8..16');
    let s = '';
    for (let i = 0; i < format.length; i++)
        s += exports.CODE_ALPHABET[rnd(exports.CODE_ALPHABET.length)];
    return formatCode(s, format.groupSize);
}
function formatCode(normalised, groupSize) {
    if (!groupSize || groupSize < 1)
        return normalised;
    return normalised.match(new RegExp(`.{1,${groupSize}}`, 'g')).join('-');
}
function normaliseCode(input) {
    if (typeof input !== 'string')
        return null;
    const s = input.normalize('NFKC').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (s.length < 8 || s.length > 16)
        return null;
    for (const ch of s)
        if (!exports.CODE_ALPHABET.includes(ch))
            return null;
    return s;
}
function hashCode(normalised) {
    return (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('corporate-code')).update(normalised).digest('base64url');
}
function memberHashOf(sub) {
    return (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('corporate-member')).update(sub).digest('base64url');
}
function hrKeyHash(address) {
    const n = address.trim().toLowerCase().replace(/[\s()-]/g, '');
    return (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('corporate-hr')).update(n).digest('base64url');
}
function emailDomain(email) {
    if (!email)
        return null;
    const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim().toLowerCase());
    return m ? m[1] : null;
}
//# sourceMappingURL=corporate-code.js.map