// Adapters from the REAL Kiorex API wire shapes (catalog / booking / patient / trust controllers) to UI view-models.
// Money on the wire is minor units (piastres); the UI works in whole EGP.
import type { Booking, Consent, DoctorProfile, DoctorSummary, FamilyMember, Patient, Review, ReviewList, SearchResponse, Session, Slot, Specialty, VisitType, CancellationPolicy } from "./types";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const egp = (minor: number | null | undefined) => Math.round((minor ?? 0) / 100);

export const mapSlot = (s: Any, typeId: string): Slot => ({ slotId: s.startsAt, startsAt: s.startsAt, endsAt: s.endsAt, visitTypeId: typeId });
export const mapSpecialty = (s: Any): Specialty => ({ code: s.code, nameAr: s.ar ?? s.nameAr ?? s.code, nameEn: s.en ?? s.nameEn ?? s.code });

export function mapSearchItem(i: Any): DoctorSummary {
  const typeId = i.defaultTypeId ?? "";
  return {
    id: i.id, nameAr: i.nameAr ?? i.nameEn ?? "", nameEn: i.nameEn ?? i.nameAr ?? "", specialtyCode: i.specialty ?? "other", photoUrl: i.photoUrl ?? null,
    verified: !!i.verified, ratingAvg: i.rating?.average ?? null, ratingCount: i.rating?.count ?? 0, feeFromEgp: egp(i.minFeeMinor), depositRequired: !!i.acceptsDeposit,
    clinicNameAr: i.clinicNameAr ?? i.clinicNameEn ?? "", clinicNameEn: i.clinicNameEn ?? i.clinicNameAr ?? "", areaAr: i.area ?? "", areaEn: i.area ?? "",
    distanceKm: i.distanceKm ?? null, languages: i.languages ?? [], gender: String(i.gender ?? "").toUpperCase().startsWith("M") ? "M" : "F",
    nextSlots: ((i.nextSlots ?? []) as Any[]).map((s) => mapSlot(s, typeId)), defaultTypeId: i.defaultTypeId ?? null, bookable: i.bookable !== false && !!i.defaultTypeId, clinicPhone: i.clinicPhone ?? null,
  };
}

export function mapSearch(r: Any): SearchResponse {
  return { items: ((r.items ?? []) as Any[]).map(mapSearchItem), total: r.total ?? 0, page: r.page ?? 1, pageSize: r.pageSize ?? 10, emergency: !!r.emergency };
}

/** The wire cancellationPolicy is Kiorly's free-form object: read the hours defensively, never invent a refund policy. */
export function mapPolicy(pol: Any | null | undefined): CancellationPolicy {
  const p = pol ?? {};
  const hours = p.freeCancelHoursBefore ?? p.cancellationWindowHours ?? p.windowHours ?? p.hoursBefore ?? null;
  return {
    freeCancelHoursBefore: typeof hours === "number" ? hours : null,
    depositRefundable: typeof p.depositRefundable === "boolean" ? p.depositRefundable : null,
    textAr: p.textAr ?? p.ar ?? "", textEn: p.textEn ?? p.en ?? "",
  };
}

export function mapProfile(p: Any): DoctorProfile {
  const clinic: Any = p.clinic ?? {};
  const visitTypes: VisitType[] = ((p.fees ?? []) as Any[]).map((f) => ({ id: f.typeId, nameAr: f.nameAr ?? f.nameEn ?? "", nameEn: f.nameEn ?? f.nameAr ?? "", feeEgp: egp(f.amountMinor) }));
  const mins = ((p.fees ?? []) as Any[]).map((f) => f.amountMinor).filter((n) => typeof n === "number");
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

export const mapReviews = (r: Any): ReviewList => ({
  average: r.average || null, count: r.count ?? 0,
  items: ((r.reviews ?? []) as Any[]).map((x): Review => ({ id: x.id, rating: x.rating, text: x.text ?? null, createdAt: x.createdAt, clinicReply: x.clinicReply ?? null })),
});

export const mapPatient = (p: Any): Patient => ({ id: p.id, nameEn: p.nameEn ?? null, nameAr: p.nameAr ?? null, phone: p.phone ?? null, preferredLocale: p.preferredLocale === "en" ? "en" : "ar", email: p.email ?? null });
export const mapDependant = (d: Any): FamilyMember => ({ id: d.id, name: d.nameEn ?? d.nameAr ?? "", relationship: String(d.relationship ?? "OTHER").toLowerCase(), dob: d.dateOfBirth ?? null, gender: d.gender ?? null });
export const mapConsent = (c: Any): Consent => ({ purpose: c.purpose, granted: !!c.granted, updatedAt: c.updatedAt ?? null });
export const mapSession = (s: Any): Session => ({ id: s.id, device: s.device ?? null, lastSeenAt: s.lastSeenAt, current: !!s.current });

export function mapBooking(b: Any): Booking {
  return {
    id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, typeId: b.typeId, startsAt: b.startsAt, endsAt: b.endsAt, dependantId: b.dependantId ?? null,
    holdExpiresAt: b.holdExpiresAt ?? null, confirmationDueAt: b.confirmationDueAt ?? null, cancelledBy: b.cancelledBy ?? null, cancellationReason: b.cancellationReason ?? null, failureCode: b.failureCode ?? null,
    depositStatus: b.depositStatus ?? "NONE", depositAmountMinor: b.depositAmountMinor ?? 0, currency: b.currency ?? "EGP", depositRefundable: b.depositRefundable ?? null,
    deposit: b.deposit ?? null, doctor: b.doctor ?? null, clinic: b.clinic ?? null, cancellationPolicy: b.cancellationPolicy ?? null,
    timeline: ((b.timeline ?? []) as Any[]).filter((e) => e.status).map((e) => ({ status: e.status, at: e.at })), createdAt: b.createdAt,
  };
}
