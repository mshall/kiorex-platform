"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addMonths = exports.yearStart = exports.availableOf = void 0;
exports.consumeFifo = consumeFifo;
exports.expireAmount = expireAmount;
exports.reversalSplit = reversalSplit;
exports.maxRedeemable = maxRedeemable;
exports.entryKey = entryKey;
const node_crypto_1 = require("node:crypto");
const ms = (d) => (d instanceof Date ? d : new Date(d)).getTime();
function consumeFifo(lots, consumeMinor, now = new Date()) {
    if (!Number.isInteger(consumeMinor) || consumeMinor < 0)
        throw new RangeError('consumeMinor must be a non-negative integer');
    const t = ms(now);
    const usable = lots.filter((l) => l.remainingMinor > 0 && ms(l.expiresAt) > t)
        .sort((a, b) => Number(!!b.scoped) - Number(!!a.scoped) || ms(a.expiresAt) - ms(b.expiresAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let left = consumeMinor;
    const out = [];
    for (const l of usable) {
        if (left === 0)
            break;
        const take = Math.min(left, l.remainingMinor);
        out.push({ lotId: l.id, minor: take });
        left -= take;
    }
    return left === 0 ? out : null;
}
const availableOf = (lots, now = new Date()) => lots.filter((l) => ms(l.expiresAt) > ms(now)).reduce((s, l) => s + Math.max(0, l.remainingMinor), 0);
exports.availableOf = availableOf;
function expireAmount(i) {
    if (ms(i.at) < ms(i.expiresAt))
        return 0;
    return Math.max(0, i.issuedMinor - i.redeemedMinor - (i.reservedMinor ?? 0));
}
function reversalSplit(i) {
    const redeemed = Math.min(Math.max(0, i.redeemedMinor), i.issuedMinor);
    return { reverseMinor: i.issuedMinor - redeemed, recoverableLossMinor: redeemed };
}
function maxRedeemable(i) {
    const share = Math.floor((i.amountMinor * Math.min(Math.max(i.redemptionMaxBp, 0), 10_000)) / 10_000);
    const room = i.amountMinor - Math.max(i.minPayableMinor, 1);
    return Math.max(0, Math.min(i.availableMinor, share, room));
}
function entryKey(type, ...parts) {
    const t = type.toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(t))
        throw new TypeError(`entryKey: bad type ${type}`);
    const h = (0, node_crypto_1.createHash)('sha256').update(parts.join('|'), 'utf8').digest('base64url').slice(0, 43);
    return `rwd:${t}:${h}`;
}
const yearStart = (now) => new Date(now.getTime() - 365 * 86_400_000);
exports.yearStart = yearStart;
const addMonths = (d, months) => { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + months); return x; };
exports.addMonths = addMonths;
//# sourceMappingURL=reward-math.js.map