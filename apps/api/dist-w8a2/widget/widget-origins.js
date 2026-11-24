"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.originOfUrl = originOfUrl;
exports.sanitizeRegisteredOrigins = sanitizeRegisteredOrigins;
exports.devOrigins = devOrigins;
exports.allowedOrigins = allowedOrigins;
exports.isOriginAllowed = isOriginAllowed;
exports.frameAncestorsOf = frameAncestorsOf;
exports.widgetSelfOrigin = widgetSelfOrigin;
const contracts_1 = require("@kiorex/contracts");
const widget_config_1 = require("./widget.config");
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;
function originOfUrl(raw) {
    if (!raw || typeof raw !== 'string' || raw.length > 2048)
        return null;
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:')
            return null;
        return u.origin.toLowerCase();
    }
    catch {
        return null;
    }
}
function sanitizeRegisteredOrigins(list) {
    if (!Array.isArray(list))
        return [];
    const out = [];
    for (const o of list) {
        if (typeof o !== 'string')
            continue;
        const v = o.trim().toLowerCase();
        if ((0, contracts_1.isValidWidgetOrigin)(v) && !out.includes(v))
            out.push(v);
        if (out.length >= contracts_1.WIDGET_MAX_ORIGINS)
            break;
    }
    return out;
}
function devOrigins() { return (0, widget_config_1.widgetCfg)().devOrigins.filter((o) => DEV_ORIGIN.test(o)); }
function allowedOrigins(registered) { return [...new Set([...sanitizeRegisteredOrigins(registered), ...devOrigins()])]; }
function isOriginAllowed(origin, allowed) {
    if (!origin)
        return false;
    const o = origin.toLowerCase();
    return allowed.some((a) => a === o);
}
function frameAncestorsOf(allowed) { return allowed.length ? allowed.join(' ') : "'none'"; }
function widgetSelfOrigin(reqProto, reqHost) {
    const host = ((0, widget_config_1.widgetCfg)().host || reqHost || '').toLowerCase();
    if (!host)
        return null;
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
    const proto = (0, widget_config_1.widgetCfg)().host && !local ? 'https' : (reqProto ?? 'http');
    return `${proto}://${host}`;
}
//# sourceMappingURL=widget-origins.js.map