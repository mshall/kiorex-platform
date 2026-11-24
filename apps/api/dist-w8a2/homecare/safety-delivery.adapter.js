"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safetyDelivery = exports.SmsSafetyDelivery = exports.UnconfiguredSafetyDelivery = exports.MockSafetyDelivery = void 0;
const config_1 = require("../common/config");
const env_1 = require("../common/providers/env");
const messaging_public_1 = require("../messaging/messaging-public");
class MockSafetyDelivery {
    mode = 'mock';
    static failNext = 0;
    async deliver(p) {
        if (MockSafetyDelivery.failNext > 0) {
            MockSafetyDelivery.failNext--;
            return { ok: false, ref: '', error: 'MOCK_PAGER_DOWN' };
        }
        return { ok: true, ref: `mock_oncall_${p.alertId}_L${p.level}` };
    }
}
exports.MockSafetyDelivery = MockSafetyDelivery;
class UnconfiguredSafetyDelivery {
    mode = 'real';
    async deliver() { return { ok: false, ref: '', error: 'NEEDS_HUMAN: on-call paging provider not configured (Docs/NEEDS_HUMAN.md, Provider go-live)' }; }
}
exports.UnconfiguredSafetyDelivery = UnconfiguredSafetyDelivery;
class SmsSafetyDelivery {
    mode = 'real';
    async deliver(p) {
        const phones = (0, config_1.cfg)().safetyOncallPhones;
        const sms = (0, messaging_public_1.createMessagingAdapter)('SMS');
        if (!phones.length || sms.mode !== 'real')
            return { ok: false, ref: '', error: 'ONCALL_NOT_CONFIGURED' };
        const body = `Kiorex SAFETY L${p.level} ${p.kind}${p.district ? ` ${p.district}` : ''} alert ${p.alertId}${p.bookingId ? ` booking ${p.bookingId}` : ''}`;
        const refs = [];
        let error;
        for (const to of phones) {
            try {
                const r = await sms.send({ channel: 'SMS', to, templateId: 'safety_oncall', locale: 'en', body, messageId: `safety:${p.alertId}:L${p.level}:${to}` });
                if (r.ok)
                    refs.push(r.providerRef);
                else
                    error = r.error;
            }
            catch (e) {
                error = String(e?.message ?? e).slice(0, 120);
            }
        }
        return refs.length ? { ok: true, ref: refs.join(',') } : { ok: false, ref: '', error: error ?? 'SEND_FAILED' };
    }
}
exports.SmsSafetyDelivery = SmsSafetyDelivery;
const safetyDelivery = () => {
    if ((0, config_1.cfg)().safetyDeliveryMode === 'mock')
        return new MockSafetyDelivery();
    return (0, env_1.providerProblems)('SMS').length || !(0, config_1.cfg)().safetyOncallPhones.length ? new UnconfiguredSafetyDelivery() : new SmsSafetyDelivery();
};
exports.safetyDelivery = safetyDelivery;
//# sourceMappingURL=safety-delivery.adapter.js.map