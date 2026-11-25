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
exports.SweepSafetyDto = exports.UnsafeAbortDto = exports.EscalationLogDto = exports.SafetySummaryDto = exports.SafetyAlertListDto = exports.SafetyAlertDto = exports.SafetySloDto = exports.CarePlanDto = exports.CarePlanVisitDto = exports.ProblemReportDto = exports.SafetyCardDto = exports.PublicVisitStatusDto = exports.FamilyShareCreatedDto = exports.FamilyShareDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const OBJ = { type: 'object', additionalProperties: true };
const DT = { type: String, format: 'date-time' };
class FamilyShareDto {
    id;
    bookingId;
    contactName;
    phoneMasked;
    status;
    locale;
    createdAt;
}
exports.FamilyShareDto = FamilyShareDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Masked phone (the number itself is encrypted and never returned)' }),
    __metadata("design:type", String)
], FamilyShareDto.prototype, "phoneMasked", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['ACTIVE', 'STOPPED', 'REVOKED'] }),
    __metadata("design:type", String)
], FamilyShareDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], FamilyShareDto.prototype, "createdAt", void 0);
class FamilyShareCreatedDto extends FamilyShareDto {
    link;
}
exports.FamilyShareCreatedDto = FamilyShareCreatedDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'WhatsApp visit-status link; returned ONCE (only its hash is stored)' }),
    __metadata("design:type", String)
], FamilyShareCreatedDto.prototype, "link", void 0);
class PublicVisitStatusDto {
    patientFirstName;
    startsAt;
    status;
    subState;
    steps;
    eta;
    provider;
    stopped;
}
exports.PublicVisitStatusDto = PublicVisitStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PublicVisitStatusDto.prototype, "patientFirstName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], PublicVisitStatusDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PublicVisitStatusDto.prototype, "subState", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ }),
    __metadata("design:type", Array)
], PublicVisitStatusDto.prototype, "steps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], PublicVisitStatusDto.prototype, "eta", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ ...OBJ, nullable: true }),
    __metadata("design:type", Object)
], PublicVisitStatusDto.prototype, "provider", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The visit was stopped (no reason is ever shown to family)' }),
    __metadata("design:type", Boolean)
], PublicVisitStatusDto.prototype, "stopped", void 0);
class SafetyCardDto {
    bookingId;
    provider;
    assignmentPending;
    emergencyNumber;
    reportProblem;
    familyShare;
}
exports.SafetyCardDto = SafetyCardDto;
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], SafetyCardDto.prototype, "provider", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123' }),
    __metadata("design:type", String)
], SafetyCardDto.prototype, "emergencyNumber", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], SafetyCardDto.prototype, "reportProblem", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], SafetyCardDto.prototype, "familyShare", void 0);
class ProblemReportDto {
    id;
    category;
    slaDueAt;
    homeVisit;
    status;
}
exports.ProblemReportDto = ProblemReportDto;
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], ProblemReportDto.prototype, "slaDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true for home visits: 1 h SLA (KXMOP05)' }),
    __metadata("design:type", Boolean)
], ProblemReportDto.prototype, "homeVisit", void 0);
class CarePlanVisitDto {
    bookingId;
    startsAt;
    endsAt;
    status;
    homeState;
}
exports.CarePlanVisitDto = CarePlanVisitDto;
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], CarePlanVisitDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], CarePlanVisitDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CarePlanVisitDto.prototype, "homeState", void 0);
class CarePlanDto {
    id;
    providerId;
    status;
    district;
    confirmedAt;
    endedAt;
    endedReason;
    createdAt;
    visits;
    completedVisits;
}
exports.CarePlanDto = CarePlanDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['REQUESTED', 'CONFIRMED', 'ENDED', 'REJECTED'] }),
    __metadata("design:type", String)
], CarePlanDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CarePlanDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], CarePlanDto.prototype, "confirmedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], CarePlanDto.prototype, "endedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CarePlanDto.prototype, "endedReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], CarePlanDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [CarePlanVisitDto], description: 'One booking with a schedule; each visit has its own status (KXMHV08)' }),
    __metadata("design:type", Array)
], CarePlanDto.prototype, "visits", void 0);
class SafetySloDto {
    seconds;
    deadlineAt;
    deliveredAt;
    deliveryLagSeconds;
    met;
    breached;
    receiveLagSeconds;
}
exports.SafetySloDto = SafetySloDto;
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], SafetySloDto.prototype, "deadlineAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], SafetySloDto.prototype, "deliveredAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SafetySloDto.prototype, "deliveryLagSeconds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Boolean }),
    __metadata("design:type", Object)
], SafetySloDto.prototype, "met", void 0);
class SafetyAlertDto {
    id;
    alertId;
    kind;
    status;
    bookingId;
    clinicId;
    district;
    raisedAt;
    receivedAt;
    slo;
    delivery;
    acknowledgedAt;
    acknowledgedBy;
    ackLagSeconds;
    escalatedAt;
    escalationLevel;
    resolvedAt;
    needsEscalation;
    ageSeconds;
    providerName;
    clinicPhone;
    actions;
}
exports.SafetyAlertDto = SafetyAlertDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['TIMER_EXPIRED', 'SOS', 'UNSAFE_ABORT'] }),
    __metadata("design:type", String)
], SafetyAlertDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['RAISED', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'] }),
    __metadata("design:type", String)
], SafetyAlertDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'District code only' }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], SafetyAlertDto.prototype, "raisedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], SafetyAlertDto.prototype, "receivedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: SafetySloDto, description: '60 s delivery SLO fields' }),
    __metadata("design:type", SafetySloDto)
], SafetyAlertDto.prototype, "slo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(OBJ),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "delivery", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "acknowledgedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "acknowledgedBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "ackLagSeconds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "escalatedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "resolvedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Unacknowledged beyond SAFETY_ACK_ESCALATE_MINUTES (10)' }),
    __metadata("design:type", Boolean)
], SafetyAlertDto.prototype, "needsEscalation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "providerName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SafetyAlertDto.prototype, "clinicPhone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ }),
    __metadata("design:type", Array)
], SafetyAlertDto.prototype, "actions", void 0);
class SafetyAlertListDto {
    items;
}
exports.SafetyAlertListDto = SafetyAlertListDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SafetyAlertDto] }),
    __metadata("design:type", Array)
], SafetyAlertListDto.prototype, "items", void 0);
class SafetySummaryDto {
    windowDays;
    total;
    open;
    unacknowledged;
    sloBreaches;
    medianDeliverySeconds;
    p95DeliverySeconds;
    byKind;
    unsafeAborts;
    depositsHeldForReview;
    deliveryMode;
    sloSeconds;
    ackEscalateMinutes;
}
exports.SafetySummaryDto = SafetySummaryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SafetySummaryDto.prototype, "medianDeliverySeconds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SafetySummaryDto.prototype, "p95DeliverySeconds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'array', items: OBJ }),
    __metadata("design:type", Array)
], SafetySummaryDto.prototype, "byKind", void 0);
class EscalationLogDto {
    alertId;
    id;
    kind;
    district;
    action;
    actor;
    note;
    at;
    level;
}
exports.EscalationLogDto = EscalationLogDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], EscalationLogDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], EscalationLogDto.prototype, "note", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(DT),
    __metadata("design:type", String)
], EscalationLogDto.prototype, "at", void 0);
class UnsafeAbortDto {
    bookingId;
    providerId;
    clinicId;
    district;
    abortedAt;
    noShow;
    depositStatus;
    paymentId;
    reviewState;
    amountMinor;
}
exports.UnsafeAbortDto = UnsafeAbortDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], UnsafeAbortDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, ...DT }),
    __metadata("design:type", Object)
], UnsafeAbortDto.prototype, "abortedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'always false (BR61)' }),
    __metadata("design:type", Boolean)
], UnsafeAbortDto.prototype, "noShow", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], UnsafeAbortDto.prototype, "paymentId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], UnsafeAbortDto.prototype, "reviewState", void 0);
class SweepSafetyDto {
    retried;
    escalated;
}
exports.SweepSafetyDto = SweepSafetyDto;
//# sourceMappingURL=homecare.dto.js.map