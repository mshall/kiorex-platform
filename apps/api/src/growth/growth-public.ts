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
export { issueLinkToken, verifyLinkToken, LT_MAX_TTL_SECONDS } from './consent/link-token';
export { linkTokenKey } from './growth-secrets';
// GRW-P1-I (pure send gate; the services live in the patient module)
export { evaluateSend, marketingPurposeFor, quietEnd, GATE_PURPOSES, GATE_CHANNELS, type GateFacts, type GateVerdict, type GatePurpose, type GateChannel } from './consent/consent-gate';
