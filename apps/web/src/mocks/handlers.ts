import { http, HttpResponse } from "msw";
import { clinics, profileFor, reviewsFor, seeds, slotsFor, specialties, summaryFor, visitTypesFor } from "./data";

// Mock API (VITE_MOCK=1 / unit tests). Every handler emits the REAL wire shapes of apps/api/src (see src/api/adapters.ts).
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => HttpResponse.json({ code, message, ...extra }, { status });

interface MockBooking {
  id: string; status: string; providerId: string; clinicId: string; typeId: string; startsAt: string; endsAt: string; dependantId: string | null; holdExpiresAt: string | null;
  confirmationDueAt: string | null; cancelledBy: string | null; cancellationReason: string | null; failureCode: string | null; depositStatus: string; depositAmountMinor: number; currency: string;
  timeline: { status: string; at: string }[]; reviewed: boolean;
}
type Dependant = { id: string; nameEn: string; nameAr: string | null; relationship: string; dateOfBirth: string; gender: string | null; guardianAccessExpired: boolean };

const state = {
  bookings: new Map<string, MockBooking>(),
  intents: new Map<string, string>(),
  family: [{ id: "m1", nameEn: "Youssef", nameAr: null, relationship: "CHILD", dateOfBirth: "2018-04-02", gender: "MALE", guardianAccessExpired: false }] as Dependant[],
  consents: [
    { purpose: "MARKETPLACE_PROCESSING", granted: true, version: "1", updatedAt: new Date().toISOString() },
    { purpose: "REMINDERS", granted: true, version: "1", updatedAt: new Date().toISOString() },
    { purpose: "RECORD_SHARING", granted: false, version: null, updatedAt: null },
    { purpose: "AI_PROCESSING", granted: false, version: null, updatedAt: null },
  ] as { purpose: string; granted: boolean; version: string | null; updatedAt: string | null }[],
  sessions: [
    { id: "s1", device: "Chrome · macOS", clientId: "kiorex-web", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), current: true },
    { id: "s2", device: "Kiorex app · iPhone", clientId: "kiorex-mobile", createdAt: new Date().toISOString(), lastSeenAt: new Date(Date.now() - 86_400_000).toISOString(), current: false },
  ],
  takenSlots: new Set<string>(),
};

export function resetMockState() {
  state.bookings.clear(); state.intents.clear(); state.takenSlots.clear(); seedCompleted();
}
/** Marks a slot as taken so the next hold returns 409 SLOT_TAKEN (used by tests). */
export const markSlotTaken = (doctorId: string, slotId: string) => state.takenSlots.add(`${doctorId}|${slotId}`);
const taken = (doctorId: string, slotId: string) => state.takenSlots.has(`${doctorId}|${slotId}`);

const flagsOff = (): string[] => {
  try { return (localStorage.getItem("kx-mock-flags-off") ?? "").split(",").filter(Boolean); } catch { return []; }
};
const guard = (key: string) => (flagsOff().includes(key) ? err(403, "FEATURE_DISABLED", "Feature disabled", { key, scope: "global" }) : null);

const seedById = (id: string) => seeds.find((s) => s.id === id);

