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
exports.DepositCheckoutDto = exports.BookingDto = exports.BookingTelehealthDto = exports.HomeBookingDto = exports.HomeSafetyInfoDto = exports.HomeAbortedDto = exports.HomeFeeDto = exports.HomeEtaDto = exports.HomeAssigneeDto = exports.HomeStepDto = exports.VisitAddressViewDto = exports.BookingTimelineDto = exports.BookingDepositDto = exports.BookingClinicDto = exports.BookingDoctorDto = void 0;
const shared_dto_1 = require("../common/shared.dto");
const swagger_1 = require("@nestjs/swagger");
class BookingDoctorDto {
    nameEn;
    nameAr;
    specialty;
}
exports.BookingDoctorDto = BookingDoctorDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDoctorDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDoctorDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDoctorDto.prototype, "specialty", void 0);
class BookingClinicDto {
    nameEn;
    nameAr;
    addressEn;
    addressAr;
    phone;
    latitude;
    longitude;
}
exports.BookingClinicDto = BookingClinicDto;
class BookingDepositDto {
    paymentId;
    status;
    checkoutUrl;
}
exports.BookingDepositDto = BookingDepositDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }),
    __metadata("design:type", String)
], BookingDepositDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Hosted checkout URL while the payment is open' }),
    __metadata("design:type", Object)
], BookingDepositDto.prototype, "checkoutUrl", void 0);
class BookingTimelineDto {
    status;
    at;
}
exports.BookingTimelineDto = BookingTimelineDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingTimelineDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], BookingTimelineDto.prototype, "at", void 0);
class VisitAddressViewDto {
    district;
    governorate;
    masked;
    maskedAt;
    address;
}
exports.VisitAddressViewDto = VisitAddressViewDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], VisitAddressViewDto.prototype, "governorate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'true 24 h after the visit (KXMHV10): doorstep lines are no longer returned' }),
    __metadata("design:type", Boolean)
], VisitAddressViewDto.prototype, "masked", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time', required: false }),
    __metadata("design:type", Object)
], VisitAddressViewDto.prototype, "maskedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: 'object', nullable: true, additionalProperties: true, description: 'Doorstep lines of the booking snapshot; null once masked' }),
    __metadata("design:type", Object)
], VisitAddressViewDto.prototype, "address", void 0);
class HomeStepDto {
    key;
    reached;
    at;
}
exports.HomeStepDto = HomeStepDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FINISHED'] }),
    __metadata("design:type", String)
], HomeStepDto.prototype, "key", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], HomeStepDto.prototype, "at", void 0);
class HomeAssigneeDto {
    displayName;
    photoUrl;
    badge;
    profession;
}
exports.HomeAssigneeDto = HomeAssigneeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HomeAssigneeDto.prototype, "displayName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HomeAssigneeDto.prototype, "photoUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Verified-professional badge text' }),
    __metadata("design:type", Object)
], HomeAssigneeDto.prototype, "badge", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }),
    __metadata("design:type", Object)
], HomeAssigneeDto.prototype, "profession", void 0);
class HomeEtaDto {
    minutes;
    shared;
}
exports.HomeEtaDto = HomeEtaDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Coarse arrival estimate, only when the provider shares it (KXMHV06)' }),
    __metadata("design:type", Object)
], HomeEtaDto.prototype, "minutes", void 0);
class HomeFeeDto {
    visitFeeMinor;
    homeSurchargeMinor;
    totalMinor;
    currency;
    depositRequired;
}
exports.HomeFeeDto = HomeFeeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Visit fee without the home surcharge' }),
    __metadata("design:type", Object)
], HomeFeeDto.prototype, "visitFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Home surcharge (BR56): provider patient revenue on a separate invoice line; never enters S or C' }),
    __metadata("design:type", Number)
], HomeFeeDto.prototype, "homeSurchargeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Visit fee incl. home surcharge (KXMHV04)' }),
    __metadata("design:type", Number)
], HomeFeeDto.prototype, "totalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Deposit required (BR54 default for home visits when an amount is configured)' }),
    __metadata("design:type", Boolean)
], HomeFeeDto.prototype, "depositRequired", void 0);
class HomeAbortedDto {
    abortedAt;
    noShow;
    depositUnderReview;
}
exports.HomeAbortedDto = HomeAbortedDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], HomeAbortedDto.prototype, "abortedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'always false: an unsafe abort is never a no-show (BR61)' }),
    __metadata("design:type", Boolean)
], HomeAbortedDto.prototype, "noShow", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The deposit is held for ops review, never auto-forfeited (KXMPAY07)' }),
    __metadata("design:type", Boolean)
], HomeAbortedDto.prototype, "depositUnderReview", void 0);
class HomeSafetyInfoDto {
    reportProblemSlaMinutes;
    emergencyNumber;
}
exports.HomeSafetyInfoDto = HomeSafetyInfoDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Report-a-problem SLA in minutes (KXMOP05: 60)' }),
    __metadata("design:type", Number)
], HomeSafetyInfoDto.prototype, "reportProblemSlaMinutes", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123' }),
    __metadata("design:type", String)
], HomeSafetyInfoDto.prototype, "emergencyNumber", void 0);
class HomeBookingDto {
    district;
    subState;
    steps;
    trackingEnabled;
    eta;
    assignee;
    assignmentPending;
    fee;
    aborted;
    address;
    safety;
}
exports.HomeBookingDto = HomeBookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HomeBookingDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'ABORTED_UNSAFE'], description: 'Home sub-state (main status stays in the KX-03 §05 machine)' }),
    __metadata("design:type", Object)
], HomeBookingDto.prototype, "subState", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [HomeStepDto], description: 'Confirmed → On the way → Arrived → Finished (KXMHV06)' }),
    __metadata("design:type", Array)
], HomeBookingDto.prototype, "steps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'kiorex.visit_tracking effective: on-the-way updates and the estimate are shown' }),
    __metadata("design:type", Boolean)
], HomeBookingDto.prototype, "trackingEnabled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeEtaDto }),
    __metadata("design:type", HomeEtaDto)
], HomeBookingDto.prototype, "eta", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeAssigneeDto, nullable: true, description: 'Agency bookings: assigned nurse name, photo, badge once HOME_VISIT_ASSIGNED arrives (KXMHV05). Never a phone number' }),
    __metadata("design:type", Object)
], HomeBookingDto.prototype, "assignee", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Agency listing: waiting for the agency to assign a clinician' }),
    __metadata("design:type", Boolean)
], HomeBookingDto.prototype, "assignmentPending", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeFeeDto }),
    __metadata("design:type", HomeFeeDto)
], HomeBookingDto.prototype, "fee", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeAbortedDto, nullable: true }),
    __metadata("design:type", Object)
], HomeBookingDto.prototype, "aborted", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: VisitAddressViewDto, description: 'Masked 24 h after the visit (KXMHV10)' }),
    __metadata("design:type", VisitAddressViewDto)
], HomeBookingDto.prototype, "address", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeSafetyInfoDto }),
    __metadata("design:type", HomeSafetyInfoDto)
], HomeBookingDto.prototype, "safety", void 0);
class BookingTelehealthDto {
    sessionId;
    state;
    joinUrl;
    opensAt;
    closesAt;
    movedFrom;
}
exports.BookingTelehealthDto = BookingTelehealthDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Clinic TelehealthSession id (the Clinic owns the call; Kiorex stores the id only)' }),
    __metadata("design:type", String)
], BookingTelehealthDto.prototype, "sessionId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['SCHEDULED', 'LIVE', 'ENDED', 'MISSED', 'CANCELLED', 'IN_PERSON'], description: 'IN_PERSON = the visit was changed to an in-person visit' }),
    __metadata("design:type", String)
], BookingTelehealthDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Patient join page on the Clinic (https://.../v/<token>). Null once the visit can no longer be joined. Open it in the browser, or in a WebView with camera/microphone permission in the app.' }),
    __metadata("design:type", Object)
], BookingTelehealthDto.prototype, "joinUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Join window opens (Clinic value, else 15 min before the booking time)' }),
    __metadata("design:type", String)
], BookingTelehealthDto.prototype, "opensAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time', description: 'Join window closes (Clinic value, else 2 h after the booking time)' }),
    __metadata("design:type", String)
], BookingTelehealthDto.prototype, "closesAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time', description: 'Previous start time when the visit was moved' }),
    __metadata("design:type", Object)
], BookingTelehealthDto.prototype, "movedFrom", void 0);
class BookingDto {
    id;
    status;
    providerId;
    clinicId;
    typeId;
    startsAt;
    endsAt;
    dependantId;
    channel;
    holdExpiresAt;
    confirmationDueAt;
    cancelledBy;
    cancellationReason;
    failureCode;
    callState;
    depositStatus;
    depositAmountMinor;
    currency;
    depositRefundable;
    deposit;
    doctor;
    clinic;
    cancellationPolicy;
    timeline;
    createdAt;
    serviceLocation;
    careType;
    visitDistrict;
    feeMinor;
    home;
    telehealth;
}
exports.BookingDto = BookingDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Kiorex booking id; also the Kiorly Idempotency-Key / externalReference' }),
    __metadata("design:type", String)
], BookingDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], BookingDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], BookingDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDto.prototype, "dependantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['MARKETPLACE', 'CLINIC_LINK', 'WHATSAPP'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "channel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time', description: 'Only while HELD (5-minute hold)' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "holdExpiresAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "confirmationDueAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDto.prototype, "cancelledBy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDto.prototype, "cancellationReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], BookingDto.prototype, "failureCode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['NONE', 'IN_FLIGHT', 'UNCERTAIN'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "callState", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['NONE', 'REQUIRED', 'PAID', 'REFUNDED', 'FORFEITED', 'RELEASED', 'HOLD_FOR_REVIEW'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "depositStatus", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Boolean }),
    __metadata("design:type", Object)
], BookingDto.prototype, "depositRefundable", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingDepositDto, nullable: true }),
    __metadata("design:type", Object)
], BookingDto.prototype, "deposit", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingDoctorDto, nullable: true }),
    __metadata("design:type", Object)
], BookingDto.prototype, "doctor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingClinicDto, nullable: true }),
    __metadata("design:type", Object)
], BookingDto.prototype, "clinic", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: shared_dto_1.CancellationPolicyDto, nullable: true, description: 'Kiorly cancellation policy as published on the listing' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "cancellationPolicy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [BookingTimelineDto] }),
    __metadata("design:type", Array)
], BookingDto.prototype, "timeline", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], BookingDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IN_CLINIC', 'HOME'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "serviceLocation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }),
    __metadata("design:type", String)
], BookingDto.prototype, "careType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'District code only (KXMHV03: the address itself is under the patient)' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "visitDistrict", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Visit fee (home surcharge is separate, see home.fee)' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "feeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeBookingDto, nullable: true, description: 'Present for HOME bookings' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "home", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: BookingTelehealthDto, nullable: true, description: 'Present for Clinic-owned video visits (kiorex.telemedicine)' }),
    __metadata("design:type", Object)
], BookingDto.prototype, "telehealth", void 0);
class DepositCheckoutDto {
    paymentId;
    checkoutUrl;
    amountMinor;
    currency;
    rewardMinor;
    lines;
    couponProblem;
}
exports.DepositCheckoutDto = DepositCheckoutDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DepositCheckoutDto.prototype, "checkoutUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'The CARD amount to pay now (the deposit minus any credit applied)' }),
    __metadata("design:type", Number)
], DepositCheckoutDto.prototype, "amountMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'GRW-P2-B2: credit (coupon or patient credit) applied to this deposit, in minor units; absent when none' }),
    __metadata("design:type", Number)
], DepositCheckoutDto.prototype, "rewardMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'GRW-P2-B2: the ordered checkout lines (PRICE, credit, CARD) whose sum is the deposit; absent when no credit applies' }),
    __metadata("design:type", Array)
], DepositCheckoutDto.prototype, "lines", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'GRW-P2-B2: why a coupon was not applied (COUPON_INVALID, NOT_APPLICABLE); the same text for a wrong code and for a code of another account' }),
    __metadata("design:type", String)
], DepositCheckoutDto.prototype, "couponProblem", void 0);
//# sourceMappingURL=booking.dto.js.map