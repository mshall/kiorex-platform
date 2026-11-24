"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLICY_KEYS = exports.POLICY_DEFS = exports.PARTIAL_FULFILMENT = exports.DEPOSIT_DEFAULT = exports.PROPOSED_DEFAULT_NOTE = void 0;
exports.PROPOSED_DEFAULT_NOTE = 'PROPOSED_DEFAULT delegated by founder 23 Nov 2026';
const bad = (m) => { throw new Error(m); };
const int = (v, name, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max)
    bad(`${name} must be an integer between ${min} and ${max}`); return n; };
const bool = (v, name) => { if (typeof v !== 'boolean')
    bad(`${name} must be true or false`); return v; };
exports.DEPOSIT_DEFAULT = {
    key: 'pay.deposit_default',
    titleEn: 'Default deposit', titleAr: 'العربون الافتراضي',
    descriptionEn: 'Market default deposit: a share of the consultation fee, capped. Applied only to providers that enabled deposits and set no explicit deposit amount. DEPOSIT_DEFAULT_MINOR stays 0 for everyone else.',
    descriptionAr: 'عربون افتراضي للسوق: نسبة من سعر الكشف بحد أقصى. يُطبّق فقط على مقدمي الخدمة الذين فعّلوا العربون دون تحديد مبلغ. تبقى قيمة DEPOSIT_DEFAULT_MINOR صفرًا لغيرهم.',
    defaults: { enabled: true, percentBps: 1000, capMajor: 200 },
    scopes: ['GLOBAL', 'MARKET', 'ORG'],
    validate(v) {
        const o = (v ?? {});
        return { enabled: bool(o.enabled, 'enabled'), percentBps: int(o.percentBps, 'percentBps', 0, 10000), capMajor: int(o.capMajor, 'capMajor', 0, 1_000_000) };
    },
};
exports.PARTIAL_FULFILMENT = {
    key: 'pharmacy.partial_fulfilment',
    titleEn: 'Partial pharmacy orders', titleAr: 'الطلبات الجزئية للصيدلية',
    descriptionEn: 'Refund the price of rejected/unavailable lines pro-rata (plus the delivery fee if the delivery is not made); funds of the fulfilled lines are released to the pharmacy; the patient sees an itemised refund.',
    descriptionAr: 'يُرد ثمن الأصناف المرفوضة أو غير المتوفرة بنسبة وتناسب (مع رسوم التوصيل إذا لم يتم التوصيل)، ويُحوَّل ثمن الأصناف المصروفة إلى الصيدلية، ويرى المريض ردًا مفصّلًا.',
    defaults: { mode: 'PRO_RATA_REFUND', refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true },
    scopes: ['GLOBAL', 'MARKET', 'ORG'],
    validate(v) {
        const o = (v ?? {});
        if (o.mode !== 'PRO_RATA_REFUND' && o.mode !== 'MANUAL_REVIEW')
            bad('mode must be PRO_RATA_REFUND or MANUAL_REVIEW');
        return { mode: o.mode, refundDeliveryFeeIfNotDelivered: bool(o.refundDeliveryFeeIfNotDelivered, 'refundDeliveryFeeIfNotDelivered'), releaseFulfilledToPharmacy: bool(o.releaseFulfilledToPharmacy, 'releaseFulfilledToPharmacy') };
    },
};
exports.POLICY_DEFS = { [exports.DEPOSIT_DEFAULT.key]: exports.DEPOSIT_DEFAULT, [exports.PARTIAL_FULFILMENT.key]: exports.PARTIAL_FULFILMENT };
exports.POLICY_KEYS = Object.keys(exports.POLICY_DEFS);
//# sourceMappingURL=policy.defaults.js.map