"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeDistrictDto = exports.CareTypeDto = exports.ViewResultDto = exports.SponsoredResultDto = exports.ProviderSlotsDto = exports.ProviderProfileDto = exports.ProviderFeeDto = exports.SearchResultDto = exports.SearchItemDto = exports.ClinicDto = exports.RatingDto = exports.HomeVisitProfileDto = exports.HomeVisitSearchDto = exports.ProfessionBadgeDto = exports.SlotDto = exports.EmergencyDto = exports.SpecialtyDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const shared_dto_1 = require("../common/shared.dto");
const shared_dto_2 = require("../common/shared.dto");
Object.defineProperty(exports, "EmergencyDto", { enumerable: true, get: function () { return shared_dto_2.EmergencyDto; } });
Object.defineProperty(exports, "SpecialtyDto", { enumerable: true, get: function () { return shared_dto_2.SpecialtyDto; } });
class SlotDto {
    startsAt;
    endsAt;
    serviceLocation;
    district;
}
exports.SlotDto = SlotDto;
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], SlotDto.prototype, "startsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], SlotDto.prototype, "endsAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IN_CLINIC', 'HOME'], required: false, description: 'Rev 2.3: where this slot takes place' }),
    __metadata("design:type", String)
], SlotDto.prototype, "serviceLocation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, required: false, description: 'Rev 2.3: district code of a HOME slot' }),
    __metadata("design:type", Object)
], SlotDto.prototype, "district", void 0);
class ProfessionBadgeDto {
    en;
    ar;
}
exports.ProfessionBadgeDto = ProfessionBadgeDto;
class HomeVisitSearchDto {
    enabled;
    homeSurchargeMinor;
    visitFeeIncludingSurchargeMinor;
}
exports.HomeVisitSearchDto = HomeVisitSearchDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Provider offers home visits AND kiorex.home_visits is effective' }),
    __metadata("design:type", Boolean)
], HomeVisitSearchDto.prototype, "enabled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Home surcharge (BR56, separate invoice line, outside S and C); null when not a home provider' }),
    __metadata("design:type", Object)
], HomeVisitSearchDto.prototype, "homeSurchargeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Visit fee incl. home surcharge (KXMHV04) when searching at HOME' }),
    __metadata("design:type", Object)
], HomeVisitSearchDto.prototype, "visitFeeIncludingSurchargeMinor", void 0);
class HomeVisitProfileDto {
    enabled;
    coverageDistricts;
    homeSurchargeMinor;
}
exports.HomeVisitProfileDto = HomeVisitProfileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], description: 'Coverage DISTRICT codes only (KXMDS05); never a home address' }),
    __metadata("design:type", Array)
], HomeVisitProfileDto.prototype, "coverageDistricts", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], HomeVisitProfileDto.prototype, "homeSurchargeMinor", void 0);
class RatingDto {
    average;
    count;
}
exports.RatingDto = RatingDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], RatingDto.prototype, "average", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], RatingDto.prototype, "count", void 0);
class ClinicDto {
    id;
    nameEn;
    nameAr;
    addressEn;
    addressAr;
    latitude;
    longitude;
    phone;
    amenities;
}
exports.ClinicDto = ClinicDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ClinicDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ClinicDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ClinicDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ClinicDto.prototype, "addressEn", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], ClinicDto.prototype, "addressAr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], ClinicDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], ClinicDto.prototype, "longitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ClinicDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String] }),
    __metadata("design:type", Array)
], ClinicDto.prototype, "amenities", void 0);
class SearchItemDto {
    id;
    nameEn;
    nameAr;
    clinicNameEn;
    clinicNameAr;
    specialty;
    governorate;
    area;
    minFeeMinor;
    maxFeeMinor;
    currency;
    rating;
    acceptsDeposit;
    languages;
    gender;
    distanceKm;
    latitude;
    longitude;
    verified;
    bookable;
    defaultTypeId;
    nextSlots;
    slotsUnavailable;
    sponsored;
    clinicPhone;
    profession;
    careType;
    edition;
    serviceLocations;
    coverageDistricts;
    assignsClinician;
    professionBadge;
    homeVisit;
    defaultServiceLocation;
}
exports.SearchItemDto = SearchItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "clinicNameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "clinicNameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Launch specialty code' }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "specialty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "governorate", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "area", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "minFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "maxFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: RatingDto }),
    __metadata("design:type", RatingDto)
], SearchItemDto.prototype, "rating", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], SearchItemDto.prototype, "languages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "distanceKm", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, required: false, description: 'Clinic latitude for the results map; omitted for home-only providers (never a personal address)' }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "latitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, required: false, description: 'Clinic longitude for the results map; omitted for home-only providers' }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "longitude", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'false when kiorex.marketplace is OFF: show clinicPhone instead' }),
    __metadata("design:type", Boolean)
], SearchItemDto.prototype, "bookable", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "defaultTypeId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SlotDto], nullable: true }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "nextSlots", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, required: false }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "clinicPhone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "profession", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }),
    __metadata("design:type", String)
], SearchItemDto.prototype, "careType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['CLINIC', 'NURSE'] }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "edition", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], enum: ['IN_CLINIC', 'HOME'] }),
    __metadata("design:type", Array)
], SearchItemDto.prototype, "serviceLocations", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], SearchItemDto.prototype, "coverageDistricts", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Agencies: the agency assigns a clinician after booking (HOME_VISIT_ASSIGNED)' }),
    __metadata("design:type", Boolean)
], SearchItemDto.prototype, "assignsClinician", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: ProfessionBadgeDto, nullable: true }),
    __metadata("design:type", Object)
], SearchItemDto.prototype, "professionBadge", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeVisitSearchDto }),
    __metadata("design:type", HomeVisitSearchDto)
], SearchItemDto.prototype, "homeVisit", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IN_CLINIC', 'HOME'], description: 'Location the defaultTypeId / nextSlots belong to' }),
    __metadata("design:type", String)
], SearchItemDto.prototype, "defaultServiceLocation", void 0);
class SearchResultDto {
    items;
    total;
    page;
    pageSize;
    sort;
    specialties;
    emergency;
    marketsLive;
}
exports.SearchResultDto = SearchResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SearchItemDto] }),
    __metadata("design:type", Array)
], SearchResultDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", String)
], SearchResultDto.prototype, "sort", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [shared_dto_2.SpecialtyDto] }),
    __metadata("design:type", Array)
], SearchResultDto.prototype, "specialties", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: shared_dto_2.EmergencyDto, required: false, description: 'Present for emergency language: show 123 guidance, never booking' }),
    __metadata("design:type", shared_dto_2.EmergencyDto)
], SearchResultDto.prototype, "emergency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], required: false, description: 'Only present (empty) when no market is live' }),
    __metadata("design:type", Array)
], SearchResultDto.prototype, "marketsLive", void 0);
class ProviderFeeDto {
    typeId;
    nameEn;
    nameAr;
    amountMinor;
    currency;
    serviceLocation;
    homeSurchargeMinor;
    totalMinor;
}
exports.ProviderFeeDto = ProviderFeeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IN_CLINIC', 'HOME'] }),
    __metadata("design:type", String)
], ProviderFeeDto.prototype, "serviceLocation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Home surcharge included in totalMinor (BR56); 0 for in-clinic fees' }),
    __metadata("design:type", Number)
], ProviderFeeDto.prototype, "homeSurchargeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'amountMinor + homeSurchargeMinor: the visit fee shown to the patient (KXMHV04)' }),
    __metadata("design:type", Number)
], ProviderFeeDto.prototype, "totalMinor", void 0);
class ProviderProfileDto {
    id;
    status;
    bookable;
    nameEn;
    nameAr;
    specialty;
    subSpecialties;
    languages;
    gender;
    titleEn;
    titleAr;
    photoUrl;
    verified;
    fees;
    clinic;
    rating;
    cancellationPolicy;
    acceptsDeposit;
    shareUrl;
    profession;
    careType;
    edition;
    professionBadge;
    verificationRegister;
    categoryEnabled;
    serviceLocations;
    assignsClinician;
    homeVisit;
}
exports.ProviderProfileDto = ProviderProfileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "nameEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "specialty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], ProviderProfileDto.prototype, "subSpecialties", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], ProviderProfileDto.prototype, "languages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "titleEn", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "titleAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "photoUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ProviderFeeDto] }),
    __metadata("design:type", Array)
], ProviderProfileDto.prototype, "fees", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: ClinicDto }),
    __metadata("design:type", ClinicDto)
], ProviderProfileDto.prototype, "clinic", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: RatingDto }),
    __metadata("design:type", RatingDto)
], ProviderProfileDto.prototype, "rating", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: shared_dto_1.CancellationPolicyDto, nullable: true }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "cancellationPolicy", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "profession", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }),
    __metadata("design:type", String)
], ProviderProfileDto.prototype, "careType", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['CLINIC', 'NURSE'] }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "edition", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: ProfessionBadgeDto, nullable: true, description: 'Profession-naming badge (KXMPR01)' }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "professionBadge", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Register that verified the clinician, e.g. a syndicate register' }),
    __metadata("design:type", Object)
], ProviderProfileDto.prototype, "verificationRegister", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'false when the care-type category flag is OFF/awaiting its gate: the profile stays readable, new bookings are 403' }),
    __metadata("design:type", Boolean)
], ProviderProfileDto.prototype, "categoryEnabled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String], enum: ['IN_CLINIC', 'HOME'] }),
    __metadata("design:type", Array)
], ProviderProfileDto.prototype, "serviceLocations", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'KXMPR02 agency profile: the agency assigns a clinician after booking' }),
    __metadata("design:type", Boolean)
], ProviderProfileDto.prototype, "assignsClinician", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: HomeVisitProfileDto, description: '"Visits at home in" districts and the home surcharge (KXMPR01)' }),
    __metadata("design:type", HomeVisitProfileDto)
], ProviderProfileDto.prototype, "homeVisit", void 0);
class ProviderSlotsDto {
    providerId;
    typeId;
    serviceLocation;
    district;
    slots;
}
exports.ProviderSlotsDto = ProviderSlotsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IN_CLINIC', 'HOME'] }),
    __metadata("design:type", String)
], ProviderSlotsDto.prototype, "serviceLocation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'District code the HOME slots were searched for' }),
    __metadata("design:type", Object)
], ProviderSlotsDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SlotDto] }),
    __metadata("design:type", Array)
], ProviderSlotsDto.prototype, "slots", void 0);
class SponsoredResultDto {
    items;
    sponsored;
    label;
}
exports.SponsoredResultDto = SponsoredResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [SearchItemDto] }),
    __metadata("design:type", Array)
], SponsoredResultDto.prototype, "items", void 0);
class ViewResultDto {
    ok;
}
exports.ViewResultDto = ViewResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    __metadata("design:type", Boolean)
], ViewResultDto.prototype, "ok", void 0);
class CareTypeDto {
    code;
    labelEn;
    labelAr;
    enabled;
    flag;
    reason;
    providerCount;
}
exports.CareTypeDto = CareTypeDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] }),
    __metadata("design:type", String)
], CareTypeDto.prototype, "code", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'false while the category flag is OFF or awaiting its launch gate' }),
    __metadata("design:type", Boolean)
], CareTypeDto.prototype, "enabled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CareTypeDto.prototype, "flag", void 0);
class HomeDistrictDto {
    district;
    governorate;
    homeEnabledProviders;
}
exports.HomeDistrictDto = HomeDistrictDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], HomeDistrictDto.prototype, "governorate", void 0);
//# sourceMappingURL=catalog.dto.js.map