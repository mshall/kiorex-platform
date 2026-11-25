"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentMapping = void 0;
const mapping_types_1 = require("./mapping-types");
const webhook_1 = require("./webhook");
const TYPES = ['payment.captured', 'payment.failed', 'refund.settled'];
exports.paymentMapping = {
    authHeaders: mapping_types_1.bearer,
    buildCheckout: (i) => ({ path: '/checkouts', body: { reference: i.paymentId, amountMinor: i.amountMinor, currency: i.currency } }),
    parseCheckout: (j) => {
        const pspRef = j?.id ?? j?.data?.id;
        const checkoutUrl = j?.checkoutUrl ?? j?.data?.checkoutUrl;
        if (!pspRef || typeof checkoutUrl !== 'string')
            throw new Error('no checkout id/url in provider response');
        return { pspRef: String(pspRef), checkoutUrl };
    },
    buildRefund: (i) => ({ path: '/refunds', body: { paymentRef: i.pspRef, reference: i.refundId, amountMinor: i.amountMinor } }),
    parseRefund: (j) => {
        const id = j?.id ?? j?.data?.id;
        if (!id)
            throw new Error('no refund id in provider response');
        return { pspRefundRef: String(id) };
    },
    parseWebhook: (raw) => {
        let j;
        try {
            j = JSON.parse(raw);
        }
        catch {
            return null;
        }
        const type = j?.type;
        if (!TYPES.includes(type) || !j?.id || !Number.isInteger(j?.amountMinor) || (!j?.paymentRef && !j?.reference))
            return null;
        return { eventId: String(j.id), type, pspRef: String(j.paymentRef ?? ''), paymentId: j.reference ? String(j.reference) : undefined, amountMinor: j.amountMinor, feeMinor: Number.isInteger(j.feeMinor) ? j.feeMinor : undefined, occurredAt: String(j.occurredAt ?? new Date().toISOString()) };
    },
    verifyWebhook: (o) => (0, webhook_1.verifyWebhookBody)(o),
};
//# sourceMappingURL=payment.mapping.js.map