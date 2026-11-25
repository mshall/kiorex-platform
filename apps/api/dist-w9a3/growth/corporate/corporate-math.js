"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.benefitFor = benefitFor;
function benefitFor(i) {
    const ints = [i.depositMinor, i.memberRemainingMinor, i.accountRemainingMinor];
    if (ints.some((v) => !Number.isInteger(v) || v < 0))
        throw new RangeError('amounts must be non-negative integers');
    if (!i.coverBp || i.coverBp < 1 || i.coverBp > 10000)
        return 0;
    const room = Math.max(0, i.depositMinor - Math.max(i.minCardMinor ?? 1, 1));
    const byShare = Math.floor((i.depositMinor * i.coverBp) / 10000);
    const bounds = [room, byShare, i.memberRemainingMinor, i.accountRemainingMinor];
    if (i.perVisitMaxMinor !== null && i.perVisitMaxMinor !== undefined)
        bounds.push(Math.max(0, i.perVisitMaxMinor));
    return Math.max(0, Math.min(...bounds));
}
//# sourceMappingURL=corporate-math.js.map