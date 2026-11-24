"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericVerify = exports.bearer = void 0;
exports.parseGenericStatus = parseGenericStatus;
exports.parseGenericSend = parseGenericSend;
exports.genericStatusBody = genericStatusBody;
const webhook_1 = require("./webhook");
const bearer = (apiKey) => ({ authorization: `Bearer ${apiKey}` });
exports.bearer = bearer;
const genericVerify = (o) => (0, webhook_1.verifyWebhookBody)(o);
exports.genericVerify = genericVerify;
const STATES = { queued: 'QUEUED', accepted: 'QUEUED', sent: 'SENT', submitted: 'SENT', delivered: 'DELIVERED', read: 'READ', seen: 'READ', failed: 'FAILED', undelivered: 'FAILED', bounced: 'FAILED', rejected: 'FAILED' };
function parseGenericStatus(raw) {
    let j;
    try {
        j = JSON.parse(raw);
    }
    catch {
        return [];
    }
    const list = Array.isArray(j?.events) ? j.events : j && typeof j === 'object' ? [j] : [];
    const out = [];
    for (const e of list) {
        const status = STATES[String(e?.status ?? '').toLowerCase()];
        const providerRef = String(e?.id ?? e?.providerRef ?? '');
        if (!status || !providerRef)
            continue;
        out.push({ providerRef, status, ...(status === 'FAILED' ? { error: String(e?.error ?? 'DELIVERY_FAILED').slice(0, 200) } : {}), ...(e?.occurredAt ? { occurredAt: String(e.occurredAt) } : {}) });
    }
    return out;
}
function parseGenericSend(json) {
    const id = json?.id ?? json?.messageId ?? json?.data?.id;
    if (!id || typeof id !== 'string' && typeof id !== 'number')
        throw new Error('no message id in provider response');
    return { providerRef: String(id) };
}
function genericStatusBody(providerRef, status, error) {
    return JSON.stringify({ events: [{ id: providerRef, status, ...(error ? { error } : {}), occurredAt: new Date().toISOString() }] });
}
//# sourceMappingURL=mapping-types.js.map