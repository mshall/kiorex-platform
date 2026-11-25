"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderConfigError = exports.mockWebhookSecret = exports.NATIVE_VENDORS = exports.PROVIDER_KINDS = void 0;
exports.providerEnv = providerEnv;
exports.providerProblems = providerProblems;
exports.assertProviderConfig = assertProviderConfig;
exports.PROVIDER_KINDS = ['SMS', 'EMAIL', 'WHATSAPP', 'PAYMENT'];
exports.NATIVE_VENDORS = {
    WHATSAPP: { name: 'meta', defaultUrl: 'https://graph.facebook.com/v21.0' },
    EMAIL: { name: 'ses' },
    SMS: { name: 'twilio', defaultUrl: 'https://api.twilio.com', secretFromKey: (k) => k.slice(k.indexOf(':') + 1) },
};
const providerName = (kind, env) => { const v = (env[`${kind}_PROVIDER`] ?? '').trim().toLowerCase(); return v === exports.NATIVE_VENDORS[kind]?.name ? v : 'gateway'; };
const NEEDS_SENDER = { SMS: true, EMAIL: true, WHATSAPP: true, PAYMENT: false };
const mockWebhookSecret = (kind) => (kind === 'WHATSAPP' ? 'wa_dev_webhook_secret_change_me' : `mock_${kind.toLowerCase()}_webhook_secret`);
exports.mockWebhookSecret = mockWebhookSecret;
const intOr = (v, d, min) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? Math.floor(n) : d;
};
function rawMode(kind, env) {
    const v = env[`${kind}_MODE`];
    if (v !== undefined && v !== '')
        return v;
    if (kind === 'PAYMENT') {
        const legacy = env.PSP_MODE;
        if (!legacy)
            return undefined;
        return legacy === 'sandbox-fake' ? 'mock' : 'real';
    }
    return env.MESSAGING_MODE === 'real' ? 'real' : undefined;
}
function providerEnv(kind, env = process.env) {
    const mode = rawMode(kind, env) === 'real' ? 'real' : 'mock';
    const provider = providerName(kind, env);
    const native = provider !== 'gateway' ? exports.NATIVE_VENDORS[kind] : undefined;
    const apiKey = env[`${kind}_API_KEY`] ?? '';
    return {
        kind,
        mode,
        provider,
        publicWebhookUrl: (env[`${kind}_WEBHOOK_PUBLIC_URL`] ?? '').trim(),
        apiUrl: ((env[`${kind}_API_URL`] ?? '').trim() || native?.defaultUrl || '').replace(/\/+$/, ''),
        apiKey,
        senderId: env[`${kind}_SENDER_ID`] ?? '',
        webhookSecret: env[`${kind}_WEBHOOK_SECRET`] || (mode === 'mock' ? (0, exports.mockWebhookSecret)(kind) : native?.secretFromKey && apiKey.includes(':') ? native.secretFromKey(apiKey) : ''),
        timeoutMs: intOr(env[`${kind}_TIMEOUT_MS`], 8000, 1),
        maxRetries: intOr(env[`${kind}_MAX_RETRIES`], 2, 0),
    };
}
const isLoopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
function providerProblems(kind, env = process.env) {
    const out = [];
    const raw = rawMode(kind, env);
    if (raw !== undefined && raw !== 'mock' && raw !== 'real')
        out.push(`${kind}_MODE must be mock or real`);
    const p = providerEnv(kind, env);
    if (p.mode !== 'real')
        return out;
    if (kind === 'PAYMENT' && (env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() === 'vendor')
        return out;
    if (!p.apiUrl)
        out.push(`${kind}_API_URL is required when ${kind}_MODE=real`);
    else {
        try {
            const u = new URL(p.apiUrl);
            if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname)))
                out.push(`${kind}_API_URL must be https`);
        }
        catch {
            out.push(`${kind}_API_URL is not a valid URL`);
        }
    }
    if (!p.apiKey)
        out.push(`${kind}_API_KEY is required when ${kind}_MODE=real`);
    if (!p.webhookSecret)
        out.push(`${kind}_WEBHOOK_SECRET is required when ${kind}_MODE=real`);
    else if (p.webhookSecret.length < 16)
        out.push(`${kind}_WEBHOOK_SECRET must be at least 16 characters`);
    if (NEEDS_SENDER[kind] && !p.senderId)
        out.push(`${kind}_SENDER_ID is required when ${kind}_MODE=real`);
    const rawProvider = (env[`${kind}_PROVIDER`] ?? '').trim().toLowerCase();
    if (rawProvider && rawProvider !== 'gateway' && rawProvider !== exports.NATIVE_VENDORS[kind]?.name)
        out.push(`${kind}_PROVIDER must be gateway${exports.NATIVE_VENDORS[kind] ? ` or ${exports.NATIVE_VENDORS[kind].name}` : ''}`);
    if (p.provider === 'meta' && !(env.WHATSAPP_VERIFY_TOKEN ?? '').trim())
        out.push('WHATSAPP_VERIFY_TOKEN is required when WHATSAPP_PROVIDER=meta');
    if (p.provider === 'ses') {
        if (!/^[^:]+:[^:]+(:.+)?$/.test(p.apiKey))
            out.push('EMAIL_API_KEY must be "<ACCESS_KEY_ID>:<SECRET_ACCESS_KEY>" when EMAIL_PROVIDER=ses');
        if (!/\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com/.test(p.apiUrl))
            out.push('EMAIL_API_URL must be https://email.<region>.amazonaws.com when EMAIL_PROVIDER=ses');
    }
    if (p.provider === 'twilio') {
        if (!/^[^:]+:.+$/.test(p.apiKey))
            out.push('SMS_API_KEY must be "<AccountSid>:<AuthToken>" when SMS_PROVIDER=twilio');
        if (!p.publicWebhookUrl)
            out.push('SMS_WEBHOOK_PUBLIC_URL is required when SMS_PROVIDER=twilio (the URL Twilio signs)');
    }
    return out;
}
class ProviderConfigError extends Error {
    problems;
    constructor(problems) {
        super(`Provider configuration invalid: ${problems.join('; ')}`);
        this.problems = problems;
        this.name = 'ProviderConfigError';
    }
}
exports.ProviderConfigError = ProviderConfigError;
function assertProviderConfig(env = process.env, kinds = exports.PROVIDER_KINDS) {
    const problems = kinds.flatMap((k) => providerProblems(k, env));
    if (problems.length)
        throw new ProviderConfigError(problems);
}
//# sourceMappingURL=env.js.map