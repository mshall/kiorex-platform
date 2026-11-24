"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LTV_POLICY_SCHEMA = exports.withLtvDefaults = exports.LTV_POLICY_DEFAULT = void 0;
exports.validateLtvPolicy = validateLtvPolicy;
exports.LTV_POLICY_DEFAULT = { horizonMonths: 12, tailFitWindowMonths: 6, discountRateBp: 0, includeRewardCost: true, includeCampaignCost: true, bootstrapResamples: 1000, seed: 20270128, intervalPercent: 90, minCohortPatients: 10, minPatientsPerObservedMonth: 10, maxBootstrapPatients: 20000 };
const KEYS = Object.keys(exports.LTV_POLICY_DEFAULT);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function validateLtvPolicy(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return { errors: ['/ must be an object'] };
    const p = payload;
    for (const k of Object.keys(p))
        if (!KEYS.includes(k))
            errors.push(`/${k} is not a known key`);
    const need = (k, ok, msg) => { if (p[k] !== undefined && !ok)
        errors.push(`/${k} ${msg}`); };
    need('horizonMonths', int(p.horizonMonths, 1, 36), 'must be an integer 1 to 36');
    need('tailFitWindowMonths', int(p.tailFitWindowMonths, 2, 12), 'must be an integer 2 to 12');
    need('discountRateBp', int(p.discountRateBp, 0, 3000), 'must be an integer 0 to 3000');
    need('includeRewardCost', typeof p.includeRewardCost === 'boolean', 'must be a boolean');
    need('includeCampaignCost', typeof p.includeCampaignCost === 'boolean', 'must be a boolean');
    need('bootstrapResamples', int(p.bootstrapResamples, 100, 5000), 'must be an integer 100 to 5000');
    need('seed', int(p.seed, 0, 2_147_483_647), 'must be an integer 0 to 2147483647');
    need('intervalPercent', int(p.intervalPercent, 50, 99), 'must be an integer 50 to 99');
    need('minCohortPatients', int(p.minCohortPatients, 10, 1000), 'must be an integer of at least 10 (the k-anonymity floor)');
    need('minPatientsPerObservedMonth', int(p.minPatientsPerObservedMonth, 10, 1000), 'must be an integer of at least 10 (the k-anonymity floor)');
    need('maxBootstrapPatients', int(p.maxBootstrapPatients, 1000, 100000), 'must be an integer 1000 to 100000');
    return { errors };
}
const withLtvDefaults = (p) => ({ ...exports.LTV_POLICY_DEFAULT, ...(p ?? {}) });
exports.withLtvDefaults = withLtvDefaults;
exports.LTV_POLICY_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Growth config: LTV_POLICY', type: 'object', additionalProperties: false,
    properties: {
        horizonMonths: { type: 'integer', minimum: 1, maximum: 36, description: 'Months of contribution an LTV covers. PROPOSED_DEFAULT 12.' },
        tailFitWindowMonths: { type: 'integer', minimum: 2, maximum: 12, description: 'Observed months the geometric tail decay is estimated from. PROPOSED_DEFAULT 6.' },
        discountRateBp: { type: 'integer', minimum: 0, maximum: 3000, description: 'Annual discount rate in basis points. PROPOSED_DEFAULT 0.' },
        includeRewardCost: { type: 'boolean', description: 'Subtract platform-funded reward redemptions from revenue (contribution margin). PROPOSED_DEFAULT true.' },
        includeCampaignCost: { type: 'boolean', description: 'Show payback against blended CAC from approved spend. PROPOSED_DEFAULT true.' },
        bootstrapResamples: { type: 'integer', minimum: 100, maximum: 5000, description: 'Bootstrap resamples over patients. PROPOSED_DEFAULT 1000.' },
        seed: { type: 'integer', minimum: 0, maximum: 2147483647, description: 'Bootstrap seed: same inputs and seed give the same estimate.' },
        intervalPercent: { type: 'integer', minimum: 50, maximum: 99, description: 'Interval width in percent. PROPOSED_DEFAULT 90.' },
        minCohortPatients: { type: 'integer', minimum: 10, maximum: 1000, description: 'k-anonymity floor for cells and estimates; never below 10.' },
        minPatientsPerObservedMonth: { type: 'integer', minimum: 10, maximum: 1000, description: 'Patients old enough to have a month before that month is used; never below 10.' },
        maxBootstrapPatients: { type: 'integer', minimum: 1000, maximum: 100000, description: 'Cap on patients per bootstrap (a larger group is subsampled deterministically).' },
    },
};
//# sourceMappingURL=ltv-policy.js.map