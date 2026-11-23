import type { DepositDefaultPolicy, PartialFulfilmentPolicy } from './policy.defaults';

/** ISO 4217 minor-unit exponent (digits after the decimal point). Unknown currencies default to 2. */
const EXPONENT: Record<string, number> = { EGP: 2, SAR: 2, AED: 2, USD: 2, EUR: 2, GBP: 2, KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, JPY: 0, KRW: 0 };
export const minorExponent = (currency: string) => EXPONENT[(currency ?? '').toUpperCase()] ?? 2;
export const majorToMinor = (major: number, currency: string) => Math.round(major * 10 ** minorExponent(currency));

/**
 * Market default deposit = percent of the consultation fee, capped (cap given in MAJOR units, converted per currency exponent).
 * Returns 0 when the policy is disabled, the fee is unknown, or the result would be below one minor unit. Never exceeds the fee itself.
 */
export function depositFromPolicy(feeMinor: number | null | undefined, currency: string, p: DepositDefaultPolicy): number {
  if (!p.enabled || !feeMinor || feeMinor <= 0 || p.percentBps <= 0) return 0;
  const byPercent = Math.round((feeMinor * p.percentBps) / 10_000);
  const capMinor = p.capMajor > 0 ? majorToMinor(p.capMajor, currency) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(byPercent, capMinor, feeMinor));
}

export interface OrderLine { sku: string; name?: string; nameAr?: string; qty: number; unitPriceMinor: number }
export interface DispensedLine { sku: string; quantityDispensed: number }
export interface PartialRefundLine { sku: string; name: string; nameAr?: string; qtyOrdered: number; qtyFulfilled: number; qtyRefunded: number; unitPriceMinor: number; refundMinor: number }
export interface PartialSettlement {
  lines: PartialRefundLine[];
  goodsRefundMinor: number;
  deliveryFeeRefundMinor: number;
  refundTotalMinor: number;
  fulfilledGoodsMinor: number;
  /** Net amount that stays with the order after the refund = fulfilled goods + the delivery fee when it was kept (= what is released to the pharmacy). */
  keptMinor: number;
  nothingFulfilled: boolean;
}

/**
 * Pro-rata partial refund (policy pharmacy.partial_fulfilment). Integer minor units only.
 * - A line's refund = unit price x (ordered - dispensed): exactly "the price of the rejected/unavailable quantity".
 * - `dispensed` omitted for a sku => nothing of it was dispensed. Quantities are clamped to 0..ordered.
 * - The delivery fee is refunded when it is a DELIVERY order, the policy says so, and the delivery was not made (`deliveryMade === false`) or nothing was dispensed.
 */
export function computePartialSettlement(o: { items: OrderLine[]; deliveryMethod: string; deliveryFeeMinor: number; dispensed: DispensedLine[]; deliveryMade?: boolean }, policy: Pick<PartialFulfilmentPolicy, 'refundDeliveryFeeIfNotDelivered'>): PartialSettlement {
  const bySku = new Map<string, number>();
  for (const d of o.dispensed) bySku.set(d.sku, (bySku.get(d.sku) ?? 0) + Math.max(0, Math.floor(d.quantityDispensed)));
  const lines: PartialRefundLine[] = o.items.map((i) => {
    const want = bySku.get(i.sku) ?? 0;
    const fulfilled = Math.min(i.qty, want);
    bySku.set(i.sku, Math.max(0, want - fulfilled)); // a sku repeated in the order consumes the dispensed quantity once
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
