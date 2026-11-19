import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CancellationPolicyDto } from '../common/shared.dto';
import { EmergencyDto, SpecialtyDto } from '../common/shared.dto';
export { SpecialtyDto, EmergencyDto };

export class SlotDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}
export class RatingDto { @ApiProperty() average!: number; @ApiProperty() count!: number }
export class ClinicDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() nameEn?: string; @ApiPropertyOptional() nameAr?: string; @ApiPropertyOptional() addressEn?: string; @ApiPropertyOptional() addressAr?: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) latitude?: number | null; @ApiPropertyOptional({ nullable: true, type: Number }) longitude?: number | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiPropertyOptional({ type: [String] }) amenities?: string[];
}
export class SearchItemDto {
  id!: string;
  @ApiProperty({ nullable: true, type: String }) nameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) clinicNameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) clinicNameAr!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Launch specialty code' }) specialty!: string | null;
  @ApiProperty({ nullable: true, type: String }) governorate!: string | null;
  @ApiProperty({ nullable: true, type: String }) area!: string | null;
  @ApiProperty({ nullable: true, type: Number }) minFeeMinor!: number | null;
  @ApiProperty({ nullable: true, type: Number }) maxFeeMinor!: number | null;
  currency!: string;
  @ApiProperty({ type: RatingDto }) rating!: RatingDto;
  acceptsDeposit!: boolean;
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty({ nullable: true, type: String }) gender!: string | null;
  @ApiProperty({ nullable: true, type: Number }) distanceKm!: number | null;
  verified!: boolean;
  @ApiProperty({ description: 'false when kiorex.marketplace is OFF: show clinicPhone instead' }) bookable!: boolean;
  @ApiProperty({ nullable: true, type: String }) defaultTypeId!: string | null;
  @ApiProperty({ type: [SlotDto], nullable: true }) nextSlots!: SlotDto[] | null;
  slotsUnavailable!: boolean;
  sponsored!: boolean;
  @ApiProperty({ nullable: true, type: String, required: false }) clinicPhone?: string | null;
}
export class SearchResultDto {
  @ApiProperty({ type: [SearchItemDto] }) items!: SearchItemDto[];
  total!: number;
  page!: number;
  pageSize!: number;
  @ApiProperty({ required: false }) sort?: string;
  @ApiProperty({ type: [SpecialtyDto] }) specialties!: SpecialtyDto[];
  @ApiProperty({ type: EmergencyDto, required: false, description: 'Present for emergency language: show 123 guidance, never booking' }) emergency?: EmergencyDto;
  @ApiProperty({ type: [String], required: false, description: 'Only present (empty) when no market is live' }) marketsLive?: string[];
}
export class ProviderFeeDto {
  typeId!: string;
  nameEn!: string;
  nameAr!: string;
  amountMinor!: number;
  currency!: string;
}
export class ProviderProfileDto {
  id!: string;
  status!: string;
  bookable!: boolean;
  @ApiProperty({ nullable: true, type: String }) nameEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) nameAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) specialty!: string | null;
  @ApiProperty({ type: [String] }) subSpecialties!: string[];
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty({ nullable: true, type: String }) gender!: string | null;
  @ApiProperty({ nullable: true, type: String }) titleEn!: string | null;
  @ApiProperty({ nullable: true, type: String }) titleAr!: string | null;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  verified!: boolean;
  @ApiProperty({ type: [ProviderFeeDto] }) fees!: ProviderFeeDto[];
  @ApiProperty({ type: ClinicDto }) clinic!: ClinicDto;
  @ApiProperty({ type: RatingDto }) rating!: RatingDto;
  @ApiProperty({ type: CancellationPolicyDto, nullable: true }) cancellationPolicy!: CancellationPolicyDto | null;
  acceptsDeposit!: boolean;
  shareUrl!: string;
}
export class ProviderSlotsDto {
  providerId!: string;
  typeId!: string;
  @ApiProperty({ type: [SlotDto] }) slots!: SlotDto[];
}
export class SponsoredResultDto {
  @ApiProperty({ type: [SearchItemDto] }) items!: SearchItemDto[];
  sponsored!: boolean;
  label!: string;
}
export class ViewResultDto { @ApiProperty({ required: false }) ok?: boolean }
