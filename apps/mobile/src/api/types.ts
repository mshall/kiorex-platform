import type { components } from "./schema";
/** Generated wire types (npm run gen:api). Where the wire shape is already what the UI needs, the generated type is used directly. */
export type S = components["schemas"];
// View-models: only for catalog data where the UI wants whole-EGP money and flat AR/EN pairs (see ./adapters).
export interface Specialty { code: string; nameAr: string; nameEn: string }
/** slotId === startsAt: Kiorex identifies a slot by provider + visit type + start time. */
export interface Slot { slotId: string; startsAt: string; endsAt: string; visitTypeId: string; serviceLocation?: ServiceLocation; district?: string | null }
/** feeEgp is what the patient pays per visit (incl. the home surcharge for HOME types, KXMHV04). */
export interface VisitType { id: string; nameAr: string; nameEn: string; feeEgp: number; serviceLocation: ServiceLocation; surchargeEgp: number }
export type CareType = S["CareTypeDto"]["code"];
export type ServiceLocation = "IN_CLINIC" | "HOME";
export interface DoctorSummary {
  id: string; nameAr: string; nameEn: string; specialtyCode: string; photoUrl: string | null; verified: boolean;
  ratingAvg: number | null; ratingCount: number; feeFromEgp: number; depositRequired: boolean;
  clinicNameAr: string; clinicNameEn: string; areaAr: string; areaEn: string; distanceKm: number | null;
  languages: string[]; gender: "F" | "M"; nextSlots: Slot[]; defaultTypeId: string | null; bookable: boolean; clinicPhone: string | null;
  careType: CareType; serviceLocations: ServiceLocation[]; coverageDistricts: string[]; assignsClinician: boolean; homeEnabled: boolean; homeSurchargeEgp: number | null; homeFeeEgp: number | null;
  professionBadge: { en: string; ar: string } | null;
}
export interface Clinic {
  id: string; nameAr: string; nameEn: string; addressAr: string; addressEn: string; phone: string; lat: number | null; lng: number | null;
}
export interface CancellationPolicy { freeCancelHoursBefore: number | null; depositRefundable: boolean | null; textAr: string; textEn: string }
export interface DoctorProfile { summary: DoctorSummary; careType: CareType; categoryEnabled: boolean; homeEnabled: boolean; coverageDistricts: string[]; homeSurchargeEgp: number | null; assignsClinician: boolean; registerName: string | null; visitTypes: VisitType[]; clinic: Clinic; cancellationPolicy: CancellationPolicy; bookable: boolean; titleAr: string | null; titleEn: string | null }
export interface Review { id: string; rating: number; text: string | null; createdAt: string; clinicReply: string | null }
export interface ReviewList { average: number | null; count: number; items: Review[] }
export interface SearchResponse { items: DoctorSummary[]; total: number; page: number; pageSize: number; emergency: boolean; marketsLive?: string[] }

export type Patient = S["PatientProfileDto"];
export type FamilyMember = S["DependantDto"];
export type ConsentPurpose = S["ConsentStateDto"]["purpose"];
export type Consent = S["ConsentStateDto"];
export type Session = S["AuthSessionDto"];

export type BookingStatus = S["BookingDto"]["status"];
export type DepositStatus = S["BookingDto"]["depositStatus"];
export type Booking = S["BookingDto"];
export type BookingChannel = Booking["channel"];

export interface SearchParams {
  q?: string; specialty?: string; area?: string; gender?: "F" | "M" | ""; language?: string;
  sort?: "earliest" | "distance" | "rating" | "fee"; maxFee?: number; minRating?: number;
  acceptsDeposit?: boolean; availableWithinDays?: number; page?: number;
  careType?: CareType; serviceLocation?: ServiceLocation; district?: string;
}
export type Address = S["AddressDto"];
export type AddressInput = S["HomeAddressBody"];
export type CareTypeInfo = S["CareTypeDto"];
export type HomeDistrict = S["HomeDistrictDto"];
export type FamilyShare = S["FamilyShareDto"];
export type CarePlan = S["CarePlanDto"];
export type SafetyCard = S["SafetyCardDto"];
export type FlagsEffective = S["EffectiveFlagsDto"];
