export { GrowthModule } from './growth.module';
export { GrowthMaintenanceService, type EraseResult, type PurgeResult } from './maintenance/growth-maintenance.service';
export { GROWTH_FLAG, GROWTH_LAUNCH_LOCKED_FLAGS, GROWTH_DEFAULT_MARKET, type GrowthFlagKey } from './growth-flags';
export { GROWTH_DEFAULT_PAYLOADS, DEFAULT_RETENTION, PROPOSED_DEFAULT_MARKER } from './config/growth-defaults';
// GRW-P1-B
export { decide, maxWindowMs, FirstTouchNotForCommissionError, PROVIDER_OWNED_KINDS, type Decision, type DecisionBooking, type DecisionPolicy, type DecisionTouch } from './attribution/decide';
export { AttributionService, type StoredDecision, type DecideForBookingInput } from './attribution/attribution.service';
export { AttributionPolicyResolver, toDecisionPolicy, type AttributionPolicyPayload } from './attribution/policy';
export { GrowthConfigService, MONEY_POLICY_KINDS, MONEY_POLICY_LEAD_MS, type ResolvedConfig, type ConfigActor, type ConfigScope } from './config/growth-config.service';
export { GrowthEventsService, type ServerFact } from './events/growth-events.service';
export { SlugService, type SlugResolution } from './slugs/slug.service';
export { slugify, candidateSlug, SLUG_PATTERN } from './slugs/slug';
export { FraudSignalService, FRAUD_RULES, clickWithoutRender, burstPerIpHash, providerLedShareJump } from './fraud/touch-rules';
export { issueLinkToken, verifyLinkToken, verifyAnyLinkToken, signProviderLinkTouch, verifyProviderLinkTouch, LT_MAX_TTL_SECONDS } from './consent/link-token';
export { LinkRegistryService, type LinkLearnResult } from './links/link-registry.service';
export { linkTokenKey, providerLinkTouchSecret, growthSecretsStatus } from './growth-secrets';
// GRW-P1-I (pure send gate; the services live in the patient module)
export { evaluateSend, marketingPurposeFor, quietEnd, GATE_PURPOSES, GATE_CHANNELS, type GateFacts, type GateVerdict, type GatePurpose, type GateChannel } from './consent/consent-gate';
// GRW-P1-C
export { BookingGrowthService, platformOf } from './booking/booking-growth.service';
export { GROWTH_FACTS, type GrowthFactsPort, BOOKING_GROWTH, GROWTH_REVENUE, LINK_REGISTRY, type BookingGrowthContext, type BookingGrowthPort, type ConfirmGrowth, type GrowthRevenuePort, type LinkRegistryPort } from './growth-ports-public';
// GRW-P1-J
export { GrowthRevenueService } from './analytics/revenue.service';
export { GrowthRollupService, ROLLUP_METRICS, VISITOR_STREAM_METRICS } from './analytics/rollup.service';
export { GrowthMetricsService, parseFilters, type GrowthFilters, type Audience } from './analytics/metrics.service';
export { GrowthSpendService } from './analytics/spend.service';
export { applyKAnonymity, maskTotal, maskCount, K_MIN } from './analytics/kanon';
// GRW-P2-X1 (Phase 2 module stubs; each package fills its own folder)
export { CampaignsModule } from './campaigns/campaigns-public';
export { ReferralModule } from './referral/referral-public';
export { RewardsModule } from './rewards/rewards-public';
export { LifecycleModule } from './lifecycle/lifecycle-public';
export { IntegrationsModule } from './integrations/integrations-public';
// GRW-P2-A
export { CampaignService, SYSTEM as CAMPAIGN_SYSTEM_ACTOR, type Actor as CampaignActor } from './campaigns/campaign.service';
export { CampaignBudgetService } from './campaigns/campaign-budget.service';
export { evaluateTransition as evaluateCampaignTransition, type CampaignStatus } from './campaigns/campaign.state';
export { isEligible as isCampaignEligible, validateEligibility as validateCampaignEligibility, type Eligibility as CampaignEligibility, type EligibilityFacts as CampaignEligibilityFacts } from './campaigns/campaign-eligibility';
// GRW-P3-B (reporting attribution models, W7 lane A2)
export { AttributionModelsModule } from './attribution-models/attribution-models.module';
// GRW-P3-A (wave 7, lane A1)
export { ExperimentsModule, ExposureService as ExperimentExposureService, variantFor as experimentVariantFor, setCookieFor as experimentSetCookieFor, cacheVaryKey as experimentCacheVaryKey } from './experiments/experiments-public';
