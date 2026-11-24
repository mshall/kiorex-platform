"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushAdapter = exports.UnconfiguredAdapter = exports.HttpMessagingAdapter = exports.MockAdapter = void 0;
exports.pushChannelFor = pushChannelFor;
exports.channelMode = channelMode;
exports.createMessagingAdapter = createMessagingAdapter;
const node_crypto_1 = require("node:crypto");
const outbound_http_1 = require("../common/outbound-http");
const env_1 = require("../common/providers/env");
const real_adapters_1 = require("../common/providers/real-adapters");
const push_1 = require("../common/providers/vendors/push");
class MockAdapter {
    channel;
    mode = 'mock';
    constructor(channel) {
        this.channel = channel;
    }
    async send(m) {
        if (m.to.endsWith('0000'))
            return { ok: false, providerRef: '', error: 'MOCK_BOUNCE' };
        return { ok: true, providerRef: `mock_${this.channel.toLowerCase()}_${(0, node_crypto_1.createHash)('sha1').update(`${m.messageId ?? ''}${m.to}${m.templateId}${Date.now()}`).digest('hex').slice(0, 12)}` };
    }
}
exports.MockAdapter = MockAdapter;
class HttpMessagingAdapter {
    channel;
    mode = 'real';
    transport;
    constructor(channel, deps = { fetchImpl: outbound_http_1.outboundFetch }) {
        this.channel = channel;
        this.transport = new real_adapters_1.HttpMessagingTransport((0, real_adapters_1.messagingKindOf)(channel), undefined, deps);
    }
    async send(m) {
        return this.transport.send({ to: m.to, body: m.body, reference: m.messageId ?? `${m.channel}:${m.templateId}:${m.to}`, templateId: m.templateId, locale: m.locale, subject: m.subject });
    }
}
exports.HttpMessagingAdapter = HttpMessagingAdapter;
class UnconfiguredAdapter {
    channel;
    mode = 'real';
    constructor(channel) {
        this.channel = channel;
    }
    async send() {
        throw new Error(`NEEDS_HUMAN: ${this.channel} real provider not configured (set ${this.channel}_API_URL / _API_KEY / _SENDER_ID / _WEBHOOK_SECRET; see Docs/PROVIDERS.md)`);
    }
}
exports.UnconfiguredAdapter = UnconfiguredAdapter;
function pushChannelFor(templateId) {
    if (/^(BOOKING|WAITLIST|DEPOSIT|TELE_SESSION)/.test(templateId))
        return 'kiorex-bookings';
    if (/^(FOLLOW_UP|REVIEW|CARE_PLAN)/.test(templateId))
        return 'kiorex-reminders';
    if (/^(PHARMACY|LAB|HOME_VISIT|RECORD)/.test(templateId))
        return 'kiorex-orders';
    return process.env.PUSH_ANDROID_CHANNEL_ID || 'kiorex-default';
}
class PushAdapter {
    sender;
    mode = 'real';
    channel = 'PUSH';
    constructor(sender = new push_1.PushSender((0, push_1.pushConfigFromEnv)(process.env), outbound_http_1.outboundFetch)) {
        this.sender = sender;
    }
    async send(m) {
        const r = await this.sender.send({ token: m.to, title: m.subject ?? 'Kiorex', body: m.body, data: { ...(m.data ?? {}), templateId: m.templateId }, channelId: pushChannelFor(m.templateId) });
        return { ok: r.ok, providerRef: r.providerRef ?? '', error: r.error, invalidToken: r.invalidToken };
    }
}
exports.PushAdapter = PushAdapter;
function channelMode(channel) {
    const k = (0, real_adapters_1.messagingKindOf)(channel);
    if (k)
        return (0, env_1.providerEnv)(k).mode;
    const m = process.env.PUSH_MODE;
    if (m === 'real' || m === 'mock')
        return m;
    return process.env.MESSAGING_MODE === 'real' ? 'real' : 'mock';
}
function createMessagingAdapter(channel) {
    if (channelMode(channel) === 'mock')
        return new MockAdapter(channel);
    if (channel === 'PUSH')
        return (0, push_1.pushProblems)(process.env).length ? new UnconfiguredAdapter(channel) : new PushAdapter();
    const k = (0, real_adapters_1.messagingKindOf)(channel);
    if (!k || (0, env_1.providerProblems)(k).length)
        return new UnconfiguredAdapter(channel);
    return new HttpMessagingAdapter(channel);
}
//# sourceMappingURL=adapters.js.map