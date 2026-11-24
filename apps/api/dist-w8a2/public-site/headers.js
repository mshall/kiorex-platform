"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagOf = exports.noStore = exports.errorCacheControl = exports.publicCacheControl = exports.textSecurityHeaders = exports.sha256Base64 = void 0;
exports.contentSecurityPolicy = contentSecurityPolicy;
exports.securityHeaders = securityHeaders;
exports.etagMatches = etagMatches;
const node_crypto_1 = require("node:crypto");
const sha256Base64 = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('base64');
exports.sha256Base64 = sha256Base64;
function contentSecurityPolicy(o) {
    const ancestors = o.frameAncestors?.length ? o.frameAncestors.join(' ') : "'none'";
    return [
        "default-src 'self'",
        "script-src 'self'",
        `style-src 'self' ${o.styleHashes.map((h) => `'sha256-${h}'`).join(' ')}`.trim(),
        "img-src 'self' data: https:",
        "font-src 'self'",
        `connect-src 'self' ${(o.connectSrc ?? []).join(' ')}`.trim(),
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        `frame-ancestors ${ancestors}`,
    ].join('; ');
}
function securityHeaders(o) {
    const h = {
        'Content-Security-Policy': contentSecurityPolicy(o),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
    };
    if (!o.frameAncestors?.length)
        h['X-Frame-Options'] = 'DENY';
    if (o.hsts !== false)
        h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    return h;
}
const textSecurityHeaders = () => ({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
});
exports.textSecurityHeaders = textSecurityHeaders;
const publicCacheControl = (p) => `public, max-age=0, s-maxage=${p.sMaxAge}, stale-while-revalidate=${p.staleWhileRevalidate}`;
exports.publicCacheControl = publicCacheControl;
const errorCacheControl = (sMaxAge = 60) => `public, max-age=0, s-maxage=${sMaxAge}`;
exports.errorCacheControl = errorCacheControl;
exports.noStore = 'no-store';
const etagOf = (body) => `W/"${(0, node_crypto_1.createHash)('sha1').update(body).digest('base64url').slice(0, 27)}"`;
exports.etagOf = etagOf;
function etagMatches(ifNoneMatch, etag) {
    if (!ifNoneMatch)
        return false;
    if (ifNoneMatch.trim() === '*')
        return true;
    const norm = (t) => t.trim().replace(/^W\//, '');
    return ifNoneMatch.split(',').some((t) => norm(t) === norm(etag));
}
//# sourceMappingURL=headers.js.map