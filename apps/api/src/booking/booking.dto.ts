import { CancellationPolicyDto } from '../common/shared.dto';
import { ApiProperty } from '@nestjs/swagger';

export class BookingDoctorDto {
  @ApiProperty({ nullable: true, type: String }) nameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) specialty!: string | null;
}
export class BookingClinicDto {
  nameEn!: string;
  nameAr!: string;
  addressEn!: string;
  addressAr!: string;
  phone!: string;
  latitude!: number;
  longitude!: number;
}
export class BookingDepositDto {
  paymentId!: string;
  @ApiProperty({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Hosted checkout URL while the payment is open' }) checkoutUrl!: string | null;
}
export class BookingTimelineDto {
  @ApiProperty({ nullable: true, type: String }) status!: string | null;
  @ApiProperty({ format: 'date-time' }) at!: string;
}
export class VisitAddressViewDto {
  district!: string;
  @ApiProperty({ nullable: true, type: String }) governorate!: string | null;
  @ApiProperty({ description: 'true 24 h after the visit (KXMHV10): doorstep lines are no longer returned' }) masked!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time', required: false }) maskedAt?: string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'Doorstep lines of the booking snapshot; null once masked' }) address!: Record<string, unknown> | null;
}
export class HomeStepDto {
  @ApiProperty({ enum: ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FINISHED'] }) key!: string;
  reached!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) at!: string | null;
}
export class HomeAssigneeDto {
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Verified-professional badge text' }) badge!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }) profession!: string | null;
}
export class HomeEtaDto {
  @ApiProperty({ nullable: true, type: Number, description: 'Coarse arrival estimate, only when the provider shares it (KXMHV06)' }) minutes!: number | null;
  shared!: boolean;
}
export class HomeFeeDto {
  @ApiProperty({ nullable: true, type: Number, description: 'Visit fee without the home surcharge' }) visitFeeMinor!: number | null;
  @ApiProperty({ description: 'Home surcharge (BR56): provider patient revenue on a separate invoice line; never enters S or C' }) homeSurchargeMinor!: number;
  @ApiProperty({ description: 'Visit fee incl. home surcharge (KXMHV04)' }) totalMinor!: number;
  currency!: string;
  @ApiProperty({ description: 'Deposit required (BR54 default for home visits when an amount is configured)' }) depositRequired!: boolean;
}
export class HomeAbortedDto {
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) abortedAt!: string | null;
  @ApiProperty({ description: 'always false: an unsafe abort is never a no-show (BR61)' }) noShow!: boolean;
  @ApiProperty({ description: 'The deposit is held for ops review, never auto-forfeited (KXMPAY07)' }) depositUnderReview!: boolean;
}
export class HomeSafetyInfoDto {
  @ApiProperty({ description: 'Report-a-problem SLA in minutes (KXMOP05: 60)' }) reportProblemSlaMinutes!: number;
  @ApiProperty({ example: '123' }) emergencyNumber!: string;
}
export class HomeBookingDto {
  @ApiProperty({ nullable: true, type: String }) district!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'ABORTED_UNSAFE'], description: 'Home sub-state (main status stays in the KX-03 §05 machine)' }) subState!: string | null;
  @ApiProperty({ type: [HomeStepDto], description: 'Confirmed → On the way → Arrived → Finished (KXMHV06)' }) steps!: HomeStepDto[];
  @ApiProperty({ description: 'kiorex.visit_tracking effective: on-the-way updates and the estimate are shown' }) trackingEnabled!: boolean;
  @ApiProperty({ type: HomeEtaDto }) eta!: HomeEtaDto;
  @ApiProperty({ type: HomeAssigneeDto, nullable: true, description: 'Agency bookings: assigned nurse name, photo, badge once HOME_VISIT_ASSIGNED arrives (KXMHV05). Never a phone number' }) assignee!: HomeAssigneeDto | null;
  @ApiProperty({ description: 'Agency listing: waiting for the agency to assign a clinician' }) assignmentPending!: boolean;
  @ApiProperty({ type: HomeFeeDto }) fee!: HomeFeeDto;
  @ApiProperty({ type: HomeAbortedDto, nullable: true }) aborted!: HomeAbortedDto | null;
  @ApiProperty({ type: VisitAddressViewDto, description: 'Masked 24 h after the visit (KXMHV10)' }) address!: VisitAddressViewDto;
  @ApiProperty({ type: HomeSafetyInfoDto }) safety!: HomeSafetyInfoDto;
}
export class BookingTelehealthDto {
  @ApiProperty({ description: 'Clinic TelehealthSession id (the Clinic owns the call; Kiorex stores the id only)' }) sessionId!: string;
  @ApiProperty({ enum: ['SCHEDULED', 'LIVE', 'ENDED', 'MISSED', 'CANCELLED', 'IN_PERSON'], description: 'IN_PERSON = the visit was changed to an in-person visit' }) state!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Patient join page on the Clinic (https://.../v/<token>). Null once the visit can no longer be joined. Open it in the browser, or in a WebView with camera/microphone permission in the app.' }) joinUrl!: string | null;
  @ApiProperty({ format: 'date-time', description: 'Join window opens (Clinic value, else 15 min before the booking time)' }) opensAt!: string;
  @ApiProperty({ format: 'date-time', description: 'Join window closes (Clinic value, else 2 h after the booking time)' }) closesAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time', description: 'Previous start time when the visit was moved' }) movedFrom!: string | null;
}
export class BookingDto {
  @ApiProperty({ description: 'Kiorex booking id; also the Kiorly Idempotency-Key / externalReference' }) id!: string;
  @ApiProperty({ enum: ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] }) status!: string;
  providerId!: string;
  clinicId!: string;
  typeId!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty({ nullable: true, type: String }) dependantId!: string | null;
  @ApiProperty({ enum: ['MARKETPLACE', 'CLINIC_LINK', 'WHATSAPP'] }) channel!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time', description: 'Only while HELD (5-minute hold)' }) holdExpiresAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) confirmationDueAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelledBy!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancellationReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) failureCode!: string | null;
  @ApiProperty({ enum: ['NONE', 'IN_FLIGHT', 'UNCERTAIN'] }) callState!: string;
  @ApiProperty({ enum: ['NONE', 'REQUIRED', 'PAID', 'REFUNDED', 'FORFEITED', 'RELEASED', 'HOLD_FOR_REVIEW'] }) depositStatus!: string;
  depositAmountMinor!: number;
  currency!: string;
  @ApiProperty({ nullable: true, type: Boolean }) depositRefundable!: boolean | null;
  @ApiProperty({ type: BookingDepositDto, nullable: true }) deposit!: BookingDepositDto | null;
  @ApiProperty({ type: BookingDoctorDto, nullable: true }) doctor!: BookingDoctorDto | null;
  @ApiProperty({ type: BookingClinicDto, nullable: true }) clinic!: BookingClinicDto | null;
  @ApiProperty({ type: CancellationPolicyDto, nullable: true, description: 'Kiorly cancellation policy as published on the listing' }) cancellationPolicy!: CancellationPolicyDto | null;
  @ApiProperty({ type: [BookingTimelineDto] }) timeline!: BookingTimelineDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ enum: ['IN_CLINIC', 'HOME'] }) serviceLocation!: string;
  @ApiProperty({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }) careType!: string;
  @ApiProperty({ nullable: true, type: String, description: 'District code only (KXMHV03: the address itself is under the patient)' }) visitDistrict!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Visit fee (home surcharge is separate, see home.fee)' }) feeMinor!: number | null;
  @ApiProperty({ type: HomeBookingDto, nullable: true, description: 'Present for HOME bookings' }) home!: HomeBookingDto | null;
  @ApiProperty({ type: BookingTelehealthDto, nullable: true, description: 'Present for Clinic-owned video visits (kiorex.telemedicine)' }) telehealth!: BookingTelehealthDto | null;
}
export class DepositCheckoutDto {
  paymentId!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  amountMinor!: number;
  currency!: string;
}
