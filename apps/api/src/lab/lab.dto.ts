import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LabTestDto {
  @ApiProperty() labId!: string;
  @ApiProperty() labName!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceMinor!: number;
  @ApiPropertyOptional() sampleType?: string;
  @ApiProperty() homeCollection!: boolean;
  @ApiPropertyOptional() preparation?: string;
}
export class LabTestsResultDto { @ApiProperty({ type: [LabTestDto] }) items!: LabTestDto[] }
export class LabSlotDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}
export class LabSlotsResultDto {
  @ApiProperty() labId!: string;
  @ApiProperty({ enum: ['HOME', 'WALK_IN'] }) collectionType!: string;
  @ApiProperty({ type: [LabSlotDto] }) slots!: LabSlotDto[];
}
export class LabBookingTestDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceMinor!: number;
}
export class LabBookingPaymentDto {
  @ApiProperty() paymentId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
}
export class LabBookingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'RESULT_RELEASED', 'REJECTED', 'CANCELLED'] }) status!: string;
  @ApiProperty() labId!: string;
  @ApiProperty({ type: [LabBookingTestDto] }) tests!: LabBookingTestDto[];
  @ApiProperty({ enum: ['HOME', 'WALK_IN'] }) collectionType!: string;
  @ApiProperty({ format: 'date-time' }) slotStartsAt!: string;
  @ApiProperty({ format: 'date-time' }) slotEndsAt!: string;
  @ApiProperty() subtotalMinor!: number;
  @ApiProperty() collectionFeeMinor!: number;
  @ApiProperty() totalMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Vault record id of the released report (GET /me/vault/{id})' }) resultRecordId!: string | null;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ type: LabBookingPaymentDto, nullable: true }) payment!: LabBookingPaymentDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
