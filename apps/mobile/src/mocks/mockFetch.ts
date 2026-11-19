// Offline fixtures (EXPO_PUBLIC_MOCK=1): an in-memory stand-in for the Kiorex API, emitting the REAL wire shapes.
// Lets the app (and screenshots/CI) run with no API or IdP. Never imported unless mock mode is on.
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SPECIALTIES = [
  { code: "paediatrics", ar: "أطفال", en: "Paediatrics" }, { code: "dermatology", ar: "جلدية", en: "Dermatology" }, { code: "cardiology", ar: "قلب", en: "Cardiology" },
  { code: "obgyn", ar: "نساء وتوليد", en: "OB/GYN" }, { code: "dentistry", ar: "أسنان", en: "Dentistry" }, { code: "orthopaedics", ar: "عظام", en: "Orthopaedics" },
  { code: "ent", ar: "أنف وأذن وحنجرة", en: "ENT" }, { code: "internal_medicine", ar: "باطنة", en: "Internal medicine" },
];
const CLINICS: Record<string, Any> = {
  c1: { id: "c1", nameAr: "عيادات الندى", nameEn: "Al-Nada Clinics", addressAr: "مدينة نصر، القاهرة", addressEn: "Nasr City, Cairo", phone: "+20 2 5555 0100", latitude: 30.05, longitude: 31.34, area: "Nasr City" },
  c2: { id: "c2", nameAr: "مركز الواحة الطبي", nameEn: "Al-Waha Medical Centre", addressAr: "المهندسين، القاهرة", addressEn: "Mohandessin, Cairo", phone: "+20 2 5555 0101", latitude: 30.06, longitude: 31.2, area: "Mohandessin" },
  c3: { id: "c3", nameAr: "عيادة التجمع", nameEn: "Tagamoa Clinic", addressAr: "التجمع الخامس، القاهرة", addressEn: "Fifth Settlement, Cairo", phone: "+20 2 5555 0102", latitude: 30.0, longitude: 31.45, area: "Fifth Settlement" },
};
const DOCS = [
  { id: "d1", nameAr: "د. ليلى حسن", nameEn: "Dr. Laila Hassan", spec: "paediatrics", clinic: "c1", fee: 350, deposit: false, rating: 4.8, count: 126, gender: "FEMALE", km: 2.4, manual: false },
  { id: "d2", nameAr: "د. كريم منصور", nameEn: "Dr. Karim Mansour", spec: "cardiology", clinic: "c2", fee: 600, deposit: true, rating: 4.6, count: 88, gender: "MALE", km: 7.9, manual: true },
  { id: "d3", nameAr: "د. هالة فؤاد", nameEn: "Dr. Hala Fouad", spec: "dermatology", clinic: "c3", fee: 450, deposit: false, rating: 0, count: 0, gender: "FEMALE", km: 14.2, manual: false },
  { id: "d4", nameAr: "د. ياسر عبد الله", nameEn: "Dr. Yasser Abdallah", spec: "orthopaedics", clinic: "c1", fee: 500, deposit: true, rating: 4.4, count: 41, gender: "MALE", km: 2.4, manual: false },
  { id: "d5", nameAr: "د. منى سالم", nameEn: "Dr. Mona Salem", spec: "obgyn", clinic: "c3", fee: 400, deposit: false, rating: 4.9, count: 203, gender: "FEMALE", km: 14.2, manual: false },
  { id: "d6", nameAr: "د. طارق إبراهيم", nameEn: "Dr. Tarek Ibrahim", spec: "dentistry", clinic: "c2", fee: 300, deposit: false, rating: 4.2, count: 57, gender: "MALE", km: 7.9, manual: false },
];
const doc = (id: string) => DOCS.find((d) => d.id === id);

function slotsFor(id: string): { startsAt: string; endsAt: string }[] {
  const base = new Date(); base.setUTCHours(0, 0, 0, 0);
  const seed = id.charCodeAt(1);
  const out: { startsAt: string; endsAt: string }[] = [];
  for (let day = 1; day <= 8; day++) for (let i = 0; i < 12; i++) {
    if ((i + day + seed) % 3 === 0) continue;
    const s = new Date(base.getTime() + day * 86_400_000 + (7 * 60 + i * 20) * 60_000);
    out.push({ startsAt: s.toISOString(), endsAt: new Date(s.getTime() + 20 * 60_000).toISOString() });
  }
  return out;
}

