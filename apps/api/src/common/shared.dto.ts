import { ApiProperty } from '@nestjs/swagger';

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
