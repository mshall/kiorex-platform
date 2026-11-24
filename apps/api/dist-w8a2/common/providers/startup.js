"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushMode = void 0;
exports.providerStatus = providerStatus;
exports.verifyProviderStartup = verifyProviderStartup;
exports.logProviderStartup = logProviderStartup;
const common_1 = require("@nestjs/common");
const env_1 = require("./env");
const push_1 = require("./vendors/push");
const problems_1 = require("./problems");
const pushMode = (env = process.env) => (env.PUSH_MODE === 'real' || (!env.PUSH_MODE && env.MESSAGING_MODE === 'real') ? 'real' : 'mock');
exports.pushMode = pushMode;
function providerStatus(env = process.env) {
    const msg = (k) => { const p = (0, env_1.providerEnv)(k, env); return { provider: k.toLowerCase(), mode: p.mode, vendor: p.mode === 'real' ? p.provider : 'mock', ready: p.mode === 'mock' || (0, env_1.providerProblems)(k, env).length === 0 }; };
    const pay = (0, env_1.providerEnv)('PAYMENT', env);
    const vendorPay = (0, problems_1.PSP_VENDOR_MODE)(env);
    return [
        msg('SMS'), msg('EMAIL'), msg('WHATSAPP'),
        { provider: 'push', mode: (0, exports.pushMode)(env), vendor: (0, exports.pushMode)(env) === 'real' ? 'fcm+expo' : 'mock', ready: (0, exports.pushMode)(env) === 'mock' || (0, push_1.pushProblems)(env).length === 0 },
        { provider: 'payment', mode: pay.mode, vendor: pay.mode === 'real' ? (vendorPay ? 'vendor' : 'gateway') : 'mock', ready: pay.mode === 'mock' || (vendorPay ? (0, problems_1.vendorPspProblems)(env).length === 0 : (0, env_1.providerProblems)('PAYMENT', env).length === 0) },
        { provider: 'video', mode: env.VIDEO_MODE === 'clinic-p2p' ? 'real' : 'mock', vendor: env.VIDEO_MODE === 'clinic-p2p' ? 'clinic-p2p' : 'mock', ready: (0, problems_1.videoProblems)(env).length === 0 },
        { provider: 'maps', mode: env.MAPS_MODE === 'real' ? 'real' : 'mock', vendor: env.MAPS_MODE === 'real' ? 'amazon-location' : 'mock', ready: (0, problems_1.mapsProblems)(env).length === 0 },
        { provider: 'ai', mode: (env.AI_PROVIDER ?? 'fake') === 'fake' ? 'mock' : 'real', vendor: env.AI_PROVIDER ?? 'fake', ready: (0, problems_1.aiProblems)(env).length === 0 },
    ];
}
function verifyProviderStartup(env = process.env) {
    (0, env_1.assertProviderConfig)(env);
    const extra = [
        ...((0, env_1.providerEnv)('PAYMENT', env).mode === 'real' && (0, problems_1.PSP_VENDOR_MODE)(env) ? (0, problems_1.vendorPspProblems)(env) : []),
        ...((0, exports.pushMode)(env) === 'real' ? (0, push_1.pushProblems)(env) : []), ...(['mock', 'real', undefined, ''].includes(env.PUSH_MODE) ? [] : ['PUSH_MODE must be mock or real']),
        ...(0, problems_1.videoProblems)(env), ...(0, problems_1.mapsProblems)(env), ...(0, problems_1.aiProblems)(env),
    ];
    if (extra.length)
        throw new env_1.ProviderConfigError(extra);
    if (env.SAFETY_DELIVERY_MODE === 'real') {
        const problems = [];
        if ((0, env_1.providerEnv)('SMS', env).mode !== 'real')
            problems.push('SAFETY_DELIVERY_MODE=real requires SMS_MODE=real');
        if (!(env.SAFETY_ONCALL_PHONES ?? '').trim())
            problems.push('SAFETY_ONCALL_PHONES is required when SAFETY_DELIVERY_MODE=real');
        if (problems.length)
            throw new env_1.ProviderConfigError(problems);
    }
    return providerStatus(env).map((s) => `${s.provider}=${s.mode}`);
}
function logProviderStartup(env = process.env, log = new common_1.Logger('providers')) {
    const summary = verifyProviderStartup(env);
    log.log(`provider modes: ${summary.join(' ')}`);
    if (env.NODE_ENV === 'production') {
        const mocked = providerStatus(env).filter((s) => s.mode === 'mock').map((s) => s.provider);
        if (mocked.length)
            log.warn(`NODE_ENV=production but ${mocked.join(', ')} still run in MOCK mode (no real delivery / payments). Set <KIND>_MODE=real plus API_URL/API_KEY/SENDER_ID/WEBHOOK_SECRET to go live.`);
    }
}
//# sourceMappingURL=startup.js.map