export const handlers = [
  http.get("/api/v1/flags/effective", () => {
    const off = flagsOff();
    const keys = ["kiorex.marketplace", "kiorex.pay_deposits", "kiorex.reviews", "kiorex.family_accounts"];
    return HttpResponse.json({ flags: Object.fromEntries(keys.map((k) => [k, off.includes(k) ? { enabled: false, scope: "global" } : { enabled: true }])) });
  }),
  // Catalog handlers emit the REAL API wire shapes (minor-unit money, {en,ar} specialty labels, startsAt-keyed slots).
  http.get("/api/v1/specialties", () => HttpResponse.json(specialties.map((s) => ({ code: s.code, en: s.nameEn, ar: s.nameAr })))),

  http.get("/api/v1/search/providers", ({ request }) => {
    const g = guard("kiorex.marketplace"); if (g) return g;
    const u = new URL(request.url);
    const p = (k: string) => u.searchParams.get(k) ?? "";
    let list = seeds.map((s) => ({ s, d: summaryFor(s) }));
    const q = p("q").toLowerCase();
    if (p("specialty")) list = list.filter(({ d }) => d.specialtyCode === p("specialty"));
    if (q) list = list.filter(({ d }) => d.nameAr.includes(q) || d.nameEn.toLowerCase().includes(q) || d.clinicNameEn.toLowerCase().includes(q) || d.clinicNameAr.includes(q));
    if (p("gender")) list = list.filter(({ d }) => d.gender === p("gender"));
    if (p("maxFee")) list = list.filter(({ d }) => d.feeFromEgp <= Number(p("maxFee")));
    if (p("minRating")) list = list.filter(({ d }) => (d.ratingAvg ?? 0) >= Number(p("minRating")));
    if (p("acceptsDeposit") === "true") list = list.filter(({ d }) => d.depositRequired);
    if (p("area")) list = list.filter(({ d }) => d.areaEn === p("area") || d.areaAr === p("area"));
    const sort = p("sort") || "earliest";
    list.sort((a, b) =>
      sort === "fee" ? a.d.feeFromEgp - b.d.feeFromEgp
      : sort === "rating" ? (b.d.ratingAvg ?? 0) - (a.d.ratingAvg ?? 0)
      : sort === "distance" ? (a.d.distanceKm ?? 99) - (b.d.distanceKm ?? 99)
      : (a.d.nextSlots[0]?.startsAt ?? "z").localeCompare(b.d.nextSlots[0]?.startsAt ?? "z"));
    const items = list.map(({ s, d }) => ({
      id: d.id, nameEn: d.nameEn, nameAr: d.nameAr, clinicNameEn: d.clinicNameEn, clinicNameAr: d.clinicNameAr, specialty: d.specialtyCode, governorate: "Cairo", area: d.areaEn,
      minFeeMinor: d.feeFromEgp * 100, maxFeeMinor: s.fee * 100, currency: "EGP", rating: { average: d.ratingAvg, count: d.ratingCount }, acceptsDeposit: d.depositRequired,
      languages: d.languages, gender: d.gender, distanceKm: d.distanceKm, verified: true, bookable: true, defaultTypeId: `${d.id}-first`,
      nextSlots: d.nextSlots.map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt })), slotsUnavailable: false, sponsored: false,
    }));
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 20, sort, specialties: [] });
  }),

  http.get("/api/v1/providers/:id", ({ params }) => {
    const s = seedById(params.id as string);
    if (!s) return err(404, "NOT_FOUND", "Provider not found");
    const pr = profileFor(s);
    return HttpResponse.json({
      id: s.id, status: "LIVE", bookable: true, nameEn: s.nameEn, nameAr: s.nameAr, specialty: s.spec, subSpecialties: [], languages: ["ar", "en"], gender: s.gender,
      photoUrl: null, verified: true,
      fees: pr.visitTypes.map((v) => ({ typeId: v.id, nameEn: v.nameEn, nameAr: v.nameAr, amountMinor: v.feeEgp * 100, currency: "EGP" })),
      clinic: { id: pr.clinic.id, nameEn: pr.clinic.nameEn, nameAr: pr.clinic.nameAr, addressEn: pr.clinic.addressEn, addressAr: pr.clinic.addressAr, area: s.areaEn, phone: pr.clinic.phone, latitude: pr.clinic.lat, longitude: pr.clinic.lng },
      rating: { average: s.rating, count: s.count }, cancellationPolicy: { freeCancelHoursBefore: 12, depositRefundable: true, textAr: pr.cancellationPolicy.textAr, textEn: pr.cancellationPolicy.textEn },
      acceptsDeposit: s.deposit !== null, shareUrl: `/doctors/${s.id}`,
    });
  }),
  http.get("/api/v1/providers/:id/slots", ({ params, request }) => {
    const typeId = new URL(request.url).searchParams.get("typeId") ?? "";
    const slots = slotsFor(params.id as string, typeId).filter((s) => !taken(params.id as string, s.slotId)).map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt }));
    return HttpResponse.json({ providerId: params.id, typeId, slots });
  }),
  http.get("/api/v1/providers/:id/reviews", ({ params }) => {
    const sd = seedById(params.id as string);
    if (!sd) return err(404, "PROVIDER_NOT_FOUND", "Provider not found");
    return HttpResponse.json({ average: sd.rating ?? 0, count: sd.count, reviews: reviewsFor(sd).map((r) => ({ id: r.id, rating: r.rating, text: r.text, clinicReply: r.clinicReply?.text ?? null, createdAt: r.createdAt })) });
  }),

  // ── account (real: /me/profile, /me/dependants, /me/consents/:purpose, /me/sessions, /me/deletion) ──
  http.get("/api/v1/me/profile", () => HttpResponse.json({ id: "p1", sub: "mock-patient-1", phone: "+201000000001", email: null, nameEn: "Amira", nameAr: "أميرة", dateOfBirth: null, gender: "FEMALE", hasNationalId: false, nationalIdLast4: null, preferredLocale: "ar", market: "EG", noShowCount: 0, createdAt: new Date().toISOString() })),
  http.post("/api/v1/me/deletion", async ({ request }) => {
    const b = (await request.json()) as { confirm: boolean; includeExport?: boolean };
    if (!b.confirm) return HttpResponse.json({ ok: false, deleted: false, code: "CONFIRMATION_REQUIRED" });
    return HttpResponse.json({ ok: true, deleted: true, ...(b.includeExport ? { export: { profile: { nameEn: "Amira" }, bookings: [] } } : {}) });
  }),
  http.get("/api/v1/me/dependants", () => HttpResponse.json(state.family)),
  http.post("/api/v1/me/dependants", async ({ request }) => {
    const g = guard("kiorex.family_accounts"); if (g) return g;
    const b = (await request.json()) as { nameEn: string; dateOfBirth: string; relationship: string; gender?: string };
    const age = (Date.now() - new Date(b.dateOfBirth).getTime()) / (365.25 * 86_400_000);
    if (age >= 18) return err(400, "DEPENDANT_ADULT", "Dependants must be under 18; adults create their own account (KA06)");
    const m: Dependant = { id: `m${state.family.length + 1}`, nameEn: b.nameEn, nameAr: null, relationship: b.relationship, dateOfBirth: b.dateOfBirth, gender: b.gender ?? null, guardianAccessExpired: false };
    state.family.push(m);
    return HttpResponse.json(m, { status: 201 });
  }),
  http.delete("/api/v1/me/dependants/:id", ({ params }) => { state.family = state.family.filter((m) => m.id !== params.id); return HttpResponse.json({ ok: true }); }),
  http.get("/api/v1/me/consents", () => HttpResponse.json(state.consents)),
  http.put("/api/v1/me/consents/:purpose", async ({ params, request }) => {
    const b = (await request.json()) as { granted: boolean };
    const c = state.consents.find((x) => x.purpose === params.purpose);
    if (!c) return err(400, "UNKNOWN_CONSENT_PURPOSE", "Unknown consent purpose");
    c.granted = b.granted; c.updatedAt = new Date().toISOString(); c.version = "1";
    return HttpResponse.json({ purpose: c.purpose, granted: c.granted });
  }),
  http.get("/api/v1/me/sessions", () => HttpResponse.json(state.sessions)),
  http.delete("/api/v1/me/sessions/:id", ({ params }) => { state.sessions = state.sessions.filter((s) => s.id !== params.id); return HttpResponse.json({ ok: true }); }),

  // ── bookings (real: POST /bookings creates intent + 5-min hold) ──
  http.get("/api/v1/bookings", () => HttpResponse.json([...state.bookings.values()].filter((b) => b.status !== "INTENT" && b.status !== "EXPIRED").sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map(present))),
  http.post("/api/v1/bookings", async ({ request }) => {
    const g = guard("kiorex.marketplace"); if (g) return g;
    const b = (await request.json()) as { providerId: string; typeId: string; startsAt: string; endsAt?: string; dependantId?: string };
    const sd = seedById(b.providerId);
    if (!sd) return err(404, "PROVIDER_NOT_FOUND", "Provider not found");
    const all = slotsFor(sd.id, b.typeId);
    const slot = all.find((x) => x.startsAt === b.startsAt);
    const id = `kx_bk_${Math.random().toString(36).slice(2, 10)}`;
    if (!slot || taken(sd.id, slot.slotId)) {
      const alternatives = all.filter((x) => !taken(sd.id, x.slotId) && x.startsAt !== b.startsAt).slice(0, 3).map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt }));
      return err(409, "SLOT_TAKEN", "Slot taken", { bookingId: id, alternatives });
    }
    const vtype = visitTypesFor(sd).find((v) => v.id === b.typeId) ?? visitTypesFor(sd)[0];
    const now = new Date().toISOString();
    state.bookings.set(id, {
      id, status: "HELD", providerId: sd.id, clinicId: sd.clinic, typeId: vtype.id, startsAt: slot.startsAt, endsAt: slot.endsAt, dependantId: b.dependantId ?? null, holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      confirmationDueAt: null, cancelledBy: null, cancellationReason: null, failureCode: null, depositStatus: vtype.depositRequired ? "REQUIRED" : "NONE", depositAmountMinor: (vtype.depositEgp ?? 0) * 100, currency: "EGP",
      timeline: [{ status: "INTENT", at: now }, { status: "HELD", at: now }], reviewed: false,
    });
    return HttpResponse.json(present(state.bookings.get(id)!), { status: 201 });
  }),
  http.get("/api/v1/bookings/:id", ({ params }) => {
    const b = state.bookings.get(params.id as string);
    return b ? HttpResponse.json(present(b)) : err(404, "BOOKING_NOT_FOUND", "Booking not found");
  }),
  http.post("/api/v1/bookings/:id/confirm", async ({ params, request }) => {
    const b = state.bookings.get(params.id as string);
    if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    const body = (await request.json()) as { marketplaceConsent: boolean };
    if (!body.marketplaceConsent) return err(400, "CONSENT_REQUIRED", "Marketplace consent is required");
    if (["PENDING_CLINIC", "CONFIRMED"].includes(b.status)) return HttpResponse.json(present(b)); // idempotent replay
    if (b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() < Date.now()) { move(b, "EXPIRED"); return err(422, "HOLD_EXPIRED", "Hold expired", { bookingId: b.id, alternatives: [] }); }
    b.holdExpiresAt = null;
    if (seedById(b.providerId)?.manual) { b.confirmationDueAt = new Date(Date.now() + 2 * 3_600_000).toISOString(); move(b, "PENDING_CLINIC"); } else move(b, "CONFIRMED");
    return HttpResponse.json(present(b));
  }),
  http.post("/api/v1/bookings/:id/release", ({ params }) => { const b = state.bookings.get(params.id as string); if (b?.status === "HELD") move(b, "EXPIRED"); return HttpResponse.json(b ? present(b) : {}); }),
  http.post("/api/v1/bookings/:id/deposit-checkout", ({ params }) => {
    const b = state.bookings.get(params.id as string);
    if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (b.depositStatus !== "REQUIRED") return err(409, "NO_DEPOSIT_DUE", "No deposit is due for this booking");
    if (!["PENDING_CLINIC", "CONFIRMED"].includes(b.status)) return err(409, "BOOKING_NOT_PAYABLE", `Booking is ${b.status}`);
    const intentId = `pi_${Math.random().toString(36).slice(2, 10)}`;
    state.intents.set(intentId, b.id);
    return HttpResponse.json({ paymentId: intentId, checkoutUrl: `/mock-checkout?intent=${intentId}&return=${encodeURIComponent(`/appointments/${b.id}`)}`, amountMinor: b.depositAmountMinor, currency: "EGP" });
  }),
  http.post("/api/v1/mock/pay/:intentId", ({ params }) => {
    const b = state.bookings.get(state.intents.get(params.intentId as string) ?? "");
    if (!b) return err(404, "NOT_FOUND", "Intent not found");
    b.depositStatus = "PAID";
    return HttpResponse.json({ ok: true });
  }),
  http.post("/api/v1/bookings/:id/cancel", async ({ params, request }) => {
    const b = state.bookings.get(params.id as string);
    if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    if (b.startsAt < new Date(Date.now() + 12 * 3_600_000).toISOString() && b.status === "CONFIRMED" && b.failureCode === "WINDOW") return err(409, "CANCELLATION_WINDOW_CLOSED", "Free cancellation window closed");
    b.cancelledBy = "PATIENT"; b.cancellationReason = body.reason ?? null; move(b, "CANCELLED");
    if (b.depositStatus === "PAID") b.depositStatus = "REFUNDED";
    return HttpResponse.json(present(b));
  }),
  http.post("/api/v1/bookings/:id/reschedule", async ({ params, request }) => {
    const b = state.bookings.get(params.id as string);
    if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    const { startsAt } = (await request.json()) as { startsAt: string; endsAt?: string };
    const slot = slotsFor(b.providerId, b.typeId).find((s) => s.startsAt === startsAt);
    if (!slot) return err(409, "SLOT_TAKEN", "Slot taken", { alternatives: [] });
    b.startsAt = slot.startsAt; b.endsAt = slot.endsAt;
    return HttpResponse.json(present(b));
  }),
  http.post("/api/v1/bookings/:id/review", async ({ params, request }) => {
    const g = guard("kiorex.reviews"); if (g) return g;
    const b = state.bookings.get(params.id as string);
    if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (b.status !== "COMPLETED") return err(403, "NOT_A_COMPLETED_VISIT", "Only completed Kiorex visits can be reviewed");
    if (b.reviewed) return err(409, "REVIEW_EXISTS", "One review per completed appointment");
    const body = (await request.json()) as { rating: number; text?: string };
    b.reviewed = true;
    return HttpResponse.json({ id: `rv_${b.id}`, rating: body.rating, text: body.text ?? null, status: "VISIBLE" });
  }),
];

