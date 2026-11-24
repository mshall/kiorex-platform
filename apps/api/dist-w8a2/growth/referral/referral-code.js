"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteDeepLink = exports.CODE_DENY_SUBSTRINGS = void 0;
exports.isAcceptableCode = isAcceptableCode;
exports.generateReferralCode = generateReferralCode;
exports.normalizeReferralCode = normalizeReferralCode;
exports.inviteUrl = inviteUrl;
exports.shareText = shareText;
const market_core_public_1 = require("../../market/market-core-public");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("@kiorex/contracts");
exports.CODE_DENY_SUBSTRINGS = ['SEX', 'ASS', 'TIT', 'KKK', 'NAZI', 'HATE', 'DIE', 'RAPE', 'ZEB', 'KOS', 'ZIFT', 'SHRM', 'NEEK', 'GAY', 'HIV', 'COVID', 'ISIS', '666', '911'];
function isAcceptableCode(code) {
    if (!contracts_1.REFERRAL_CODE_PATTERN.test(code))
        return false;
    if (/(.)\1{3,}/.test(code))
        return false;
    if (new Set(code).size < 4)
        return false;
    return !exports.CODE_DENY_SUBSTRINGS.some((w) => code.includes(w));
}
function generateReferralCode(rand = (n) => (0, node_crypto_1.randomInt)(n)) {
    for (let attempt = 0; attempt < 50; attempt++) {
        let s = '';
        for (let i = 0; i < 8; i++)
            s += contracts_1.REFERRAL_CODE_ALPHABET[rand(contracts_1.REFERRAL_CODE_ALPHABET.length)];
        if (isAcceptableCode(s))
            return s;
    }
    throw new Error('referral code generator exhausted its attempts');
}
function normalizeReferralCode(raw) {
    if (typeof raw !== 'string' || raw.length > 40)
        return null;
    const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return contracts_1.REFERRAL_CODE_PATTERN.test(s) ? s : null;
}
const HOST = () => (process.env.SITE_CANONICAL_HOST?.replace(/\/+$/, '') || 'https://kiorex.com');
function inviteUrl(code, o = {}) {
    const loc = o.locale === 'en' ? 'en' : 'ar';
    const cc = /^[A-Z]{2}$/.test(o.market ?? '') ? o.market.toLowerCase() : market_core_public_1.DEFAULT_MARKET.toLowerCase();
    return `${HOST()}/${loc}/${cc}/invite/${code}`;
}
const inviteDeepLink = (code) => `kiorex://invite/${code}`;
exports.inviteDeepLink = inviteDeepLink;
function shareText(code, o = {}) {
    const url = inviteUrl(code, o);
    return o.locale === 'en'
        ? `A friend invited you to Kiorex, where you can book a visit with a doctor. Join here: ${url}`
        : `صديق دعاك لتجربة كيوريكس لحجز موعد مع طبيب. سجّل من هنا: ${url}`;
}
//# sourceMappingURL=referral-code.js.map