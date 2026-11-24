/**
 * `LTV_POLICY` growth configuration (maker-checker, reporting only; AD-10). PROPOSED_DEFAULT values are engineering defaults the founder has not ratified. Nothing in this
 * policy can lower the k-anonymity floor: `minCohortPatients` is at least 10 (validated here and again as a database CHECK on the cohort and estimate tables).
 */
export interface LtvPolicy {
  /** Months of contribution an LTV covers (the observed horizon for complete cohorts; projections extend to it). */
  horizonMonths: number;
  /** How many of the last observed months the geometric tail uses to estimate the average monthly decay. */
  tailFitWindowMonths: number;
  /** Annual discount rate in basis points applied month by month (0 = undiscounted). */
  discountRateBp: number;
  /** Subtract reward cost (P2-B2 redemptions) from revenue: contribution margin. */
  includeRewardCost: boolean;
  /** Subtract nothing but show payback against blended CAC from approved spend. */
  includeCampaignCost: boolean;
  bootstrapResamples: number;
  /** Seed of the bootstrap: the same inputs and seed always give the same estimate. */
  seed: number;
  /** Width of the interval in percent (90 = 5th to 95th percentile). */
  intervalPercent: number;
  /** k-anonymity floor for every cohort cell and estimate; cannot be below 10. */
  minCohortPatients: number;
  /** A month is used as an observation only when this many patients are old enough to have it (never below the floor). */
  minPatientsPerObservedMonth: number;
  /** Cap on patients entering one bootstrap (a larger group is subsampled deterministically and says so). */
  maxBootstrapPatients: number;
}
export const LTV_POLICY_DEFAULT: LtvPolicy = { horizonMonths: 12, tailFitWindowMonths: 6, discountRateBp: 0, includeRewardCost: true, includeCampaignCost: true, bootstrapResamples: 1000, seed: 20270128, intervalPercent: 90, minCohortPatients: 10, minPatientsPerObservedMonth: 10, maxBootstrapPatients: 20000 };

const KEYS = Object.keys(LTV_POLICY_DEFAULT);
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
export function validateLtvPolicy(payload: unknown): { errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { errors: ['/ must be an object'] };
  const p = payload as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) errors.push(`/${k} is not a known key`);
  const need = (k: keyof LtvPolicy, ok: boolean, msg: string) => { if (p[k] !== undefined && !ok) errors.push(`/${k} ${msg}`); };
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
export const withLtvDefaults = (p: Partial<LtvPolicy> | null | undefined): LtvPolicy => ({ ...LTV_POLICY_DEFAULT, ...(p ?? {}) });

/** JSON Schema shown to the console form until contracts 1.13.0 carries `LTV_POLICY` (the validator above is the authority). */
export const LTV_POLICY_SCHEMA = {
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
} as const;
