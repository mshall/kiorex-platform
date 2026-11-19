// UI view-models. The real OpenAPI (apps/api/openapi) declares request bodies but no response schemas, so
// responses are mapped from the wire shapes in apps/api/src into these types by ./adapters.ts.
export interface Specialty { code: string; nameAr: string; nameEn: string }
export interface Slot { slotId: string; startsAt: string; endsAt: string; visitTypeId: string }
export interface VisitType { id: string; nameAr: string; nameEn: string; feeEgp: number; durationMin: number; depositRequired: boolean; depositEgp: number | null }
export interface DoctorSummary {
  id: string; nameAr: string; nameEn: string; specialtyCode: string; photoUrl: string | null; verified: boolean; ratingAvg: number | null; ratingCount: number; feeFromEgp: number; depositRequired: boolean;
  clinicNameAr: string; clinicNameEn: string; areaAr: string; areaEn: string; distanceKm: number | null; languages: string[]; gender: "F" | "M"; nextSlots: Slot[];
}
export interface Clinic { id: string; nameAr: string; nameEn: string; addressAr: string; addressEn: string; phone: string; lat: number | null; lng: number | null; paymentMethods: string[]; hoursAr: string[]; hoursEn: string[] }
export interface DoctorProfile {
  summary: DoctorSummary; bioAr: string | null; bioEn: string | null; subSpecialtiesAr: string[]; subSpecialtiesEn: string[]; visitTypes: VisitType[]; clinic: Clinic;
  bookable: boolean; cancellationPolicy: { freeCancelHoursBefore: number; depositRefundable: boolean; textAr: string; textEn: string };
}
export interface Review { id: string; rating: number; text: string | null; createdAt: string; clinicReply: { text: string; createdAt: string | null } | null }
export interface ReviewList { items: Review[]; ratingAvg: number | null; ratingCount: number }
export interface Patient { id: string; nameAr: string | null; nameEn: string | null; phone: string; dob: string | null; gender: string | null; locale: "ar" | "en" }
export interface FamilyMember { id: string; name: string; relationship: string; dob: string | null; gender: string | null; guardianAccessExpired: boolean }
export type ConsentType = "marketplace_processing" | "reminders" | "record_sharing" | "ai_processing";
export interface Consent { type: ConsentType; granted: boolean; updatedAt: string | null }
export interface Session { id: string; device: string; lastSeenAt: string; current: boolean }
export type BookingStatus = "INTENT" | "HELD" | "PENDING_CLINIC" | "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "EXPIRED";
export type DepositStatus = "NONE" | "REQUIRED" | "PAID" | "REFUNDED" | "FORFEITED" | "RELEASED";
export interface Booking {
  id: string; status: BookingStatus;
  doctor: { id: string; nameAr: string; nameEn: string; specialtyCode: string; verified: boolean };
  clinic: Clinic; patient: { id: string; name: string }; visitType: VisitType;
  startsAt: string; endsAt: string; holdExpiresAt: string | null; pendingDueAt: string | null; failureCode: string | null;
  deposit: { requiredEgp: number; paidEgp: number; status: DepositStatus; payUrl: string | null };
  cancellation: { reason: string | null; byClinic: boolean; canCancel: boolean; canReschedule: boolean; windowClosesAt: string | null };
  timeline: { status: BookingStatus; at: string; note: string | null }[]; reviewable: boolean; reviewed: boolean;
}
export interface SearchResponse { items: DoctorSummary[]; total: number; page: number; pageSize: number; emergency: boolean }

export interface SearchParams {
  q?: string; specialty?: string; area?: string; gender?: "F" | "M" | ""; language?: string;
  sort?: "earliest" | "distance" | "rating" | "fee"; maxFee?: number; minRating?: number;
  acceptsDeposit?: boolean; availableWithinDays?: number; page?: number;
}
