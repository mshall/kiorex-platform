import { ApiProperty } from '@nestjs/swagger';

export class WaitlistOfferDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty({ enum: ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ format: 'date-time', description: 'Accept before this time; afterwards the slot is offered onward' }) expiresAt!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Held booking created on accept; confirm it with POST /bookings/{id}/confirm' }) bookingId!: string | null;
}
export class WaitlistEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() providerId!: string;
  @ApiProperty() typeId!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) preferredFrom!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) preferredTo!: string | null;
  @ApiProperty({ enum: ['WAITING', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: [WaitlistOfferDto] }) offers!: WaitlistOfferDto[];
}
export class WaitlistScanResultDto {
  @ApiProperty() offersCreated!: number;
  @ApiProperty() offersExpired!: number;
}
