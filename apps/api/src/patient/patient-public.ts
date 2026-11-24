export { PatientService, CONSENT_PURPOSES, CONSENT_VERSION } from './patient.service';
export type { ConsentPurpose } from './patient.service';
export { PatientModule } from './patient.module';
export { ConsentService, ALL_CONSENT_PURPOSES, CORE_CONSENT_PURPOSES, GROWTH_CONSENT_PURPOSES, MARKETING_CONSENT_PURPOSES, CONSENT_SOURCES, CONSENT_TEXT_PLACEHOLDER } from './consent/consent.service';
export { PreferenceCentreService, MARKETING_CHANNELS, FALLBACK_CONSENT_DEFAULTS, tzOffsetMinutes, type ConsentDefaults, type PreferenceUpdate, type MarketingChannel } from './consent/preference-centre.service';
export { SuppressionService, SUPPRESSION_CHANNELS, SUPPRESSION_REASONS } from './consent/suppression.service';
