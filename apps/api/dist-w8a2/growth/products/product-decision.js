"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACT_KIND_PRODUCT = exports.PRODUCT_FACT_KINDS = exports.PRODUCT_FACT_PRODUCTS = void 0;
exports.policyForProduct = policyForProduct;
exports.decideProductFact = decideProductFact;
exports.continuityHash = continuityHash;
const contracts_1 = require("@kiorex/contracts");
const decide_1 = require("../attribution/decide");
exports.PRODUCT_FACT_PRODUCTS = ['PHARMACY', 'LAB', 'NURSE'];
exports.PRODUCT_FACT_KINDS = ['ORDER', 'LAB_BOOKING', 'CARE_PLAN_BOOKING'];
exports.FACT_KIND_PRODUCT = { ORDER: 'PHARMACY', LAB_BOOKING: 'LAB', CARE_PLAN_BOOKING: 'NURSE' };
const inRange = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 365;
function policyForProduct(base, payload, product) {
    const w = payload?.products?.[product]?.windows;
    if (!w)
        return base;
    return {
        ...base,
        ...(inRange(w.providerTouchWindowDays) ? { providerTouchWindowDays: w.providerTouchWindowDays } : {}),
        ...(inRange(w.patientReferralWindowDays) ? { patientReferralWindowDays: w.patientReferralWindowDays } : {}),
        ...(inRange(w.campaignClickWindowDays) ? { campaignClickWindowDays: w.campaignClickWindowDays } : {}),
    };
}
function decideProductFact(fact, touches, policy) {
    if (exports.FACT_KIND_PRODUCT[fact.factKind] !== fact.product)
        throw new TypeError(`fact kind ${fact.factKind} does not belong to product ${fact.product}`);
    const booking = { id: `${fact.factKind}:${fact.factId}`, orgId: fact.orgRef, createdAt: fact.createdAt, channel: 'KIOREX', ltValidForOrg: false };
    const d = (0, decide_1.decide)(booking, touches, policy);
    return { ...d, product: fact.product, factKind: fact.factKind, factId: fact.factId };
}
function continuityHash(fact, parentDecisionId, parentOrigin, policyVersion) {
    return (0, contracts_1.computeAttributionInputsHash)({ booking: { id: `${fact.factKind}:${fact.factId}`, orgId: fact.orgRef, createdAt: fact.createdAt, channel: 'CONTINUITY', hasValidLt: false }, touches: [{ id: parentDecisionId, occurredAt: parentOrigin }], policyVersion, precedence: 'PROVIDER_FIRST' });
}
//# sourceMappingURL=product-decision.js.map