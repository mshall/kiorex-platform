"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConfigured = exports.HttpMessagingTransport = exports.messagingKindOf = exports.messagingMapping = exports.MESSAGING_MAPPINGS = void 0;
exports.mappingFor = mappingFor;
const env_1 = require("./env");
const http_1 = require("./http");
const sms_mapping_1 = require("./sms.mapping");
const email_mapping_1 = require("./email.mapping");
const whatsapp_mapping_1 = require("./whatsapp.mapping");
const whatsapp_meta_mapping_1 = require("./whatsapp.meta.mapping");
const email_ses_mapping_1 = require("./email.ses.mapping");
const sms_twilio_mapping_1 = require("./sms.twilio.mapping");
exports.MESSAGING_MAPPINGS = { SMS: sms_mapping_1.smsMapping, EMAIL: email_mapping_1.emailMapping, WHATSAPP: whatsapp_mapping_1.whatsappMapping };
const VENDOR_MAPPINGS = { SMS: { twilio: sms_twilio_mapping_1.smsTwilioMapping }, EMAIL: { ses: email_ses_mapping_1.emailSesMapping }, WHATSAPP: { meta: whatsapp_meta_mapping_1.whatsappMetaMapping } };
function mappingFor(kind, e) {
    return (e.mode === 'real' && VENDOR_MAPPINGS[kind][e.provider]) || exports.MESSAGING_MAPPINGS[kind];
}
const messagingMapping = (kind, env = process.env) => mappingFor(kind, (0, env_1.providerEnv)(kind, env));
exports.messagingMapping = messagingMapping;
const messagingKindOf = (channel) => (channel === 'SMS' || channel === 'EMAIL' || channel === 'WHATSAPP' ? channel : undefined);
exports.messagingKindOf = messagingKindOf;
class HttpMessagingTransport {
    kind;
    env;
    deps;
    mapping;
    mode = 'real';
    constructor(kind, env = (0, env_1.providerEnv)(kind), deps = {}, mapping = mappingFor(kind, env)) {
        this.kind = kind;
        this.env = env;
        this.deps = deps;
        this.mapping = mapping;
    }
    async send(m) {
        try {
            const wire = this.mapping.buildSend({ to: m.to, body: m.body, senderId: this.env.senderId, reference: m.reference, templateId: m.templateId, locale: m.locale, variables: m.variables, subject: m.subject, apiUrl: this.env.apiUrl, apiKey: this.env.apiKey, publicWebhookUrl: this.env.publicWebhookUrl || undefined });
            const r = await (0, http_1.providerRequest)(this.env, { path: wire.path, body: wire.body, form: wire.form, sign: wire.sign, headers: wire.headers, idempotencyKey: m.reference }, this.deps, this.mapping.authHeaders(this.env.apiKey));
            return { ok: true, providerRef: this.mapping.parseSend(r.json).providerRef };
        }
        catch (e) {
            if (e instanceof http_1.ProviderError)
                return { ok: false, providerRef: '', error: e.message };
            return { ok: false, providerRef: '', error: 'PROVIDER_BAD_RESPONSE' };
        }
    }
}
exports.HttpMessagingTransport = HttpMessagingTransport;
const isConfigured = (kind, env = process.env) => (0, env_1.providerEnv)(kind, env).mode === 'real' && (0, env_1.providerProblems)(kind, env).length === 0;
exports.isConfigured = isConfigured;
//# sourceMappingURL=real-adapters.js.map