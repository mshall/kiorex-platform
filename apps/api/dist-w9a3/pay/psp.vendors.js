"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instapayEnv = exports.FawryPspAdapter = exports.PaymobPspAdapter = exports.vendorPspProblems = exports.PSP_VENDOR_MODE = exports.enabledPsps = void 0;
const config_1 = require("../common/config");
const outbound_http_1 = require("../common/outbound-http");
const env_1 = require("../common/providers/env");
const http_1 = require("../common/providers/http");
const fawry_1 = require("../common/providers/vendors/fawry");
const paymob_1 = require("../common/providers/vendors/paymob");
const problems_1 = require("../common/providers/problems");
exports.enabledPsps = problems_1.enabledPsps;
exports.PSP_VENDOR_MODE = problems_1.PSP_VENDOR_MODE;
exports.vendorPspProblems = problems_1.vendorPspProblems;
const DEFAULTS = { paymob: 'https://accept.paymob.com', fawry: 'https://www.atfawry.com', instapay: '' };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v ? Math.floor(n) : d; };
function transport(name, apiKey, env) {
    const P = name.toUpperCase();
    return { kind: 'PAYMENT', mode: 'real', provider: name, publicWebhookUrl: '', apiUrl: ((env[`${P}_API_URL`] ?? '').trim() || DEFAULTS[name]).replace(/\/+$/, ''), apiKey, senderId: '', webhookSecret: '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) };
}
const returnUrl = (paymentId) => `${(0, config_1.cfg)().webBaseUrl}/pay/return?payment=${encodeURIComponent(paymentId)}`;
const notifyUrl = (psp) => `${(0, config_1.cfg)().publicBaseUrl}/api/v1/pay/webhooks/${psp}`;
class PaymobPspAdapter {
    env;
    fetchImpl;
    name = 'paymob';
    constructor(env = process.env, fetchImpl = outbound_http_1.outboundFetch) {
        this.env = env;
        this.fetchImpl = fetchImpl;
    }
    get t() { return transport('paymob', this.env.PAYMOB_SECRET_KEY ?? '', this.env); }
    async createCheckout(i) {
        const ids = (this.env.PAYMOB_INTEGRATION_IDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
        const r = await (0, http_1.providerRequest)(this.t, { path: '/v1/intention/', body: (0, paymob_1.paymobIntentionBody)({ ...i, integrationIds: ids, notificationUrl: notifyUrl('paymob'), redirectionUrl: returnUrl(i.paymentId) }), idempotencyKey: `checkout:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, (0, paymob_1.paymobAuth)(this.t.apiKey));
        return (0, paymob_1.parsePaymobIntention)(r.json, this.t.apiUrl, this.env.PAYMOB_PUBLIC_KEY ?? '');
    }
    verifyWebhook(raw, _headers, query = {}) {
        let obj;
        try {
            obj = JSON.parse(raw)?.obj;
        }
        catch {
            return null;
        }
        if (!obj || !(0, paymob_1.verifyPaymobHmac)(this.env.PAYMOB_HMAC_SECRET ?? '', obj, String(query.hmac ?? '')))
            return null;
        return (0, paymob_1.parsePaymobCallback)(raw);
    }
    async refund(i) {
        const t = this.t;
        const auth = (0, paymob_1.paymobAuth)(t.apiKey);
        const inq = await (0, http_1.providerRequest)(t, { path: '/api/ecommerce/orders/transaction_inquiry', body: { order_id: i.pspRef } }, { fetchImpl: this.fetchImpl }, auth);
        const r = await (0, http_1.providerRequest)(t, { path: '/api/acceptance/void_refund/refund', body: (0, paymob_1.paymobRefundBody)((0, paymob_1.paymobTransactionIdFromInquiry)(inq.json), i.amountMinor), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl }, auth);
        const id = r.json?.id;
        if (id === undefined)
            throw new Error('no refund id in Paymob response');
        return { pspRefundRef: String(id) };
    }
}
exports.PaymobPspAdapter = PaymobPspAdapter;
class FawryPspAdapter {
    env;
    fetchImpl;
    name = 'fawry';
    constructor(env = process.env, fetchImpl = outbound_http_1.outboundFetch) {
        this.env = env;
        this.fetchImpl = fetchImpl;
    }
    get t() { return transport('fawry', '', this.env); }
    async createCheckout(i) {
        return (0, fawry_1.fawryCheckoutUrl)({ apiUrl: this.t.apiUrl, merchantCode: this.env.FAWRY_MERCHANT_CODE ?? '', secureKey: this.env.FAWRY_SECURE_KEY ?? '', paymentId: i.paymentId, amountMinor: i.amountMinor, returnUrl: returnUrl(i.paymentId), webhookUrl: notifyUrl('fawry') });
    }
    verifyWebhook(raw) {
        const b = (0, fawry_1.verifyFawryCallback)(this.env.FAWRY_SECURE_KEY ?? '', raw);
        return b ? (0, fawry_1.parseFawryCallback)(b) : null;
    }
    async refund(i) {
        const code = this.env.FAWRY_MERCHANT_CODE ?? '';
        const key = this.env.FAWRY_SECURE_KEY ?? '';
        const t = this.t;
        const st = await (0, http_1.providerRequest)(t, { method: 'GET', path: '', absoluteUrl: (0, fawry_1.fawryStatusUrl)(t.apiUrl, code, key, i.pspRef) }, { fetchImpl: this.fetchImpl });
        const ref = st.json?.fawryRefNumber;
        if (!ref)
            throw new Error('Fawry status has no fawryRefNumber');
        const r = await (0, http_1.providerRequest)(t, { path: '/ECommerceWeb/Fawry/payments/refund', body: (0, fawry_1.fawryRefundBody)({ merchantCode: code, secureKey: key, fawryRefNumber: String(ref), amountMinor: i.amountMinor, reason: `refund ${i.refundId}` }), idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl });
        if (Number(r.json?.statusCode) !== 200)
            throw new Error(`Fawry refund rejected (${String(r.json?.statusCode ?? 'unknown')})`);
        return { pspRefundRef: String(ref) };
    }
}
exports.FawryPspAdapter = FawryPspAdapter;
const instapayEnv = (env = process.env) => ({ ...(0, env_1.providerEnv)('PAYMENT', {}), mode: 'real', provider: 'gateway', apiUrl: (env.INSTAPAY_API_URL ?? '').trim().replace(/\/+$/, ''), apiKey: env.INSTAPAY_API_KEY ?? '', webhookSecret: env.INSTAPAY_WEBHOOK_SECRET ?? '', timeoutMs: num(env.PAYMENT_TIMEOUT_MS, 8000), maxRetries: num(env.PAYMENT_MAX_RETRIES, 2) });
exports.instapayEnv = instapayEnv;
//# sourceMappingURL=psp.vendors.js.map