export { ReferralModule } from './referral.module';
export { generateReferralCode, normalizeReferralCode, inviteUrl, inviteDeepLink, isAcceptableCode } from './referral-code';
export { ReferralService } from './referral.service';
export { ReferralClaimService } from './referral-claim.service';
export { ReferralQualificationService } from './referral-qualification.service';
export { ReferralIdentityService, MockStaffPhoneMatch, STAFF_PHONE_MATCH, type StaffPhoneMatchPort } from './referral-identity.service';
export { ReferralExpiryJob } from './referral-expiry.job';
export { qualify as qualifyReferral, type QualFacts, type ReferralRulesView } from './referral-qualification';
export { evaluateFraud, REFERRAL_FRAUD_RULE_IDS, type FraudFacts } from './referral-fraud.rules';
