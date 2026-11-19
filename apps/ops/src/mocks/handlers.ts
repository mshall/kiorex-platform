// Mock-server (VITE_MOCK=1 / unit tests). Flag endpoints replicate the real control-plane response shapes
// (apps/api/src/control-plane/flags.service.ts). OP-01..06 endpoints are mocked until the API serves them.
import { http, HttpResponse } from "msw";
import type { FlagAudit, FlagRequest, FlagRow } from "@/api/hooks";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const err = (status: number, code: string, message: string) => HttpResponse.json({ code, message }, { status });

type Def = { key: string; product: string; class: string; scopes: string[]; dependsOn: string[]; moneyPath: boolean; launchLocked: boolean; whenOff: string };
const defs: Def[] = [
  { key: "kiorex.marketplace", product: "kiorex", class: "MODULE", scopes: ["GLOBAL", "MARKET"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "Search shows clinic phone only; no new bookings; existing bookings honoured" },
  { key: "kiorex.pay_deposits", product: "kiorex", class: "COMMERCIAL", scopes: ["GLOBAL", "MARKET"], dependsOn: ["kiorex.marketplace"], moneyPath: true, launchLocked: false, whenOff: "Deposit-required visit types bookable without deposit or hidden" },
  { key: "kiorex.reviews", product: "kiorex", class: "MODULE", scopes: ["GLOBAL", "MARKET"], dependsOn: ["kiorex.marketplace"], moneyPath: false, launchLocked: false, whenOff: "No new reviews; aggregates still displayed" },
  { key: "kiorex.family_accounts", product: "kiorex", class: "MODULE", scopes: ["GLOBAL", "MARKET"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "Existing dependants kept; cannot add new" },
  { key: "kiorex.telemedicine", product: "kiorex", class: "LAUNCH_LOCKED", scopes: ["GLOBAL", "MARKET"], dependsOn: [], moneyPath: false, launchLocked: true, whenOff: "Video option hidden" },
  { key: "kiorex.ai_navigation", product: "kiorex", class: "LAUNCH_LOCKED", scopes: ["GLOBAL", "MARKET"], dependsOn: [], moneyPath: false, launchLocked: true, whenOff: "Plain specialty search" },
  { key: "clinic.kiorex_listing", product: "kiorly-clinic", class: "MODULE", scopes: ["GLOBAL", "MARKET", "ORG"], dependsOn: ["kiorex.marketplace"], moneyPath: false, launchLocked: false, whenOff: "Listings PAUSED on Kiorex; confirmed bookings honoured" },
  { key: "clinic.commission_settlement", product: "kiorly-clinic", class: "COMMERCIAL", scopes: ["GLOBAL", "MARKET"], dependsOn: ["clinic.kiorex_listing"], moneyPath: true, launchLocked: false, whenOff: "New commission charges stop; confirmed charges still settle" },
  { key: "whatsapp_reminders", product: "kiorly-clinic", class: "INTEGRATION", scopes: ["GLOBAL", "MARKET", "ORG"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "Reminders stop; manual call list shown" },
  { key: "account.passkeys", product: "kiorex-account", class: "MODULE", scopes: ["GLOBAL", "MARKET"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "OTP only" },
  { key: "pharmacy.module", product: "kiorly-pharmacy", class: "MODULE", scopes: ["GLOBAL", "MARKET", "ORG"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "No new sign-ups; existing tenants read-only with export" },
  { key: "lab.module", product: "kiorly-lab", class: "MODULE", scopes: ["GLOBAL", "MARKET", "ORG"], dependsOn: [], moneyPath: false, launchLocked: false, whenOff: "No new sign-ups; existing tenants read-only with export" },
];

interface Ov { key: string; scope: string; scopeId: string; reason: string; ticket: string; setBy: string; expiresAt: string | null; startsAt: string | null; at: string }
const S = {
  version: 7,
  overrides: [] as Ov[],
  gates: new Map<string, { gateId: string; approver: string; approvedOn: string; documentUrl: string }>(),
  audit: [] as FlagAudit[],
  requests: [] as FlagRequest[],
};
export const ACTOR = "ops-1";

export function resetOpsMock() {
  S.version = 7; S.overrides = []; S.gates.clear(); S.audit = [];
  S.requests = [{ id: "req_seed", flagKey: "kiorex.pay_deposits", scope: "GLOBAL", scopeId: "", value: "OFF", reason: "PSP degraded — pausing new deposits", ticket: "OPS-412", expiresAt: null, requestedBy: "ops-2", status: "PENDING", approvedBy: null, emergency: false, reviewDueAt: null, reviewedBy: null, reviewedAt: null, createdAt: ago(25), decidedAt: null }];
}
resetOpsMock();

function evalFlag(d: Def, market: string): { effective: boolean; reason: string } {
  const off = (k: string, m?: string) => S.overrides.some((o) => o.key === k && ((o.scope === "GLOBAL") || (m && o.scope === "MARKET" && o.scopeId === m)));
  if (off(d.key, market)) return { effective: false, reason: "FLAG_OFF" };
  for (const p of d.dependsOn) { const pd = defs.find((x) => x.key === p); if (pd && !evalFlag(pd, market).effective) return { effective: false, reason: "DEPENDENCY_OFF" }; }
  if (d.launchLocked && !S.gates.has(d.key)) return { effective: false, reason: "AWAITING_GATE" };
  return { effective: true, reason: "DEFAULT" };
}

function row(d: Def, market: string): FlagRow {
  const m = evalFlag(d, market);
  const g = evalFlag(d, "");
  const ovs = S.overrides.filter((o) => o.key === d.key);
  const src = ovs.find((o) => o.scope === "GLOBAL") ?? ovs.find((o) => o.scope === "MARKET" && o.scopeId === market);
  const last = S.audit.find((a) => a.flagKey === d.key);
  const gate = S.gates.get(d.key);
  return {
    key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, moneyPath: d.moneyPath, launchLocked: d.launchLocked, whenOff: d.whenOff, gateHint: d.launchLocked ? "Gate evidence required" : null,
    effective: { global: g.effective, market: { [market]: m.effective } },
    state: m.effective ? "ON" : m.reason === "AWAITING_GATE" ? "ON_AWAITING_GATE" : "OFF", reason: m.reason,
    source: src ? { scope: src.scope, scopeId: src.scopeId, reason: src.reason, ticket: src.ticket, setBy: src.setBy, expiresAt: src.expiresAt, at: src.at } : m.reason === "AWAITING_GATE" ? { scope: "GATE" } : m.reason === "DEPENDENCY_OFF" ? { scope: "DEPENDENCY" } : { scope: "DEFAULT" },
    overrides: ovs.map((o) => ({ scope: o.scope, scopeId: o.scopeId, reason: o.reason, ticket: o.ticket, expiresAt: o.expiresAt, startsAt: o.startsAt })),
    gate: gate ?? null,
    lastChange: last ? { at: last.createdAt, actor: last.actor, event: last.event ?? "TOGGLE", newValue: last.newValue, reason: last.reason } : null,
  };
}

const audit = (a: Partial<FlagAudit> & { flagKey: string }) => S.audit.unshift({ createdAt: new Date().toISOString(), scope: "GLOBAL", scopeId: "", oldValue: null, newValue: null, actor: ACTOR, reason: null, ticket: null, event: "TOGGLE", ...a });

function apply(key: string, b: { scope: string; scopeId?: string; value: string; reason: string; ticket: string; expiresAt?: string; startsAt?: string }, emergency: boolean) {
  const scopeId = b.scope === "GLOBAL" ? "" : (b.scope === "MARKET" ? (b.scopeId ?? "").toUpperCase() : b.scopeId ?? "");
  S.overrides = S.overrides.filter((o) => !(o.key === key && o.scope === b.scope && o.scopeId === scopeId));
  if (b.value === "OFF") S.overrides.push({ key, scope: b.scope, scopeId, reason: b.reason, ticket: b.ticket, setBy: ACTOR, expiresAt: b.expiresAt ?? null, startsAt: b.startsAt ?? null, at: new Date().toISOString() });
  audit({ flagKey: key, scope: b.scope, scopeId, oldValue: b.value === "OFF" ? "ON" : "OFF", newValue: b.value, reason: b.reason, ticket: b.ticket, emergency });
  return ++S.version;
}

export const opsHandlers = [
  http.get("/api/v1/admin/flags", ({ request }) => {
    const u = new URL(request.url); const market = (u.searchParams.get("market") ?? "EG").toUpperCase(); const product = u.searchParams.get("product");
    return HttpResponse.json(defs.filter((d) => !product || d.product === product).map((d) => row(d, market)));
  }),
  http.put("/api/v1/admin/flags/:key/values", async ({ params, request }) => {
    const key = params.key as string; const d = defs.find((x) => x.key === key);
    const b = (await request.json()) as { scope: string; scopeId?: string; value: string; reason: string; ticket: string; expiresAt?: string; startsAt?: string; emergency?: boolean };
    if (!d) return err(404, "FLAG_NOT_FOUND", "Unknown flag");
    if (!d.scopes.includes(b.scope)) return err(400, "SCOPE_NOT_ALLOWED", `${key} cannot be set at ${b.scope} scope`);
    if (b.scope !== "GLOBAL" && !b.scopeId?.trim()) return err(400, "SCOPE_ID_REQUIRED", "scopeId required for market/org scope");
    if (!b.reason?.trim() || !b.ticket?.trim()) return err(400, "REASON_AND_TICKET_REQUIRED", "reason and ticket are required (KXM-OP-08)");
    const twoPerson = b.value === "OFF" && d.moneyPath && b.scope !== "ORG";
    if (twoPerson && !b.emergency) {
      const id = `req_${Math.random().toString(36).slice(2, 8)}`;
      S.requests.unshift({ id, flagKey: key, scope: b.scope, scopeId: b.scopeId ?? "", value: "OFF", reason: b.reason, ticket: b.ticket, expiresAt: b.expiresAt ?? null, requestedBy: ACTOR, status: "PENDING", approvedBy: null, emergency: false, reviewDueAt: null, reviewedBy: null, reviewedAt: null, createdAt: new Date().toISOString(), decidedAt: null });
      audit({ flagKey: key, scope: b.scope, newValue: "OFF", reason: b.reason, ticket: b.ticket, event: "REQUEST" });
      return HttpResponse.json({ status: "PENDING_APPROVAL", requestId: id });
    }
    const version = apply(key, b, !!b.emergency);
    if (twoPerson && b.emergency) S.requests.unshift({ id: `req_${Math.random().toString(36).slice(2, 8)}`, flagKey: key, scope: b.scope, scopeId: b.scopeId ?? "", value: "OFF", reason: b.reason, ticket: b.ticket, expiresAt: null, requestedBy: ACTOR, status: "APPROVED", approvedBy: ACTOR, emergency: true, reviewDueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), reviewedBy: null, reviewedAt: null, createdAt: new Date().toISOString(), decidedAt: new Date().toISOString() });
    return HttpResponse.json({ status: "APPLIED", version });
  }),
  http.put("/api/v1/admin/flags/:key/gate", async ({ params, request }) => {
    const key = params.key as string; const d = defs.find((x) => x.key === key);
    const b = (await request.json()) as { gateId: string; approver: string; approvedOn: string; documentUrl: string };
    if (!d?.launchLocked) return err(400, "NOT_LAUNCH_LOCKED", `${key} is not launch-locked`);
    if (!b.gateId?.trim() || !b.approver?.trim() || !b.documentUrl?.trim() || !b.approvedOn) return err(400, "GATE_EVIDENCE_INCOMPLETE", "gateId, approver, approvedOn and documentUrl are required (KXM-OP-09)");
    if (!/^https?:\/\//i.test(b.documentUrl)) return err(400, "GATE_DOCUMENT_URL_INVALID", "documentUrl must be an http(s) link");
    S.gates.set(key, b); audit({ flagKey: key, newValue: "GATE_SATISFIED", oldValue: "AWAITING_GATE", reason: `${b.gateId} approved by ${b.approver}`, event: "GATE" });
    return HttpResponse.json({ version: ++S.version });
  }),
  http.post("/api/v1/admin/flags/:key/gate/revoke", async ({ params, request }) => {
    const b = (await request.json()) as { reason: string };
    S.gates.delete(params.key as string); audit({ flagKey: params.key as string, newValue: "AWAITING_GATE", reason: b.reason, event: "GATE" });
    return HttpResponse.json({ version: ++S.version });
  }),
  http.get("/api/v1/admin/flags/requests", () => HttpResponse.json(S.requests)),
  http.post("/api/v1/admin/flags/requests/:id/approve", ({ params }) => {
    const r = S.requests.find((x) => x.id === params.id);
    if (!r) return err(404, "REQUEST_NOT_FOUND", "Unknown request");
    if (r.requestedBy === ACTOR) return err(403, "SECOND_APPROVER_REQUIRED", "A different super admin must approve (two-person rule, KXM-OP-10)");
    r.status = "APPROVED"; r.approvedBy = ACTOR; r.decidedAt = new Date().toISOString();
    apply(r.flagKey, { scope: r.scope, scopeId: r.scopeId, value: r.value, reason: r.reason, ticket: r.ticket }, false);
    return HttpResponse.json({ version: S.version });
  }),
  http.post("/api/v1/admin/flags/requests/:id/reject", ({ params }) => {
    const r = S.requests.find((x) => x.id === params.id); if (!r) return err(404, "REQUEST_NOT_FOUND", "Unknown request");
    r.status = "REJECTED"; r.decidedAt = new Date().toISOString(); return HttpResponse.json({ ok: true });
  }),
  http.post("/api/v1/admin/flags/requests/:id/review", ({ params }) => {
    const r = S.requests.find((x) => x.id === params.id); if (!r) return err(404, "REQUEST_NOT_FOUND", "Unknown request");
    r.reviewedBy = ACTOR; r.reviewedAt = new Date().toISOString(); return HttpResponse.json({ ok: true });
  }),
  http.get("/api/v1/admin/flags/audit", ({ request }) => {
    const u = new URL(request.url); const k = u.searchParams.get("flagKey");
    const rows = S.audit.filter((a) => !k || a.flagKey === k);
    if (u.searchParams.get("format") === "csv") return new HttpResponse(["createdAt,flagKey,scope,newValue,actor,reason,ticket", ...rows.map((r) => [r.createdAt, r.flagKey, r.scope, r.newValue, r.actor, r.reason, r.ticket].join(","))].join("\n"), { headers: { "content-type": "text/csv" } });
    return HttpResponse.json(rows);
  }),
  http.get("/api/v1/admin/flags/propagation", () => HttpResponse.json({
    currentVersion: S.version,
    products: [
      { product: "kiorex", snapshotVersion: S.version, lastFetchedAt: ago(0.2), ageSeconds: 12, versionsBehind: 0, status: "IN_SYNC", lastPush: { version: S.version, at: ago(0.3), error: null }, webhookConfigured: true },
      { product: "kiorly-clinic", snapshotVersion: S.version - 1, lastFetchedAt: ago(1.5), ageSeconds: 90, versionsBehind: 1, status: "STALE", lastPush: { version: S.version - 1, at: ago(2), error: "timeout" }, webhookConfigured: true },
      { product: "kiorex-account", snapshotVersion: S.version, lastFetchedAt: ago(0.4), ageSeconds: 25, versionsBehind: 0, status: "IN_SYNC", lastPush: { version: 0, at: null, error: null }, webhookConfigured: false },
      { product: "kiorly-pharmacy", snapshotVersion: 0, lastFetchedAt: null, ageSeconds: null, versionsBehind: S.version, status: "NEVER_FETCHED", lastPush: { version: 0, at: null, error: null }, webhookConfigured: false },
    ],
  })),

  // ---- OP-01..06: real /admin/* wire shapes (apps/api/src/ops) ----
  http.get("/api/v1/admin/providers", ({ request }) => {
    const u = new URL(request.url); const q = (u.searchParams.get("q") ?? "").toLowerCase(); const st = u.searchParams.get("status");
    const all = [
      { id: "p1", clinicId: "cl1", clinicianId: "dr1", status: "LIVE", nameEn: "Dr. Laila Hassan", nameAr: "د. ليلى حسن", specialty: "paediatrics", governorate: "Cairo", ratingAvg: 4.8, ratingCount: 126, sourceVersion: "1", syncedAt: ago(30) },
      { id: "p2", clinicId: "cl2", clinicianId: "dr2", status: "LIVE", nameEn: "Dr. Karim Mansour", nameAr: "د. كريم منصور", specialty: "cardiology", governorate: "Giza", ratingAvg: 4.6, ratingCount: 88, sourceVersion: "1", syncedAt: ago(90) },
      { id: "p3", clinicId: "cl3", clinicianId: "dr3", status: "PAUSED", nameEn: "Dr. Hala Fouad", nameAr: "د. هالة فؤاد", specialty: "dermatology", governorate: "Cairo", ratingAvg: null, ratingCount: 0, sourceVersion: "1", syncedAt: ago(600) },
    ].filter((p) => (!q || p.nameEn.toLowerCase().includes(q)) && (!st || p.status === st));
    return HttpResponse.json({ total: all.length, items: all });
  }),
  http.get("/api/v1/admin/bookings/:id/timeline", ({ params }) => params.id === "bk_demo"
    ? HttpResponse.json({ booking: { id: "bk_demo", status: "CONFIRMED" }, events: [
      { kind: "INTENT", fromStatus: null, toStatus: null, detail: { providerId: "p1" }, createdAt: ago(50) }, { kind: "STATE", fromStatus: "INTENT", toStatus: "HELD", detail: null, createdAt: ago(49) },
      { kind: "KIORLY_CALL", fromStatus: null, toStatus: null, detail: { call: "POST /holds" }, createdAt: ago(49) }, { kind: "STATE", fromStatus: "HELD", toStatus: "CONFIRMED", detail: null, createdAt: ago(46) }],
      payments: [{ id: "pi1", status: "CAPTURED", amountMinor: 15000, currency: "EGP", createdAt: ago(47) }], messages: [], webhooks: [{ eventId: "e1", type: "APPOINTMENT_CONFIRMED", status: "APPLIED", at: ago(45) }], outbox: [] })
    : HttpResponse.json({ code: "BOOKING_NOT_FOUND", message: "Booking not found" }, { status: 404 })),
  http.get("/api/v1/admin/outbox", () => HttpResponse.json({ stats: { pending: 3, failed: 0, dead: 1, lagMs: 4000, lagAlert: false }, items: [
    { id: "ob1", type: "APPOINTMENT_CONFIRMED", aggregateType: "Booking", aggregateId: "bk_demo", target: "KIORLY", status: "DEAD", attempts: 8, lastError: "502 from upstream", createdAt: ago(240) },
    { id: "ob2", type: "REVIEW_INVITATION_ELIGIBLE", aggregateType: "Booking", aggregateId: "bk_77", target: "INTERNAL", status: "PENDING", attempts: 0, lastError: null, createdAt: ago(1) }] })),
  http.post("/api/v1/admin/outbox/:id/replay", () => HttpResponse.json({ ok: true })),
  http.get("/api/v1/admin/payments/dashboard", () => HttpResponse.json({
    intents: [{ status: "CAPTURED", _count: 210, _sum: { amountMinor: 3150000 } }], refunds: [{ status: "PENDING", _count: 2, _sum: { amountMinor: 30000 } }, { status: "SUCCEEDED", _count: 9, _sum: { amountMinor: 135000 } }],
    payouts: [{ id: "po1", payoutRef: "r1", clinicId: "cl1", amountMinor: 520000, currency: "EGP", status: "SENT", paidAt: ago(1440), createdAt: ago(1440) }],
    reconciliationRuns: [{ id: "rr1", kind: "PSP_DAILY", status: "DISCREPANCIES", discrepancies: [{}], createdAt: ago(300) }, { id: "rr2", kind: "BOOKING_NIGHTLY", status: "OK", discrepancies: [], createdAt: ago(900) }], balances: [] })),
  http.get("/api/v1/admin/moderation", () => HttpResponse.json([
    { id: "m1", reviewId: "r1", reason: "PHI,ABUSE", status: "OPEN", createdAt: ago(60) }, { id: "m2", reviewId: "r2", reason: "PHI", status: "OPEN", createdAt: ago(1400) }])),
  http.post("/api/v1/admin/moderation/:id/resolve", () => HttpResponse.json({ ok: true })),
  http.get("/api/v1/admin/liquidity", () => HttpResponse.json({ windowDays: 30, listedDoctors: 102, liveDoctors: 96, bookingsByStatus: [{ status: "CONFIRMED", count: 210 }, { status: "COMPLETED", count: 140 }], searchToBook: 0.084, searches: 5200, confirmedBookings: 437, attended: 132, noShow: 17, noShowRate: 0.114, slotsPerDay: "TODO: needs Kiorly slot count API (not in marketplace contract)" })),
];
export const handlers = opsHandlers;
