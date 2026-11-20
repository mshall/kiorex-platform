import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CancellationPolicyDto } from '../common/shared.dto';
import { EmergencyDto, SpecialtyDto } from '../common/shared.dto';
export { SpecialtyDto, EmergencyDto };

export class SlotDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty({ enum: ['IN_CLINIC', 'HOME'], required: false, description: 'Rev 2.3: where this slot takes place' }) serviceLocation?: string;
  @ApiProperty({ nullable: true, type: String, required: false, description: 'Rev 2.3: district code of a HOME slot' }) district?: string | null;
}
export class ProfessionBadgeDto { en!: string; ar!: string }
export class HomeVisitSearchDto {
  @ApiProperty({ description: 'Provider offers home visits AND kiorex.home_visits is effective' }) enabled!: boolean;
  @ApiProperty({ nullable: true, type: Number, description: 'Home surcharge (BR56, separate invoice line, outside S and C); null when not a home provider' }) homeSurchargeMinor!: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Visit fee incl. home surcharge (KXMHV04) when searching at HOME' }) visitFeeIncludingSurchargeMinor!: number | null;
}
export class HomeVisitProfileDto {
  enabled!: boolean;
  @ApiProperty({ type: [String], description: 'Coverage DISTRICT codes only (KXMDS05); never a home address' }) coverageDistricts!: string[];
  @ApiProperty({ nullable: true, type: Number }) homeSurchargeMinor!: number | null;
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
  @ApiProperty({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }) profession!: string | null;
  @ApiProperty({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }) careType!: string;
  @ApiProperty({ nullable: true, type: String, enum: ['CLINIC', 'NURSE'] }) edition!: string | null;
  @ApiProperty({ type: [String], enum: ['IN_CLINIC', 'HOME'] }) serviceLocations!: string[];
  @ApiProperty({ type: [String] }) coverageDistricts!: string[];
  @ApiProperty({ description: 'Agencies: the agency assigns a clinician after booking (HOME_VISIT_ASSIGNED)' }) assignsClinician!: boolean;
  @ApiProperty({ type: ProfessionBadgeDto, nullable: true }) professionBadge!: ProfessionBadgeDto | null;
  @ApiProperty({ type: HomeVisitSearchDto }) homeVisit!: HomeVisitSearchDto;
  @ApiProperty({ enum: ['IN_CLINIC', 'HOME'], description: 'Location the defaultTypeId / nextSlots belong to' }) defaultServiceLocation!: string;
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
  @ApiProperty({ enum: ['IN_CLINIC', 'HOME'] }) serviceLocation!: string;
  @ApiProperty({ description: 'Home surcharge included in totalMinor (BR56); 0 for in-clinic fees' }) homeSurchargeMinor!: number;
  @ApiProperty({ description: 'amountMinor + homeSurchargeMinor: the visit fee shown to the patient (KXMHV04)' }) totalMinor!: number;
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
  @ApiProperty({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }) profession!: string | null;
  @ApiProperty({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }) careType!: string;
  @ApiProperty({ nullable: true, type: String, enum: ['CLINIC', 'NURSE'] }) edition!: string | null;
  @ApiProperty({ type: ProfessionBadgeDto, nullable: true, description: 'Profession-naming badge (KXMPR01)' }) professionBadge!: ProfessionBadgeDto | null;
  @ApiProperty({ nullable: true, type: String, description: 'Register that verified the clinician, e.g. a syndicate register' }) verificationRegister!: string | null;
  @ApiProperty({ description: 'false when the care-type category flag is OFF/awaiting its gate: the profile stays readable, new bookings are 403' }) categoryEnabled!: boolean;
  @ApiProperty({ type: [String], enum: ['IN_CLINIC', 'HOME'] }) serviceLocations!: string[];
  @ApiProperty({ description: 'KXMPR02 agency profile: the agency assigns a clinician after booking' }) assignsClinician!: boolean;
  @ApiProperty({ type: HomeVisitProfileDto, description: '"Visits at home in" districts and the home surcharge (KXMPR01)' }) homeVisit!: HomeVisitProfileDto;
}
export class ProviderSlotsDto {
  providerId!: string;
  typeId!: string;
  @ApiProperty({ enum: ['IN_CLINIC', 'HOME'] }) serviceLocation!: string;
  @ApiProperty({ nullable: true, type: String, description: 'District code the HOME slots were searched for' }) district!: string | null;
  @ApiProperty({ type: [SlotDto] }) slots!: SlotDto[];
}
export class SponsoredResultDto {
  @ApiProperty({ type: [SearchItemDto] }) items!: SearchItemDto[];
  sponsored!: boolean;
  label!: string;
}
export class ViewResultDto { @ApiProperty({ required: false }) ok?: boolean }

export class CareTypeDto {
  @ApiProperty({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }) code!: string;
  labelEn!: string;
  labelAr!: string;
  @ApiProperty({ description: 'false while the category flag is OFF or awaiting its launch gate' }) enabled!: boolean;
  @ApiProperty({ nullable: true, type: String }) flag!: string | null;
  reason!: string;
  providerCount!: number;
}
export class HomeDistrictDto {
  district!: string;
  @ApiProperty({ nullable: true, type: String }) governorate!: string | null;
  homeEnabledProviders!: number;
}
