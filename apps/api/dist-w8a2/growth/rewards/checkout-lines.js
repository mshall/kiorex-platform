"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeCheckout = composeCheckout;
exports.linesBalance = linesBalance;
function composeCheckout(i) {
    const price = i.priceMinor;
    if (!Number.isInteger(price) || price <= 0)
        throw new RangeError('priceMinor must be a positive integer');
    for (const [k, v] of Object.entries({ sponsored: i.sponsoredMinor, credit: i.creditMinor, held: i.heldDepositMinor, minCard: i.minCardMinor })) {
        if (v !== undefined && (!Number.isInteger(v) || v < 0))
            throw new RangeError(`${k} must be a non-negative integer`);
    }
    const minCard = Math.max(i.minCardMinor ?? 0, 1);
    if (minCard > price)
        throw new RangeError('minCardMinor exceeds the price');
    let room = price - minCard;
    const sponsored = Math.min(i.sponsoredMinor ?? 0, room);
    room -= sponsored;
    const held = Math.min(i.heldDepositMinor ?? 0, room);
    room -= held;
    const credit = Math.min(i.creditMinor ?? 0, room);
    const card = price - sponsored - credit - held;
    const lines = [{ code: 'PRICE', amountMinor: price, labelKey: 'checkout.price' }];
    if (sponsored > 0)
        lines.push({ code: 'SPONSORED_DISCOUNT', amountMinor: -sponsored, labelKey: 'checkout.sponsored' });
    if (credit > 0)
        lines.push({ code: 'PATIENT_CREDIT', amountMinor: -credit, labelKey: 'checkout.credit' });
    if (held > 0)
        lines.push({ code: 'DEPOSIT_HELD', amountMinor: -held, labelKey: 'checkout.deposit_held' });
    lines.push({ code: 'CARD', amountMinor: card, labelKey: 'checkout.card' });
    return { lines, creditMinor: credit, cardMinor: card };
}
function linesBalance(lines) {
    const price = lines.find((l) => l.code === 'PRICE')?.amountMinor;
    const card = lines.find((l) => l.code === 'CARD')?.amountMinor;
    if (price === undefined || card === undefined || lines.filter((l) => l.code === 'PRICE' || l.code === 'CARD').length !== 2)
        return false;
    const reductions = lines.filter((l) => l.code !== 'PRICE' && l.code !== 'CARD').reduce((s, l) => s + l.amountMinor, 0);
    return reductions <= 0 && card >= 1 && price + reductions === card;
}
//# sourceMappingURL=checkout-lines.js.map