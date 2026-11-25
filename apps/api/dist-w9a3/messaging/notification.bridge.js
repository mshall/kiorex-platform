"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InboxChannelAdapter = exports.HubChannelAdapter = void 0;
exports.flattenBody = flattenBody;
const notify_1 = require("@kiorex/contracts/notify");
const env_1 = require("../common/providers/env");
const real_adapters_1 = require("../common/providers/real-adapters");
function flattenBody(m) {
    switch (m.channel) {
        case 'SMS': return m.body.text;
        case 'EMAIL': return m.body.text;
        case 'PUSH': return m.body.body;
        case 'INAPP': return m.body.body;
        case 'WHATSAPP': {
            const b = m.body;
            return b.text ?? b.template?.vars.body ?? '';
        }
    }
}
class HubChannelAdapter {
    channel;
    hub;
    constructor(channel, hub) {
        this.channel = channel;
        this.hub = hub;
    }
    get mode() { return this.hub.channelMode(this.channel); }
    async send(m) {
        const r = await this.hub.send({
            messageId: m.metadata?.messageId, channel: this.channel, sub: m.metadata?.sub, to: m.to,
            templateId: m.metadata?.templateId ?? m.type, locale: m.locale, body: flattenBody(m), subject: m.channel === 'EMAIL' ? m.body.subject : m.channel === 'PUSH' ? m.body.title : undefined,
        });
        return { ok: r.ok, providerRef: r.providerRef ?? undefined, error: r.error ?? undefined };
    }
    parseWebhook(rawBody) {
        const kind = (0, real_adapters_1.messagingKindOf)(this.channel);
        if (!kind)
            return [];
        const out = [];
        for (const e of (0, real_adapters_1.messagingMapping)(kind).parseStatusWebhook(rawBody)) {
            const status = (0, notify_1.normalizeVendorStatus)(this.channel, e.status);
            if (status)
                out.push({ providerRef: e.providerRef, status, ...(e.error ? { error: e.error } : {}), ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}) });
        }
        return out;
    }
    verify(rawBody, headers = {}) {
        const kind = (0, real_adapters_1.messagingKindOf)(this.channel);
        if (!kind)
            return false;
        return (0, real_adapters_1.messagingMapping)(kind).verifyWebhook({ secret: (0, env_1.providerEnv)(kind).webhookSecret, rawBody, headers });
    }
}
exports.HubChannelAdapter = HubChannelAdapter;
class InboxChannelAdapter {
    channel = 'INAPP';
    mode = 'real';
    async send(m) { return { ok: true, providerRef: `inapp:${m.metadata?.messageId ?? m.notificationId}` }; }
    parseWebhook() { return []; }
    verify() { return false; }
}
exports.InboxChannelAdapter = InboxChannelAdapter;
//# sourceMappingURL=notification.bridge.js.map