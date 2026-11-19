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
  @ApiProperty({ enum: ['NONE', 'REQUIRED', 'PAID', 'REFUNDED', 'FORFEITED', 'RELEASED'] }) depositStatus!: string;
  depositAmountMinor!: number;
  currency!: string;
  @ApiProperty({ nullable: true, type: Boolean }) depositRefundable!: boolean | null;
  @ApiProperty({ type: BookingDepositDto, nullable: true }) deposit!: BookingDepositDto | null;
  @ApiProperty({ type: BookingDoctorDto, nullable: true }) doctor!: BookingDoctorDto | null;
  @ApiProperty({ type: BookingClinicDto, nullable: true }) clinic!: BookingClinicDto | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Kiorly cancellation policy as published on the listing' }) cancellationPolicy!: Record<string, unknown> | null;
  @ApiProperty({ type: [BookingTimelineDto] }) timeline!: BookingTimelineDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class DepositCheckoutDto {
  paymentId!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  amountMinor!: number;
  currency!: string;
}
