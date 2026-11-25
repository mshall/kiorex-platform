"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskCoupon = exports.couponHash = exports.COUPON_PATTERN = exports.COUPON_LENGTH = void 0;
exports.generateCoupon = generateCoupon;
exports.normalizeCoupon = normalizeCoupon;
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("@kiorex/contracts");
const privacy_hash_1 = require("../../common/privacy-hash");
exports.COUPON_LENGTH = 10;
exports.COUPON_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
function generateCoupon(rand = (n) => (0, node_crypto_1.randomInt)(n)) {
    let s = '';
    for (let i = 0; i < exports.COUPON_LENGTH; i++)
        s += contracts_1.REFERRAL_CODE_ALPHABET[rand(contracts_1.REFERRAL_CODE_ALPHABET.length)];
    return s;
}
function normalizeCoupon(raw) {
    if (typeof raw !== 'string')
        return null;
    const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return exports.COUPON_PATTERN.test(s) ? s : null;
}
const couponHash = (code) => (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('reward-coupon')).update(code).digest('base64url');
exports.couponHash = couponHash;
const maskCoupon = (code) => `${'•'.repeat(exports.COUPON_LENGTH - 4)}${code.slice(-4)}`;
exports.maskCoupon = maskCoupon;
//# sourceMappingURL=reward-coupon.js.map