// Adapters from the REAL Kiorex API catalog shapes (apps/api/src/catalog) to the UI view-models in ./types.
// Money on the wire is minor units (piastres); the UI works in whole EGP.
import type { DoctorProfile, DoctorSummary, Slot, Specialty, VisitType } from "./types";

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
    distanceKm: i.distanceKm ?? null, languages: i.languages ?? [], gender: i.gender === "M" ? "M" : "F",
    nextSlots: ((i.nextSlots ?? []) as Any[]).map((s) => mapSlot(s, typeId)),
  };
}

export function mapSearch(r: Any) {
  return { items: ((r.items ?? []) as Any[]).map(mapSearchItem), total: r.total ?? 0, page: r.page ?? 1, pageSize: r.pageSize ?? 20, emergency: !!r.emergency };
}

export function mapProfile(p: Any): DoctorProfile {
  const clinic: Any = p.clinic ?? {};
  const visitTypes: VisitType[] = ((p.fees ?? []) as Any[]).map((f) => ({
    id: f.typeId, nameAr: f.nameAr ?? f.nameEn ?? "", nameEn: f.nameEn ?? f.nameAr ?? "", feeEgp: egp(f.amountMinor), durationMin: 20, depositRequired: !!p.acceptsDeposit, depositEgp: null,
  }));
  const pol: Any = p.cancellationPolicy ?? {};
  const summary = mapSearchItem({
    id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, specialty: p.specialty, photoUrl: p.photoUrl, verified: p.verified, rating: p.rating, minFeeMinor: Math.min(...((p.fees ?? []) as Any[]).map((f) => f.amountMinor), Infinity) === Infinity ? 0 : Math.min(...((p.fees ?? []) as Any[]).map((f) => f.amountMinor)),
    acceptsDeposit: p.acceptsDeposit, clinicNameAr: clinic.nameAr, clinicNameEn: clinic.nameEn, area: clinic.area, languages: p.languages, gender: p.gender, nextSlots: [], defaultTypeId: visitTypes[0]?.id,
  });
  return {
    summary, bookable: !!p.bookable, bioAr: null, bioEn: null, subSpecialtiesAr: p.subSpecialties ?? [], subSpecialtiesEn: p.subSpecialties ?? [], visitTypes,
    clinic: {
      id: clinic.id ?? "", nameAr: clinic.nameAr ?? clinic.nameEn ?? "", nameEn: clinic.nameEn ?? clinic.nameAr ?? "", addressAr: clinic.addressAr ?? clinic.addressEn ?? "", addressEn: clinic.addressEn ?? clinic.addressAr ?? "",
      phone: clinic.phone ?? "", lat: clinic.latitude ?? null, lng: clinic.longitude ?? null, paymentMethods: clinic.paymentMethods ?? [], hoursAr: [], hoursEn: [],
    },
    cancellationPolicy: {
      freeCancelHoursBefore: pol.freeCancelHoursBefore ?? pol.windowHours ?? 0, depositRefundable: pol.depositRefundable ?? true,
      textAr: pol.textAr ?? pol.ar ?? "", textEn: pol.textEn ?? pol.en ?? "",
    },
  };
}

// ───────────── patient account ─────────────
import type { Booking, BookingStatus, Clinic, Consent, ConsentType, DepositStatus, FamilyMember, Patient, Review, ReviewList, Session } from "./types";

export const mapPatient = (p: Any): Patient => ({ id: p.id, nameAr: p.nameAr ?? null, nameEn: p.nameEn ?? null, phone: p.phone ?? "", dob: p.dateOfBirth ?? null, gender: p.gender ?? null, locale: p.preferredLocale === "en" ? "en" : "ar" });
export const mapDependant = (d: Any): FamilyMember => ({ id: d.id, name: d.nameEn ?? d.nameAr ?? "", relationship: String(d.relationship ?? "OTHER").toLowerCase(), dob: d.dateOfBirth ?? null, gender: d.gender ?? null, guardianAccessExpired: !!d.guardianAccessExpired });
export const mapConsent = (c: Any): Consent => ({ type: String(c.purpose).toLowerCase() as ConsentType, granted: !!c.granted, updatedAt: c.updatedAt ?? null });
export const mapSession = (s: Any): Session => ({ id: s.id, device: s.device ?? "—", lastSeenAt: s.lastSeenAt, current: !!s.current });

// ───────────── reviews ─────────────
export const mapReviews = (r: Any): ReviewList => ({
  ratingAvg: r.count ? r.average ?? null : null, ratingCount: r.count ?? 0,
  items: ((r.reviews ?? []) as Any[]).map((x): Review => ({ id: x.id, rating: x.rating, text: x.text ?? null, createdAt: x.createdAt, clinicReply: x.clinicReply ? (typeof x.clinicReply === "string" ? { text: x.clinicReply, createdAt: null } : { text: x.clinicReply.text ?? "", createdAt: x.clinicReply.createdAt ?? null }) : null })),
});

// ───────────── bookings ─────────────
const ACTIVE: BookingStatus[] = ["PENDING_CLINIC", "CONFIRMED"];
export function mapBooking(b: Any): Booking {
  const c: Any = b.clinic ?? {};
  const clinic: Clinic = { id: b.clinicId ?? "", nameAr: c.nameAr ?? c.nameEn ?? "", nameEn: c.nameEn ?? c.nameAr ?? "", addressAr: c.addressAr ?? c.addressEn ?? "", addressEn: c.addressEn ?? c.addressAr ?? "", phone: c.phone ?? "", lat: c.latitude ?? null, lng: c.longitude ?? null, paymentMethods: [], hoursAr: [], hoursEn: [] };
  const status = b.status as BookingStatus;
  const dep = (b.depositStatus ?? "NONE") as DepositStatus;
  return {
    id: b.id, status,
    doctor: { id: b.providerId, nameAr: b.doctor?.nameAr ?? b.doctor?.nameEn ?? "", nameEn: b.doctor?.nameEn ?? b.doctor?.nameAr ?? "", specialtyCode: b.doctor?.specialty ?? "other", verified: true },
    clinic, patient: { id: b.dependantId ?? "self", name: "" },
    visitType: { id: b.typeId, nameAr: "", nameEn: "", feeEgp: 0, durationMin: 20, depositRequired: dep !== "NONE", depositEgp: egp(b.depositAmountMinor) },
    startsAt: iso2(b.startsAt), endsAt: iso2(b.endsAt), holdExpiresAt: b.holdExpiresAt ? iso2(b.holdExpiresAt) : null, pendingDueAt: b.confirmationDueAt ? iso2(b.confirmationDueAt) : null, failureCode: b.failureCode ?? null,
    deposit: { requiredEgp: egp(b.depositAmountMinor), paidEgp: dep === "PAID" || dep === "RELEASED" ? egp(b.depositAmountMinor) : 0, status: dep, payUrl: b.deposit?.checkoutUrl ?? null },
    cancellation: { reason: b.cancellationReason ?? null, byClinic: b.cancelledBy === "CLINIC", canCancel: ACTIVE.includes(status), canReschedule: ACTIVE.includes(status), windowClosesAt: null },
    timeline: ((b.timeline ?? []) as Any[]).map((e) => ({ status: e.status as BookingStatus, at: iso2(e.at), note: null })),
    reviewable: status === "COMPLETED", reviewed: false,
  };
}
const iso2 = (v: unknown) => new Date(v as string).toISOString();