const state = {
  bookings: new Map<string, Any>(),
  taken: new Set<string>(),
  deps: [{ id: "m1", nameEn: "Youssef", nameAr: "يوسف", relationship: "CHILD", dateOfBirth: "2018-04-02", gender: "MALE" }] as Any[],
  consents: { MARKETPLACE_PROCESSING: true, REMINDERS: true, RECORD_SHARING: false, AI_PROCESSING: false } as Record<string, boolean>,
  sessions: [{ id: "s1", device: "Kiorex app · demo", lastSeenAt: new Date().toISOString(), current: true }, { id: "s2", device: "Safari · iPhone", lastSeenAt: new Date(Date.now() - 86_400_000).toISOString(), current: false }] as Any[],
  flagsOff: new Set<string>(),
};
/** Test/demo hooks. */
export const mockControls = { setFlagOff: (k: string, off = true) => (off ? state.flagsOff.add(k) : state.flagsOff.delete(k)), markTaken: (iso: string) => state.taken.add(iso) };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, message: string, extra: Any = {}) => json(status, { code, message, ...extra });
const gate = (k: string) => (state.flagsOff.has(k) ? err(403, "FEATURE_DISABLED", "Feature disabled", { key: k, scope: "GLOBAL" }) : null);

const present = (b: Any) => {
  const d = doc(b.providerId)!; const c = CLINICS[d.clinic];
  return {
    ...b, holdExpiresAt: b.status === "HELD" ? b.holdExpiresAt : null, doctor: { nameEn: d.nameEn, nameAr: d.nameAr, specialty: d.spec },
    clinic: { nameEn: c.nameEn, nameAr: c.nameAr, addressEn: c.addressEn, addressAr: c.addressAr, phone: c.phone, latitude: c.latitude, longitude: c.longitude },
    cancellationPolicy: { freeCancelHoursBefore: 12, depositRefundable: true, textAr: "يمكنك الإلغاء مجانًا حتى ١٢ ساعة قبل الموعد، ويُرد العربون كاملًا.", textEn: "Cancel free up to 12 hours before the visit; any deposit is refunded in full." },
    deposit: b.depositStatus === "NONE" ? null : { paymentId: `pay_${b.id}`, status: b.depositStatus === "PAID" ? "CAPTURED" : "CREATED", checkoutUrl: b.depositStatus === "PAID" ? null : `https://example.com/mock-pay/${b.id}` },
  };
};
const push = (b: Any, status: string) => { b.status = status; b.timeline.push({ status, at: new Date().toISOString() }); };

