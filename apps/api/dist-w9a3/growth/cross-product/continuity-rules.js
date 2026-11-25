"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lagBucket = exports.LAG_BUCKETS = exports.lagHoursBetween = exports.PARENT_STATUSES = exports.asClinicOrigin = exports.CLINIC_ORIGINS = exports.isEntryKind = exports.entryKindOfProduct = exports.ENTRY_META = exports.FLAG_CROSS_PRODUCT = exports.CONTINUITY_ENTRY_KINDS = void 0;
exports.pickParent = pickParent;
exports.evaluateContinuity = evaluateContinuity;
exports.CONTINUITY_ENTRY_KINDS = ['RX_TO_PHARMACY', 'LAB_ORDER_TO_LAB', 'CARE_PLAN_TO_HOME_VISIT'];
exports.FLAG_CROSS_PRODUCT = 'growth.cross_product';
exports.ENTRY_META = {
    RX_TO_PHARMACY: { toProduct: 'PHARMACY', factKind: 'ORDER', gateFlags: ['kiorex.pharmacy_orders'], ttlDays: 30, lookbackDays: 7, cta: '/pharmacy' },
    LAB_ORDER_TO_LAB: { toProduct: 'LAB', factKind: 'LAB_BOOKING', gateFlags: ['kiorex.lab_bookings'], ttlDays: 30, lookbackDays: 7, cta: '/lab' },
    CARE_PLAN_TO_HOME_VISIT: { toProduct: 'NURSE', factKind: 'CARE_PLAN_BOOKING', gateFlags: ['kiorex.home_visits', 'nurse.care_plans'], ttlDays: 30, lookbackDays: 30, cta: '/care-plans' },
};
const entryKindOfProduct = (p) => Object.keys(exports.ENTRY_META).find((k) => exports.ENTRY_META[k].toProduct === p);
exports.entryKindOfProduct = entryKindOfProduct;
const isEntryKind = (v) => typeof v === 'string' && exports.CONTINUITY_ENTRY_KINDS.includes(v);
exports.isEntryKind = isEntryKind;
exports.CLINIC_ORIGINS = ['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'];
const asClinicOrigin = (v) => (typeof v === 'string' && exports.CLINIC_ORIGINS.includes(v) ? v : null);
exports.asClinicOrigin = asClinicOrigin;
exports.PARENT_STATUSES = ['COMPLETED', 'CHECKED_IN'];
function pickParent(candidates, o) {
    const from = o.at.getTime() - o.lookbackDays * 86_400_000;
    const to = o.at.getTime() + 86_400_000;
    const ok = candidates.filter((c) => !c.dependantId && exports.PARENT_STATUSES.includes(c.status) && (!o.clinicId || c.clinicId === o.clinicId) && c.startsAt.getTime() >= from && c.startsAt.getTime() <= to);
    return ok.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1))[0] ?? null;
}
function evaluateContinuity(i) {
    if (!i.flagOn)
        return { linked: false, origin: i.ownOrigin, reason: 'FLAG_OFF', parentOrigin: null, providerLedProtected: false };
    if (!i.consent)
        return { linked: false, origin: i.ownOrigin, reason: 'NO_CONSENT', parentOrigin: null, providerLedProtected: false };
    if (!i.hasParent)
        return { linked: false, origin: i.ownOrigin, reason: 'NO_PARENT', parentOrigin: null, providerLedProtected: false };
    const parentOrigin = (0, exports.asClinicOrigin)(i.parentOrigin);
    const protectedParent = parentOrigin === 'PROVIDER_LED';
    if (i.ownOrigin === 'PROVIDER_LED')
        return { linked: true, origin: 'PROVIDER_LED', reason: 'OWN_PROVIDER_EVIDENCE', parentOrigin, providerLedProtected: protectedParent };
    return { linked: true, origin: 'CROSS_PRODUCT', reason: 'CONTINUITY_ENTRY_POINT', parentOrigin, providerLedProtected: protectedParent };
}
const lagHoursBetween = (visitAt, factAt) => Math.max(0, Math.floor((factAt.getTime() - visitAt.getTime()) / 3_600_000));
exports.lagHoursBetween = lagHoursBetween;
exports.LAG_BUCKETS = ['LT_24H', 'D1_3', 'D3_7', 'GT_7D'];
const lagBucket = (hours) => (hours < 24 ? 'LT_24H' : hours < 72 ? 'D1_3' : hours < 168 ? 'D3_7' : 'GT_7D');
exports.lagBucket = lagBucket;
//# sourceMappingURL=continuity-rules.js.map