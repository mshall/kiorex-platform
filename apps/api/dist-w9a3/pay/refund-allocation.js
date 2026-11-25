"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateRefund = allocateRefund;
exports.sponsoredVoidedByRefund = sponsoredVoidedByRefund;
function allocateRefund(i) {
    for (const [k, v] of Object.entries(i))
        if (!Number.isInteger(v) || v < 0)
            throw new RangeError(`${k} must be a non-negative integer`);
    if (i.priceMinor === 0)
        throw new RangeError('priceMinor must be positive');
    if (i.refundableMinor > i.priceMinor)
        throw new RangeError('refundableMinor exceeds the price');
    const r = i.refundableMinor / i.priceMinor;
    const paid = i.creditMinor + i.cardMinor + i.heldDepositMinor;
    const patientPaidRefundableMinor = Math.min(paid, Math.round(r * paid));
    const creditRestoredMinor = Math.min(i.creditMinor, patientPaidRefundableMinor, Math.round(r * i.creditMinor));
    return { patientPaidRefundableMinor, creditRestoredMinor, cardRefundMinor: patientPaidRefundableMinor - creditRestoredMinor, sponsoredVoidedMinor: Math.min(i.sponsoredMinor, Math.round(r * i.sponsoredMinor)) };
}
function sponsoredVoidedByRefund(i) {
    for (const [k, v] of Object.entries(i))
        if (!Number.isInteger(v) || v < 0)
            throw new RangeError(`${k} must be a non-negative integer`);
    if (i.sponsoredMinor === 0 || i.cardMinor === 0)
        return 0;
    const after = i.cardRefundedAfterMinor >= i.cardMinor ? i.sponsoredMinor : Math.min(i.sponsoredMinor, Math.round((i.sponsoredMinor * i.cardRefundedAfterMinor) / i.cardMinor));
    return Math.max(0, after - i.alreadyVoidedMinor);
}
//# sourceMappingURL=refund-allocation.js.map