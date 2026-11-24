"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordShareConsentScalarFieldEnum = exports.SharedRecordScalarFieldEnum = exports.WaitlistOfferScalarFieldEnum = exports.WaitlistEntryScalarFieldEnum = exports.ChannelConversationScalarFieldEnum = exports.MessageLogScalarFieldEnum = exports.AiUsageScalarFieldEnum = exports.ControlStateScalarFieldEnum = exports.ProductRegistrationScalarFieldEnum = exports.FlagAuditScalarFieldEnum = exports.FlagChangeRequestScalarFieldEnum = exports.FlagGateEvidenceScalarFieldEnum = exports.FlagValueScalarFieldEnum = exports.FlagDefinitionScalarFieldEnum = exports.ComplaintScalarFieldEnum = exports.ModerationCaseScalarFieldEnum = exports.ReviewScalarFieldEnum = exports.NotificationPreferenceScalarFieldEnum = exports.DeviceTokenScalarFieldEnum = exports.MessageScalarFieldEnum = exports.ReconciliationRunScalarFieldEnum = exports.PspSettlementLineScalarFieldEnum = exports.PayoutScalarFieldEnum = exports.LedgerEntryScalarFieldEnum = exports.LedgerTxScalarFieldEnum = exports.RefundScalarFieldEnum = exports.PayLinkScalarFieldEnum = exports.PaymentIntentScalarFieldEnum = exports.BookingEventScalarFieldEnum = exports.BookingIntentScalarFieldEnum = exports.AnalyticsEventScalarFieldEnum = exports.ProfileViewDailyScalarFieldEnum = exports.ProviderScalarFieldEnum = exports.KiorlyPatientLinkScalarFieldEnum = exports.DataRequestScalarFieldEnum = exports.ConsentRecordScalarFieldEnum = exports.DependantScalarFieldEnum = exports.PatientProfileScalarFieldEnum = exports.AuthSessionScalarFieldEnum = exports.KvStateScalarFieldEnum = exports.AuditLogScalarFieldEnum = exports.WebhookReceiptScalarFieldEnum = exports.OutboxEventScalarFieldEnum = exports.TransactionIsolationLevel = exports.ModelName = exports.AnyNull = exports.JsonNull = exports.DbNull = exports.NullTypes = exports.Decimal = void 0;
exports.ReferralCodeScalarFieldEnum = exports.GrowthCampaignBudgetDailyScalarFieldEnum = exports.GrowthCampaignStatusHistoryScalarFieldEnum = exports.GrowthCampaignApprovalScalarFieldEnum = exports.GrowthCampaignCreativeScalarFieldEnum = exports.GrowthCampaignScalarFieldEnum = exports.CommunicationSuppressionScalarFieldEnum = exports.GrowthVisitorConsentScalarFieldEnum = exports.GrowthConfigReaderScalarFieldEnum = exports.GrowthFraudSignalScalarFieldEnum = exports.WidgetRegistrationScalarFieldEnum = exports.GrowthLandingPageScalarFieldEnum = exports.GrowthSlugHistoryScalarFieldEnum = exports.GrowthSlugScalarFieldEnum = exports.GrowthConfigVersionScalarFieldEnum = exports.GrowthSpendEntryScalarFieldEnum = exports.GrowthRevenueFactScalarFieldEnum = exports.GrowthMetricDailyScalarFieldEnum = exports.GrowthEventScalarFieldEnum = exports.GrowthAttributionDecisionScalarFieldEnum = exports.GrowthTouchpointScalarFieldEnum = exports.GrowthAcquisitionSourceScalarFieldEnum = exports.LeadAlertDeliveryScalarFieldEnum = exports.LeadAlertConfigScalarFieldEnum = exports.OpsStaffContactScalarFieldEnum = exports.PartnerFunnelMarkScalarFieldEnum = exports.PartnerLeadScalarFieldEnum = exports.PartnerIntakeNonceScalarFieldEnum = exports.RateLimitBucketScalarFieldEnum = exports.PartnerEnrolmentScalarFieldEnum = exports.PartnerConnectionScalarFieldEnum = exports.PolicySettingScalarFieldEnum = exports.ImportCommitItemScalarFieldEnum = exports.ImportTaskScalarFieldEnum = exports.ImportDecisionScalarFieldEnum = exports.ImportFileScalarFieldEnum = exports.ImportBatchScalarFieldEnum = exports.NurseLabRelayScalarFieldEnum = exports.CarePlanBookingScalarFieldEnum = exports.FamilyShareScalarFieldEnum = exports.SafetyAlertActionScalarFieldEnum = exports.SafetyAlertScalarFieldEnum = exports.BookingVisitAddressScalarFieldEnum = exports.PatientAddressScalarFieldEnum = exports.PartnerRegistrationScalarFieldEnum = exports.TeleSessionScalarFieldEnum = exports.LabBookingScalarFieldEnum = exports.PharmacyOrderScalarFieldEnum = exports.PharmacyCartScalarFieldEnum = exports.FollowUpReminderScalarFieldEnum = void 0;
exports.BookingSponsoredDiscountScalarFieldEnum = exports.SponsoredPromotionProjectionScalarFieldEnum = exports.GrowthProductDecisionScalarFieldEnum = exports.SeoIndexationSnapshotScalarFieldEnum = exports.SeoVitalSnapshotScalarFieldEnum = exports.SeoInternalLinkScalarFieldEnum = exports.SeoQualityReportScalarFieldEnum = exports.FraudCalibrationScalarFieldEnum = exports.FraudDecisionLogScalarFieldEnum = exports.FraudCaseSignalScalarFieldEnum = exports.FraudCaseScalarFieldEnum = exports.GrowthLtvEstimateScalarFieldEnum = exports.GrowthCohortMonthlyScalarFieldEnum = exports.GrowthPathSnapshotScalarFieldEnum = exports.GrowthAttributionModelResultScalarFieldEnum = exports.GrowthExperimentEventScalarFieldEnum = exports.GrowthExperimentResultScalarFieldEnum = exports.GrowthExperimentDailyScalarFieldEnum = exports.GrowthExperimentExposureScalarFieldEnum = exports.GrowthExperimentScalarFieldEnum = exports.RewardRecoverableLossScalarFieldEnum = exports.RewardApprovalRequestScalarFieldEnum = exports.ReferralShareScalarFieldEnum = exports.RewardReconcileRunScalarFieldEnum = exports.RewardCheckoutLineScalarFieldEnum = exports.GoodwillGrantScalarFieldEnum = exports.RefundDestinationChoiceScalarFieldEnum = exports.RewardHouseholdMemberScalarFieldEnum = exports.RewardHouseholdScalarFieldEnum = exports.GrowthJobRunScalarFieldEnum = exports.GrowthIntegrationHealthScalarFieldEnum = exports.GrowthExternalMetricDailyScalarFieldEnum = exports.GrowthIntegrationRunScalarFieldEnum = exports.AssistantLinkScalarFieldEnum = exports.AssistantConfirmationScalarFieldEnum = exports.AssistantEscalationScalarFieldEnum = exports.AssistantUsageDailyScalarFieldEnum = exports.AssistantToolCallScalarFieldEnum = exports.AssistantTurnScalarFieldEnum = exports.AssistantSessionScalarFieldEnum = exports.LifecycleSegmentSnapshotScalarFieldEnum = exports.LifecycleMessageDecisionScalarFieldEnum = exports.LifecycleEnrollmentScalarFieldEnum = exports.PatientLifecycleScalarFieldEnum = exports.RewardIssuanceBudgetScalarFieldEnum = exports.RewardLedgerEntryScalarFieldEnum = exports.RewardLotScalarFieldEnum = exports.ReferralIdentitySignalScalarFieldEnum = exports.ReferralQualificationCheckScalarFieldEnum = exports.ReferralRelationshipScalarFieldEnum = void 0;
exports.NullsOrder = exports.JsonNullValueFilter = exports.QueryMode = exports.NullableJsonNullValueInput = exports.JsonNullValueInput = exports.SortOrder = exports.MarketGeographyScalarFieldEnum = exports.MarketOnboardingPlanScalarFieldEnum = exports.SponsoredPromotionReviewScalarFieldEnum = void 0;
const runtime = __importStar(require("@prisma/client/runtime/index-browser"));
exports.Decimal = runtime.Decimal;
exports.NullTypes = {
    DbNull: runtime.NullTypes.DbNull,
    JsonNull: runtime.NullTypes.JsonNull,
    AnyNull: runtime.NullTypes.AnyNull,
};
exports.DbNull = runtime.DbNull;
exports.JsonNull = runtime.JsonNull;
exports.AnyNull = runtime.AnyNull;
exports.ModelName = {
    OutboxEvent: 'OutboxEvent',
    WebhookReceipt: 'WebhookReceipt',
    AuditLog: 'AuditLog',
    KvState: 'KvState',
    AuthSession: 'AuthSession',
    PatientProfile: 'PatientProfile',
    Dependant: 'Dependant',
    ConsentRecord: 'ConsentRecord',
    DataRequest: 'DataRequest',
    KiorlyPatientLink: 'KiorlyPatientLink',
    Provider: 'Provider',
    ProfileViewDaily: 'ProfileViewDaily',
    AnalyticsEvent: 'AnalyticsEvent',
    BookingIntent: 'BookingIntent',
    BookingEvent: 'BookingEvent',
    PaymentIntent: 'PaymentIntent',
    PayLink: 'PayLink',
    Refund: 'Refund',
    LedgerTx: 'LedgerTx',
    LedgerEntry: 'LedgerEntry',
    Payout: 'Payout',
    PspSettlementLine: 'PspSettlementLine',
    ReconciliationRun: 'ReconciliationRun',
    Message: 'Message',
    DeviceToken: 'DeviceToken',
    NotificationPreference: 'NotificationPreference',
    Review: 'Review',
    ModerationCase: 'ModerationCase',
    Complaint: 'Complaint',
    FlagDefinition: 'FlagDefinition',
    FlagValue: 'FlagValue',
    FlagGateEvidence: 'FlagGateEvidence',
    FlagChangeRequest: 'FlagChangeRequest',
    FlagAudit: 'FlagAudit',
    ProductRegistration: 'ProductRegistration',
    ControlState: 'ControlState',
    AiUsage: 'AiUsage',
    MessageLog: 'MessageLog',
    ChannelConversation: 'ChannelConversation',
    WaitlistEntry: 'WaitlistEntry',
    WaitlistOffer: 'WaitlistOffer',
    SharedRecord: 'SharedRecord',
    RecordShareConsent: 'RecordShareConsent',
    FollowUpReminder: 'FollowUpReminder',
    PharmacyCart: 'PharmacyCart',
    PharmacyOrder: 'PharmacyOrder',
    LabBooking: 'LabBooking',
    TeleSession: 'TeleSession',
    PartnerRegistration: 'PartnerRegistration',
    PatientAddress: 'PatientAddress',
    BookingVisitAddress: 'BookingVisitAddress',
    SafetyAlert: 'SafetyAlert',
    SafetyAlertAction: 'SafetyAlertAction',
    FamilyShare: 'FamilyShare',
    CarePlanBooking: 'CarePlanBooking',
    NurseLabRelay: 'NurseLabRelay',
    ImportBatch: 'ImportBatch',
    ImportFile: 'ImportFile',
    ImportDecision: 'ImportDecision',
    ImportTask: 'ImportTask',
    ImportCommitItem: 'ImportCommitItem',
    PolicySetting: 'PolicySetting',
    PartnerConnection: 'PartnerConnection',
    PartnerEnrolment: 'PartnerEnrolment',
    RateLimitBucket: 'RateLimitBucket',
    PartnerIntakeNonce: 'PartnerIntakeNonce',
    PartnerLead: 'PartnerLead',
    PartnerFunnelMark: 'PartnerFunnelMark',
    OpsStaffContact: 'OpsStaffContact',
    LeadAlertConfig: 'LeadAlertConfig',
    LeadAlertDelivery: 'LeadAlertDelivery',
    GrowthAcquisitionSource: 'GrowthAcquisitionSource',
    GrowthTouchpoint: 'GrowthTouchpoint',
    GrowthAttributionDecision: 'GrowthAttributionDecision',
    GrowthEvent: 'GrowthEvent',
    GrowthMetricDaily: 'GrowthMetricDaily',
    GrowthRevenueFact: 'GrowthRevenueFact',
    GrowthSpendEntry: 'GrowthSpendEntry',
    GrowthConfigVersion: 'GrowthConfigVersion',
    GrowthSlug: 'GrowthSlug',
    GrowthSlugHistory: 'GrowthSlugHistory',
    GrowthLandingPage: 'GrowthLandingPage',
    WidgetRegistration: 'WidgetRegistration',
    GrowthFraudSignal: 'GrowthFraudSignal',
    GrowthConfigReader: 'GrowthConfigReader',
    GrowthVisitorConsent: 'GrowthVisitorConsent',
    CommunicationSuppression: 'CommunicationSuppression',
    GrowthCampaign: 'GrowthCampaign',
    GrowthCampaignCreative: 'GrowthCampaignCreative',
    GrowthCampaignApproval: 'GrowthCampaignApproval',
    GrowthCampaignStatusHistory: 'GrowthCampaignStatusHistory',
    GrowthCampaignBudgetDaily: 'GrowthCampaignBudgetDaily',
    ReferralCode: 'ReferralCode',
    ReferralRelationship: 'ReferralRelationship',
    ReferralQualificationCheck: 'ReferralQualificationCheck',
    ReferralIdentitySignal: 'ReferralIdentitySignal',
    RewardLot: 'RewardLot',
    RewardLedgerEntry: 'RewardLedgerEntry',
    RewardIssuanceBudget: 'RewardIssuanceBudget',
    PatientLifecycle: 'PatientLifecycle',
    LifecycleEnrollment: 'LifecycleEnrollment',
    LifecycleMessageDecision: 'LifecycleMessageDecision',
    LifecycleSegmentSnapshot: 'LifecycleSegmentSnapshot',
    AssistantSession: 'AssistantSession',
    AssistantTurn: 'AssistantTurn',
    AssistantToolCall: 'AssistantToolCall',
    AssistantUsageDaily: 'AssistantUsageDaily',
    AssistantEscalation: 'AssistantEscalation',
    AssistantConfirmation: 'AssistantConfirmation',
    AssistantLink: 'AssistantLink',
    GrowthIntegrationRun: 'GrowthIntegrationRun',
    GrowthExternalMetricDaily: 'GrowthExternalMetricDaily',
    GrowthIntegrationHealth: 'GrowthIntegrationHealth',
    GrowthJobRun: 'GrowthJobRun',
    RewardHousehold: 'RewardHousehold',
    RewardHouseholdMember: 'RewardHouseholdMember',
    RefundDestinationChoice: 'RefundDestinationChoice',
    GoodwillGrant: 'GoodwillGrant',
    RewardCheckoutLine: 'RewardCheckoutLine',
    RewardReconcileRun: 'RewardReconcileRun',
    ReferralShare: 'ReferralShare',
    RewardApprovalRequest: 'RewardApprovalRequest',
    RewardRecoverableLoss: 'RewardRecoverableLoss',
    GrowthExperiment: 'GrowthExperiment',
    GrowthExperimentExposure: 'GrowthExperimentExposure',
    GrowthExperimentDaily: 'GrowthExperimentDaily',
    GrowthExperimentResult: 'GrowthExperimentResult',
    GrowthExperimentEvent: 'GrowthExperimentEvent',
    GrowthAttributionModelResult: 'GrowthAttributionModelResult',
    GrowthPathSnapshot: 'GrowthPathSnapshot',
    GrowthCohortMonthly: 'GrowthCohortMonthly',
    GrowthLtvEstimate: 'GrowthLtvEstimate',
    FraudCase: 'FraudCase',
    FraudCaseSignal: 'FraudCaseSignal',
    FraudDecisionLog: 'FraudDecisionLog',
    FraudCalibration: 'FraudCalibration',
    SeoQualityReport: 'SeoQualityReport',
    SeoInternalLink: 'SeoInternalLink',
    SeoVitalSnapshot: 'SeoVitalSnapshot',
    SeoIndexationSnapshot: 'SeoIndexationSnapshot',
    GrowthProductDecision: 'GrowthProductDecision',
    SponsoredPromotionProjection: 'SponsoredPromotionProjection',
    BookingSponsoredDiscount: 'BookingSponsoredDiscount',
    SponsoredPromotionReview: 'SponsoredPromotionReview',
    MarketOnboardingPlan: 'MarketOnboardingPlan',
    MarketGeography: 'MarketGeography'
};
exports.TransactionIsolationLevel = runtime.makeStrictEnum({
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
});
exports.OutboxEventScalarFieldEnum = {
    id: 'id',
    type: 'type',
    aggregateType: 'aggregateType',
    aggregateId: 'aggregateId',
    target: 'target',
    payload: 'payload',
    status: 'status',
    attempts: 'attempts',
    nextAttemptAt: 'nextAttemptAt',
    lastError: 'lastError',
    dedupeKey: 'dedupeKey',
    createdAt: 'createdAt',
    sentAt: 'sentAt'
};
exports.WebhookReceiptScalarFieldEnum = {
    eventId: 'eventId',
    source: 'source',
    type: 'type',
    aggregateId: 'aggregateId',
    payload: 'payload',
    status: 'status',
    error: 'error',
    receivedAt: 'receivedAt',
    processedAt: 'processedAt'
};
exports.AuditLogScalarFieldEnum = {
    id: 'id',
    actor: 'actor',
    action: 'action',
    resource: 'resource',
    resourceId: 'resourceId',
    metadata: 'metadata',
    createdAt: 'createdAt'
};
exports.KvStateScalarFieldEnum = {
    key: 'key',
    value: 'value',
    updatedAt: 'updatedAt'
};
exports.AuthSessionScalarFieldEnum = {
    id: 'id',
    sid: 'sid',
    sub: 'sub',
    clientId: 'clientId',
    device: 'device',
    ip: 'ip',
    createdAt: 'createdAt',
    lastSeenAt: 'lastSeenAt',
    revokedAt: 'revokedAt'
};
exports.PatientProfileScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    phone: 'phone',
    email: 'email',
    nameEn: 'nameEn',
    nameAr: 'nameAr',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    nationalIdEnc: 'nationalIdEnc',
    nationalIdHash: 'nationalIdHash',
    preferredLocale: 'preferredLocale',
    market: 'market',
    noShowCount: 'noShowCount',
    deletedAt: 'deletedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.DependantScalarFieldEnum = {
    id: 'id',
    guardianSub: 'guardianSub',
    nameEn: 'nameEn',
    nameAr: 'nameAr',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    relationship: 'relationship',
    evidence: 'evidence',
    expiresAt: 'expiresAt',
    deletedAt: 'deletedAt',
    createdAt: 'createdAt'
};
exports.ConsentRecordScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    purpose: 'purpose',
    granted: 'granted',
    version: 'version',
    source: 'source',
    channel: 'channel',
    ipHash: 'ipHash',
    evidence: 'evidence',
    createdAt: 'createdAt'
};
exports.DataRequestScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    kind: 'kind',
    status: 'status',
    result: 'result',
    requestedAt: 'requestedAt',
    completedAt: 'completedAt'
};
exports.KiorlyPatientLinkScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    dependantId: 'dependantId',
    clinicId: 'clinicId',
    kiorlyPatientId: 'kiorlyPatientId',
    evidence: 'evidence',
    status: 'status',
    createdAt: 'createdAt'
};
exports.ProviderScalarFieldEnum = {
    id: 'id',
    tenantId: 'tenantId',
    clinicId: 'clinicId',
    clinicianId: 'clinicianId',
    status: 'status',
    sourceVersion: 'sourceVersion',
    market: 'market',
    nameEn: 'nameEn',
    nameAr: 'nameAr',
    clinicNameEn: 'clinicNameEn',
    clinicNameAr: 'clinicNameAr',
    specialty: 'specialty',
    subSpecialties: 'subSpecialties',
    languages: 'languages',
    gender: 'gender',
    governorate: 'governorate',
    area: 'area',
    latitude: 'latitude',
    longitude: 'longitude',
    minFeeMinor: 'minFeeMinor',
    maxFeeMinor: 'maxFeeMinor',
    currency: 'currency',
    acceptsDeposit: 'acceptsDeposit',
    ratingAvg: 'ratingAvg',
    ratingCount: 'ratingCount',
    searchText: 'searchText',
    raw: 'raw',
    syncedAt: 'syncedAt',
    createdAt: 'createdAt',
    profession: 'profession',
    edition: 'edition',
    careType: 'careType',
    serviceLocations: 'serviceLocations',
    coverageDistricts: 'coverageDistricts',
    assignsClinician: 'assignsClinician',
    verificationRegister: 'verificationRegister',
    homeSurchargeMinor: 'homeSurchargeMinor',
    nextSlotAt: 'nextSlotAt',
    slotIndexedAt: 'slotIndexedAt'
};
exports.ProfileViewDailyScalarFieldEnum = {
    providerId: 'providerId',
    date: 'date',
    views: 'views',
    pushedAt: 'pushedAt'
};
exports.AnalyticsEventScalarFieldEnum = {
    id: 'id',
    name: 'name',
    specialtyCode: 'specialtyCode',
    providerId: 'providerId',
    market: 'market',
    code: 'code',
    district: 'district',
    careType: 'careType',
    serviceLocation: 'serviceLocation',
    createdAt: 'createdAt'
};
exports.BookingIntentScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    dependantId: 'dependantId',
    providerId: 'providerId',
    clinicId: 'clinicId',
    clinicianId: 'clinicianId',
    tenantId: 'tenantId',
    typeId: 'typeId',
    startsAt: 'startsAt',
    endsAt: 'endsAt',
    status: 'status',
    channel: 'channel',
    holdId: 'holdId',
    holdExternalRef: 'holdExternalRef',
    holdExpiresAt: 'holdExpiresAt',
    callState: 'callState',
    kiorlyAppointmentId: 'kiorlyAppointmentId',
    kiorlyPatientId: 'kiorlyPatientId',
    kiorlyVersion: 'kiorlyVersion',
    confirmationDueAt: 'confirmationDueAt',
    cancelledBy: 'cancelledBy',
    cancellationReason: 'cancellationReason',
    depositRefundable: 'depositRefundable',
    failureCode: 'failureCode',
    depositStatus: 'depositStatus',
    depositAmountMinor: 'depositAmountMinor',
    currency: 'currency',
    feeMinor: 'feeMinor',
    patientSnapshot: 'patientSnapshot',
    version: 'version',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    terminalAt: 'terminalAt',
    serviceLocation: 'serviceLocation',
    careType: 'careType',
    visitDistrict: 'visitDistrict',
    homeState: 'homeState',
    homeSurchargeMinor: 'homeSurchargeMinor',
    assignee: 'assignee',
    enRouteAt: 'enRouteAt',
    etaMinutes: 'etaMinutes',
    arrivedAt: 'arrivedAt',
    abortedAt: 'abortedAt',
    carePlanId: 'carePlanId',
    telehealth: 'telehealth',
    acquisitionOrigin: 'acquisitionOrigin',
    attributionDecisionId: 'attributionDecisionId'
};
exports.BookingEventScalarFieldEnum = {
    id: 'id',
    bookingId: 'bookingId',
    kind: 'kind',
    fromStatus: 'fromStatus',
    toStatus: 'toStatus',
    detail: 'detail',
    createdAt: 'createdAt'
};
exports.PaymentIntentScalarFieldEnum = {
    id: 'id',
    bookingId: 'bookingId',
    payLinkToken: 'payLinkToken',
    sub: 'sub',
    clinicId: 'clinicId',
    amountMinor: 'amountMinor',
    currency: 'currency',
    psp: 'psp',
    pspRef: 'pspRef',
    checkoutUrl: 'checkoutUrl',
    status: 'status',
    refundedMinor: 'refundedMinor',
    feeMinor: 'feeMinor',
    releasedAt: 'releasedAt',
    releaseKind: 'releaseKind',
    payoutId: 'payoutId',
    purpose: 'purpose',
    orderRef: 'orderRef',
    capturedAt: 'capturedAt',
    kiorlyNotified: 'kiorlyNotified',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    reviewState: 'reviewState',
    reviewReason: 'reviewReason',
    heldForReviewAt: 'heldForReviewAt',
    reviewedBy: 'reviewedBy',
    reviewedAt: 'reviewedAt',
    rewardMinor: 'rewardMinor',
    rewardPostedMinor: 'rewardPostedMinor',
    sponsoredMinor: 'sponsoredMinor',
    sponsoredPostedMinor: 'sponsoredPostedMinor',
    sponsoredVoidedMinor: 'sponsoredVoidedMinor'
};
exports.PayLinkScalarFieldEnum = {
    token: 'token',
    clinicId: 'clinicId',
    externalRef: 'externalRef',
    amountMinor: 'amountMinor',
    currency: 'currency',
    status: 'status',
    expiresAt: 'expiresAt',
    paymentIntentId: 'paymentIntentId',
    createdAt: 'createdAt'
};
exports.RefundScalarFieldEnum = {
    id: 'id',
    paymentId: 'paymentId',
    amountMinor: 'amountMinor',
    reason: 'reason',
    status: 'status',
    idempotencyKey: 'idempotencyKey',
    pspRefundRef: 'pspRefundRef',
    createdAt: 'createdAt',
    settledAt: 'settledAt'
};
exports.LedgerTxScalarFieldEnum = {
    id: 'id',
    idempotencyKey: 'idempotencyKey',
    kind: 'kind',
    bookingId: 'bookingId',
    paymentId: 'paymentId',
    clinicId: 'clinicId',
    memo: 'memo',
    createdAt: 'createdAt'
};
exports.LedgerEntryScalarFieldEnum = {
    id: 'id',
    txId: 'txId',
    account: 'account',
    debitMinor: 'debitMinor',
    creditMinor: 'creditMinor',
    currency: 'currency',
    createdAt: 'createdAt'
};
exports.PayoutScalarFieldEnum = {
    id: 'id',
    payoutRef: 'payoutRef',
    clinicId: 'clinicId',
    amountMinor: 'amountMinor',
    currency: 'currency',
    status: 'status',
    periodKey: 'periodKey',
    paymentRefs: 'paymentRefs',
    paidAt: 'paidAt',
    createdAt: 'createdAt'
};
exports.PspSettlementLineScalarFieldEnum = {
    id: 'id',
    psp: 'psp',
    pspRef: 'pspRef',
    kind: 'kind',
    amountMinor: 'amountMinor',
    feeMinor: 'feeMinor',
    date: 'date',
    matched: 'matched'
};
exports.ReconciliationRunScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    status: 'status',
    discrepancies: 'discrepancies',
    stats: 'stats',
    createdAt: 'createdAt'
};
exports.MessageScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    bookingId: 'bookingId',
    channel: 'channel',
    templateId: 'templateId',
    locale: 'locale',
    params: 'params',
    status: 'status',
    reason: 'reason',
    scheduledFor: 'scheduledFor',
    sentAt: 'sentAt',
    readAt: 'readAt',
    dedupeKey: 'dedupeKey',
    createdAt: 'createdAt'
};
exports.DeviceTokenScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    platform: 'platform',
    token: 'token',
    appVersion: 'appVersion',
    locale: 'locale',
    createdAt: 'createdAt',
    lastSeenAt: 'lastSeenAt',
    revokedAt: 'revokedAt'
};
exports.NotificationPreferenceScalarFieldEnum = {
    sub: 'sub',
    channel: 'channel',
    enabled: 'enabled',
    quietStart: 'quietStart',
    quietEnd: 'quietEnd'
};
exports.ReviewScalarFieldEnum = {
    id: 'id',
    bookingId: 'bookingId',
    sub: 'sub',
    providerId: 'providerId',
    clinicId: 'clinicId',
    clinicianId: 'clinicianId',
    kiorlyAppointmentId: 'kiorlyAppointmentId',
    rating: 'rating',
    text: 'text',
    status: 'status',
    moderationFlags: 'moderationFlags',
    clinicReply: 'clinicReply',
    editableUntil: 'editableUntil',
    syncStatus: 'syncStatus',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ModerationCaseScalarFieldEnum = {
    id: 'id',
    reviewId: 'reviewId',
    reason: 'reason',
    status: 'status',
    resolution: 'resolution',
    resolvedBy: 'resolvedBy',
    createdAt: 'createdAt',
    resolvedAt: 'resolvedAt'
};
exports.ComplaintScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    bookingId: 'bookingId',
    category: 'category',
    body: 'body',
    status: 'status',
    slaDueAt: 'slaDueAt',
    createdAt: 'createdAt',
    resolvedAt: 'resolvedAt',
    homeVisit: 'homeVisit'
};
exports.FlagDefinitionScalarFieldEnum = {
    key: 'key',
    product: 'product',
    class: 'class',
    scopes: 'scopes',
    dependsOn: 'dependsOn',
    launchLocked: 'launchLocked',
    moneyPath: 'moneyPath',
    description: 'description',
    whenOff: 'whenOff',
    gateHint: 'gateHint',
    gateIds: 'gateIds',
    edition: 'edition',
    createdAt: 'createdAt'
};
exports.FlagValueScalarFieldEnum = {
    id: 'id',
    flagKey: 'flagKey',
    scope: 'scope',
    scopeId: 'scopeId',
    value: 'value',
    reason: 'reason',
    ticket: 'ticket',
    setBy: 'setBy',
    expiresAt: 'expiresAt',
    startsAt: 'startsAt',
    updatedAt: 'updatedAt',
    createdAt: 'createdAt'
};
exports.FlagGateEvidenceScalarFieldEnum = {
    flagKey: 'flagKey',
    gateId: 'gateId',
    approver: 'approver',
    approvedOn: 'approvedOn',
    documentUrl: 'documentUrl',
    recordedBy: 'recordedBy',
    createdAt: 'createdAt'
};
exports.FlagChangeRequestScalarFieldEnum = {
    id: 'id',
    flagKey: 'flagKey',
    scope: 'scope',
    scopeId: 'scopeId',
    value: 'value',
    reason: 'reason',
    ticket: 'ticket',
    expiresAt: 'expiresAt',
    requestedBy: 'requestedBy',
    status: 'status',
    approvedBy: 'approvedBy',
    emergency: 'emergency',
    reviewDueAt: 'reviewDueAt',
    reviewedBy: 'reviewedBy',
    reviewedAt: 'reviewedAt',
    createdAt: 'createdAt',
    decidedAt: 'decidedAt'
};
exports.FlagAuditScalarFieldEnum = {
    id: 'id',
    flagKey: 'flagKey',
    scope: 'scope',
    scopeId: 'scopeId',
    oldValue: 'oldValue',
    newValue: 'newValue',
    actor: 'actor',
    reason: 'reason',
    ticket: 'ticket',
    expiresAt: 'expiresAt',
    emergency: 'emergency',
    event: 'event',
    createdAt: 'createdAt'
};
exports.ProductRegistrationScalarFieldEnum = {
    product: 'product',
    keyId: 'keyId',
    secretEnc: 'secretEnc',
    webhookUrl: 'webhookUrl',
    webhookSecretEnc: 'webhookSecretEnc',
    active: 'active',
    lastFetchedVersion: 'lastFetchedVersion',
    lastFetchedAt: 'lastFetchedAt',
    lastPushedVersion: 'lastPushedVersion',
    lastPushedAt: 'lastPushedAt',
    lastPushError: 'lastPushError'
};
exports.ControlStateScalarFieldEnum = {
    id: 'id',
    version: 'version',
    updatedAt: 'updatedAt'
};
exports.AiUsageScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    purpose: 'purpose',
    provider: 'provider',
    promptVersion: 'promptVersion',
    redactions: 'redactions',
    source: 'source',
    createdAt: 'createdAt'
};
exports.MessageLogScalarFieldEnum = {
    id: 'id',
    messageId: 'messageId',
    channel: 'channel',
    direction: 'direction',
    mode: 'mode',
    sub: 'sub',
    recipient: 'recipient',
    recipientMasked: 'recipientMasked',
    templateId: 'templateId',
    locale: 'locale',
    body: 'body',
    status: 'status',
    providerRef: 'providerRef',
    error: 'error',
    createdAt: 'createdAt',
    sentAt: 'sentAt',
    deliveredAt: 'deliveredAt',
    readAt: 'readAt',
    failedAt: 'failedAt'
};
exports.ChannelConversationScalarFieldEnum = {
    id: 'id',
    channel: 'channel',
    phone: 'phone',
    sub: 'sub',
    state: 'state',
    context: 'context',
    locale: 'locale',
    lastInboundAt: 'lastInboundAt',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WaitlistEntryScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    dependantId: 'dependantId',
    providerId: 'providerId',
    clinicId: 'clinicId',
    clinicianId: 'clinicianId',
    tenantId: 'tenantId',
    typeId: 'typeId',
    preferredFrom: 'preferredFrom',
    preferredTo: 'preferredTo',
    status: 'status',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WaitlistOfferScalarFieldEnum = {
    id: 'id',
    entryId: 'entryId',
    sub: 'sub',
    providerId: 'providerId',
    startsAt: 'startsAt',
    endsAt: 'endsAt',
    status: 'status',
    expiresAt: 'expiresAt',
    bookingId: 'bookingId',
    createdAt: 'createdAt',
    respondedAt: 'respondedAt'
};
exports.SharedRecordScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    kind: 'kind',
    clinicId: 'clinicId',
    kiorlyPatientId: 'kiorlyPatientId',
    dependantId: 'dependantId',
    sourceRef: 'sourceRef',
    sourceEventId: 'sourceEventId',
    title: 'title',
    payloadEnc: 'payloadEnc',
    signedAt: 'signedAt',
    storageKey: 'storageKey',
    fileName: 'fileName',
    mimeType: 'mimeType',
    sizeBytes: 'sizeBytes',
    sha256: 'sha256',
    status: 'status',
    revokedAt: 'revokedAt',
    revokedReason: 'revokedReason',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.RecordShareConsentScalarFieldEnum = {
    sub: 'sub',
    scope: 'scope',
    granted: 'granted',
    updatedAt: 'updatedAt'
};
exports.FollowUpReminderScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    recordId: 'recordId',
    clinicId: 'clinicId',
    dueAt: 'dueAt',
    source: 'source',
    status: 'status',
    createdAt: 'createdAt'
};
exports.PharmacyCartScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    pharmacyId: 'pharmacyId',
    registrationId: 'registrationId',
    items: 'items',
    deliveryMethod: 'deliveryMethod',
    deliveryAddress: 'deliveryAddress',
    prescriptionRecordId: 'prescriptionRecordId',
    updatedAt: 'updatedAt'
};
exports.PharmacyOrderScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    pharmacyId: 'pharmacyId',
    registrationId: 'registrationId',
    status: 'status',
    items: 'items',
    subtotalMinor: 'subtotalMinor',
    deliveryFeeMinor: 'deliveryFeeMinor',
    totalMinor: 'totalMinor',
    currency: 'currency',
    deliveryMethod: 'deliveryMethod',
    deliveryAddress: 'deliveryAddress',
    prescriptionRecordId: 'prescriptionRecordId',
    rxStatus: 'rxStatus',
    partnerOrderId: 'partnerOrderId',
    paymentId: 'paymentId',
    takeRateBps: 'takeRateBps',
    platformFeeMinor: 'platformFeeMinor',
    rejectionReason: 'rejectionReason',
    readyAt: 'readyAt',
    outForDeliveryAt: 'outForDeliveryAt',
    dispensedAt: 'dispensedAt',
    settlement: 'settlement',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.LabBookingScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    labId: 'labId',
    registrationId: 'registrationId',
    tests: 'tests',
    collectionType: 'collectionType',
    slotStartsAt: 'slotStartsAt',
    slotEndsAt: 'slotEndsAt',
    address: 'address',
    status: 'status',
    subtotalMinor: 'subtotalMinor',
    collectionFeeMinor: 'collectionFeeMinor',
    totalMinor: 'totalMinor',
    currency: 'currency',
    paymentId: 'paymentId',
    partnerOrderId: 'partnerOrderId',
    takeRateBps: 'takeRateBps',
    platformFeeMinor: 'platformFeeMinor',
    rejectionReason: 'rejectionReason',
    resultRecordId: 'resultRecordId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.TeleSessionScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    bookingId: 'bookingId',
    providerId: 'providerId',
    clinicId: 'clinicId',
    status: 'status',
    videoProvider: 'videoProvider',
    roomName: 'roomName',
    scheduledStartsAt: 'scheduledStartsAt',
    patientJoinedAt: 'patientJoinedAt',
    clinicianJoinedAt: 'clinicianJoinedAt',
    startedAt: 'startedAt',
    endedAt: 'endedAt',
    durationSec: 'durationSec',
    consultFeeMinor: 'consultFeeMinor',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.PartnerRegistrationScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    name: 'name',
    baseUrl: 'baseUrl',
    clientKey: 'clientKey',
    clientSecretEnc: 'clientSecretEnc',
    webhookSecretEnc: 'webhookSecretEnc',
    active: 'active',
    labRegistrationId: 'labRegistrationId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.PatientAddressScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    label: 'label',
    governorate: 'governorate',
    district: 'district',
    addressEnc: 'addressEnc',
    confirmedAt: 'confirmedAt',
    confirmedPhoneLast4: 'confirmedPhoneLast4',
    isDefault: 'isDefault',
    deletedAt: 'deletedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.BookingVisitAddressScalarFieldEnum = {
    bookingId: 'bookingId',
    sub: 'sub',
    governorate: 'governorate',
    district: 'district',
    addressEnc: 'addressEnc',
    maskAfter: 'maskAfter',
    maskedAt: 'maskedAt',
    createdAt: 'createdAt'
};
exports.SafetyAlertScalarFieldEnum = {
    id: 'id',
    alertId: 'alertId',
    eventId: 'eventId',
    bookingId: 'bookingId',
    clinicId: 'clinicId',
    appointmentId: 'appointmentId',
    kind: 'kind',
    district: 'district',
    deliverTo: 'deliverTo',
    raisedAt: 'raisedAt',
    receivedAt: 'receivedAt',
    deliverWithinSeconds: 'deliverWithinSeconds',
    deliveredAt: 'deliveredAt',
    deliveryMode: 'deliveryMode',
    deliveryRef: 'deliveryRef',
    deliveryError: 'deliveryError',
    status: 'status',
    acknowledgedAt: 'acknowledgedAt',
    acknowledgedBy: 'acknowledgedBy',
    escalatedAt: 'escalatedAt',
    escalatedBy: 'escalatedBy',
    escalationLevel: 'escalationLevel',
    resolvedAt: 'resolvedAt',
    resolvedBy: 'resolvedBy',
    createdAt: 'createdAt'
};
exports.SafetyAlertActionScalarFieldEnum = {
    id: 'id',
    alertId: 'alertId',
    action: 'action',
    actor: 'actor',
    note: 'note',
    createdAt: 'createdAt'
};
exports.FamilyShareScalarFieldEnum = {
    id: 'id',
    bookingId: 'bookingId',
    sub: 'sub',
    contactName: 'contactName',
    phoneEnc: 'phoneEnc',
    phoneMasked: 'phoneMasked',
    phoneHash: 'phoneHash',
    tokenHash: 'tokenHash',
    consentAttestedAt: 'consentAttestedAt',
    status: 'status',
    stoppedAt: 'stoppedAt',
    locale: 'locale',
    lastNotifiedState: 'lastNotifiedState',
    createdAt: 'createdAt'
};
exports.CarePlanBookingScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    providerId: 'providerId',
    clinicId: 'clinicId',
    typeId: 'typeId',
    status: 'status',
    visitDistrict: 'visitDistrict',
    visitAddressId: 'visitAddressId',
    preferredStartDate: 'preferredStartDate',
    notesEnc: 'notesEnc',
    kiorlyCarePlanId: 'kiorlyCarePlanId',
    endedReason: 'endedReason',
    confirmedAt: 'confirmedAt',
    endedAt: 'endedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.NurseLabRelayScalarFieldEnum = {
    id: 'id',
    clinicId: 'clinicId',
    patientRef: 'patientRef',
    partnerOrderId: 'partnerOrderId',
    registrationId: 'registrationId',
    labOrderNumber: 'labOrderNumber',
    status: 'status',
    lastLabStatus: 'lastLabStatus',
    refusalCode: 'refusalCode',
    reportId: 'reportId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ImportBatchScalarFieldEnum = {
    id: 'id',
    orgId: 'orgId',
    orgName: 'orgName',
    label: 'label',
    status: 'status',
    createdBy: 'createdBy',
    requestedBy: 'requestedBy',
    requestedAt: 'requestedAt',
    reportHash: 'reportHash',
    approvedBy: 'approvedBy',
    approvedAt: 'approvedAt',
    summary: 'summary',
    progress: 'progress',
    committedAt: 'committedAt',
    rolledBackAt: 'rolledBackAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ImportFileScalarFieldEnum = {
    id: 'id',
    batchId: 'batchId',
    name: 'name',
    kind: 'kind',
    rejectReason: 'rejectReason',
    sha256: 'sha256',
    size: 'size',
    sniffed: 'sniffed',
    storageKey: 'storageKey',
    tables: 'tables',
    meta: 'meta',
    createdAt: 'createdAt'
};
exports.ImportDecisionScalarFieldEnum = {
    id: 'id',
    batchId: 'batchId',
    taskKey: 'taskKey',
    action: 'action',
    params: 'params',
    reason: 'reason',
    decidedBy: 'decidedBy',
    createdAt: 'createdAt'
};
exports.ImportTaskScalarFieldEnum = {
    id: 'id',
    batchId: 'batchId',
    key: 'key',
    type: 'type',
    severity: 'severity',
    entity: 'entity',
    status: 'status',
    payload: 'payload',
    resolvedBy: 'resolvedBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.ImportCommitItemScalarFieldEnum = {
    id: 'id',
    batchId: 'batchId',
    entity: 'entity',
    sourceKey: 'sourceKey',
    targetId: 'targetId',
    idempotencyKey: 'idempotencyKey',
    status: 'status',
    createdAt: 'createdAt'
};
exports.PolicySettingScalarFieldEnum = {
    id: 'id',
    key: 'key',
    scope: 'scope',
    scopeId: 'scopeId',
    value: 'value',
    note: 'note',
    updatedBy: 'updatedBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.PartnerConnectionScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    orgRef: 'orgRef',
    name: 'name',
    nameAr: 'nameAr',
    market: 'market',
    contactEmail: 'contactEmail',
    baseUrl: 'baseUrl',
    clientKey: 'clientKey',
    secretsEnc: 'secretsEnc',
    pendingSecretsEnc: 'pendingSecretsEnc',
    intakeKeyHash: 'intakeKeyHash',
    statusTokenHash: 'statusTokenHash',
    status: 'status',
    readiness: 'readiness',
    checks: 'checks',
    human: 'human',
    registrationId: 'registrationId',
    decisionReason: 'decisionReason',
    requestedBy: 'requestedBy',
    approvedBy: 'approvedBy',
    approvedAt: 'approvedAt',
    liveAt: 'liveAt',
    checksRunAt: 'checksRunAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.PartnerEnrolmentScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    orgRef: 'orgRef',
    label: 'label',
    signingKey: 'signingKey',
    status: 'status',
    expiresAt: 'expiresAt',
    createdBy: 'createdBy',
    revokedBy: 'revokedBy',
    revokedAt: 'revokedAt',
    usedAt: 'usedAt',
    connectionId: 'connectionId',
    createdAt: 'createdAt'
};
exports.RateLimitBucketScalarFieldEnum = {
    key: 'key',
    windowStart: 'windowStart',
    count: 'count',
    expiresAt: 'expiresAt'
};
exports.PartnerIntakeNonceScalarFieldEnum = {
    id: 'id',
    seenAt: 'seenAt'
};
exports.PartnerLeadScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    orgRef: 'orgRef',
    orgName: 'orgName',
    contactName: 'contactName',
    contactRole: 'contactRole',
    phone: 'phone',
    email: 'email',
    preferredTime: 'preferredTime',
    note: 'note',
    locale: 'locale',
    market: 'market',
    consentAt: 'consentAt',
    status: 'status',
    assignee: 'assignee',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.PartnerFunnelMarkScalarFieldEnum = {
    kind: 'kind',
    orgRef: 'orgRef',
    stage: 'stage',
    firstAt: 'firstAt'
};
exports.OpsStaffContactScalarFieldEnum = {
    sub: 'sub',
    name: 'name',
    phone: 'phone',
    email: 'email',
    roles: 'roles',
    locale: 'locale',
    leadAlerts: 'leadAlerts',
    channels: 'channels',
    leadsSeenAt: 'leadsSeenAt',
    lastSeenAt: 'lastSeenAt',
    createdAt: 'createdAt'
};
exports.LeadAlertConfigScalarFieldEnum = {
    id: 'id',
    enabled: 'enabled',
    channels: 'channels',
    updatedBy: 'updatedBy',
    updatedAt: 'updatedAt'
};
exports.LeadAlertDeliveryScalarFieldEnum = {
    id: 'id',
    dedupeKey: 'dedupeKey',
    leadId: 'leadId',
    staffSub: 'staffSub',
    channel: 'channel',
    status: 'status',
    reason: 'reason',
    scheduledFor: 'scheduledFor',
    sentAt: 'sentAt',
    createdAt: 'createdAt'
};
exports.GrowthAcquisitionSourceScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sourceKind: 'sourceKind',
    sourceRef: 'sourceRef',
    label: 'label',
    ownerOrgRef: 'ownerOrgRef',
    active: 'active',
    linkStatus: 'linkStatus',
    linkRevokedAt: 'linkRevokedAt',
    registryCheckedAt: 'registryCheckedAt',
    createdAt: 'createdAt',
    product: 'product'
};
exports.GrowthTouchpointScalarFieldEnum = {
    id: 'id',
    market: 'market',
    visitorKey: 'visitorKey',
    sub: 'sub',
    sourceId: 'sourceId',
    kind: 'kind',
    providerOrgRef: 'providerOrgRef',
    linkCode: 'linkCode',
    utmSource: 'utmSource',
    utmMedium: 'utmMedium',
    utmCampaign: 'utmCampaign',
    utmContent: 'utmContent',
    utmTerm: 'utmTerm',
    clickIdKind: 'clickIdKind',
    clickIdHash: 'clickIdHash',
    referrerHost: 'referrerHost',
    landingKind: 'landingKind',
    localeAt: 'localeAt',
    dwellMs: 'dwellMs',
    ltTokenId: 'ltTokenId',
    occurredAt: 'occurredAt',
    ipHash: 'ipHash',
    uaClass: 'uaClass'
};
exports.GrowthAttributionDecisionScalarFieldEnum = {
    id: 'id',
    market: 'market',
    bookingId: 'bookingId',
    origin: 'origin',
    reasonCode: 'reasonCode',
    policyVersionId: 'policyVersionId',
    inputsHash: 'inputsHash',
    evidenceTouchIds: 'evidenceTouchIds',
    firstTouchId: 'firstTouchId',
    lastTouchId: 'lastTouchId',
    lastNonDirectTouchId: 'lastNonDirectTouchId',
    winningTouchId: 'winningTouchId',
    bookingSnapshot: 'bookingSnapshot',
    supersedesId: 'supersedesId',
    actor: 'actor',
    note: 'note',
    createdAt: 'createdAt'
};
exports.GrowthEventScalarFieldEnum = {
    id: 'id',
    market: 'market',
    name: 'name',
    visitorKey: 'visitorKey',
    bookingId: 'bookingId',
    careType: 'careType',
    props: 'props',
    dedupeKey: 'dedupeKey',
    occurredAt: 'occurredAt'
};
exports.GrowthMetricDailyScalarFieldEnum = {
    id: 'id',
    market: 'market',
    day: 'day',
    metric: 'metric',
    sourceKind: 'sourceKind',
    landingKind: 'landingKind',
    careType: 'careType',
    origin: 'origin',
    city: 'city',
    district: 'district',
    specialty: 'specialty',
    providerRef: 'providerRef',
    doctorRef: 'doctorRef',
    branchRef: 'branchRef',
    campaign: 'campaign',
    channel: 'channel',
    platform: 'platform',
    product: 'product',
    campaignId: 'campaignId',
    value: 'value',
    updatedAt: 'updatedAt'
};
exports.GrowthRevenueFactScalarFieldEnum = {
    id: 'id',
    market: 'market',
    kind: 'kind',
    chargeId: 'chargeId',
    appointmentId: 'appointmentId',
    bookingId: 'bookingId',
    status: 'status',
    amountMinor: 'amountMinor',
    currency: 'currency',
    origin: 'origin',
    occurredAt: 'occurredAt',
    createdAt: 'createdAt'
};
exports.GrowthSpendEntryScalarFieldEnum = {
    id: 'id',
    market: 'market',
    day: 'day',
    campaign: 'campaign',
    channel: 'channel',
    sourceKind: 'sourceKind',
    amountMinor: 'amountMinor',
    currency: 'currency',
    note: 'note',
    status: 'status',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    decidedBy: 'decidedBy',
    decidedAt: 'decidedAt',
    campaignId: 'campaignId',
    source: 'source',
    adapterRef: 'adapterRef'
};
exports.GrowthConfigVersionScalarFieldEnum = {
    id: 'id',
    kind: 'kind',
    scope: 'scope',
    scopeId: 'scopeId',
    version: 'version',
    status: 'status',
    payload: 'payload',
    schemaVersion: 'schemaVersion',
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    approvedBy: 'approvedBy',
    approvedAt: 'approvedAt',
    ticket: 'ticket',
    reason: 'reason',
    checksum: 'checksum',
    supersedesId: 'supersedesId',
    announcement: 'announcement'
};
exports.GrowthSlugScalarFieldEnum = {
    id: 'id',
    market: 'market',
    entityType: 'entityType',
    entityId: 'entityId',
    slug: 'slug',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.GrowthSlugHistoryScalarFieldEnum = {
    id: 'id',
    market: 'market',
    entityType: 'entityType',
    entityId: 'entityId',
    slug: 'slug',
    replacedBy: 'replacedBy',
    supersededAt: 'supersededAt'
};
exports.GrowthLandingPageScalarFieldEnum = {
    id: 'id',
    market: 'market',
    pageType: 'pageType',
    locale: 'locale',
    paramsKey: 'paramsKey',
    params: 'params',
    indexable: 'indexable',
    guardResult: 'guardResult',
    lastRenderedAt: 'lastRenderedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.WidgetRegistrationScalarFieldEnum = {
    id: 'id',
    market: 'market',
    orgRef: 'orgRef',
    orgSlug: 'orgSlug',
    origins: 'origins',
    status: 'status',
    syncedAt: 'syncedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.GrowthFraudSignalScalarFieldEnum = {
    id: 'id',
    market: 'market',
    ruleId: 'ruleId',
    subjectHash: 'subjectHash',
    score: 'score',
    evidenceRef: 'evidenceRef',
    createdAt: 'createdAt',
    reviewStatus: 'reviewStatus',
    reviewedBy: 'reviewedBy',
    reviewedAt: 'reviewedAt',
    reviewNote: 'reviewNote'
};
exports.GrowthConfigReaderScalarFieldEnum = {
    id: 'id',
    instanceId: 'instanceId',
    reader: 'reader',
    kind: 'kind',
    scope: 'scope',
    scopeId: 'scopeId',
    versionId: 'versionId',
    version: 'version',
    firstLoadedAt: 'firstLoadedAt',
    loadedAt: 'loadedAt',
    lastSeenAt: 'lastSeenAt'
};
exports.GrowthVisitorConsentScalarFieldEnum = {
    id: 'id',
    market: 'market',
    analytics: 'analytics',
    marketing: 'marketing',
    textVersion: 'textVersion',
    source: 'source',
    evidence: 'evidence',
    ipHash: 'ipHash',
    createdAt: 'createdAt'
};
exports.CommunicationSuppressionScalarFieldEnum = {
    id: 'id',
    market: 'market',
    channel: 'channel',
    addressHash: 'addressHash',
    reason: 'reason',
    source: 'source',
    createdAt: 'createdAt',
    liftedAt: 'liftedAt'
};
exports.GrowthCampaignScalarFieldEnum = {
    id: 'id',
    market: 'market',
    key: 'key',
    utmCampaign: 'utmCampaign',
    name: 'name',
    objective: 'objective',
    status: 'status',
    startsAt: 'startsAt',
    endsAt: 'endsAt',
    autoExpiresAt: 'autoExpiresAt',
    budgetTotalMinor: 'budgetTotalMinor',
    budgetDailyMinor: 'budgetDailyMinor',
    currency: 'currency',
    channels: 'channels',
    eligibility: 'eligibility',
    utmConfig: 'utmConfig',
    landingPageId: 'landingPageId',
    policyVersionId: 'policyVersionId',
    ownerSub: 'ownerSub',
    approvedPayloadHash: 'approvedPayloadHash',
    pausedUntil: 'pausedUntil',
    pauseReason: 'pauseReason',
    thresholdsFiredBp: 'thresholdsFiredBp',
    statusReason: 'statusReason',
    version: 'version',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    activatedAt: 'activatedAt',
    completedAt: 'completedAt',
    archivedAt: 'archivedAt'
};
exports.GrowthCampaignCreativeScalarFieldEnum = {
    id: 'id',
    campaignId: 'campaignId',
    kind: 'kind',
    assetRef: 'assetRef',
    locale: 'locale',
    status: 'status',
    checksum: 'checksum',
    createdBy: 'createdBy',
    createdAt: 'createdAt'
};
exports.GrowthCampaignApprovalScalarFieldEnum = {
    id: 'id',
    campaignId: 'campaignId',
    kind: 'kind',
    requestedBy: 'requestedBy',
    requestedAt: 'requestedAt',
    decidedBy: 'decidedBy',
    decidedAt: 'decidedAt',
    decision: 'decision',
    reason: 'reason',
    snapshot: 'snapshot',
    snapshotHash: 'snapshotHash'
};
exports.GrowthCampaignStatusHistoryScalarFieldEnum = {
    id: 'id',
    campaignId: 'campaignId',
    from: 'from',
    to: 'to',
    actor: 'actor',
    reasonCode: 'reasonCode',
    at: 'at'
};
exports.GrowthCampaignBudgetDailyScalarFieldEnum = {
    campaignId: 'campaignId',
    day: 'day',
    plannedMinor: 'plannedMinor',
    approvedSpendMinor: 'approvedSpendMinor',
    pendingSpendMinor: 'pendingSpendMinor',
    utilisationBp: 'utilisationBp',
    updatedAt: 'updatedAt'
};
exports.ReferralCodeScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sub: 'sub',
    code: 'code',
    status: 'status',
    createdAt: 'createdAt'
};
exports.ReferralRelationshipScalarFieldEnum = {
    id: 'id',
    market: 'market',
    referrerSub: 'referrerSub',
    refereeSub: 'refereeSub',
    codeId: 'codeId',
    touchId: 'touchId',
    status: 'status',
    rejectReason: 'rejectReason',
    firstBookingId: 'firstBookingId',
    qualifiedBookingId: 'qualifiedBookingId',
    ruleVersionId: 'ruleVersionId',
    createdAt: 'createdAt',
    qualifiedAt: 'qualifiedAt',
    holdUntil: 'holdUntil',
    completedAt: 'completedAt',
    reviewState: 'reviewState',
    campaignId: 'campaignId',
    claimedVia: 'claimedVia'
};
exports.ReferralQualificationCheckScalarFieldEnum = {
    id: 'id',
    relationshipId: 'relationshipId',
    checkKey: 'checkKey',
    passed: 'passed',
    detail: 'detail',
    at: 'at'
};
exports.ReferralIdentitySignalScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    kind: 'kind',
    valueHash: 'valueHash',
    firstSeenAt: 'firstSeenAt'
};
exports.RewardLotScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sub: 'sub',
    kind: 'kind',
    mode: 'mode',
    currency: 'currency',
    amountMinor: 'amountMinor',
    couponCodeHash: 'couponCodeHash',
    status: 'status',
    ruleVersionId: 'ruleVersionId',
    relationshipId: 'relationshipId',
    campaignId: 'campaignId',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    ownerSub: 'ownerSub',
    householdId: 'householdId',
    funding: 'funding',
    scope: 'scope',
    qualifyingBookingId: 'qualifyingBookingId',
    couponCodeSealed: 'couponCodeSealed',
    couponRevealedAt: 'couponRevealedAt',
    issuedBy: 'issuedBy',
    reasonCode: 'reasonCode'
};
exports.RewardLedgerEntryScalarFieldEnum = {
    id: 'id',
    lotId: 'lotId',
    type: 'type',
    amountMinor: 'amountMinor',
    currency: 'currency',
    idempotencyKey: 'idempotencyKey',
    ruleVersionId: 'ruleVersionId',
    bookingId: 'bookingId',
    payLinkId: 'payLinkId',
    relationshipId: 'relationshipId',
    reasonCode: 'reasonCode',
    actor: 'actor',
    createdAt: 'createdAt',
    refundId: 'refundId'
};
exports.RewardIssuanceBudgetScalarFieldEnum = {
    ruleVersionId: 'ruleVersionId',
    issuedMinor: 'issuedMinor',
    ceilingMinor: 'ceilingMinor',
    updatedAt: 'updatedAt'
};
exports.PatientLifecycleScalarFieldEnum = {
    sub: 'sub',
    market: 'market',
    stage: 'stage',
    stageAt: 'stageAt',
    registeredAt: 'registeredAt',
    lastBookingAt: 'lastBookingAt',
    lastAttendedAt: 'lastAttendedAt',
    bookingsCount: 'bookingsCount',
    platform: 'platform',
    language: 'language',
    city: 'city',
    district: 'district',
    referralStatus: 'referralStatus',
    hasDependants: 'hasDependants'
};
exports.LifecycleEnrollmentScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    market: 'market',
    journeyKey: 'journeyKey',
    journeyVersion: 'journeyVersion',
    state: 'state',
    step: 'step',
    nextRunAt: 'nextRunAt',
    startedAt: 'startedAt',
    endedAt: 'endedAt',
    endReason: 'endReason'
};
exports.LifecycleMessageDecisionScalarFieldEnum = {
    id: 'id',
    sub: 'sub',
    market: 'market',
    journeyKey: 'journeyKey',
    step: 'step',
    messageClass: 'messageClass',
    channel: 'channel',
    templateKey: 'templateKey',
    decision: 'decision',
    reason: 'reason',
    at: 'at',
    messageLogId: 'messageLogId'
};
exports.LifecycleSegmentSnapshotScalarFieldEnum = {
    day: 'day',
    market: 'market',
    segmentKey: 'segmentKey',
    countBucket: 'countBucket'
};
exports.AssistantSessionScalarFieldEnum = {
    id: 'id',
    market: 'market',
    channelConversationId: 'channelConversationId',
    sub: 'sub',
    phoneHash: 'phoneHash',
    state: 'state',
    language: 'language',
    consentVersion: 'consentVersion',
    tokenBudgetUsed: 'tokenBudgetUsed',
    costMinorUsed: 'costMinorUsed',
    turns: 'turns',
    lastToolAt: 'lastToolAt',
    escalatedAt: 'escalatedAt',
    closedAt: 'closedAt',
    createdAt: 'createdAt',
    expiresAt: 'expiresAt',
    context: 'context'
};
exports.AssistantTurnScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    seq: 'seq',
    direction: 'direction',
    redactedText: 'redactedText',
    intent: 'intent',
    toolName: 'toolName',
    modelMode: 'modelMode',
    tokensIn: 'tokensIn',
    tokensOut: 'tokensOut',
    costMinor: 'costMinor',
    latencyMs: 'latencyMs',
    outcome: 'outcome',
    createdAt: 'createdAt',
    purgeAfter: 'purgeAfter'
};
exports.AssistantToolCallScalarFieldEnum = {
    id: 'id',
    turnId: 'turnId',
    tool: 'tool',
    argsRedacted: 'argsRedacted',
    resultKind: 'resultKind',
    resultRef: 'resultRef',
    confirmNonceHash: 'confirmNonceHash',
    createdAt: 'createdAt'
};
exports.AssistantUsageDailyScalarFieldEnum = {
    day: 'day',
    market: 'market',
    tokens: 'tokens',
    costMinor: 'costMinor',
    conversations: 'conversations',
    breakerTripped: 'breakerTripped',
    updatedAt: 'updatedAt'
};
exports.AssistantEscalationScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    reason: 'reason',
    status: 'status',
    ackBy: 'ackBy',
    slaDueAt: 'slaDueAt',
    createdAt: 'createdAt',
    transcript: 'transcript',
    closedAt: 'closedAt',
    closedBy: 'closedBy'
};
exports.AssistantConfirmationScalarFieldEnum = {
    id: 'id',
    sessionId: 'sessionId',
    sub: 'sub',
    kind: 'kind',
    targetRef: 'targetRef',
    payload: 'payload',
    nonceHash: 'nonceHash',
    expiresAt: 'expiresAt',
    usedAt: 'usedAt',
    outcome: 'outcome',
    resultRef: 'resultRef',
    createdAt: 'createdAt'
};
exports.AssistantLinkScalarFieldEnum = {
    id: 'id',
    tokenHash: 'tokenHash',
    phoneHash: 'phoneHash',
    intent: 'intent',
    payload: 'payload',
    expiresAt: 'expiresAt',
    usedAt: 'usedAt',
    createdAt: 'createdAt'
};
exports.GrowthIntegrationRunScalarFieldEnum = {
    id: 'id',
    market: 'market',
    kind: 'kind',
    mode: 'mode',
    windowFrom: 'windowFrom',
    windowTo: 'windowTo',
    status: 'status',
    rows: 'rows',
    error: 'error',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt'
};
exports.GrowthExternalMetricDailyScalarFieldEnum = {
    id: 'id',
    market: 'market',
    kind: 'kind',
    day: 'day',
    dimensionKey: 'dimensionKey',
    metric: 'metric',
    value: 'value',
    currency: 'currency',
    fetchedAt: 'fetchedAt'
};
exports.GrowthIntegrationHealthScalarFieldEnum = {
    kind: 'kind',
    market: 'market',
    lastOkAt: 'lastOkAt',
    lastErrorAt: 'lastErrorAt',
    consecutiveFailures: 'consecutiveFailures',
    circuit: 'circuit',
    updatedAt: 'updatedAt'
};
exports.GrowthJobRunScalarFieldEnum = {
    id: 'id',
    job: 'job',
    instanceId: 'instanceId',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
    rows: 'rows',
    error: 'error'
};
exports.RewardHouseholdScalarFieldEnum = {
    id: 'id',
    market: 'market',
    ownerSub: 'ownerSub',
    createdAt: 'createdAt'
};
exports.RewardHouseholdMemberScalarFieldEnum = {
    householdId: 'householdId',
    memberSub: 'memberSub',
    relation: 'relation',
    addedAt: 'addedAt',
    endedAt: 'endedAt'
};
exports.RefundDestinationChoiceScalarFieldEnum = {
    id: 'id',
    market: 'market',
    refundId: 'refundId',
    bookingId: 'bookingId',
    sub: 'sub',
    choice: 'choice',
    chosenAt: 'chosenAt',
    source: 'source'
};
exports.GoodwillGrantScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sub: 'sub',
    reason: 'reason',
    bookingId: 'bookingId',
    ticketRef: 'ticketRef',
    amountMinor: 'amountMinor',
    lotId: 'lotId',
    grantedBy: 'grantedBy',
    approvedBy: 'approvedBy',
    createdAt: 'createdAt'
};
exports.RewardCheckoutLineScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sub: 'sub',
    bookingId: 'bookingId',
    payLinkId: 'payLinkId',
    priceMinor: 'priceMinor',
    lines: 'lines',
    createdAt: 'createdAt'
};
exports.RewardReconcileRunScalarFieldEnum = {
    id: 'id',
    market: 'market',
    ranAt: 'ranAt',
    results: 'results',
    ok: 'ok',
    caseRef: 'caseRef'
};
exports.ReferralShareScalarFieldEnum = {
    id: 'id',
    market: 'market',
    codeId: 'codeId',
    channel: 'channel',
    createdAt: 'createdAt'
};
exports.RewardApprovalRequestScalarFieldEnum = {
    id: 'id',
    market: 'market',
    kind: 'kind',
    status: 'status',
    sub: 'sub',
    amountMinor: 'amountMinor',
    reason: 'reason',
    bookingId: 'bookingId',
    ticketRef: 'ticketRef',
    payload: 'payload',
    requestedBy: 'requestedBy',
    decidedBy: 'decidedBy',
    decisionNote: 'decisionNote',
    lotId: 'lotId',
    createdAt: 'createdAt',
    decidedAt: 'decidedAt'
};
exports.RewardRecoverableLossScalarFieldEnum = {
    id: 'id',
    market: 'market',
    sub: 'sub',
    lotId: 'lotId',
    amountMinor: 'amountMinor',
    reasonCode: 'reasonCode',
    bookingId: 'bookingId',
    createdAt: 'createdAt'
};
exports.GrowthExperimentScalarFieldEnum = {
    id: 'id',
    market: 'market',
    key: 'key',
    name: 'name',
    surface: 'surface',
    hypothesis: 'hypothesis',
    status: 'status',
    variants: 'variants',
    allocationBp: 'allocationBp',
    eligibility: 'eligibility',
    primaryMetric: 'primaryMetric',
    guardrails: 'guardrails',
    mode: 'mode',
    alphaBp: 'alphaBp',
    minSample: 'minSample',
    plannedDays: 'plannedDays',
    salt: 'salt',
    startedAt: 'startedAt',
    stoppedAt: 'stoppedAt',
    stopReason: 'stopReason',
    createdBy: 'createdBy',
    approvedBy: 'approvedBy',
    flagKey: 'flagKey',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.GrowthExperimentExposureScalarFieldEnum = {
    id: 'id',
    experimentId: 'experimentId',
    market: 'market',
    day: 'day',
    variant: 'variant',
    unitKind: 'unitKind',
    unitHash: 'unitHash',
    subRef: 'subRef',
    firstAt: 'firstAt'
};
exports.GrowthExperimentDailyScalarFieldEnum = {
    experimentId: 'experimentId',
    day: 'day',
    variant: 'variant',
    exposures: 'exposures',
    conversions: 'conversions',
    guardrailCounts: 'guardrailCounts',
    updatedAt: 'updatedAt'
};
exports.GrowthExperimentResultScalarFieldEnum = {
    id: 'id',
    experimentId: 'experimentId',
    computedAt: 'computedAt',
    dayNumber: 'dayNumber',
    verdict: 'verdict',
    srmP: 'srmP',
    payload: 'payload'
};
exports.GrowthExperimentEventScalarFieldEnum = {
    id: 'id',
    experimentId: 'experimentId',
    at: 'at',
    kind: 'kind',
    actor: 'actor',
    reason: 'reason',
    diff: 'diff'
};
exports.GrowthAttributionModelResultScalarFieldEnum = {
    id: 'id',
    market: 'market',
    day: 'day',
    model: 'model',
    sourceKind: 'sourceKind',
    sourceRef: 'sourceRef',
    campaignId: 'campaignId',
    conversionsFrac: 'conversionsFrac',
    revenueMinor: 'revenueMinor',
    paths: 'paths',
    windowDays: 'windowDays',
    updatedAt: 'updatedAt'
};
exports.GrowthPathSnapshotScalarFieldEnum = {
    id: 'id',
    market: 'market',
    day: 'day',
    pathHash: 'pathHash',
    pathKinds: 'pathKinds',
    length: 'length',
    conversions: 'conversions',
    k: 'k',
    windowDays: 'windowDays'
};
exports.GrowthCohortMonthlyScalarFieldEnum = {
    id: 'id',
    market: 'market',
    cohortMonth: 'cohortMonth',
    cohortBasis: 'cohortBasis',
    sourceKind: 'sourceKind',
    campaignId: 'campaignId',
    platform: 'platform',
    monthIndex: 'monthIndex',
    patients: 'patients',
    retainedPatients: 'retainedPatients',
    completedBookings: 'completedBookings',
    revenueMinor: 'revenueMinor',
    rewardCostMinor: 'rewardCostMinor',
    k: 'k',
    suppressed: 'suppressed',
    updatedAt: 'updatedAt'
};
exports.GrowthLtvEstimateScalarFieldEnum = {
    id: 'id',
    market: 'market',
    cohortKey: 'cohortKey',
    horizonMonths: 'horizonMonths',
    estimateMinor: 'estimateMinor',
    lowMinor: 'lowMinor',
    highMinor: 'highMinor',
    modelVersion: 'modelVersion',
    computedAt: 'computedAt',
    n: 'n',
    label: 'label'
};
exports.FraudCaseScalarFieldEnum = {
    id: 'id',
    market: 'market',
    subjectHash: 'subjectHash',
    kind: 'kind',
    score: 'score',
    band: 'band',
    status: 'status',
    mode: 'mode',
    slaDueAt: 'slaDueAt',
    assignedTo: 'assignedTo',
    decision: 'decision',
    decisionNote: 'decisionNote',
    decidedBy: 'decidedBy',
    createdAt: 'createdAt',
    decidedAt: 'decidedAt',
    updatedAt: 'updatedAt'
};
exports.FraudCaseSignalScalarFieldEnum = {
    id: 'id',
    caseId: 'caseId',
    ruleId: 'ruleId',
    weight: 'weight',
    evidenceRef: 'evidenceRef',
    at: 'at'
};
exports.FraudDecisionLogScalarFieldEnum = {
    id: 'id',
    caseId: 'caseId',
    action: 'action',
    fromStatus: 'fromStatus',
    toStatus: 'toStatus',
    actor: 'actor',
    note: 'note',
    at: 'at'
};
exports.FraudCalibrationScalarFieldEnum = {
    market: 'market',
    day: 'day',
    ruleId: 'ruleId',
    flagged: 'flagged',
    confirmed: 'confirmed',
    dismissed: 'dismissed'
};
exports.SeoQualityReportScalarFieldEnum = {
    id: 'id',
    market: 'market',
    pageKey: 'pageKey',
    templateKind: 'templateKind',
    locale: 'locale',
    score: 'score',
    failedChecks: 'failedChecks',
    checkedAt: 'checkedAt',
    contentHash: 'contentHash'
};
exports.SeoInternalLinkScalarFieldEnum = {
    id: 'id',
    market: 'market',
    fromKey: 'fromKey',
    toKey: 'toKey',
    anchorKind: 'anchorKind',
    rule: 'rule',
    rank: 'rank',
    computedAt: 'computedAt'
};
exports.SeoVitalSnapshotScalarFieldEnum = {
    id: 'id',
    market: 'market',
    templateKind: 'templateKind',
    metric: 'metric',
    p75: 'p75',
    source: 'source',
    day: 'day',
    sampleSize: 'sampleSize'
};
exports.SeoIndexationSnapshotScalarFieldEnum = {
    id: 'id',
    market: 'market',
    day: 'day',
    templateKind: 'templateKind',
    submitted: 'submitted',
    indexed: 'indexed',
    excluded: 'excluded',
    reasonBuckets: 'reasonBuckets'
};
exports.GrowthProductDecisionScalarFieldEnum = {
    id: 'id',
    market: 'market',
    product: 'product',
    factKind: 'factKind',
    factId: 'factId',
    factStatusRef: 'factStatusRef',
    origin: 'origin',
    reasonCode: 'reasonCode',
    policyVersionId: 'policyVersionId',
    inputsHash: 'inputsHash',
    evidenceTouchIds: 'evidenceTouchIds',
    parentDecisionId: 'parentDecisionId',
    supersedesId: 'supersedesId',
    createdAt: 'createdAt'
};
exports.SponsoredPromotionProjectionScalarFieldEnum = {
    id: 'id',
    market: 'market',
    promotionId: 'promotionId',
    orgRef: 'orgRef',
    version: 'version',
    status: 'status',
    nameAr: 'nameAr',
    nameEn: 'nameEn',
    patientCopyAr: 'patientCopyAr',
    patientCopyEn: 'patientCopyEn',
    scope: 'scope',
    discount: 'discount',
    eligibility: 'eligibility',
    budgetCapMinor: 'budgetCapMinor',
    fundingMode: 'fundingMode',
    referencePriceMinor: 'referencePriceMinor',
    contentHash: 'contentHash',
    startsAt: 'startsAt',
    endsAt: 'endsAt',
    lastEventAt: 'lastEventAt',
    updatedAt: 'updatedAt'
};
exports.BookingSponsoredDiscountScalarFieldEnum = {
    id: 'id',
    market: 'market',
    bookingIntentId: 'bookingIntentId',
    promotionId: 'promotionId',
    promotionVersion: 'promotionVersion',
    amountMinor: 'amountMinor',
    currency: 'currency',
    reservationRef: 'reservationRef',
    state: 'state',
    debitRef: 'debitRef',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};
exports.SponsoredPromotionReviewScalarFieldEnum = {
    id: 'id',
    market: 'market',
    promotionId: 'promotionId',
    promotionVersion: 'promotionVersion',
    kind: 'kind',
    guardResult: 'guardResult',
    requestedBy: 'requestedBy',
    decidedBy: 'decidedBy',
    decision: 'decision',
    reason: 'reason',
    createdAt: 'createdAt',
    decidedAt: 'decidedAt'
};
exports.MarketOnboardingPlanScalarFieldEnum = {
    id: 'id',
    cc: 'cc',
    status: 'status',
    steps: 'steps',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    readyAt: 'readyAt',
    publishedAt: 'publishedAt'
};
exports.MarketGeographyScalarFieldEnum = {
    id: 'id',
    market: 'market',
    level: 'level',
    key: 'key',
    parentKey: 'parentKey',
    nameAr: 'nameAr',
    nameEn: 'nameEn',
    slugAr: 'slugAr',
    slugEn: 'slugEn',
    active: 'active',
    createdAt: 'createdAt'
};
exports.SortOrder = {
    asc: 'asc',
    desc: 'desc'
};
exports.JsonNullValueInput = {
    JsonNull: exports.JsonNull
};
exports.NullableJsonNullValueInput = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull
};
exports.QueryMode = {
    default: 'default',
    insensitive: 'insensitive'
};
exports.JsonNullValueFilter = {
    DbNull: exports.DbNull,
    JsonNull: exports.JsonNull,
    AnyNull: exports.AnyNull
};
exports.NullsOrder = {
    first: 'first',
    last: 'last'
};
//# sourceMappingURL=prismaNamespaceBrowser.js.map