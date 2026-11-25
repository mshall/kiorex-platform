"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rxQrPayload = exports.rxVerifyUrl = exports.rxTokenValid = void 0;
exports.rxToken = rxToken;
exports.parseRxToken = parseRxToken;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const mac = (recordId, signedAt) => (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().rxVerifySecret).update(`rx1:${recordId}:${signedAt}`).digest('base64url').slice(0, 24);
function rxToken(recordId, signedAt) {
    return `kxrx1.${recordId}.${mac(recordId, signedAt.toISOString())}`;
}
function parseRxToken(token) {
    const m = /^kxrx1\.([A-Za-z0-9_-]{3,64})\.([A-Za-z0-9_-]{24})$/.exec(token ?? '');
    return m ? { recordId: m[1], mac: m[2] } : null;
}
const rxTokenValid = (recordId, signedAt, given) => (0, crypto_1.safeEqual)(mac(recordId, signedAt.toISOString()), given);
exports.rxTokenValid = rxTokenValid;
const rxVerifyUrl = (token) => `${(0, config_1.cfg)().rxVerifyBase}?t=${encodeURIComponent(token)}`;
exports.rxVerifyUrl = rxVerifyUrl;
const rxQrPayload = (token) => (0, exports.rxVerifyUrl)(token);
exports.rxQrPayload = rxQrPayload;
//# sourceMappingURL=rx.js.map