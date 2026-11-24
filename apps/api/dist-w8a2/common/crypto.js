"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = void 0;
exports.encryptField = encryptField;
exports.decryptField = decryptField;
exports.blindIndex = blindIndex;
exports.safeEqual = safeEqual;
exports.encryptBytes = encryptBytes;
exports.decryptBytes = decryptBytes;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
function key() {
    const k = Buffer.from((0, config_1.cfg)().fieldKey, 'base64');
    if (k.length !== 32)
        throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64)');
    return k;
}
function encryptField(plain) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const c = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
function decryptField(enc) {
    const [v, iv, tag, ct] = enc.split('.');
    if (v !== 'v1')
        throw new Error('unknown ciphertext version');
    const d = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
function blindIndex(value) {
    return (0, node_crypto_1.createHmac)('sha256', key()).update(value.trim()).digest('hex');
}
const sha256Hex = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('hex');
exports.sha256Hex = sha256Hex;
function safeEqual(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && (0, node_crypto_1.timingSafeEqual)(x, y);
}
function encryptBytes(plain) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const c = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function decryptBytes(enc) {
    const d = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key(), enc.subarray(0, 12));
    d.setAuthTag(enc.subarray(12, 28));
    return Buffer.concat([d.update(enc.subarray(28)), d.final()]);
}
//# sourceMappingURL=crypto.js.map