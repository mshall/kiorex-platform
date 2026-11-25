"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnconfiguredPspAdapter = exports.HttpPspAdapter = exports.FakePspAdapter = exports.PSP_NAMES = void 0;
exports.pspAdapter = pspAdapter;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const outbound_http_1 = require("../common/outbound-http");
const env_1 = require("../common/providers/env");
const psp_vendors_1 = require("./psp.vendors");
const http_1 = require("../common/providers/http");
const payment_mapping_1 = require("../common/providers/payment.mapping");
exports.PSP_NAMES = ['paymob', 'fawry', 'instapay'];
class FakePspAdapter {
    name;
    constructor(name) {
        this.name = name;
    }
    async createCheckout(i) {
        return { pspRef: `fake_${this.name}_${i.paymentId}`, checkoutUrl: `${(0, config_1.cfg)().publicBaseUrl}/api/v1/pay/fake-checkout/${i.paymentId}` };
    }
    static sign(raw) { return (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().pspFakeSecret).update(raw).digest('hex'); }
    verifyWebhook(raw, headers) {
        const sig = String(headers['x-psp-signature'] ?? '');
        if (!sig || !(0, crypto_1.safeEqual)(sig, FakePspAdapter.sign(raw)))
            return null;
        const ev = JSON.parse(raw);
        return ev && typeof ev === 'object' && !Array.isArray(ev) ? ev : null;
    }
    async refund(i) { return { pspRefundRef: `fake_rf_${i.refundId}` }; }
}
exports.FakePspAdapter = FakePspAdapter;
class HttpPspAdapter {
    name;
    mapping;
    fetchImpl;
    envOverride;
    constructor(name, mapping = payment_mapping_1.paymentMapping, fetchImpl = outbound_http_1.outboundFetch, envOverride) {
        this.name = name;
        this.mapping = mapping;
        this.fetchImpl = fetchImpl;
        this.envOverride = envOverride;
    }
    get env() { return this.envOverride?.() ?? (0, env_1.providerEnv)('PAYMENT'); }
    async createCheckout(i) {
        const w = this.mapping.buildCheckout(i);
        const r = await (0, http_1.providerRequest)(this.env, { path: w.path, body: w.body, idempotencyKey: `checkout:${i.paymentId}` }, { fetchImpl: this.fetchImpl }, this.mapping.authHeaders(this.env.apiKey));
        return this.mapping.parseCheckout(r.json);
    }
    verifyWebhook(raw, headers) {
        if (!this.mapping.verifyWebhook({ secret: this.env.webhookSecret, rawBody: raw, headers }))
            return null;
        return this.mapping.parseWebhook(raw);
    }
    async refund(i) {
        const w = this.mapping.buildRefund(i);
        const r = await (0, http_1.providerRequest)(this.env, { path: w.path, body: w.body, idempotencyKey: `refund:${i.refundId}` }, { fetchImpl: this.fetchImpl }, this.mapping.authHeaders(this.env.apiKey));
        return this.mapping.parseRefund(r.json);
    }
}
exports.HttpPspAdapter = HttpPspAdapter;
class UnconfiguredPspAdapter {
    name;
    constructor(name) {
        this.name = name;
    }
    async createCheckout() { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured (set PAYMENT_API_URL / PAYMENT_API_KEY / PAYMENT_WEBHOOK_SECRET; see Docs/PROVIDERS.md)`); }
    verifyWebhook() { return null; }
    async refund() { throw new Error(`NEEDS_HUMAN: ${this.name} adapter not configured`); }
}
exports.UnconfiguredPspAdapter = UnconfiguredPspAdapter;
function pspAdapter(name) {
    const n = (exports.PSP_NAMES.includes(name) ? name : 'paymob');
    if ((0, config_1.cfg)().pspMode === 'sandbox-fake')
        return new FakePspAdapter(n);
    if ((0, psp_vendors_1.PSP_VENDOR_MODE)()) {
        if ((0, psp_vendors_1.vendorPspProblems)().length)
            return new UnconfiguredPspAdapter(n);
        const on = (0, psp_vendors_1.enabledPsps)();
        const use = on.includes(n) ? n : on[0];
        return use === 'paymob' ? new psp_vendors_1.PaymobPspAdapter() : use === 'fawry' ? new psp_vendors_1.FawryPspAdapter() : new HttpPspAdapter('instapay', payment_mapping_1.paymentMapping, outbound_http_1.outboundFetch, () => (0, psp_vendors_1.instapayEnv)());
    }
    return (0, env_1.providerProblems)('PAYMENT').length ? new UnconfiguredPspAdapter(n) : new HttpPspAdapter(n);
}
//# sourceMappingURL=psp.js.map