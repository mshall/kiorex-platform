import { ApiProperty } from '@nestjs/swagger';

export class TeleSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() providerId!: string;
  @ApiProperty({ enum: ['SCHEDULED', 'WAITING', 'IN_PROGRESS', 'ENDED', 'CANCELLED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) scheduledStartsAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) endedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) durationSec!: number | null;
  @ApiProperty({ description: 'Per-consult fee placeholder (NEEDS_HUMAN, 0 while unset)' }) consultFeeMinor!: number;
  @ApiProperty({ format: 'date-time', description: 'Join window opens (15 min before the visit)' }) joinOpensAt!: string;
}
export class VideoTokenDto {
  @ApiProperty() token!: string;
  @ApiProperty() room!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['patient', 'clinician'] }) role!: string;
  @ApiProperty({ description: 'mock | the real provider name' }) provider!: string;
}
export class TeleProviderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) nameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) specialty!: string | null;
  @ApiProperty({ nullable: true, type: String }) defaultTypeId!: string | null;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { startsAt: { type: 'string' }, endsAt: { type: 'string' } } }, nullable: true }) nextSlots!: { startsAt: string; endsAt: string }[] | null;
}
export class TeleProvidersResultDto { @ApiProperty({ type: [TeleProviderDto] }) items!: TeleProviderDto[] }