async function route(method: string, path: string, url: URL, body: Any): Promise<Response> {
  let m: RegExpMatchArray | null;
  if (method === "GET" && path === "/flags/effective") return json(200, { market: "EG", flags: Object.fromEntries(["kiorex.marketplace", "kiorex.pay_deposits", "kiorex.reviews", "kiorex.family_accounts"].map((k) => [k, { enabled: !state.flagsOff.has(k), reason: "mock" }])) });
  if (method === "GET" && path === "/specialties") return json(200, SPECIALTIES);
  if (method === "GET" && path === "/search/providers") {
    const g = gate("kiorex.marketplace"); if (g) return g;
    const q = (url.searchParams.get("q") ?? "").toLowerCase(); const sp = url.searchParams.get("specialty");
    let list = DOCS.filter((d) => (!sp || d.spec === sp) && (!q || d.nameEn.toLowerCase().includes(q) || d.nameAr.includes(q) || d.spec.includes(q) || SPECIALTIES.find((s) => s.code === d.spec)?.ar.includes(q)));
    const maxFee = url.searchParams.get("maxFee"); if (maxFee) list = list.filter((d) => d.fee <= Number(maxFee));
    const gender = url.searchParams.get("gender"); if (gender) list = list.filter((d) => d.gender.startsWith(gender));
    const minRating = url.searchParams.get("minRating"); if (minRating) list = list.filter((d) => d.rating >= Number(minRating));
    if (url.searchParams.get("acceptsDeposit") === "true") list = list.filter((d) => d.deposit);
    const sort = url.searchParams.get("sort") ?? "earliest";
    list = [...list].sort((a, b) => sort === "fee" ? a.fee - b.fee : sort === "distance" ? a.km - b.km : b.rating - a.rating);
    return json(200, { items: list.map((d) => ({ id: d.id, nameEn: d.nameEn, nameAr: d.nameAr, clinicNameEn: CLINICS[d.clinic].nameEn, clinicNameAr: CLINICS[d.clinic].nameAr, specialty: d.spec, area: CLINICS[d.clinic].area, minFeeMinor: d.fee * 100, maxFeeMinor: d.fee * 100, currency: "EGP", rating: { average: d.count ? d.rating : null, count: d.count }, acceptsDeposit: d.deposit, languages: ["ar", "en"], gender: d.gender, distanceKm: d.km, verified: true, bookable: true, defaultTypeId: `${d.id}-first`, nextSlots: slotsFor(d.id).filter((s) => !state.taken.has(s.startsAt)).slice(0, 3), slotsUnavailable: false, sponsored: false })), total: list.length, page: 1, pageSize: 10, sort, specialties: [] });
  }
  if (method === "GET" && (m = path.match(/^\/providers\/([^/]+)$/))) {
    const d = doc(m[1]); if (!d) return err(404, "PROVIDER_NOT_FOUND", "Provider not found");
    const c = CLINICS[d.clinic];
    return json(200, { id: d.id, status: "LIVE", bookable: true, nameEn: d.nameEn, nameAr: d.nameAr, specialty: d.spec, subSpecialties: [], languages: ["ar", "en"], gender: d.gender, titleEn: "Consultant", titleAr: "استشاري", photoUrl: null, verified: true,
      fees: [{ typeId: `${d.id}-first`, nameEn: "Consultation", nameAr: "كشف", amountMinor: d.fee * 100, currency: "EGP" }, { typeId: `${d.id}-follow`, nameEn: "Follow-up", nameAr: "إعادة", amountMinor: Math.round(d.fee * 60), currency: "EGP" }],
      clinic: c, rating: { average: d.count ? d.rating : null, count: d.count }, acceptsDeposit: d.deposit,
      cancellationPolicy: { freeCancelHoursBefore: 12, depositRefundable: true, textAr: "يمكنك الإلغاء مجانًا حتى ١٢ ساعة قبل الموعد، ويُرد العربون كاملًا.", textEn: "Cancel free up to 12 hours before the visit; any deposit is refunded in full." } });
  }
  if (method === "GET" && (m = path.match(/^\/providers\/([^/]+)\/slots$/))) return json(200, { providerId: m[1], typeId: url.searchParams.get("typeId"), slots: slotsFor(m[1]).filter((s) => !state.taken.has(s.startsAt)) });
  if (method === "GET" && (m = path.match(/^\/providers\/([^/]+)\/reviews$/))) {
    const d = doc(m[1]); if (!d || !d.count) return json(200, { average: 0, count: 0, reviews: [] });
    return json(200, { average: d.rating, count: d.count, reviews: [{ id: `${d.id}r1`, rating: 5, text: "التزام بالموعد وشرح واضح.", clinicReply: "شكرًا لثقتكم.", createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString() }, { id: `${d.id}r2`, rating: 4, text: "Clear and on time.", clinicReply: null, createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }] });
  }
  if (method === "POST" && path.match(/^\/providers\/[^/]+\/view$/)) return json(200, { ok: true });
  if (method === "GET" && path === "/me/profile") return json(200, { id: "p1", sub: "mock", phone: "+201000000001", email: null, nameEn: "Amira", nameAr: "أميرة", dateOfBirth: null, gender: "FEMALE", preferredLocale: "ar" });
  if (method === "GET" && path === "/me/dependants") return json(200, state.deps);
  if (method === "POST" && path === "/me/dependants") { const g = gate("kiorex.family_accounts"); if (g) return g; const d = { id: `m${state.deps.length + 1}`, ...body }; state.deps.push(d); return json(201, d); }
  if (method === "DELETE" && (m = path.match(/^\/me\/dependants\/([^/]+)$/))) { state.deps = state.deps.filter((d) => d.id !== m![1]); return json(200, { ok: true }); }
  if (method === "GET" && path === "/me/consents") return json(200, Object.entries(state.consents).map(([purpose, granted]) => ({ purpose, granted, version: 1, updatedAt: new Date().toISOString() })));
  if (method === "PUT" && (m = path.match(/^\/me\/consents\/([^/]+)$/))) { state.consents[m[1]] = !!body.granted; return json(200, { purpose: m[1], granted: !!body.granted }); }
  if (method === "GET" && path === "/me/sessions") return json(200, state.sessions);
  if (method === "DELETE" && (m = path.match(/^\/me\/sessions\/([^/]+)$/))) { state.sessions = state.sessions.filter((s) => s.id !== m![1]); return json(200, { ok: true }); }
  if (method === "POST" && path === "/me/export") return json(200, { id: "exp1", generatedAt: new Date().toISOString() });
  if (method === "POST" && path === "/me/deletion") return json(200, { ok: !!body.confirm, deleted: !!body.confirm });
  if (method === "GET" && path === "/me/reviews") return json(200, []);

  if (method === "GET" && path === "/bookings") return json(200, [...state.bookings.values()].filter((b) => b.status !== "INTENT").sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map(present));
  if (method === "POST" && path === "/bookings") {
    const g = gate("kiorex.marketplace"); if (g) return g;
    const d = doc(body.providerId); if (!d) return err(404, "PROVIDER_NOT_FOUND", "Provider not found");
    if (state.taken.has(body.startsAt)) return err(409, "SLOT_TAKEN", "Slot taken", { alternatives: slotsFor(d.id).filter((s) => !state.taken.has(s.startsAt) && s.startsAt !== body.startsAt).slice(0, 3) });
    const id = `kx_bk_${Math.random().toString(36).slice(2, 10)}`;
    const b: Any = { id, status: "HELD", providerId: d.id, clinicId: d.clinic, typeId: body.typeId, startsAt: body.startsAt, endsAt: body.endsAt ?? new Date(new Date(body.startsAt).getTime() + 20 * 60_000).toISOString(), dependantId: body.dependantId ?? null, channel: "MARKETPLACE",
      holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), confirmationDueAt: null, cancelledBy: null, cancellationReason: null, failureCode: null, depositStatus: d.deposit ? "REQUIRED" : "NONE", depositAmountMinor: d.deposit ? 15000 : 0, currency: "EGP", depositRefundable: true, timeline: [{ status: "HELD", at: new Date().toISOString() }], createdAt: new Date().toISOString(), manual: d.manual };
    state.bookings.set(id, b); return json(201, present(b));
  }
  if ((m = path.match(/^\/bookings\/([^/]+)(?:\/(confirm|release|cancel|reschedule|deposit-checkout|review))?$/))) {
    const b = state.bookings.get(m[1]); if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
    const act = m[2];
    if (method === "GET" && !act) return json(200, present(b));
    if (method === "POST" && act === "confirm") {
      if (!body.marketplaceConsent) return err(400, "CONSENT_REQUIRED", "Marketplace processing consent is required to book");
      if (b.status !== "HELD") return json(200, present(b));
      if (new Date(b.holdExpiresAt) < new Date()) { push(b, "EXPIRED"); return err(422, "HOLD_EXPIRED", "Hold expired", { alternatives: slotsFor(b.providerId).slice(0, 3) }); }
      push(b, b.manual ? "PENDING_CLINIC" : "CONFIRMED"); if (b.manual) b.confirmationDueAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      return json(200, present(b));
    }
    if (method === "POST" && (act === "release" || act === "cancel")) { if (b.status === "HELD") push(b, "EXPIRED"); else { push(b, "CANCELLED"); b.cancelledBy = "PATIENT"; b.cancellationReason = body.reason ?? null; if (b.depositStatus === "PAID") b.depositStatus = "REFUNDED"; } return json(200, present(b)); }
    if (method === "POST" && act === "reschedule") { if (state.taken.has(body.startsAt)) return err(409, "SLOT_TAKEN", "Slot taken", { alternatives: slotsFor(b.providerId).slice(0, 3) }); b.startsAt = body.startsAt; b.endsAt = body.endsAt ?? b.endsAt; return json(200, present(b)); }
    if (method === "POST" && act === "deposit-checkout") { const g = gate("kiorex.pay_deposits"); if (g) return g; b.depositStatus = "PAID"; return json(200, { paymentId: `pay_${b.id}`, checkoutUrl: `https://example.com/mock-pay/${b.id}`, amountMinor: b.depositAmountMinor, currency: "EGP" }); }
    if (method === "POST" && act === "review") { const g = gate("kiorex.reviews"); if (g) return g; if (b.status !== "COMPLETED") return err(403, "NOT_A_COMPLETED_VISIT", "Only completed Kiorex visits can be reviewed"); b.reviewed = true; return json(201, { id: "rv1", rating: body.rating }); }
  }
  return err(404, "NOT_FOUND", `Mock has no route ${method} ${path}`);
}

export async function mockFetch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  let body: Any = {};
  if (req.method !== "GET" && req.method !== "DELETE") { try { body = await req.json(); } catch { body = {}; } }
  await new Promise((r) => setTimeout(r, 120));
  return route(req.method, path, url, body);
}
