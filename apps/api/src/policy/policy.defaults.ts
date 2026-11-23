/**
 * Business-policy defaults (founder delegation, 23 Nov 2026).
 *
 * Every value here is a PROPOSED_DEFAULT delegated by founder 23 Nov 2026: a starting point that ships so the flows work end to end, NOT a
 * ratified commercial or legal decision. Nothing below is enforced as a constant: each value is resolved at call time through PolicyService
 * (ORG override > MARKET override > GLOBAL override > this default), so ops can change it per market or per organisation without a deploy.
 * Counsel / CFO review is still required before paid beta (Docs/NEEDS_HUMAN.md #1 and #22).
 */
export const PROPOSED_DEFAULT_NOTE = 'PROPOSED_DEFAULT delegated by founder 23 Nov 2026';

export type PolicyScope = 'GLOBAL' | 'MARKET' | 'ORG';

/** pay.deposit_default: market-level default deposit, applied ONLY to providers that enabled deposits and carry no explicit deposit amount. */
export interface DepositDefaultPolicy {
  /** false => the market default is never applied (deposits then need an explicit provider amount or DEPOSIT_DEFAULT_MINOR). */
  enabled: boolean;
  /** Share of the consultation fee, in basis points (1000 = 10%). */
  percentBps: number;
  /** Cap in MAJOR currency units (200 = 200 EGP); converted with the currency's minor-unit exponent (EGP 2, KWD 3, JPY 0). */
  capMajor: number;
}

/** pharmacy.partial_fulfilment: what happens to a PARTIAL_REVIEW order (some lines rejected / unavailable). */
export interface PartialFulfilmentPolicy {
  /** PRO_RATA_REFUND: refund rejected/unavailable lines automatically; MANUAL_REVIEW: park in PARTIAL_REVIEW for ops (the pre-23-Nov behaviour). */
  mode: 'PRO_RATA_REFUND' | 'MANUAL_REVIEW';
  /** DELIVERY orders: refund the delivery fee when the delivery is not made (pharmacy reports deliveryMade=false, or nothing was dispensed). */
  refundDeliveryFeeIfNotDelivered: boolean;
  /** Funds of the fulfilled lines are released to the pharmacy (minus the marketplace take) when the refund is issued. */
  releaseFulfilledToPharmacy: boolean;
}

export interface PolicyDef<T> {
  key: string;
  titleEn: string; titleAr: string;
  descriptionEn: string; descriptionAr: string;
  defaults: T;
  /** Scopes where an override may be stored. */
  scopes: PolicyScope[];
  validate(v: unknown): T;
}

const bad = (m: string): never => { throw new Error(m); };
const int = (v: unknown, name: string, min: number, max: number) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) bad(`${name} must be an integer between ${min} and ${max}`); return n; };
const bool = (v: unknown, name: string) => { if (typeof v !== 'boolean') bad(`${name} must be true or false`); return v as boolean; };

export const DEPOSIT_DEFAULT: PolicyDef<DepositDefaultPolicy> = {
  key: 'pay.deposit_default',
  titleEn: 'Default deposit', titleAr: 'العربون الافتراضي',
  descriptionEn: 'Market default deposit: a share of the consultation fee, capped. Applied only to providers that enabled deposits and set no explicit deposit amount. DEPOSIT_DEFAULT_MINOR stays 0 for everyone else.',
  descriptionAr: 'عربون افتراضي للسوق: نسبة من سعر الكشف بحد أقصى. يُطبّق فقط على مقدمي الخدمة الذين فعّلوا العربون دون تحديد مبلغ. تبقى قيمة DEPOSIT_DEFAULT_MINOR صفرًا لغيرهم.',
  defaults: { enabled: true, percentBps: 1000, capMajor: 200 },
  scopes: ['GLOBAL', 'MARKET', 'ORG'],
  validate(v) {
    const o = (v ?? {}) as Record<string, unknown>;
    return { enabled: bool(o.enabled, 'enabled'), percentBps: int(o.percentBps, 'percentBps', 0, 10000), capMajor: int(o.capMajor, 'capMajor', 0, 1_000_000) };
  },
};

export const PARTIAL_FULFILMENT: PolicyDef<PartialFulfilmentPolicy> = {
  key: 'pharmacy.partial_fulfilment',
  titleEn: 'Partial pharmacy orders', titleAr: 'الطلبات الجزئية للصيدلية',
  descriptionEn: 'Refund the price of rejected/unavailable lines pro-rata (plus the delivery fee if the delivery is not made); funds of the fulfilled lines are released to the pharmacy; the patient sees an itemised refund.',
  descriptionAr: 'يُرد ثمن الأصناف المرفوضة أو غير المتوفرة بنسبة وتناسب (مع رسوم التوصيل إذا لم يتم التوصيل)، ويُحوَّل ثمن الأصناف المصروفة إلى الصيدلية، ويرى المريض ردًا مفصّلًا.',
  defaults: { mode: 'PRO_RATA_REFUND', refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true },
  scopes: ['GLOBAL', 'MARKET', 'ORG'],
  validate(v) {
    const o = (v ?? {}) as Record<string, unknown>;
    if (o.mode !== 'PRO_RATA_REFUND' && o.mode !== 'MANUAL_REVIEW') bad('mode must be PRO_RATA_REFUND or MANUAL_REVIEW');
    return { mode: o.mode as PartialFulfilmentPolicy['mode'], refundDeliveryFeeIfNotDelivered: bool(o.refundDeliveryFeeIfNotDelivered, 'refundDeliveryFeeIfNotDelivered'), releaseFulfilledToPharmacy: bool(o.releaseFulfilledToPharmacy, 'releaseFulfilledToPharmacy') };
  },
};

export const POLICY_DEFS = { [DEPOSIT_DEFAULT.key]: DEPOSIT_DEFAULT, [PARTIAL_FULFILMENT.key]: PARTIAL_FULFILMENT } as const;
export type PolicyKey = keyof PolicyValues;
export const POLICY_KEYS = Object.keys(POLICY_DEFS) as PolicyKey[];

/** Typed value per key (the resolver returns exactly these). */
export interface PolicyValues { 'pay.deposit_default': DepositDefaultPolicy; 'pharmacy.partial_fulfilment': PartialFulfilmentPolicy }
