// Adapters from the REAL Kiorex API wire shapes (catalog / booking / patient / trust controllers) to UI view-models.
// Money on the wire is minor units (piastres); the UI works in whole EGP.
import type { DoctorProfile, DoctorSummary, Review, ReviewList, S, SearchResponse, Slot, Specialty, VisitType, CancellationPolicy } from "./types";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- free-form policy/clinic objects (spec: additionalProperties)
const egp = (minor: number | null | undefined) => Math.round((minor ?? 0) / 100);

export const mapSlot = (s: S["SlotDto"], typeId: string): Slot => ({ slotId: s.startsAt, startsAt: s.startsAt, endsAt: s.endsAt, visitTypeId: typeId });
export const mapSpecialty = (s: S["SpecialtyDto"]): Specialty => ({ code: s.code, nameAr: s.ar ?? s.code, nameEn: s.en ?? s.code });

export function mapSearchItem(i: Partial<S["SearchItemDto"]> & { id: string; photoUrl?: string | null }): DoctorSummary {
  const typeId = i.defaultTypeId ?? "";
  return {
    id: i.id, nameAr: i.nameAr ?? i.nameEn ?? "", nameEn: i.nameEn ?? i.nameAr ?? "", specialtyCode: i.specialty ?? "other", photoUrl: i.photoUrl ?? null,
    verified: !!i.verified, ratingAvg: i.rating?.average ?? null, ratingCount: i.rating?.count ?? 0, feeFromEgp: egp(i.minFeeMinor), depositRequired: !!i.acceptsDeposit,
    clinicNameAr: i.clinicNameAr ?? i.clinicNameEn ?? "", clinicNameEn: i.clinicNameEn ?? i.clinicNameAr ?? "", areaAr: i.area ?? "", areaEn: i.area ?? "",
    distanceKm: i.distanceKm ?? null, languages: i.languages ?? [], gender: String(i.gender ?? "").toUpperCase().startsWith("M") ? "M" : "F",
    nextSlots: (i.nextSlots ?? []).map((s) => mapSlot(s, typeId)), defaultTypeId: i.defaultTypeId ?? null, bookable: i.bookable !== false && !!i.defaultTypeId, clinicPhone: i.clinicPhone ?? null,
  };
}

export function mapSearch(r: S["SearchResultDto"]): SearchResponse {
  return { items: r.items.map(mapSearchItem), total: r.total, page: r.page, pageSize: r.pageSize, emergency: !!r.emergency };
}

/** The wire cancellationPolicy is Kiorly's free-form object: read the hours defensively, never invent a refund policy. */
export function mapPolicy(pol: object | null | undefined): CancellationPolicy {
  const p = (pol ?? {}) as Any;
  const hours = p.freeCancelHoursBefore ?? p.cancellationWindowHours ?? p.windowHours ?? p.hoursBefore ?? null;
  return {
    freeCancelHoursBefore: typeof hours === "number" ? hours : null,
    depositRefundable: typeof p.depositRefundable === "boolean" ? p.depositRefundable : null,
    textAr: p.textAr ?? p.ar ?? "", textEn: p.textEn ?? p.en ?? "",
  };
}

export function mapProfile(p: S["ProviderProfileDto"]): DoctorProfile {
  const clinic = (p.clinic ?? {}) as Any;
  const visitTypes: VisitType[] = p.fees.map((f) => ({ id: f.typeId, nameAr: f.nameAr ?? f.nameEn ?? "", nameEn: f.nameEn ?? f.nameAr ?? "", feeEgp: egp(f.amountMinor) }));
  const mins = p.fees.map((f) => f.amountMinor).filter((n) => typeof n === "number");
  const summary = mapSearchItem({
    id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, specialty: p.specialty, photoUrl: p.photoUrl, verified: p.verified, rating: p.rating, minFeeMinor: mins.length ? Math.min(...mins) : 0,
    acceptsDeposit: p.acceptsDeposit, clinicNameAr: clinic.nameAr, clinicNameEn: clinic.nameEn, area: clinic.area, languages: p.languages, gender: p.gender, nextSlots: [], defaultTypeId: visitTypes[0]?.id,
    bookable: p.bookable, clinicPhone: clinic.phone,
  });
  summary.bookable = !!p.bookable && visitTypes.length > 0;
  return {
    summary, visitTypes, bookable: summary.bookable, titleAr: p.titleAr ?? null, titleEn: p.titleEn ?? null,
    clinic: {
      id: clinic.id ?? "", nameAr: clinic.nameAr ?? clinic.nameEn ?? "", nameEn: clinic.nameEn ?? clinic.nameAr ?? "", addressAr: clinic.addressAr ?? clinic.addressEn ?? "", addressEn: clinic.addressEn ?? clinic.addressAr ?? "",
      phone: clinic.phone ?? "", lat: clinic.latitude ?? null, lng: clinic.longitude ?? null,
    },
    cancellationPolicy: mapPolicy(p.cancellationPolicy),
  };
}

export const mapReviews = (r: S["ProviderReviewsDto"]): ReviewList => ({
  average: r.average || null, count: r.count,
  items: r.reviews.map((x): Review => ({ id: x.id, rating: x.rating, text: x.text ?? null, createdAt: x.createdAt, clinicReply: x.clinicReply ?? null })),
});

