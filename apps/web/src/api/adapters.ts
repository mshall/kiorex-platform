// Presentation mappers: GENERATED response types (./schema.d.ts, from the OpenAPI contract) -> UI view-models in ./types.
// Money on the wire is minor units (piastres); the UI works in whole EGP. Only the two fields the contract leaves as free-form
// `object` (clinic, cancellationPolicy) are read through `Loose`.
import type { components } from "./schema";
import type { ServiceLocation, DoctorProfile, DoctorSummary, Slot, Specialty, VisitType } from "./types";

type S = components["schemas"];
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const egp = (minor: number | null | undefined) => Math.round((minor ?? 0) / 100);

export const mapSlot = (s: S["SlotDto"], typeId: string): Slot => ({ slotId: s.startsAt, startsAt: s.startsAt, endsAt: s.endsAt, visitTypeId: typeId });

export const mapSpecialty = (s: S["SpecialtyDto"]): Specialty => ({ code: s.code, nameAr: s.ar ?? s.code, nameEn: s.en ?? s.code });

export function mapSearchItem(i: Pick<S["SearchItemDto"], "id"> & Partial<S["SearchItemDto"]> & { photoUrl?: string | null }): DoctorSummary {
  const typeId = i.defaultTypeId ?? "";
  return {
    id: i.id, nameAr: i.nameAr ?? i.nameEn ?? "", nameEn: i.nameEn ?? i.nameAr ?? "", specialtyCode: i.specialty ?? "other", photoUrl: i.photoUrl ?? null,
    verified: !!i.verified, ratingAvg: i.rating?.count ? i.rating.average : null, ratingCount: i.rating?.count ?? 0, feeFromEgp: egp(i.minFeeMinor), depositRequired: !!i.acceptsDeposit,
    clinicNameAr: i.clinicNameAr ?? i.clinicNameEn ?? "", clinicNameEn: i.clinicNameEn ?? i.clinicNameAr ?? "", areaAr: i.area ?? "", areaEn: i.area ?? "",
    distanceKm: i.distanceKm ?? null, latitude: i.latitude ?? null, longitude: i.longitude ?? null, languages: i.languages ?? [], gender: i.gender === "M" ? "M" : "F",
    careType: i.careType, serviceLocations: (i.serviceLocations as ServiceLocation[] | undefined) ?? ["IN_CLINIC"], coverageDistricts: i.coverageDistricts ?? [],
    homeFeeEgp: i.homeVisit?.enabled ? egp(i.homeVisit.visitFeeIncludingSurchargeMinor) : null, homeSurchargeEgp: egp(i.homeVisit?.homeSurchargeMinor), badge: i.professionBadge ?? null, assignsClinician: !!i.assignsClinician,
    nextSlots: (i.nextSlots ?? []).map((s) => mapSlot(s, typeId)), sponsored: !!i.sponsored, bookable: i.bookable ?? true, clinicPhone: i.clinicPhone ?? null,
  };
}

export function mapSearch(r: S["SearchResultDto"]) {
  return { items: r.items.map(mapSearchItem), total: r.total, page: r.page, pageSize: r.pageSize, emergency: !!r.emergency, noMarketLive: Array.isArray(r.marketsLive) && r.marketsLive.length === 0 };
}

