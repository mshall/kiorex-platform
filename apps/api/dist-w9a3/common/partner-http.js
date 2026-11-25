"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerTransientError = exports.PartnerHttpError = void 0;
exports.partnerRequest = partnerRequest;
const outbound_http_1 = require("./outbound-http");
const hmac_1 = require("./hmac");
class PartnerHttpError extends Error {
    status;
    code;
    body;
    constructor(status, code, body) {
        super(`partner ${status}${code ? ` ${code}` : ''}`);
        this.status = status;
        this.code = code;
        this.body = body;
    }
}
exports.PartnerHttpError = PartnerHttpError;
class PartnerTransientError extends Error {
    kind;
    status;
    constructor(message, kind, status) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}
exports.PartnerTransientError = PartnerTransientError;
async function partnerRequest(c, r) {
    const base = c.baseUrl.replace(/\/$/, '');
    const qs = r.query ? '?' + new URLSearchParams(Object.entries(r.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
    const url = `${base}${r.path}${qs}`;
    const body = r.body === undefined ? undefined : JSON.stringify(r.body);
    const signed = (0, hmac_1.signKiorlyRequest)({ clientKey: c.clientKey, clientSecret: c.clientSecret, method: r.method, path: new URL(url).pathname, body });
    const headers = { ...signed.headers, accept: 'application/json' };
    if (body !== undefined)
        headers['content-type'] = 'application/json';
    if (r.idempotencyKey)
        headers['idempotency-key'] = r.idempotencyKey;
    let res;
    try {
        res = await (0, outbound_http_1.outboundFetch)(url, { method: r.method, headers, body, signal: AbortSignal.timeout(c.timeoutMs) });
    }
    catch (e) {
        const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw new PartnerTransientError(timeout ? 'timeout' : `network: ${e.message}`, timeout ? 'TIMEOUT' : 'NETWORK');
    }
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : undefined;
    }
    catch {
        data = { raw: text.slice(0, 200) };
    }
    if (res.status >= 500 || res.status === 429)
        throw new PartnerTransientError(`HTTP ${res.status}`, 'HTTP_5XX', res.status);
    if (res.status >= 400)
        throw new PartnerHttpError(res.status, data?.code, data);
    return { status: res.status, data: data };
}
//# sourceMappingURL=partner-http.js.map