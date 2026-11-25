import { livePolicy } from '../policy/policy-registry';
/**
 * Recommendations (GRW-P3-E): advisory only, built from AGGREGATES, approved by a human. The action vocabulary is CLOSED: a recommendation is one of these kinds and nothing else; there is no
 * "send", "spend", "activate", "target" or "audience" kind, and the database repeats the list as a CHECK.
 */
export const RECOMMENDATION_KINDS = ['REALLOCATE_BUDGET', 'PAUSE_CAMPAIGN', 'CONTENT_SUGGESTION', 'SEO_GAP', 'LIFECYCLE_HOLDOUT'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];
export const RECOMMENDATION_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface RecommendationPolicy {
  /** k-anonymity floor of every number a recommendation rests on (ADR-007); never below 10. */ k: number;
  /** minor units: below this a CAC says nothing (same floor as the channel performance report). */ spendFloorMinor: number;
  expiryDays: number; maxPerRun: number;
  /** The most a reallocation may suggest moving (basis points of the weaker channel's spend). */ maxShiftBp: number;
  minRatioBp: number; maxAiSummariesPerDay: number;
}
/** Live: the ACTIVE `RECOMMENDATION_POLICY` maker-checker version over the shipped defaults (k 10, EGP 500 floor, 14 days, 10 per run, 2000 bp, 1.5 times, 20 summaries). */
export const RECOMMENDATION_POLICY = livePolicy<RecommendationPolicy & Record<string, unknown>>('RECOMMENDATION_POLICY');

export interface BilingualText { en: string; ar: string }
export interface RuleProposal {
  kind: RecommendationKind;
  /** Stable key of the situation, so a rerun does not duplicate an open proposal. */
  fingerprint: string;
  payload: Record<string, unknown>;
  rationale: BilingualText;
  evidenceRefs: Array<{ source: string; ref: string; window?: string }>;
  confidence: number;
}

/** What the rules read. Every figure is an aggregate; a count of 1 to 9 never gets here (the input service drops it, `assertAggregateOnly` rejects it). */
export interface ChannelAggregate { channel: string; campaigns: number; spendMinor: number; attendedNew: number; cacMinor: number | null; ltvMinor: number | null }
export interface CampaignAggregate { campaignId: string; label: string; status: string; channel: string; activeDays: number; spendMinor: number; attendedNew: number; cacMinor: number | null }
export interface LandingAggregate { landingKind: string; views: number; registrations: number }
export interface SeoAggregate { templateKind: string; locale: string; pages: number; failingPages: number; topFailedChecks: string[]; submitted: number | null; indexed: number | null }
export interface HoldoutAggregate { journey: string; sent: number; holdout: number; sentBookedBp: number; holdoutBookedBp: number }
export interface RecommendationInputs {
  market: string; window: { from: string; to: string };
  channels: ChannelAggregate[]; campaigns: CampaignAggregate[]; landings: LandingAggregate[]; seo: SeoAggregate[]; holdouts: HoldoutAggregate[];
}
