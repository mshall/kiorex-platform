import { DEFAULT_FRAUD_CONFIG, DEFAULT_MATCH_CONFIG, DEFAULT_ROUTING, FRAUD_BOUNDS, FRAUD_RULES, MATCH_FLOORS, ROUTING_FLOORS } from '@kiorex/pay-contract';
import { POLICY_SCHEMAS as GENERATED } from './policy-schemas.generated';

/**
 * The policy kind schemas in force: the ones synced from contracts 1.13.0 plus the Kiorly Pay kinds (PAY_FRAUD_THRESHOLDS, PAY_MATCHING_POLICY, PAY_ROUTING_POLICY), whose bounds are the
 * SAFETY FLOORS of the shared contract (@kiorex/pay-contract): a stored version can tune a number inside its bounds and can never switch a detector off, make auto-matching laxer than the
 * floor, or turn the fraud scorer into an enforcement (there is no enforce mode). INTEGRATION_MODES additionally knows BANK_IPN (the bank / IPN rail).
 * No fee, price or percentage lives here: fees are NEEDS_HUMAN (finance) and stay per-PSP settings.
 */
const int = (b: readonly [number, number], d: number, description: string) => ({ type: 'integer', minimum: b[0], maximum: b[1], default: d, description });
const obj = (properties: Record<string, unknown>, description?: string) => ({ type: 'object', additionalProperties: false, properties, ...(description ? { description } : {}) });
const B = FRAUD_BOUNDS; const D = DEFAULT_FRAUD_CONFIG;

const PAY_FRAUD_THRESHOLDS = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Pay config: PAY_FRAUD_THRESHOLDS', type: 'object', additionalProperties: false,
  description: 'Payment fraud scorer thresholds (velocity, card testing, amount anomaly, repeated failures, fingerprint reuse). SHADOW records only; FLAG queues a human review item. There is no enforcement mode: scores never block a payment or ban an account. Every number is bounded; at most one rule may be disabled. Unknown keys rejected.',
  properties: {
    mode: { type: 'string', enum: ['SHADOW', 'FLAG'], default: D.mode, description: 'SHADOW = record only; FLAG = also put high scores in the human review queue.' },
    velocity: obj({ windowSec: int(B['velocity.windowSec'], D.velocity.windowSec, 'Window in seconds.'), maxAttempts: int(B['velocity.maxAttempts'], D.velocity.maxAttempts, 'Attempts per account in the window above which the rule fires.') }),
    cardTesting: obj({ windowSec: int(B['cardTesting.windowSec'], D.cardTesting.windowSec, 'Window in seconds.'), minFailures: int(B['cardTesting.minFailures'], D.cardTesting.minFailures, 'Failed small attempts that make a pattern.'), smallAmountMinor: int(B['cardTesting.smallAmountMinor'], D.cardTesting.smallAmountMinor, 'Largest amount (minor units) still counted as a card test.'), minDistinctFingerprints: int(B['cardTesting.minDistinctFingerprints'], D.cardTesting.minDistinctFingerprints, 'Distinct cards tried.') }),
    amountAnomaly: obj({ ratio: int(B['amountAnomaly.ratio'], D.amountAnomaly.ratio, 'Multiple of the account median that fires.'), minHistory: int(B['amountAnomaly.minHistory'], D.amountAnomaly.minHistory, 'Successful payments needed before the median is trusted.'), minAmountMinor: int(B['amountAnomaly.minAmountMinor'], D.amountAnomaly.minAmountMinor, 'Smaller amounts never fire.') }),
    repeatedFailures: obj({ consecutive: int(B['repeatedFailures.consecutive'], D.repeatedFailures.consecutive, 'Failures in a row.') }),
    fingerprintReuse: obj({ windowSec: int(B['fingerprintReuse.windowSec'], D.fingerprintReuse.windowSec, 'Look-back in seconds.'), maxAccounts: int(B['fingerprintReuse.maxAccounts'], D.fingerprintReuse.maxAccounts, 'Accounts sharing one card above which the rule fires.') }),
    reviewScore: int(B.reviewScore, D.reviewScore, 'Score at or above which FLAG mode queues a review item.'),
    disabledRules: { type: 'array', maxItems: 1, items: { type: 'string', enum: [...FRAUD_RULES] }, default: [], description: 'At most one rule may be switched off.' },
  },
};
const PAY_MATCHING_POLICY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Pay config: PAY_MATCHING_POLICY', type: 'object', additionalProperties: false,
  description: 'Automated invoice matching: confidence needed to apply a match without a person. AUTO also requires an exact reference, an exact remaining amount and a clear margin over the runner-up (code). Floors: autoThreshold at least 0.9, margin at least 0.1. Unknown keys rejected.',
  properties: {
    autoThreshold: { type: 'number', minimum: MATCH_FLOORS.autoThresholdMin, maximum: 1, default: DEFAULT_MATCH_CONFIG.autoThreshold, description: 'Confidence for AUTO.' },
    reviewThreshold: { type: 'number', minimum: MATCH_FLOORS.reviewThresholdMin, maximum: 0.9, default: DEFAULT_MATCH_CONFIG.reviewThreshold, description: 'Confidence for the review queue.' },
    autoMargin: { type: 'number', minimum: MATCH_FLOORS.autoMarginMin, maximum: 1, default: DEFAULT_MATCH_CONFIG.autoMargin, description: 'Lead over the runner-up for AUTO.' },
    dateWindowDays: { type: 'integer', minimum: 1, maximum: 365, default: DEFAULT_MATCH_CONFIG.dateWindowDays, description: 'Days between invoice and payment that still look plausible.' },
  },
};
const PAY_ROUTING_POLICY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Pay config: PAY_ROUTING_POLICY', type: 'object', additionalProperties: false,
  description: 'Provider ordering: preference (market order), success (success-rate aware, Wilson lower bound) or cost (configured fees only; an unset fee is never assumed cheap, fees are NEEDS_HUMAN). Organisation preference is a separate audited setting. Unknown keys rejected.',
  properties: {
    strategy: { type: 'string', enum: ['preference', 'success', 'cost'], default: DEFAULT_ROUTING.strategy, description: 'Ordering strategy.' },
    minAttempts: { type: 'integer', minimum: ROUTING_FLOORS.minAttemptsMin, maximum: 100000, default: DEFAULT_ROUTING.minAttempts, description: 'Attempts below which observed success is not trusted.' },
    successMargin: { type: 'number', minimum: ROUTING_FLOORS.successMarginMin, maximum: 0.5, default: DEFAULT_ROUTING.successMargin, description: 'How far below the best a provider must be to be demoted.' },
  },
};

const modes = JSON.parse(JSON.stringify(GENERATED.INTEGRATION_MODES));
modes.properties.modes.properties.BANK_IPN = { type: 'string', enum: ['mock', 'real'] };

export const PAY_POLICY_KINDS = ['PAY_FRAUD_THRESHOLDS', 'PAY_MATCHING_POLICY', 'PAY_ROUTING_POLICY'] as const;
export const POLICY_SCHEMAS: Record<string, any> = { ...GENERATED, INTEGRATION_MODES: modes, PAY_FRAUD_THRESHOLDS, PAY_MATCHING_POLICY, PAY_ROUTING_POLICY };
