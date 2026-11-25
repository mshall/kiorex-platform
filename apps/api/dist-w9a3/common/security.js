"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIOREX_DEV_SECRET_DEFAULTS = exports.corsOptions = void 0;
exports.allowedCorsOrigins = allowedCorsOrigins;
exports.corsOriginAllowed = corsOriginAllowed;
exports.swaggerEnabled = swaggerEnabled;
exports.securityHeaderMap = securityHeaderMap;
exports.securityHeaders = securityHeaders;
exports.trustedProxyHops = trustedProxyHops;
exports.applyHttpHardening = applyHttpHardening;
exports.insecureProductionSecrets = insecureProductionSecrets;
exports.assertProductionSecrets = assertProductionSecrets;
const originOf = (u) => {
    if (!u)
        return null;
    try {
        return new URL(u).origin;
    }
    catch {
        return null;
    }
};
const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);
function allowedCorsOrigins(env = process.env) {
    const explicit = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    const derived = [env.WEB_BASE_URL, env.PUBLIC_BASE_URL, env.PUBLIC_APP_URL, env.OPS_BASE_URL, env.APP_WEB_URL].map(originOf).filter((x) => !!x);
    return [...new Set([...explicit, ...derived])];
}
function corsOriginAllowed(origin, env = process.env) {
    if (!origin)
        return true;
    if (allowedCorsOrigins(env).includes(origin.replace(/\/+$/, '')))
        return true;
    return env.NODE_ENV !== 'production' && isLocalOrigin(origin);
}
const corsOptions = (env = process.env) => ({
    origin: (origin, cb) => cb(null, corsOriginAllowed(origin, env)),
    credentials: true,
});
exports.corsOptions = corsOptions;
function swaggerEnabled(env = process.env) {
    const v = env.SWAGGER_ENABLED?.trim().toLowerCase();
    if (v === 'true')
        return true;
    if (v === 'false')
        return false;
    return env.NODE_ENV !== 'production';
}
function securityHeaderMap(path, env = process.env) {
    const h = {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (env.NODE_ENV === 'production')
        h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    if (path.startsWith('/api/') && !path.startsWith('/api/docs')) {
        h['X-Frame-Options'] = 'DENY';
        h['Content-Security-Policy'] = "frame-ancestors 'none'";
    }
    return h;
}
function securityHeaders(env = process.env) {
    return (req, res, next) => {
        for (const [k, v] of Object.entries(securityHeaderMap(req.path ?? req.url ?? '', env)))
            res.setHeader(k, v);
        res.removeHeader?.('X-Powered-By');
        next();
    };
}
function trustedProxyHops(env = process.env) {
    const n = Number(env.TRUSTED_PROXY_HOPS);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}
function applyHttpHardening(app, env = process.env) {
    const http = app.getHttpAdapter().getInstance();
    http.disable?.('x-powered-by');
    http.set?.('trust proxy', trustedProxyHops(env));
    http.use?.(securityHeaders(env));
}
function insecureProductionSecrets(env = process.env, devDefaults) {
    if (env.NODE_ENV !== 'production' || env.ALLOW_INSECURE_DEFAULT_SECRETS === 'true')
        return [];
    return Object.entries(devDefaults).filter(([k, dev]) => { const v = env[k]?.trim(); return !v || v === dev || /change_me|dev[-_]only|_dev_/i.test(v); }).map(([k]) => k);
}
exports.KIOREX_DEV_SECRET_DEFAULTS = {
    FIELD_ENCRYPTION_KEY: 'a2lvcmV4LWRldi1vbmx5LWZpZWxkLWtleS0zMmJ5dGU=',
    KIORLY_CLIENT_SECRET: 'kx_dev_secret_change_me',
    KIORLY_WEBHOOK_SECRET: 'kx_dev_webhook_secret',
    PSP_FAKE_WEBHOOK_SECRET: 'psp_fake_secret_change_me',
    WHATSAPP_WEBHOOK_SECRET: 'wa_dev_webhook_secret_change_me',
    KIOREX_RECORD_SHARE_HMAC_SECRET: 'dev-record-share-secret',
    RX_VERIFY_HMAC_SECRET: 'rx_dev_verify_secret_change_me',
};
function assertProductionSecrets(env = process.env) {
    const bad = insecureProductionSecrets(env, exports.KIOREX_DEV_SECRET_DEFAULTS);
    if (bad.length)
        throw new Error(`Refusing to start in production with missing or published dev secrets: ${bad.join(', ')} (set real values from Secrets Manager; ALLOW_INSECURE_DEFAULT_SECRETS=true is for staging bring-up only)`);
}
//# sourceMappingURL=security.js.map