import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddressDto {
  id!: string;
  @ApiProperty({ example: 'Home' }) label!: string;
  governorate!: string;
  @ApiProperty({ description: 'District code, e.g. nasr-city (GET /home/districts)' }) district!: string;
  @ApiProperty({ nullable: true, type: String }) street!: string | null;
  @ApiProperty({ nullable: true, type: String }) building!: string | null;
  @ApiProperty({ nullable: true, type: String }) floor!: string | null;
  @ApiProperty({ nullable: true, type: String }) flat!: string | null;
  @ApiProperty({ nullable: true, type: String }) landmark!: string | null;
  @ApiProperty({ nullable: true, type: Number }) lat!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lng!: number | null;
  hasPin!: boolean;
  @ApiProperty({ nullable: true, type: String, enum: ['USER', 'GEOCODED'] }) pinSource!: string | null;
  @ApiProperty({ description: 'Confirmed with the OTP-verified phone (needed once before the first home booking)' }) confirmed!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) confirmedAt!: string | null;
  isDefault!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ description: 'Masked one-line summary (label · district · governorate), safe to show anywhere' }) summary!: string;
}
