"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomToken = exports.sha256Hex = exports.subRefOf = exports.growthKey = void 0;
exports.ipHashOf = ipHashOf;
exports.addressHash = addressHash;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
const growthKey = (label) => (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().fieldKey).update(`kiorex-growth:${label}`).digest();
exports.growthKey = growthKey;
function ipHashOf(ip, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    return (0, node_crypto_1.createHmac)('sha256', (0, exports.growthKey)(`ip:${day}`)).update(ip ?? 'unknown').digest('base64url').slice(0, 32);
}
function addressHash(address) {
    const n = address.trim().toLowerCase().replace(/[\s()-]/g, '');
    return (0, node_crypto_1.createHmac)('sha256', (0, exports.growthKey)('address')).update(n).digest('base64url');
}
const subRefOf = (sub) => (0, node_crypto_1.createHmac)('sha256', (0, exports.growthKey)('subref')).update(sub).digest('base64url').slice(0, 32);
exports.subRefOf = subRefOf;
const sha256Hex = (s) => (0, node_crypto_1.createHash)('sha256').update(s, 'utf8').digest('hex');
exports.sha256Hex = sha256Hex;
const randomToken = (bytes = 16) => (0, node_crypto_1.randomBytes)(bytes).toString('base64url');
exports.randomToken = randomToken;
//# sourceMappingURL=privacy-hash.js.map