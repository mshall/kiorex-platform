// Test-only re-exports so specs import the public growth surface plus the retention job (internal class, not part of the façade).
export { AttributionService, GrowthEventsService, issueLinkToken, linkTokenKey } from '../src/growth/growth-public';
export { RetentionJob as RetentionJobProbe } from '../src/growth/retention/retention.job';
