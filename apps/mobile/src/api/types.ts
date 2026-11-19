// View-models used by the UI. Wire shapes come from the REAL Kiorex API (apps/api controllers); the OpenAPI spec only
// types paths (response/request bodies are not decorated yet), so bodies are modelled here and mapped in ./adapters.
export interface Specialty { code: string; nameAr: string; nameEn: string }
/** slotId === startsAt: Kiorex identifies a slot by provider + visit type + start time. */
export interface Slot { slotId: string; startsAt: string; endsAt: string; visitTypeId: string }
export interface VisitType { id: string; nameAr: string; nameEn: string; feeEgp: number }
export interface DoctorSummary {
  id: string; nameAr: string; nameEn: string; specialtyCode: string; photoUrl: string | null; verified: boolean;
  ratingAvg: number | null; ratingCount: number; feeFromEgp: number; depositRequired: boolean;
  clinicNameAr: string; clinicNameEn: string; areaAr: string; areaEn: string; distanceKm: number | null;
  languages: string[]; gender: "F" | "M"; nextSlots: Slot[]; defaultTypeId: string | null; bookable: boolean; clinicPhone: string | null;
}
export interface Clinic {
  id: string; nameAr: string; nameEn: string; addressAr: string; addressEn: string; phone: string; lat: number | null; lng: number | null;
}
export interface CancellationPolicy { freeCancelHoursBefore: number | null; depositRefundable: boolean | null; textAr: string; textEn: string }
export interface DoctorProfile { summary: DoctorSummary; visitTypes: VisitType[]; clinic: Clinic; cancellationPolicy: CancellationPolicy; bookable: boolean; titleAr: string | null; titleEn: string | null }
export interface Review { id: string; rating: number; text: string | null; createdAt: string; clinicReply: string | null }
export interface ReviewList { average: number | null; count: number; items: Review[] }
export interface SearchResponse { items: DoctorSummary[]; total: number; page: number; pageSize: number; emergency: boolean }

export interface Patient { id: string; nameEn: string | null; nameAr: string | null; phone: string | null; preferredLocale: "ar" | "en"; email: string | null }
export interface FamilyMember { id: string; name: string; relationship: string; dob: string | null; gender: string | null }
export type ConsentPurpose = "MARKETPLACE_PROCESSING" | "REMINDERS" | "RECORD_SHARING" | "AI_PROCESSING";
export interface Consent { purpose: ConsentPurpose; granted: boolean; updatedAt: string | null }
export interface Session { id: string; device: string | null; lastSeenAt: string; current: boolean }

export type BookingStatus = "INTENT" | "HELD" | "PENDING_CLINIC" | "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "EXPIRED";
export type DepositStatus = "NONE" | "REQUIRED" | "PAID" | "REFUNDED" | "FORFEITED" | string;
export interface BookingEvent { status: BookingStatus; at: string }
export interface Booking {
  id: string; status: BookingStatus; providerId: string; clinicId: string; typeId: string; startsAt: string; endsAt: string; dependantId: string | null;
  holdExpiresAt: string | null; confirmationDueAt: string | null; cancelledBy: string | null; cancellationReason: string | null; failureCode: string | null;
  depositStatus: DepositStatus; depositAmountMinor: number; currency: string; depositRefundable: boolean | null;
  deposit: { paymentId: string; status: string; checkoutUrl: string | null } | null;
  doctor: { nameEn: string | null; nameAr: string | null; specialty: string | null } | null;
  clinic: { nameEn?: string; nameAr?: string; addressEn?: string; addressAr?: string; phone?: string | null; latitude?: number | null; longitude?: number | null } | null;
  cancellationPolicy: unknown; timeline: BookingEvent[]; createdAt: string;
}

export interface SearchParams {
  q?: string; specialty?: string; area?: string; gender?: "F" | "M" | ""; language?: string;
  sort?: "earliest" | "distance" | "rating" | "fee"; maxFee?: number; minRating?: number;
  acceptsDeposit?: boolean; availableWithinDays?: number; page?: number;
}
export interface FlagsEffective { market: string; version?: number; flags: Record<string, { enabled: boolean; reason?: string; scope?: string }> }
export interface ExportResult { id?: string; generatedAt?: string }
