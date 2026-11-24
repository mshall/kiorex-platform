"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiProblems = exports.mapsProblems = exports.videoProblems = exports.enabledPsps = exports.PSP_VENDOR_MODE = void 0;
exports.vendorPspProblems = vendorPspProblems;
const PSP_VENDOR_MODE = (env = process.env) => (env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() === 'vendor';
exports.PSP_VENDOR_MODE = PSP_VENDOR_MODE;
const enabledPsps = (env = process.env) => ((env.PAYMENT_ENABLED_PSPS ?? 'paymob').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s === 'paymob' || s === 'fawry' || s === 'instapay'));
exports.enabledPsps = enabledPsps;
const videoProblems = (env = process.env) => {
    const m = (env.VIDEO_MODE ?? 'mock').trim().toLowerCase();
    if (m === 'mock' || m === 'clinic-p2p')
        return [];
    return [`VIDEO_MODE must be mock or clinic-p2p (got "${env.VIDEO_MODE}"): Kiorex uses no video vendor, the Clinic owns the call`];
};
exports.videoProblems = videoProblems;
const mapsProblems = (env = process.env) => {
    if (env.MAPS_MODE !== 'real')
        return [];
    const out = [];
    if (!/^https:\/\/places\.geo\.[a-z0-9-]+\.amazonaws\.com/.test(env.MAPS_API_URL ?? '') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.MAPS_API_URL ?? ''))
        out.push('MAPS_API_URL must be https://places.geo.<region>.amazonaws.com when MAPS_MODE=real');
    if (!env.MAPS_API_KEY && !(env.MAPS_ACCESS_KEY_ID && env.MAPS_SECRET_ACCESS_KEY))
        out.push('MAPS_API_KEY (or MAPS_ACCESS_KEY_ID + MAPS_SECRET_ACCESS_KEY) is required when MAPS_MODE=real');
    return out;
};
exports.mapsProblems = mapsProblems;
const aiProblems = (env = process.env) => {
    const p = env.AI_PROVIDER ?? 'fake';
    if (p !== 'fake' && p !== 'openai-eu')
        return ['AI_PROVIDER must be fake or openai-eu'];
    if (p === 'fake')
        return [];
    const out = [];
    if (!(env.OPENAI_EU_API_KEY ?? '').trim())
        out.push('OPENAI_EU_API_KEY is required when AI_PROVIDER=openai-eu');
    if (!/^https:\/\//.test(env.OPENAI_EU_BASE_URL ?? ''))
        out.push('OPENAI_EU_BASE_URL (https, e.g. the EU data-residency endpoint) is required when AI_PROVIDER=openai-eu');
    return out;
};
exports.aiProblems = aiProblems;
function vendorPspProblems(env = process.env) {
    const out = [];
    const list = (0, exports.enabledPsps)(env);
    if (!list.length)
        out.push('PAYMENT_ENABLED_PSPS must list at least one of paymob,fawry,instapay');
    const need = (v) => v.filter((k) => !(env[k] ?? '').trim()).forEach((k) => out.push(`${k} is required when PAYMENT_MODE=real and PAYMENT_PROVIDER=vendor (${k.split('_')[0].toLowerCase()} enabled)`));
    if (list.includes('paymob')) {
        need(['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS']);
        if ((env.PAYMOB_INTEGRATION_IDS ?? '').split(',').some((s) => s.trim() && !/^\d+$/.test(s.trim())))
            out.push('PAYMOB_INTEGRATION_IDS must be a comma list of numbers');
    }
    if (list.includes('fawry'))
        need(['FAWRY_MERCHANT_CODE', 'FAWRY_SECURE_KEY']);
    if (list.includes('instapay')) {
        need(['INSTAPAY_API_URL', 'INSTAPAY_API_KEY', 'INSTAPAY_WEBHOOK_SECRET']);
        if ((env.INSTAPAY_WEBHOOK_SECRET ?? '').length < 16 && env.INSTAPAY_WEBHOOK_SECRET)
            out.push('INSTAPAY_WEBHOOK_SECRET must be at least 16 characters');
    }
    for (const P of ['PAYMOB', 'FAWRY', 'INSTAPAY']) {
        const u = (env[`${P}_API_URL`] ?? '').trim();
        if (u) {
            try {
                if (new URL(u).protocol !== 'https:' && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(u))
                    out.push(`${P}_API_URL must be https`);
            }
            catch {
                out.push(`${P}_API_URL is not a valid URL`);
            }
        }
    }
    if (env.NODE_ENV === 'production' && !/^https:\/\//.test(env.PUBLIC_BASE_URL ?? ''))
        out.push('PUBLIC_BASE_URL (public https origin of this API, used for PSP callbacks and return URLs) is required in production when PAYMENT_PROVIDER=vendor');
    return out;
}
//# sourceMappingURL=problems.js.map