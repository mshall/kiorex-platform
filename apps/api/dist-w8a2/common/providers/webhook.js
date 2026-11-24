"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBHOOK_TOLERANCE_SECONDS = exports.WEBHOOK_TIMESTAMP_HEADER = exports.WEBHOOK_SIGNATURE_HEADER = void 0;
exports.signWebhookBody = signWebhookBody;
exports.verifyWebhookBody = verifyWebhookBody;
exports.signedWebhookHeaders = signedWebhookHeaders;
const node_crypto_1 = require("node:crypto");
exports.WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
exports.WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
exports.WEBHOOK_TOLERANCE_SECONDS = 300;
function signWebhookBody(secret, timestampSeconds, rawBody) {
    return `sha256=${(0, node_crypto_1.createHmac)('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')}`;
}
const eq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && (0, node_crypto_1.timingSafeEqual)(x, y); };
const header = (h, name) => { const v = h[name] ?? h[name.toLowerCase()]; return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); };
function verifyWebhookBody(o) {
    if (!o.secret)
        return false;
    const sig = header(o.headers, exports.WEBHOOK_SIGNATURE_HEADER);
    const ts = header(o.headers, exports.WEBHOOK_TIMESTAMP_HEADER);
    if (!sig || !/^\d+$/.test(ts))
        return false;
    const now = o.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(ts)) > (o.toleranceSeconds ?? exports.WEBHOOK_TOLERANCE_SECONDS))
        return false;
    return eq(sig, signWebhookBody(o.secret, ts, o.rawBody));
}
function signedWebhookHeaders(secret, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
    return { [exports.WEBHOOK_TIMESTAMP_HEADER]: String(nowSeconds), [exports.WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(secret, nowSeconds, rawBody) };
}
//# sourceMappingURL=webhook.js.map