"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.token = exports.utmCampaignOf = exports.MEDIUM_BY_CHANNEL = exports.CAMPAIGN_KEY = exports.UTM_TOKEN = void 0;
exports.validateUtmConfig = validateUtmConfig;
exports.buildUtm = buildUtm;
exports.trackedLinks = trackedLinks;
exports.UTM_TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
exports.CAMPAIGN_KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;
exports.MEDIUM_BY_CHANNEL = {
    ORGANIC_SEARCH: 'organic', EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp', PUSH: 'push', IN_APP: 'in_app', PARTNER: 'partner', PAID_SEARCH: 'cpc', PAID_SOCIAL: 'paid_social', PAID_VIDEO: 'paid_video', OFFLINE: 'offline', REFERRAL: 'referral',
};
const utmCampaignOf = (market, key) => `${market.toLowerCase()}-${key}`;
exports.utmCampaignOf = utmCampaignOf;
const token = (v, max = 40) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').replace(/-{2,}/g, '-').slice(0, Math.min(max, 64));
exports.token = token;
function validateUtmConfig(c, max) {
    const errors = [];
    const out = {};
    if (c === undefined || c === null)
        return { valid: true, value: {} };
    if (typeof c !== 'object' || Array.isArray(c))
        return { valid: false, errors: ['/utmConfig: must be an object'] };
    const o = c;
    for (const k of Object.keys(o))
        if (!['source', 'medium', 'content', 'term', 'targetPath', 'locale'].includes(k))
            errors.push(`/utmConfig/${k}: unknown key`);
    for (const k of ['source', 'medium', 'content', 'term'])
        if (o[k] !== undefined) {
            const v = o[k];
            if (typeof v !== 'string' || !exports.UTM_TOKEN.test(v) || v.length > max)
                errors.push(`/utmConfig/${k}: lower-case a-z, 0-9, _ or - only, at most ${max} characters`);
            else
                out[k] = v;
        }
    if (o.targetPath !== undefined) {
        const p = o.targetPath;
        if (typeof p !== 'string' || !/^\/[A-Za-z0-9/_.~%-]{0,200}$/.test(p) || p.includes('//') || p.includes('..'))
            errors.push('/utmConfig/targetPath: a site-relative path such as /doctors');
        else
            out.targetPath = p;
    }
    if (o.locale !== undefined) {
        if (o.locale === 'ar' || o.locale === 'en')
            out.locale = o.locale;
        else
            errors.push('/utmConfig/locale: ar or en');
    }
    return errors.length ? { valid: false, errors } : { valid: true, value: out };
}
function buildUtm(i) {
    const medium = i.config.medium ?? exports.MEDIUM_BY_CHANNEL[i.channels[0] ?? ''] ?? 'campaign';
    return { utm_source: i.config.source ?? 'kiorex', utm_medium: medium, utm_campaign: (0, exports.utmCampaignOf)(i.market, i.key), ...(i.config.content ? { utm_content: i.config.content } : {}), ...(i.config.term ? { utm_term: i.config.term } : {}) };
}
function trackedLinks(i) {
    const utm = buildUtm(i);
    const locale = i.config.locale ?? i.locale ?? 'ar';
    const landingPath = `/${locale}/${i.market.toLowerCase()}${i.config.targetPath ?? ''}`;
    const qs = new URLSearchParams(Object.entries(utm)).toString();
    const url = `${i.host.replace(/\/+$/, '')}${landingPath}?${qs}`;
    return { webUrl: url, appLink: url, landingPath, utm };
}
//# sourceMappingURL=campaign-utm.js.map