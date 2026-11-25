"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_LT_TTL_MS = exports.PROVIDER_LT_PREFIX = exports.LT_MAX_TTL_SECONDS = exports.LT_PREFIX = void 0;
exports.issueLinkToken = issueLinkToken;
exports.verifyLinkToken = verifyLinkToken;
exports.signProviderLinkTouch = signProviderLinkTouch;
exports.verifyProviderLinkTouch = verifyProviderLinkTouch;
exports.verifyAnyLinkToken = verifyAnyLinkToken;
const node_crypto_1 = require("node:crypto");
exports.LT_PREFIX = 'kxl1';
exports.LT_MAX_TTL_SECONDS = 30 * 60;
const b64 = (b) => Buffer.from(b).toString('base64url');
const sig = (key, payload) => (0, node_crypto_1.createHmac)('sha256', key).update(`${exports.LT_PREFIX}.${payload}`).digest();
function issueLinkToken(key, i) {
    const now = Math.floor((i.now ?? Date.now()) / 1000);
    const ttl = Math.min(Math.max(1, Math.floor(i.ttlSeconds ?? exports.LT_MAX_TTL_SECONDS)), exports.LT_MAX_TTL_SECONDS);
    const claims = { org: i.orgRef, code: i.linkCode, iat: now, exp: now + ttl, n: i.nonce ?? (0, node_crypto_1.randomBytes)(6).toString('base64url') };
    const payload = b64(JSON.stringify(claims));
    return `${exports.LT_PREFIX}.${payload}.${b64(sig(key, payload))}`;
}
function verifyLinkToken(key, token, now = Date.now()) {
    if (!key)
        return { ok: false, reason: 'INVALID' };
    if (typeof token !== 'string' || token.length > 512)
        return { ok: false, reason: 'INVALID' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== exports.LT_PREFIX)
        return { ok: false, reason: 'INVALID' };
    const expected = sig(key, parts[1]);
    let given;
    try {
        given = Buffer.from(parts[2], 'base64url');
    }
    catch {
        return { ok: false, reason: 'INVALID' };
    }
    if (given.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(given, expected))
        return { ok: false, reason: 'INVALID' };
    let c;
    try {
        c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'INVALID' };
    }
    if (typeof c.org !== 'string' || typeof c.code !== 'string' || !Number.isFinite(c.iat) || !Number.isFinite(c.exp) || c.exp - c.iat > exports.LT_MAX_TTL_SECONDS)
        return { ok: false, reason: 'INVALID' };
    if (Math.floor(now / 1000) >= c.exp || Math.floor(now / 1000) < c.iat - 60)
        return { ok: false, reason: 'EXPIRED' };
    return { ok: true, claims: c };
}
exports.PROVIDER_LT_PREFIX = 'kx-lt1\n';
exports.PROVIDER_LT_TTL_MS = 72 * 60 * 60 * 1000;
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;
function signProviderLinkTouch(secret, i) {
    const payload = b64(JSON.stringify({ o: i.orgRef, c: i.code.toUpperCase(), t: i.now ?? Date.now(), v: 1 }));
    return `${payload}.${(0, node_crypto_1.createHmac)('sha256', secret).update(exports.PROVIDER_LT_PREFIX + payload).digest('base64url')}`;
}
function verifyProviderLinkTouch(secret, token, now = Date.now()) {
    if (!secret || typeof token !== 'string' || token.length > 600)
        return { ok: false, reason: 'INVALID' };
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1])
        return { ok: false, reason: 'INVALID' };
    const expected = Buffer.from((0, node_crypto_1.createHmac)('sha256', secret).update(exports.PROVIDER_LT_PREFIX + parts[0]).digest('base64url'));
    const given = Buffer.from(parts[1]);
    if (expected.length !== given.length || !(0, node_crypto_1.timingSafeEqual)(expected, given))
        return { ok: false, reason: 'INVALID' };
    let c;
    try {
        c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'INVALID' };
    }
    if (!c || c.v !== 1 || typeof c.o !== 'string' || !c.o || typeof c.t !== 'number' || typeof c.c !== 'string' || !CROCKFORD.test(c.c.toUpperCase()))
        return { ok: false, reason: 'INVALID' };
    if (c.t > now + 5 * 60_000 || now - c.t > exports.PROVIDER_LT_TTL_MS)
        return { ok: false, reason: 'EXPIRED' };
    return { ok: true, claims: { org: c.o, code: c.c.toUpperCase(), iat: Math.floor(c.t / 1000) } };
}
function verifyAnyLinkToken(keys, token, now = Date.now()) {
    if (typeof token === 'string' && token.startsWith(`${exports.LT_PREFIX}.`)) {
        const r = verifyLinkToken(keys.kxl1, token, now);
        return r.ok ? { ok: true, claims: { org: r.claims.org, code: r.claims.code }, format: 'KXL1' } : r;
    }
    const r = verifyProviderLinkTouch(keys.provider, token, now);
    return r.ok ? { ok: true, claims: { org: r.claims.org, code: r.claims.code }, format: 'PROVIDER_LT' } : r;
}
//# sourceMappingURL=link-token.js.map