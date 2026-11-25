"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORPORATE_BENEFIT_PORT = exports.SPONSORED_PAY_PORT = exports.SPONSORED_DISCOUNT_PORT = exports.CROSS_PRODUCT_EVENTS = exports.continuityIdFrom = exports.CONTINUITY_HEADER = exports.PRODUCT_GROWTH = exports.REFERRAL_PORT = exports.REWARDS_PORT = exports.LINK_REGISTRY = exports.GROWTH_REVENUE = exports.BOOKING_GROWTH = exports.GROWTH_FACTS = void 0;
exports.GROWTH_FACTS = 'GROWTH_FACTS_PORT';
exports.BOOKING_GROWTH = 'GROWTH_BOOKING_PORT';
exports.GROWTH_REVENUE = 'GROWTH_REVENUE_PORT';
exports.LINK_REGISTRY = 'GROWTH_LINK_REGISTRY_PORT';
exports.REWARDS_PORT = 'GROWTH_REWARDS_PORT';
exports.REFERRAL_PORT = 'GROWTH_REFERRAL_PORT';
exports.PRODUCT_GROWTH = 'GROWTH_PRODUCT_PORT';
exports.CONTINUITY_HEADER = 'x-kx-continuity';
const continuityIdFrom = (v) => { const s = Array.isArray(v) ? v[0] : v; return typeof s === 'string' && /^[A-Za-z0-9_-]{10,40}$/.test(s) ? s : null; };
exports.continuityIdFrom = continuityIdFrom;
exports.CROSS_PRODUCT_EVENTS = 'GROWTH_CROSS_PRODUCT_EVENTS';
exports.SPONSORED_DISCOUNT_PORT = 'SPONSORED_DISCOUNT_PORT';
exports.SPONSORED_PAY_PORT = 'SPONSORED_PAY_PORT';
exports.CORPORATE_BENEFIT_PORT = 'CORPORATE_BENEFIT_PORT';
//# sourceMappingURL=growth-ports-public.js.map