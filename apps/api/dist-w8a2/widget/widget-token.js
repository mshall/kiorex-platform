"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueWidgetToken = issueWidgetToken;
exports.verifyWidgetToken = verifyWidgetToken;
const node_crypto_1 = require("node:crypto");
const privacy_hash_1 = require("../common/privacy-hash");
const PREFIX = 'kxw1';
const key = () => (0, privacy_hash_1.growthKey)('widget-session-token');
const sign = (body) => (0, node_crypto_1.createHmac)('sha256', key()).update(`${PREFIX}.${body}`).digest('base64url');
function issueWidgetToken(c, ttlSeconds, now = Date.now()) {
    const iat = Math.floor(now / 1000);
    const claims = { v: 1, org: c.org, origin: c.origin.toLowerCase(), iat, exp: iat + ttlSeconds, n: (0, node_crypto_1.randomBytes)(8).toString('base64url'), ...(c.sandbox ? { sbx: 1 } : {}) };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return { token: `${PREFIX}.${body}.${sign(body)}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
function verifyWidgetToken(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 1024)
        return { ok: false, reason: 'MALFORMED' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX)
        return { ok: false, reason: 'MALFORMED' };
    const expected = Buffer.from(sign(parts[1]));
    const got = Buffer.from(parts[2]);
    if (expected.length !== got.length || !(0, node_crypto_1.timingSafeEqual)(expected, got))
        return { ok: false, reason: 'BAD_SIGNATURE' };
    let c;
    try {
        c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'MALFORMED' };
    }
    if (c?.v !== 1 || typeof c.org !== 'string' || typeof c.origin !== 'string' || typeof c.exp !== 'number')
        return { ok: false, reason: 'MALFORMED' };
    if (c.exp * 1000 <= now)
        return { ok: false, reason: 'EXPIRED' };
    return { ok: true, claims: c };
}
//# sourceMappingURL=widget-token.js.map