function move(b: MockBooking, status: string) { b.status = status; b.timeline.push({ status, at: new Date().toISOString() }); }

function present(b: MockBooking) {
  const sd = seedById(b.providerId)!;
  const c = clinics[sd.clinic];
  return {
    id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, typeId: b.typeId, startsAt: b.startsAt, endsAt: b.endsAt, dependantId: b.dependantId, channel: "MARKETPLACE",
    holdExpiresAt: b.status === "HELD" ? b.holdExpiresAt : null, confirmationDueAt: b.confirmationDueAt, cancelledBy: b.cancelledBy, cancellationReason: b.cancellationReason, failureCode: b.failureCode,
    callState: null, depositStatus: b.depositStatus, depositAmountMinor: b.depositAmountMinor, currency: b.currency, depositRefundable: true,
    deposit: b.depositStatus !== "NONE" ? { paymentId: "pi_x", status: b.depositStatus === "PAID" ? "CAPTURED" : "CREATED", checkoutUrl: null } : null,
    doctor: { nameEn: sd.nameEn, nameAr: sd.nameAr, specialty: sd.spec },
    clinic: { nameEn: c.nameEn, nameAr: c.nameAr, addressEn: c.addressEn, addressAr: c.addressAr, phone: c.phone, latitude: c.lat, longitude: c.lng },
    cancellationPolicy: null, timeline: b.timeline, createdAt: b.timeline[0].at,
  };
}

/** A completed visit so the review flow can be exercised in mock mode. */
function seedCompleted() {
  const sd = seeds[0]; const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
  state.bookings.set("kx_bk_done", { id: "kx_bk_done", status: "COMPLETED", providerId: sd.id, clinicId: sd.clinic, typeId: `${sd.id}-first`, startsAt: at, endsAt: at, dependantId: null, holdExpiresAt: null, confirmationDueAt: null, cancelledBy: null, cancellationReason: null, failureCode: null, depositStatus: "NONE", depositAmountMinor: 0, currency: "EGP", timeline: [{ status: "INTENT", at }, { status: "CONFIRMED", at }, { status: "COMPLETED", at }], reviewed: false });
}
seedCompleted();

/** Test helper: patch a booking (e.g. expire its hold). */
export function mutateBooking(id: string, patch: Partial<MockBooking>) { const b = state.bookings.get(id); if (b) Object.assign(b, patch); }
export const mockBookings = () => [...state.bookings.values()];