export function mapProfile(p: S["ProviderProfileDto"]): DoctorProfile {
  const clinic: Loose = p.clinic ?? {};
  const visitTypes: VisitType[] = p.fees.map((f) => ({
    id: f.typeId, nameAr: f.nameAr ?? f.nameEn ?? "", nameEn: f.nameEn ?? f.nameAr ?? "", feeEgp: egp(f.totalMinor ?? f.amountMinor), serviceLocation: f.serviceLocation ?? "IN_CLINIC", surchargeEgp: egp(f.homeSurchargeMinor), durationMin: 20, depositRequired: !!p.acceptsDeposit, depositEgp: null,
  }));
  const pol: Loose = p.cancellationPolicy ?? {};
  const summary = mapSearchItem({
    id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, specialty: p.specialty, photoUrl: p.photoUrl, verified: p.verified, rating: p.rating, minFeeMinor: p.fees.length ? Math.min(...p.fees.map((f) => f.amountMinor)) : 0,
    acceptsDeposit: p.acceptsDeposit, clinicNameAr: clinic.nameAr, clinicNameEn: clinic.nameEn, area: clinic.area, languages: p.languages, gender: p.gender, nextSlots: [], defaultTypeId: visitTypes[0]?.id, bookable: p.bookable,
  });
  return {
    summary: { ...summary, badge: p.professionBadge ?? null, assignsClinician: !!p.assignsClinician, careType: p.careType },
    careType: p.careType, serviceLocations: p.serviceLocations?.length ? p.serviceLocations : ["IN_CLINIC"], categoryEnabled: p.categoryEnabled !== false,
    home: { enabled: !!p.homeVisit?.enabled, coverageDistricts: p.homeVisit?.coverageDistricts ?? [], surchargeEgp: egp(p.homeVisit?.homeSurchargeMinor) },
    bookable: !!p.bookable, bioAr: null, bioEn: null, subSpecialtiesAr: p.subSpecialties ?? [], subSpecialtiesEn: p.subSpecialties ?? [], visitTypes,
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
import type { Booking, BookingChannel, BookingStatus, Clinic, Consent, ConsentType, DepositStatus, FamilyMember, Patient, Review, ReviewList, Session } from "./types";

export const mapPatient = (p: S["PatientProfileDto"]): Patient => ({ id: p.id, nameAr: p.nameAr ?? null, nameEn: p.nameEn ?? null, phone: p.phone ?? "", email: p.email ?? null, dob: p.dateOfBirth ?? null, gender: p.gender ?? null, locale: p.preferredLocale === "en" ? "en" : "ar" });
export const mapDependant = (d: S["DependantDto"]): FamilyMember => ({ id: d.id, name: d.nameEn ?? d.nameAr ?? "", relationship: String(d.relationship ?? "OTHER").toLowerCase(), dob: d.dateOfBirth ?? null, gender: d.gender ?? null, guardianAccessExpired: !!d.guardianAccessExpired });
export const mapConsent = (c: S["ConsentStateDto"]): Consent => ({ type: c.purpose.toLowerCase() as ConsentType, granted: c.granted, updatedAt: c.updatedAt });
export const mapSession = (s: S["AuthSessionDto"]): Session => ({ id: s.id, device: s.device ?? "—", lastSeenAt: s.lastSeenAt, current: s.current });

// ───────────── reviews ─────────────
export const mapReviews = (r: S["ProviderReviewsDto"]): ReviewList => ({
  ratingAvg: r.count ? r.average : null, ratingCount: r.count,
  items: r.reviews.map((x): Review => ({ id: x.id, rating: x.rating, text: x.text, createdAt: x.createdAt, clinicReply: x.clinicReply ? { text: x.clinicReply, createdAt: null } : null })),
});

// ───────────── bookings ─────────────
const ACTIVE: BookingStatus[] = ["PENDING_CLINIC", "CONFIRMED"];
export function mapBooking(b: S["BookingDto"]): Booking {
  const c: Partial<S["BookingClinicDto"]> = b.clinic ?? {};
  const clinic: Clinic = { id: b.clinicId ?? "", nameAr: c.nameAr ?? c.nameEn ?? "", nameEn: c.nameEn ?? c.nameAr ?? "", addressAr: c.addressAr ?? c.addressEn ?? "", addressEn: c.addressEn ?? c.addressAr ?? "", phone: c.phone ?? "", lat: c.latitude ?? null, lng: c.longitude ?? null, paymentMethods: [], hoursAr: [], hoursEn: [] };
  const status: BookingStatus = b.status;
  const dep: DepositStatus = b.depositStatus;
  return {
    id: b.id, status, channel: b.channel as BookingChannel,
    doctor: { id: b.providerId, nameAr: b.doctor?.nameAr ?? b.doctor?.nameEn ?? "", nameEn: b.doctor?.nameEn ?? b.doctor?.nameAr ?? "", specialtyCode: b.doctor?.specialty ?? "other", verified: true },
    clinic, patient: { id: b.dependantId ?? "self", name: "" },
    visitType: { id: b.typeId, nameAr: "", nameEn: "", feeEgp: 0, durationMin: 20, depositRequired: dep !== "NONE", depositEgp: egp(b.depositAmountMinor) },
    startsAt: iso2(b.startsAt), endsAt: iso2(b.endsAt), holdExpiresAt: b.holdExpiresAt ? iso2(b.holdExpiresAt) : null, pendingDueAt: b.confirmationDueAt ? iso2(b.confirmationDueAt) : null, failureCode: b.failureCode ?? null,
    deposit: { requiredEgp: egp(b.depositAmountMinor), paidEgp: dep === "PAID" || dep === "RELEASED" ? egp(b.depositAmountMinor) : 0, status: dep, payUrl: b.deposit?.checkoutUrl ?? null },
    cancellation: { reason: b.cancellationReason ?? null, byClinic: b.cancelledBy === "CLINIC", canCancel: ACTIVE.includes(status), canReschedule: ACTIVE.includes(status), windowClosesAt: null },
    timeline: (b.timeline ?? []).map((e) => ({ status: e.status as BookingStatus, at: iso2(e.at), note: null })),
    reviewable: status === "COMPLETED", reviewed: false,
    serviceLocation: b.serviceLocation ?? "IN_CLINIC", careType: b.careType ?? null, visitDistrict: b.visitDistrict ?? null, home: b.home ?? null, telehealth: b.telehealth ?? null,
  };
}
const iso2 = (v: unknown) => new Date(v as string).toISOString();
