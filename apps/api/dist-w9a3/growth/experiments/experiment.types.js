"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricByKey = exports.METRICS = exports.EXPERIMENT_POLICY = exports.EXPERIMENT_STATUSES = void 0;
exports.EXPERIMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RUNNING', 'STOPPED', 'CONCLUDED', 'ARCHIVED'];
exports.EXPERIMENT_POLICY = {
    minRunDays: 7,
    srmAlpha: 0.001,
    maxConcurrentPerSurface: 1,
    maxVariants: 5,
    kAnonymity: 10,
    assignmentTtlSeconds: 600,
    maxRunFactor: 2,
    guardrailMinEvents: 20,
    conversionWindowDays: 7,
    maxCookieExperiments: 3,
};
exports.METRICS = [
    { key: 'booking_started', event: 'BookingInitiated', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
    { key: 'booking_confirmed', event: 'BookingConfirmed', harmful: false, kind: 'PRIMARY', unit: 'BOOKING' },
    { key: 'booking_attended', event: 'BookingAttended', harmful: false, kind: 'PRIMARY', unit: 'BOOKING' },
    { key: 'signup_completed', event: 'PatientRegistered', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
    { key: 'referral_invite', event: 'ReferralInviteShared', harmful: false, kind: 'PRIMARY', unit: 'VISITOR' },
    { key: 'message_opt_out', event: 'MessageOptOut', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
    { key: 'complaint', event: 'ComplaintFiled', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
    { key: 'page_error', event: 'PageError', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
    { key: 'page_slow', event: 'PageSlow', harmful: true, kind: 'GUARDRAIL', unit: 'VISITOR' },
    { key: 'cancellation', event: 'BookingCancelled', harmful: true, kind: 'GUARDRAIL', unit: 'BOOKING' },
];
const metricByKey = (k) => exports.METRICS.find((m) => m.key === k);
exports.metricByKey = metricByKey;
//# sourceMappingURL=experiment.types.js.map