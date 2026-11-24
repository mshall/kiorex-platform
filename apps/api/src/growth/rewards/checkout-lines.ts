import type { CHECKOUT_LINE_CODES } from '@kiorex/contracts';

export type CheckoutLineCode = (typeof CHECKOUT_LINE_CODES)[number];
export interface CheckoutLine { code: CheckoutLineCode; amountMinor: number; labelKey: string }

/**
 * The ordered lines of a checkout (founder rule: a price reduction first, then credit, then a deposit already held, then the card; every line is shown).
 * Pure. `PRICE` is the gross amount; the other lines are tenders or reductions that SUM TO IT (RC-3): price = sponsored + credit + heldDeposit + card.
 * Credit and a held deposit are limited so the card always keeps `minCardMinor` (at least one minor unit: the PSP never sees a zero charge), and no line is negative.
 * Order of use read as "tender order after any price reduction" (H-27, founder to confirm).
 */
export function composeCheckout(i: { priceMinor: number; sponsoredMinor?: number; creditMinor?: number; heldDepositMinor?: number; minCardMinor?: number }): { lines: CheckoutLine[]; creditMinor: number; cardMinor: number } {
  const price = i.priceMinor;
  if (!Number.isInteger(price) || price <= 0) throw new RangeError('priceMinor must be a positive integer');
  for (const [k, v] of Object.entries({ sponsored: i.sponsoredMinor, credit: i.creditMinor, held: i.heldDepositMinor, minCard: i.minCardMinor })) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new RangeError(`${k} must be a non-negative integer`);
  }
  const minCard = Math.max(i.minCardMinor ?? 0, 1);
  if (minCard > price) throw new RangeError('minCardMinor exceeds the price');
  let room = price - minCard;
  const sponsored = Math.min(i.sponsoredMinor ?? 0, room); room -= sponsored;
  const held = Math.min(i.heldDepositMinor ?? 0, room); room -= held;
  const credit = Math.min(i.creditMinor ?? 0, room);
  const card = price - sponsored - credit - held;
  const lines: CheckoutLine[] = [{ code: 'PRICE', amountMinor: price, labelKey: 'checkout.price' }];
  if (sponsored > 0) lines.push({ code: 'SPONSORED_DISCOUNT', amountMinor: -sponsored, labelKey: 'checkout.sponsored' });
  if (credit > 0) lines.push({ code: 'PATIENT_CREDIT', amountMinor: -credit, labelKey: 'checkout.credit' });
  if (held > 0) lines.push({ code: 'DEPOSIT_HELD', amountMinor: -held, labelKey: 'checkout.deposit_held' });
  lines.push({ code: 'CARD', amountMinor: card, labelKey: 'checkout.card' });
  return { lines, creditMinor: credit, cardMinor: card };
}

/** RC-3: the lines of a snapshot add up to the price: PRICE plus every reduction (negative lines) equals the CARD line, and nothing is out of order. */
export function linesBalance(lines: readonly CheckoutLine[]): boolean {
  const price = lines.find((l) => l.code === 'PRICE')?.amountMinor;
  const card = lines.find((l) => l.code === 'CARD')?.amountMinor;
  if (price === undefined || card === undefined || lines.filter((l) => l.code === 'PRICE' || l.code === 'CARD').length !== 2) return false;
  const reductions = lines.filter((l) => l.code !== 'PRICE' && l.code !== 'CARD').reduce((s, l) => s + l.amountMinor, 0);
  return reductions <= 0 && card >= 1 && price + reductions === card;
}
