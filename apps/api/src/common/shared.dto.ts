import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shapes shared by several modules (kept in the shared kernel; see module-boundaries test). */
export class SpecialtyDto {
  @ApiProperty({ example: 'dermatology' }) code!: string;
  @ApiProperty() en!: string;
  @ApiProperty() ar!: string;
}
export class EmergencyDto {
  @ApiProperty({ example: '123' }) number!: string;
  @ApiProperty() service!: string;
  @ApiProperty() messageEn!: string;
  @ApiProperty() messageAr!: string;
  @ApiProperty() bookingBlocked!: boolean;
  @ApiProperty({ type: [String] }) categories!: string[];
}

export class CancellationPolicyDto {
  @ApiPropertyOptional({ description: 'Hours before the visit a patient may still cancel' }) patientCancelMinHours?: number;
  @ApiPropertyOptional() patientRescheduleMinHours?: number;
  @ApiPropertyOptional({ description: 'Deposit is refunded when cancelled at least this many hours ahead' }) depositRefundMinHours?: number;
  @ApiPropertyOptional() maxPatientReschedules?: number;
}
