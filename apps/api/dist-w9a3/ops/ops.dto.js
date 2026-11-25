"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogDto = exports.OpsMessageDto = exports.CircuitDto = exports.LiquidityDto = exports.OpsOkDto = exports.ComplaintDto = exports.ModerationCaseDto = exports.BookingReconcileDto = exports.ImportResultDto = exports.ReconciliationRunDto = exports.PayoutRunDto = exports.FeeStatementDto = exports.FeeStatementTotalsDto = exports.FeeStatementLineDto = exports.RefundDto = exports.HomeGateMetricDto = exports.HomeGateClusterDto = exports.ReviewDecisionDto = exports.HeldDepositDto = exports.PaymentsDashboardDto = exports.LedgerBalanceDto = exports.ReconRunRowDto = exports.PayoutRowDto = exports.StatusTotalDto = exports.ReplayResultDto = exports.OutboxListDto = exports.OutboxStatsDto = exports.OutboxEventDto = exports.BookingTimelineOpsDto = exports.TimelineOutboxDto = exports.TimelineWebhookDto = exports.TimelineMessageDto = exports.PaymentRowDto = exports.RefundRowDto = exports.TimelineEventDto = exports.TimelineBookingDto = exports.OpsBookingDto = exports.SyncResultDto = exports.OpsProviderListDto = exports.OpsProviderDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const OBJ = { type: 'object', additionalProperties: true };
class OpsProviderDto {
    id;
    clinicId;
    clinicianId;
    status;
    nameEn;
    nameAr;
    specialty;
    syncedAt;
    profession;
    careType;
    serviceLocations;
    coverageDistricts;
}
exports.OpsProviderDto = OpsProviderDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Mirrored Kiorly listing status (LIVE, PAUSED, ...)' }),
    __metadata("design:type", String)
], OpsProviderDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OpsProviderDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OpsProviderDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OpsProviderDto.prototype, "specialty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, format: 'date-time' }),
    __metadata("design:type", String)
], OpsProviderDto.prototype, "syncedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, nullable: true, type: String, description: 'KXMOP01 mirrors the profession' }),
    __metadata("design:type", Object)
], OpsProviderDto.prototype, "profession", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }),
    __metadata("design:type", String)
], OpsProviderDto.prototype, "careType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, type: [String] }),
    __metadata("design:type", Array)
], OpsProviderDto.prototype, "serviceLocations", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, type: [String] }),
    __metadata("design:type", Array)
], OpsProviderDto.prototype, "coverageDistricts", void 0);
class OpsProviderListDto {
    total;
    items;
}
exports.OpsProviderListDto = OpsProviderListDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [OpsProviderDto] }),
    __metadata("design:type", Array)
], OpsProviderListDto.prototype, "items", void 0);
class SyncResultDto {
    upserted;
    skipped;
    pages;
}
exports.SyncResultDto = SyncResultDto;
class OpsBookingDto {
    id;
    providerId;
    clinicId;
    status;
    startsAt;
    callState;
    depositStatus;
    failureCode;
    createdAt;
    updatedAt;
}
exports.OpsBookingDto = OpsBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] }),
    __metadata("design:type", String)
], OpsBookingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OpsBookingDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OpsBookingDto.prototype, "failureCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OpsBookingDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OpsBookingDto.prototype, "updatedAt", void 0);
class TimelineBookingDto {
    id;
    sub;
    dependantId;
    providerId;
    clinicId;
    clinicianId;
    tenantId;
    typeId;
    startsAt;
    endsAt;
    status;
    channel;
    holdId;
    holdExternalRef;
    holdExpiresAt;
    callState;
    kiorlyAppointmentId;
    kiorlyPatientId;
    kiorlyVersion;
    confirmationDueAt;
    cancelledBy;
    cancellationReason;
    depositRefundable;
    failureCode;
    depositStatus;
    depositAmountMinor;
    currency;
    feeMinor;
    version;
    createdAt;
    updatedAt;
    terminalAt;
}
exports.TimelineBookingDto = TimelineBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "sub", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "dependantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "providerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "clinicianId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "tenantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "typeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "channel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "holdId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "holdExternalRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "holdExpiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "callState", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "kiorlyAppointmentId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "kiorlyPatientId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], TimelineBookingDto.prototype, "kiorlyVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "confirmationDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "cancelledBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "cancellationReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Boolean }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "depositRefundable", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "failureCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "depositStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], TimelineBookingDto.prototype, "depositAmountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "feeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], TimelineBookingDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineBookingDto.prototype, "updatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TimelineBookingDto.prototype, "terminalAt", void 0);
class TimelineEventDto {
    id;
    bookingId;
    kind;
    fromStatus;
    toStatus;
    detail;
    createdAt;
}
exports.TimelineEventDto = TimelineEventDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineEventDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineEventDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['INTENT', 'HOLD', 'KIORLY_CALL', 'WEBHOOK', 'PAYMENT', 'STATE', 'RECONCILE'] }),
    __metadata("design:type", String)
], TimelineEventDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineEventDto.prototype, "fromStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], TimelineEventDto.prototype, "toStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: 'object', additionalProperties: true, description: 'Free-form diagnostic detail of the step (no PHI)' }),
    __metadata("design:type", Object)
], TimelineEventDto.prototype, "detail", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineEventDto.prototype, "createdAt", void 0);
class RefundRowDto {
    id;
    paymentId;
    amountMinor;
    reason;
    status;
    idempotencyKey;
    pspRefundRef;
    createdAt;
    settledAt;
}
exports.RefundRowDto = RefundRowDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundRowDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundRowDto.prototype, "paymentId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], RefundRowDto.prototype, "amountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundRowDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['REQUESTED', 'SETTLED', 'FAILED'] }),
    __metadata("design:type", String)
], RefundRowDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundRowDto.prototype, "idempotencyKey", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], RefundRowDto.prototype, "pspRefundRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], RefundRowDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], RefundRowDto.prototype, "settledAt", void 0);
class PaymentRowDto {
    id;
    bookingId;
    payLinkToken;
    sub;
    clinicId;
    amountMinor;
    currency;
    psp;
    pspRef;
    checkoutUrl;
    status;
    refundedMinor;
    feeMinor;
    releasedAt;
    releaseKind;
    payoutId;
    purpose;
    orderRef;
    capturedAt;
    kiorlyNotified;
    createdAt;
    updatedAt;
    refunds;
}
exports.PaymentRowDto = PaymentRowDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "payLinkToken", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "sub", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaymentRowDto.prototype, "amountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "psp", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "pspRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "checkoutUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaymentRowDto.prototype, "refundedMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaymentRowDto.prototype, "feeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "releasedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "releaseKind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "payoutId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DEPOSIT', 'PHARMACY', 'LAB'] }),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "purpose", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "orderRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PaymentRowDto.prototype, "capturedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PaymentRowDto.prototype, "kiorlyNotified", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PaymentRowDto.prototype, "updatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [RefundRowDto] }),
    __metadata("design:type", Array)
], PaymentRowDto.prototype, "refunds", void 0);
class TimelineMessageDto {
    id;
    channel;
    status;
    templateId;
    scheduledFor;
}
exports.TimelineMessageDto = TimelineMessageDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineMessageDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineMessageDto.prototype, "channel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineMessageDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineMessageDto.prototype, "templateId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], TimelineMessageDto.prototype, "scheduledFor", void 0);
class TimelineWebhookDto {
    eventId;
    type;
    status;
    at;
}
exports.TimelineWebhookDto = TimelineWebhookDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineWebhookDto.prototype, "eventId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineWebhookDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineWebhookDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], TimelineWebhookDto.prototype, "at", void 0);
class TimelineOutboxDto {
    id;
    type;
    status;
    attempts;
}
exports.TimelineOutboxDto = TimelineOutboxDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineOutboxDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineOutboxDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], TimelineOutboxDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], TimelineOutboxDto.prototype, "attempts", void 0);
class BookingTimelineOpsDto {
    booking;
    events;
    payments;
    messages;
    webhooks;
    outbox;
}
exports.BookingTimelineOpsDto = BookingTimelineOpsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: TimelineBookingDto }),
    __metadata("design:type", TimelineBookingDto)
], BookingTimelineOpsDto.prototype, "booking", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TimelineEventDto] }),
    __metadata("design:type", Array)
], BookingTimelineOpsDto.prototype, "events", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PaymentRowDto] }),
    __metadata("design:type", Array)
], BookingTimelineOpsDto.prototype, "payments", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TimelineMessageDto] }),
    __metadata("design:type", Array)
], BookingTimelineOpsDto.prototype, "messages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TimelineWebhookDto] }),
    __metadata("design:type", Array)
], BookingTimelineOpsDto.prototype, "webhooks", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [TimelineOutboxDto] }),
    __metadata("design:type", Array)
], BookingTimelineOpsDto.prototype, "outbox", void 0);
class OutboxEventDto {
    id;
    type;
    aggregateType;
    aggregateId;
    target;
    status;
    attempts;
    lastError;
    nextAttemptAt;
    createdAt;
    sentAt;
}
exports.OutboxEventDto = OutboxEventDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PENDING', 'SENT', 'FAILED', 'DEAD'] }),
    __metadata("design:type", String)
], OutboxEventDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OutboxEventDto.prototype, "lastError", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OutboxEventDto.prototype, "nextAttemptAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OutboxEventDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], OutboxEventDto.prototype, "sentAt", void 0);
class OutboxStatsDto {
    pending;
    failed;
    dead;
    lagMs;
    lagAlert;
}
exports.OutboxStatsDto = OutboxStatsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Age of the oldest undelivered event in ms' }),
    __metadata("design:type", Number)
], OutboxStatsDto.prototype, "lagMs", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true when lag exceeds 2 minutes' }),
    __metadata("design:type", Boolean)
], OutboxStatsDto.prototype, "lagAlert", void 0);
class OutboxListDto {
    stats;
    items;
}
exports.OutboxListDto = OutboxListDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: OutboxStatsDto }),
    __metadata("design:type", OutboxStatsDto)
], OutboxListDto.prototype, "stats", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [OutboxEventDto] }),
    __metadata("design:type", Array)
], OutboxListDto.prototype, "items", void 0);
class ReplayResultDto {
    ok;
    status;
}
exports.ReplayResultDto = ReplayResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], ReplayResultDto.prototype, "status", void 0);
class StatusTotalDto {
    status;
    _count;
    _sum;
}
exports.StatusTotalDto = StatusTotalDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], StatusTotalDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'rows in this status' }),
    __metadata("design:type", Number)
], StatusTotalDto.prototype, "_count", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', properties: { amountMinor: { type: 'number', nullable: true } } }),
    __metadata("design:type", Object)
], StatusTotalDto.prototype, "_sum", void 0);
class PayoutRowDto {
    id;
    payoutRef;
    clinicId;
    amountMinor;
    currency;
    status;
    periodKey;
    paymentRefs;
    paidAt;
    createdAt;
}
exports.PayoutRowDto = PayoutRowDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "payoutRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "clinicId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PayoutRowDto.prototype, "amountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['SENT', 'KIORLY_RECORDED'] }),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "periodKey", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], PayoutRowDto.prototype, "paymentRefs", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "paidAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PayoutRowDto.prototype, "createdAt", void 0);
class ReconRunRowDto {
    id;
    kind;
    status;
    discrepancies;
    stats;
    createdAt;
}
exports.ReconRunRowDto = ReconRunRowDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ReconRunRowDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PSP_DAILY', 'BOOKING_NIGHTLY'] }),
    __metadata("design:type", String)
], ReconRunRowDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OK', 'DISCREPANCIES'] }),
    __metadata("design:type", String)
], ReconRunRowDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Per-item mismatch records (kind-specific)' }),
    __metadata("design:type", Array)
], ReconRunRowDto.prototype, "discrepancies", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: 'object', additionalProperties: { type: 'number' } }),
    __metadata("design:type", Object)
], ReconRunRowDto.prototype, "stats", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ReconRunRowDto.prototype, "createdAt", void 0);
class LedgerBalanceDto {
    account;
    debitMinor;
    creditMinor;
}
exports.LedgerBalanceDto = LedgerBalanceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'PSP_CLEARING, HELD:*, PAYABLE:*, REFUND_PAYABLE, PSP_FEES, MARKETPLACE_FEES' }),
    __metadata("design:type", String)
], LedgerBalanceDto.prototype, "account", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LedgerBalanceDto.prototype, "debitMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], LedgerBalanceDto.prototype, "creditMinor", void 0);
class PaymentsDashboardDto {
    intents;
    refunds;
    payouts;
    reconciliationRuns;
    balances;
    heldForReview;
}
exports.PaymentsDashboardDto = PaymentsDashboardDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [StatusTotalDto] }),
    __metadata("design:type", Array)
], PaymentsDashboardDto.prototype, "intents", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [StatusTotalDto] }),
    __metadata("design:type", Array)
], PaymentsDashboardDto.prototype, "refunds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [PayoutRowDto] }),
    __metadata("design:type", Array)
], PaymentsDashboardDto.prototype, "payouts", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ReconRunRowDto] }),
    __metadata("design:type", Array)
], PaymentsDashboardDto.prototype, "reconciliationRuns", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [LedgerBalanceDto] }),
    __metadata("design:type", Array)
], PaymentsDashboardDto.prototype, "balances", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', properties: { count: { type: 'number' }, amountMinor: { type: 'number' } }, description: 'KXMPAY07 deposits held for review' }),
    __metadata("design:type", Object)
], PaymentsDashboardDto.prototype, "heldForReview", void 0);
class HeldDepositDto {
    paymentId;
    bookingId;
    clinicId;
    amountMinor;
    currency;
    reason;
    heldForReviewAt;
    ageHours;
    providerId;
    district;
    abortedAt;
}
exports.HeldDepositDto = HeldDepositDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "heldForReviewAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "ageHours", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "providerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'District code only' }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], HeldDepositDto.prototype, "abortedAt", void 0);
class ReviewDecisionDto {
    paymentId;
    outcome;
    amountMinor;
    refundId;
}
exports.ReviewDecisionDto = ReviewDecisionDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['RELEASED_TO_PROVIDER', 'REFUNDED_TO_PATIENT'] }),
    __metadata("design:type", String)
], ReviewDecisionDto.prototype, "outcome", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], ReviewDecisionDto.prototype, "refundId", void 0);
class HomeGateClusterDto {
    cluster;
    homeEnabledProviders;
    threshold;
    met;
    byCareType;
}
exports.HomeGateClusterDto = HomeGateClusterDto;
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], HomeGateClusterDto.prototype, "byCareType", void 0);
class HomeGateMetricDto {
    threshold;
    clusterBasis;
    clusters;
    anyMet;
    allMet;
    gates;
    safetyConsoleLive;
}
exports.HomeGateMetricDto = HomeGateMetricDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Minimum home-enabled providers per launch cluster (50)' }),
    __metadata("design:type", Number)
], HomeGateMetricDto.prototype, "threshold", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'governorate' }),
    __metadata("design:type", String)
], HomeGateMetricDto.prototype, "clusterBasis", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [HomeGateClusterDto] }),
    __metadata("design:type", Array)
], HomeGateMetricDto.prototype, "clusters", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', additionalProperties: true, description: 'Human-recorded evidence state per gate (GHV1, GHV2): the metric never satisfies a gate' }),
    __metadata("design:type", Object)
], HomeGateMetricDto.prototype, "gates", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Safety console (KXMOP12) is deployed in this API' }),
    __metadata("design:type", Boolean)
], HomeGateMetricDto.prototype, "safetyConsoleLive", void 0);
class RefundDto {
    id;
    paymentId;
    amountMinor;
    reason;
    status;
}
exports.RefundDto = RefundDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['REQUESTED', 'SETTLED', 'FAILED'] }),
    __metadata("design:type", String)
], RefundDto.prototype, "status", void 0);
class FeeStatementLineDto {
    partner;
    orders;
    feeMinor;
    vatBps;
    vatMinor;
    totalMinor;
}
exports.FeeStatementLineDto = FeeStatementLineDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Ledger partner account owner, e.g. ph:<pharmacyId> or lab:<labId>' }),
    __metadata("design:type", String)
], FeeStatementLineDto.prototype, "partner", void 0);
class FeeStatementTotalsDto {
    feeMinor;
    vatMinor;
    totalMinor;
}
exports.FeeStatementTotalsDto = FeeStatementTotalsDto;
class FeeStatementDto {
    from;
    to;
    currency;
    vatBps;
    vatNote;
    lines;
    totals;
}
exports.FeeStatementDto = FeeStatementDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FeeStatementDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], FeeStatementDto.prototype, "to", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'VAT is a config line on Kiorex\'s own statements (FEE_STATEMENT_VAT_BPS, NEEDS_HUMAN). Never reported to any authority.' }),
    __metadata("design:type", Number)
], FeeStatementDto.prototype, "vatBps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [FeeStatementLineDto] }),
    __metadata("design:type", Array)
], FeeStatementDto.prototype, "lines", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: FeeStatementTotalsDto }),
    __metadata("design:type", FeeStatementTotalsDto)
], FeeStatementDto.prototype, "totals", void 0);
class PayoutRunDto {
    period;
    payouts;
}
exports.PayoutRunDto = PayoutRunDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ }),
    __metadata("design:type", Array)
], PayoutRunDto.prototype, "payouts", void 0);
class ReconciliationRunDto {
    id;
    kind;
    status;
    discrepancies;
    stats;
    createdAt;
}
exports.ReconciliationRunDto = ReconciliationRunDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PSP_DAILY', 'BOOKING_NIGHTLY'] }),
    __metadata("design:type", String)
], ReconciliationRunDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OK', 'DISCREPANCIES'] }),
    __metadata("design:type", String)
], ReconciliationRunDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ }),
    __metadata("design:type", Array)
], ReconciliationRunDto.prototype, "discrepancies", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ ...OBJ, nullable: true }),
    __metadata("design:type", Object)
], ReconciliationRunDto.prototype, "stats", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ReconciliationRunDto.prototype, "createdAt", void 0);
class ImportResultDto {
    imported;
}
exports.ImportResultDto = ImportResultDto;
class BookingReconcileDto {
    result;
}
exports.BookingReconcileDto = BookingReconcileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ ...OBJ, description: 'checked / corrected / missing / errors counters' }),
    __metadata("design:type", Object)
], BookingReconcileDto.prototype, "result", void 0);
class ModerationCaseDto {
    id;
    reviewId;
    reason;
    status;
    resolution;
    createdAt;
}
exports.ModerationCaseDto = ModerationCaseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OPEN', 'RESOLVED'] }),
    __metadata("design:type", String)
], ModerationCaseDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ModerationCaseDto.prototype, "resolution", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ModerationCaseDto.prototype, "createdAt", void 0);
class ComplaintDto {
    id;
    sub;
    bookingId;
    category;
    status;
    slaDueAt;
    createdAt;
    homeVisit;
    slaBreached;
    minutesToSla;
}
exports.ComplaintDto = ComplaintDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ComplaintDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ComplaintDto.prototype, "slaDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], ComplaintDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'KXMOP05: home-visit complaints have a 1 h SLA' }),
    __metadata("design:type", Boolean)
], ComplaintDto.prototype, "homeVisit", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Minutes until the SLA is due (negative = overdue)' }),
    __metadata("design:type", Number)
], ComplaintDto.prototype, "minutesToSla", void 0);
class OpsOkDto {
    ok;
    status;
}
exports.OpsOkDto = OpsOkDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], OpsOkDto.prototype, "status", void 0);
class LiquidityDto {
    windowDays;
    listedDoctors;
    liveDoctors;
    bookingsByStatus;
    searchToBook;
    searches;
    confirmedBookings;
    attended;
    noShow;
    byCareType;
    homeEnabledByDistrict;
    safetyAlerts;
}
exports.LiquidityDto = LiquidityDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: { type: 'object', properties: { status: { type: 'string' }, count: { type: 'number' } }, required: ['status', 'count'] } }),
    __metadata("design:type", Array)
], LiquidityDto.prototype, "bookingsByStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], LiquidityDto.prototype, "searchToBook", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ, description: 'KXMOP06 by care type and visit location' }),
    __metadata("design:type", Array)
], LiquidityDto.prototype, "byCareType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ, description: 'KXMOP06 home-enabled providers per district' }),
    __metadata("design:type", Array)
], LiquidityDto.prototype, "homeEnabledByDistrict", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], LiquidityDto.prototype, "safetyAlerts", void 0);
class CircuitDto {
    clinicId;
    fails;
    open;
    openUntil;
}
exports.CircuitDto = CircuitDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], CircuitDto.prototype, "openUntil", void 0);
class OpsMessageDto {
    id;
    sub;
    bookingId;
    channel;
    templateId;
    status;
    createdAt;
}
exports.OpsMessageDto = OpsMessageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OpsMessageDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OpsMessageDto.prototype, "createdAt", void 0);
class AuditLogDto {
    id;
    actor;
    action;
    resource;
    resourceId;
    metadata;
    createdAt;
}
exports.AuditLogDto = AuditLogDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AuditLogDto.prototype, "resourceId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ ...OBJ, nullable: true }),
    __metadata("design:type", Object)
], AuditLogDto.prototype, "metadata", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], AuditLogDto.prototype, "createdAt", void 0);
//# sourceMappingURL=ops.dto.js.map