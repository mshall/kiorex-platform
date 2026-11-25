"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOMMENDATION_POLICY = exports.RECOMMENDATION_STATUSES = exports.RECOMMENDATION_KINDS = void 0;
exports.RECOMMENDATION_KINDS = ['REALLOCATE_BUDGET', 'PAUSE_CAMPAIGN', 'CONTENT_SUGGESTION', 'SEO_GAP', 'LIFECYCLE_HOLDOUT'];
exports.RECOMMENDATION_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED'];
exports.RECOMMENDATION_POLICY = {
    k: 10,
    spendFloorMinor: 50_000,
    expiryDays: 14,
    maxPerRun: 10,
    maxShiftBp: 2000,
    minRatioBp: 15_000,
    maxAiSummariesPerDay: 20,
};
//# sourceMappingURL=recommendation.types.js.map