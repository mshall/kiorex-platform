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
  devices: [] as Any[],
  bookings: new Map<string, Any>(),
  taken: new Set<string>(),
  deps: [{ id: "m1", nameEn: "Youssef", nameAr: "يوسف", relationship: "CHILD", dateOfBirth: "2018-04-02", gender: "MALE" }] as Any[],
  consents: { MARKETPLACE_PROCESSING: true, REMINDERS: true, RECORD_SHARING: false, AI_PROCESSING: false } as Record<string, boolean>,
  sessions: [{ id: "s1", device: "Kiorex app · demo", lastSeenAt: new Date().toISOString(), current: true }, { id: "s2", device: "Safari · iPhone", lastSeenAt: new Date(Date.now() - 86_400_000).toISOString(), current: false }] as Any[],
  flagsOff: new Set<string>(),
  stoppedLinks: new Set<string>(),
};

// ---- new patient features (waitlist, vault, pharmacy, lab, telemedicine) ----
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const nid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const RX_URL = "https://kiorex.test/rx/verify?t=mock-rx-token-0001";
const feat = {
  vault: [
    { id: "rec_visit", kind: "VISIT_SUMMARY", title: "Visit summary · Dr. Laila Hassan", source: "CLINIC", clinicId: "c1", dependantId: null, signedAt: iso(-5 * 86_400_000), hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: iso(-5 * 86_400_000), content: { assessment: "Seasonal allergic rhinitis", plan: "Antihistamine for 7 days, review if no improvement" } },
    { id: "rec_rx", kind: "PRESCRIPTION", title: "Prescription · Dr. Laila Hassan", source: "CLINIC", clinicId: "c1", dependantId: null, signedAt: iso(-5 * 86_400_000), hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: iso(-5 * 86_400_000), prescription: { items: null }, verification: { token: "mock-rx-token-0001", qrPayload: RX_URL, verifyUrl: RX_URL } },
    { id: "rec_lab", kind: "LAB_RESULT", title: "CBC · Al-Noor Lab", source: "LAB", clinicId: null, dependantId: null, signedAt: iso(-2 * 86_400_000), hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: iso(-2 * 86_400_000), report: { panel: "Complete blood count", status: "Signed report released" } },
  ] as Any[],
  sharing: { VISIT_SUMMARY: true, PRESCRIPTIONS: true, LAB_RESULTS: false, SHARE_WITH_OTHER_CLINICS: false } as Record<string, boolean>,
  followUps: [{ id: "fu1", recordId: "rec_visit", clinicId: "c1", dueAt: iso(9 * 86_400_000), source: "DOCTOR", status: "SCHEDULED" }] as Any[],
  waitlist: [{ id: "wl1", providerId: "d2", doctor: { id: "d2", nameEn: "Dr. Mock", nameAr: "د. تجريبي", specialty: "paediatrics", photoUrl: null }, clinicNameEn: null, clinicNameAr: null, typeId: "d2-first", preferredFrom: null, preferredTo: null, status: "OFFERED", expiresAt: iso(20 * 86_400_000), offers: [{ id: "wo1", startsAt: iso(2 * 86_400_000), endsAt: iso(2 * 86_400_000 + 20 * 60_000), status: "OFFERED", expiresAt: iso(15 * 60_000), bookingId: null }] }] as Any[],
  cart: { pharmacyId: null as string | null, items: [] as Any[], deliveryMethod: null as string | null, prescriptionRecordId: null as string | null },
  pOrders: [] as Any[], lab: [] as Any[], tele: [] as Any[],
};
const MEDS: Any[] = [
  { sku: "para500", name: "Paracetamol 500 mg", strength: "500 mg", form: "tablet", priceMinor: 4500, rxRequired: false, available: true },
  { sku: "amox500", name: "Amoxicillin 500 mg", strength: "500 mg", form: "capsule", priceMinor: 12000, rxRequired: true, available: true },
  { sku: "cetir10", name: "Cetirizine 10 mg", strength: "10 mg", form: "tablet", priceMinor: 6000, rxRequired: false, available: false },
];
const LAB_TESTS: Any[] = [
  { labId: "lab1", labName: "Al-Noor Lab", code: "CBC", name: "Complete blood count", priceMinor: 25000, sampleType: "Blood", homeCollection: true, preparation: "No fasting needed" },
  { labId: "lab1", labName: "Al-Noor Lab", code: "HBA1C", name: "HbA1c", priceMinor: 30000, sampleType: "Blood", homeCollection: true },
  { labId: "lab1", labName: "Al-Noor Lab", code: "LIPID", name: "Lipid profile", priceMinor: 35000, sampleType: "Blood", homeCollection: false, preparation: "Fast 10 hours" },
];
const cartView = () => {
  const items = feat.cart.items.map((i) => { const m = MEDS.find((x) => x.sku === i.sku)!; return { sku: m.sku, name: m.name, qty: i.qty, unitPriceMinor: m.priceMinor, rxRequired: m.rxRequired, available: m.available }; });
  const subtotalMinor = items.reduce((n, i) => n + i.qty * i.unitPriceMinor, 0);
  const deliveryFeeMinor = feat.cart.deliveryMethod === "DELIVERY" ? 3000 : 0;
  return { ...feat.cart, items, subtotalMinor, deliveryFeeMinor, totalMinor: subtotalMinor + deliveryFeeMinor, currency: "EGP", rxRequired: items.some((i) => i.rxRequired) };
};
/** Test/demo hooks. */
export const mockControls = { setFlagOff: (k: string, off = true) => (off ? state.flagsOff.add(k) : state.flagsOff.delete(k)), markTaken: (iso: string) => state.taken.add(iso) };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, message: string, extra: Any = {}) => json(status, { code, message, ...extra });
const gate = (k: string) => (state.flagsOff.has(k) ? err(403, "FEATURE_DISABLED", "Feature disabled", { key: k, scope: "GLOBAL" }) : null);

