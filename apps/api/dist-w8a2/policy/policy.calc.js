"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.majorToMinor = exports.minorExponent = void 0;
exports.depositFromPolicy = depositFromPolicy;
exports.computePartialSettlement = computePartialSettlement;
const EXPONENT = { EGP: 2, SAR: 2, AED: 2, USD: 2, EUR: 2, GBP: 2, KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, JPY: 0, KRW: 0 };
const minorExponent = (currency) => EXPONENT[(currency ?? '').toUpperCase()] ?? 2;
exports.minorExponent = minorExponent;
const majorToMinor = (major, currency) => Math.round(major * 10 ** (0, exports.minorExponent)(currency));
exports.majorToMinor = majorToMinor;
function depositFromPolicy(feeMinor, currency, p) {
    if (!p.enabled || !feeMinor || feeMinor <= 0 || p.percentBps <= 0)
        return 0;
    const byPercent = Math.round((feeMinor * p.percentBps) / 10_000);
    const capMinor = p.capMajor > 0 ? (0, exports.majorToMinor)(p.capMajor, currency) : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(byPercent, capMinor, feeMinor));
}
function computePartialSettlement(o, policy) {
    const bySku = new Map();
    for (const d of o.dispensed) {
        const q = Number(d.quantityDispensed);
        bySku.set(d.sku, (bySku.get(d.sku) ?? 0) + (Number.isFinite(q) ? Math.max(0, Math.floor(q)) : q === Infinity ? Number.MAX_SAFE_INTEGER : 0));
    }
    const lines = o.items.map((i) => {
        const want = bySku.get(i.sku) ?? 0;
        const fulfilled = Math.min(i.qty, want);
        bySku.set(i.sku, Math.max(0, want - fulfilled));
        const refunded = i.qty - fulfilled;
        return { sku: i.sku, name: i.name ?? i.sku, ...(i.nameAr ? { nameAr: i.nameAr } : {}), qtyOrdered: i.qty, qtyFulfilled: fulfilled, qtyRefunded: refunded, unitPriceMinor: i.unitPriceMinor, refundMinor: refunded * i.unitPriceMinor };
    });
    const goodsRefund = lines.reduce((s, l) => s + l.refundMinor, 0);
    const fulfilledGoods = lines.reduce((s, l) => s + l.qtyFulfilled * l.unitPriceMinor, 0);
    const nothing = lines.every((l) => l.qtyFulfilled === 0);
    const deliveryNotMade = o.deliveryMade === false || nothing;
    const feeRefund = o.deliveryMethod === 'DELIVERY' && policy.refundDeliveryFeeIfNotDelivered && deliveryNotMade ? o.deliveryFeeMinor : 0;
    return { lines, goodsRefundMinor: goodsRefund, deliveryFeeRefundMinor: feeRefund, refundTotalMinor: goodsRefund + feeRefund, fulfilledGoodsMinor: fulfilledGoods, keptMinor: fulfilledGoods + (o.deliveryFeeMinor - feeRefund), nothingFulfilled: nothing };
}
//# sourceMappingURL=policy.calc.js.map