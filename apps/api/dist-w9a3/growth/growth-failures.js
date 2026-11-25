"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGrowthFailures = exports.growthFailureCount = exports.recordGrowthFailure = exports.GROWTH_FAILURE = void 0;
const counters = new Map();
exports.GROWTH_FAILURE = { ATTRIBUTION_FLAG_CHECK: 'growth.attribution.flag_check_failed', ATTRIBUTION_DECISION: 'growth.attribution.decision_failed', PRODUCT_DECISION: 'growth.product.decision_failed' };
const recordGrowthFailure = (key) => { const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return n; };
exports.recordGrowthFailure = recordGrowthFailure;
const growthFailureCount = (key) => counters.get(key) ?? 0;
exports.growthFailureCount = growthFailureCount;
const resetGrowthFailures = () => counters.clear();
exports.resetGrowthFailures = resetGrowthFailures;
//# sourceMappingURL=growth-failures.js.map