const present = (b: Any) => {
  const d = doc(b.providerId)!; const c = CLINICS[d.clinic];
  return {
    ...b, channel: b.providerId === "d4" ? "WHATSAPP" : b.providerId === "d2" ? "CLINIC_LINK" : "MARKETPLACE", holdExpiresAt: b.status === "HELD" ? b.holdExpiresAt : null, doctor: { nameEn: d.nameEn, nameAr: d.nameAr, specialty: d.spec },
    clinic: { nameEn: c.nameEn, nameAr: c.nameAr, addressEn: c.addressEn, addressAr: c.addressAr, phone: c.phone, latitude: c.latitude, longitude: c.longitude },
    cancellationPolicy: { freeCancelHoursBefore: 12, depositRefundable: true, textAr: "يمكنك الإلغاء مجانًا حتى ١٢ ساعة قبل الموعد، ويُرد العربون كاملًا.", textEn: "Cancel free up to 12 hours before the visit; any deposit is refunded in full." },
    deposit: b.depositStatus === "NONE" ? null : { paymentId: `pay_${b.id}`, status: b.depositStatus === "PAID" ? "CAPTURED" : "CREATED", checkoutUrl: b.depositStatus === "PAID" ? null : `https://example.com/mock-pay/${b.id}` },
  };
};
const push = (b: Any, status: string) => { b.status = status; b.timeline.push({ status, at: new Date().toISOString() }); };


/** Mock order/booking progression: paid ~1 s after creation, then the "pharmacy/lab" acknowledges. */
const progressOrder = (o: Any) => { if (o.status === "PENDING_PAYMENT" && Date.now() > o._paidAt) { o.status = "SUBMITTED"; o.payment = { ...o.payment, status: "CAPTURED" }; } return o; };
const progressLab = (b: Any) => { if (b.status === "PENDING_PAYMENT" && Date.now() > b._paidAt) { b.status = "RESULT_RELEASED"; b.resultRecordId = "rec_lab"; b.payment = { ...b.payment, status: "CAPTURED" }; } return b; };

async function route(method: string, path: string, url: URL, body: Any): Promise<Response> {
  let m: RegExpMatchArray | null;
  if (method === "GET" && path === "/flags/effective") return json(200, { market: "EG", flags: Object.fromEntries(["kiorex.marketplace", "kiorex.pay_deposits", "kiorex.reviews", "kiorex.family_accounts", "kiorex.record_vault", "kiorex.pharmacy_orders", "kiorex.lab_bookings", "kiorex.telemedicine"].map((k) => [k, { enabled: !state.flagsOff.has(k), reason: "mock" }])) });
  // public family link (no login): token "gone-token" is a revoked link (404); "stopped-token" a stopped one. Never any address / fee / phone / reason.
  if ((m = path.match(/^\/public\/visit-status\/([^/]+)(\/stop)?$/))) {
    const tok = m[1];
    if (tok === "gone-token") return err(404, "NOT_FOUND", "Link not found");
    if (m[2] && method === "POST") { state.stoppedLinks.add(tok); return json(200, { ok: true }); }
    const stopped = tok === "stopped-token" || state.stoppedLinks.has(tok);
    const steps = ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "FINISHED"].map((key, i) => ({ key, reached: i < 2, at: i < 2 ? iso(-3_600_000 + i * 1_200_000) : null }));
    return json(200, { patientFirstName: "Youssef", startsAt: iso(3_600_000), subState: null, steps, eta: stopped ? {} : { shared: true, minutes: 18 }, provider: stopped ? null : { displayName: "Nurse Heba" }, stopped, status: stopped ? "STOPPED" : "ON_THE_WAY" });
  }
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
  if (method === "GET" && path === "/me/devices") return json(200, state.devices ?? []);
  if (method === "POST" && path === "/me/devices") { const d = { id: `dev${(state.devices ??= []).length + 1}`, platform: body.platform, appVersion: body.appVersion ?? null, locale: body.locale ?? null, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }; state.devices.push(d); return json(201, d); }
  if (method === "DELETE" && (m = path.match(/^\/me\/devices\/([^/]+)$/))) { state.devices = (state.devices ?? []).filter((d: Any) => d.id !== m![1]); return json(200, { ok: true }); }
  if (method === "GET" && path === "/me/sessions") return json(200, state.sessions);
  if (method === "DELETE" && (m = path.match(/^\/me\/sessions\/([^/]+)$/))) { state.sessions = state.sessions.filter((s) => s.id !== m![1]); return json(200, { ok: true }); }
  if (method === "POST" && path === "/me/export") return json(200, { id: "exp1", generatedAt: new Date().toISOString() });
  if (method === "POST" && path === "/me/deletion") return json(200, { ok: !!body.confirm, deleted: !!body.confirm });
  if (method === "GET" && path === "/me/reviews") return json(200, []);

  // ---- markets / analytics ----
  if (method === "GET" && path === "/markets") return json(200, [{ code: "EG", live: !state.flagsOff.has("market.eg.live"), flag: "market.eg.live", state: state.flagsOff.has("market.eg.live") ? "AWAITING_GATE" : "LIVE" }]);
  if (method === "POST" && path === "/analytics/events") return json(202, { accepted: (body.events ?? []).length });

  // ---- records vault ----
  if (method === "GET" && path === "/me/vault") { const kind = url.searchParams.get("kind"); return json(200, { items: feat.vault.filter((r) => !kind || r.kind === kind), readOnly: state.flagsOff.has("kiorex.record_vault") }); }
  if (method === "POST" && path === "/me/vault/uploads") {
    const g = gate("kiorex.record_vault"); if (g) return g;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(body.mimeType)) return err(400, "UNSUPPORTED_FILE_TYPE", "Only PDF, JPEG and PNG files can be uploaded");
    const r = { id: nid("rec"), kind: "UPLOAD", title: body.title ?? body.fileName, source: "PATIENT", clinicId: null, dependantId: null, signedAt: null, hasFile: true, fileName: body.fileName, mimeType: body.mimeType, sizeBytes: Math.round((body.contentBase64?.length ?? 0) * 0.75), createdAt: new Date().toISOString() };
    feat.vault.unshift(r); return json(201, r);
  }
  if ((m = path.match(/^\/me\/vault\/([^/]+)(\/content)?$/))) {
    const r = feat.vault.find((x) => x.id === m![1]); if (!r) return err(404, "RECORD_NOT_FOUND", "Record not found");
    if (m[2]) return new Response(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)), { status: 200, headers: { "content-type": r.mimeType ?? "image/png" } });
    if (method === "DELETE") { feat.vault = feat.vault.filter((x) => x.id !== r.id); return json(200, { ok: true }); }
    return json(200, r);
  }
  if (method === "GET" && path === "/me/record-sharing") return json(200, { scopes: Object.entries(feat.sharing).map(([scope, granted]) => ({ scope, granted, updatedAt: granted ? new Date().toISOString() : null })), canGrant: !state.flagsOff.has("clinic.record_share_patient_app") && !state.flagsOff.has("kiorex.record_vault") });
  if (method === "PUT" && (m = path.match(/^\/me\/record-sharing\/([^/]+)$/))) {
    if (body.granted && (state.flagsOff.has("clinic.record_share_patient_app") || state.flagsOff.has("kiorex.record_vault"))) return err(403, "FEATURE_DISABLED", "Feature disabled", { key: "clinic.record_share_patient_app", scope: "GATE" });
    feat.sharing[m[1]] = !!body.granted; return json(200, { scopes: Object.entries(feat.sharing).map(([scope, granted]) => ({ scope, granted, updatedAt: new Date().toISOString() })), canGrant: true });
  }
  if (method === "GET" && path === "/me/prescriptions") return json(200, feat.vault.filter((r) => r.kind === "PRESCRIPTION"));
  if (method === "GET" && path === "/me/follow-ups") return json(200, feat.followUps);
  if (method === "POST" && path === "/me/follow-ups") { const f = { id: nid("fu"), recordId: body.recordId ?? null, clinicId: null, dueAt: iso(body.afterDays * 86_400_000), source: "PATIENT", status: "SCHEDULED" }; feat.followUps.push(f); return json(201, f); }
  if (method === "DELETE" && (m = path.match(/^\/me\/follow-ups\/([^/]+)$/))) { feat.followUps = feat.followUps.filter((f) => f.id !== m![1]); return json(200, { ok: true }); }

  // ---- waitlist ----
  if (path.startsWith("/waitlist")) {
    const g = gate("kiorex.marketplace"); if (g) return g;
    if (method === "GET" && path === "/waitlist") return json(200, feat.waitlist.filter((w) => w.status !== "CANCELLED"));
    if (method === "POST" && path === "/waitlist") { const w = { id: nid("wl"), providerId: body.providerId, typeId: body.typeId, preferredFrom: body.preferredFrom ?? null, preferredTo: body.preferredTo ?? null, status: "WAITING", expiresAt: iso(30 * 86_400_000), offers: [] }; feat.waitlist.unshift(w); return json(201, w); }
    if (method === "DELETE" && (m = path.match(/^\/waitlist\/([^/]+)$/))) { const w = feat.waitlist.find((x) => x.id === m![1]); if (w) w.status = "CANCELLED"; return json(200, { ok: true }); }
    if (method === "POST" && (m = path.match(/^\/waitlist\/offers\/([^/]+)\/(accept|decline)$/))) {
      const w = feat.waitlist.find((x) => x.offers.some((o: Any) => o.id === m![1])); const o = w?.offers.find((x: Any) => x.id === m![1]);
      if (!w || !o) return err(404, "OFFER_NOT_FOUND", "Offer not found");
      if (new Date(o.expiresAt) < new Date()) return err(410, "OFFER_EXPIRED", "Offer expired");
      if (m[2] === "decline") { o.status = "DECLINED"; w.status = "WAITING"; return json(200, { ok: true }); }
      const d = doc(w.providerId)!; const id = nid("kx_bk");
      const b: Any = { id, status: "HELD", providerId: d.id, clinicId: d.clinic, typeId: w.typeId, startsAt: o.startsAt, endsAt: o.endsAt, dependantId: null, holdExpiresAt: iso(5 * 60_000), confirmationDueAt: null, cancelledBy: null, cancellationReason: null, failureCode: null, depositStatus: "NONE", depositAmountMinor: 0, currency: "EGP", manual: false, callState: "NONE", createdAt: new Date().toISOString(), timeline: [{ status: "HELD", at: new Date().toISOString() }] };
      state.bookings.set(id, b); o.status = "ACCEPTED"; o.bookingId = id; w.status = "BOOKED"; return json(200, present(b));
    }
  }

  // ---- pharmacy ----
  if (path.startsWith("/pharmacy")) {
    const g = gate("kiorex.pharmacy_orders"); if (g) return g;
    if (method === "GET" && path === "/pharmacy/pharmacies") return json(200, [{ id: "ph1", name: "El-Ezaby Pharmacy · Nasr City", pickup: true, deliveryEnabled: true, deliveryFeeMinor: 3000, prepMinutes: 30 }]);
    if (method === "GET" && path === "/pharmacy/search") { const q = (url.searchParams.get("q") ?? "").toLowerCase(); return json(200, { items: MEDS.filter((x) => x.name.toLowerCase().includes(q)).map((x) => ({ pharmacyId: "ph1", ...x })) }); }
    if (path === "/pharmacy/cart") {
      if (method === "PUT") { feat.cart = { ...feat.cart, pharmacyId: body.pharmacyId, items: body.items, prescriptionRecordId: body.prescriptionRecordId ?? null }; }
      if (method === "DELETE") { feat.cart = { pharmacyId: null, items: [], deliveryMethod: null, prescriptionRecordId: null }; return json(200, { ok: true }); }
      return json(200, cartView());
    }
    if (method === "PUT" && path === "/pharmacy/cart/delivery") { feat.cart.deliveryMethod = body.method; return json(200, cartView()); }
    if (method === "POST" && path === "/pharmacy/orders") {
      const c = cartView(); if (c.rxRequired && !body.prescriptionRecordId) return err(422, "PRESCRIPTION_REQUIRED", "A prescription is required");
      const o = { id: nid("kx_po"), status: "PENDING_PAYMENT", pharmacyId: c.pharmacyId, items: c.items, subtotalMinor: c.subtotalMinor, deliveryFeeMinor: c.deliveryFeeMinor, totalMinor: c.totalMinor, currency: "EGP", deliveryMethod: c.deliveryMethod ?? "PICKUP", rxStatus: c.rxRequired ? "PENDING" : "NOT_REQUIRED", rejectionReason: null, readyAt: null, dispensedAt: null, payment: { paymentId: nid("pay"), status: "CREATED", checkoutUrl: "about:blank" }, createdAt: new Date().toISOString(), _paidAt: Date.now() + 1000 };
      feat.pOrders.unshift(o); feat.cart = { pharmacyId: null, items: [], deliveryMethod: null, prescriptionRecordId: null }; return json(201, o);
    }
    if (method === "GET" && path === "/pharmacy/orders") return json(200, feat.pOrders.map(progressOrder));
    if ((m = path.match(/^\/pharmacy\/orders\/([^/]+)(\/cancel)?$/))) { const o = feat.pOrders.find((x) => x.id === m![1]); if (!o) return err(404, "ORDER_NOT_FOUND", "Order not found"); if (m[2]) { o.status = "CANCELLED"; } return json(200, progressOrder(o)); }
  }

  // ---- lab ----
  if (path.startsWith("/lab")) {
    const g = gate("kiorex.lab_bookings"); if (g) return g;
    if (method === "GET" && path === "/lab/tests") { const q = (url.searchParams.get("q") ?? "").toLowerCase(); return json(200, { items: LAB_TESTS.filter((x) => x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q)) }); }
    if (method === "GET" && path === "/lab/slots") { const out = []; for (let d = 1; d <= 3; d++) for (const h of [9, 11, 14]) { const st = new Date(); st.setUTCDate(st.getUTCDate() + d); st.setUTCHours(h, 0, 0, 0); out.push({ startsAt: st.toISOString(), endsAt: new Date(st.getTime() + 30 * 60_000).toISOString() }); } return json(200, { labId: url.searchParams.get("labId"), collectionType: url.searchParams.get("collectionType"), slots: out }); }
    if (method === "POST" && path === "/lab/bookings") {
      const tests = (body.testCodes as string[]).map((c) => LAB_TESTS.find((t) => t.code === c)!).map((t) => ({ code: t.code, name: t.name, priceMinor: t.priceMinor }));
      const sub = tests.reduce((n, t) => n + t.priceMinor, 0); const fee = body.collectionType === "HOME" ? 5000 : 0;
      const b = { id: nid("kx_lb"), status: "PENDING_PAYMENT", labId: body.labId, tests, collectionType: body.collectionType, slotStartsAt: body.slot.startsAt, slotEndsAt: body.slot.endsAt, subtotalMinor: sub, collectionFeeMinor: fee, totalMinor: sub + fee, currency: "EGP", resultRecordId: null, rejectionReason: null, payment: { paymentId: nid("pay"), status: "CREATED", checkoutUrl: "about:blank" }, createdAt: new Date().toISOString(), _paidAt: Date.now() + 1000 };
      feat.lab.unshift(b); return json(201, b);
    }
    if (method === "GET" && path === "/lab/bookings") return json(200, feat.lab.map(progressLab));
    if ((m = path.match(/^\/lab\/bookings\/([^/]+)(\/cancel)?$/))) { const b = feat.lab.find((x) => x.id === m![1]); if (!b) return err(404, "LAB_BOOKING_NOT_FOUND", "Not found"); if (m[2]) b.status = "CANCELLED"; return json(200, progressLab(b)); }
  }

  // ---- telemedicine (mock video provider) ----
  if (path.startsWith("/telemedicine")) {
    const g = gate("kiorex.telemedicine"); if (g) return g;
    if (method === "GET" && path === "/telemedicine/providers") return json(200, { items: DOCS.filter((d) => ["d1", "d3"].includes(d.id)).map((d) => ({ id: d.id, nameEn: d.nameEn, nameAr: d.nameAr, specialty: d.spec, defaultTypeId: `${d.id}-first`, nextSlots: slotsFor(d.id).slice(0, 2) })) });
    if (method === "POST" && path === "/telemedicine/sessions") {
      const b = state.bookings.get(body.bookingId); if (!b) return err(404, "BOOKING_NOT_FOUND", "Booking not found");
      let t = feat.tele.find((x) => x.bookingId === b.id);
      if (!t) { t = { id: nid("kx_ts"), bookingId: b.id, providerId: b.providerId, status: "SCHEDULED", scheduledStartsAt: b.startsAt, startedAt: null, endedAt: null, durationSec: null, consultFeeMinor: 0, joinOpensAt: iso(-60_000) /* demo: room already open */ }; feat.tele.push(t); }
      return json(201, t);
    }
    if (method === "GET" && path === "/telemedicine/visits") return json(200, []); // Clinic-owned visits come from the Clinic; the mock stack uses the mock session path below
    if (method === "GET" && path === "/telemedicine/sessions") return json(200, feat.tele);
    if ((m = path.match(/^\/telemedicine\/sessions\/([^/]+)(?:\/(join|end))?$/))) {
      const t = feat.tele.find((x) => x.id === m![1]); if (!t) return err(404, "SESSION_NOT_FOUND", "Session not found");
      if (m[2] === "join") { t.status = "WAITING"; return json(200, { session: t, video: { token: "mock.video.token", room: `kx-room-${t.id}`, url: "mock://video", expiresAt: iso(3600_000), role: "patient", provider: "mock" } }); }
      if (m[2] === "end") { t.status = "ENDED"; t.endedAt = new Date().toISOString(); t.durationSec = 420; }
      return json(200, t);
    }
  }


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
