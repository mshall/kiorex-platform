import type { Page, Route } from "@playwright/test";

/** DEV-only API fixtures for states the seed data does not reliably hold (every order / lab / video state, a live home visit).
 *  They are applied with `page.route`, never shipped: use them to assert UI states without depending on whatever the stack was last seeded with. */
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();
const item = (sku: string, name: string, qty: number, price: number, rx = false) => ({ sku, name, qty, unitPriceMinor: price, rxRequired: rx, available: true });
const order = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, pharmacyId: "ph1", items: [item("a", "Paracetamol 500mg", 2, 2500), item("b", "Pharmoenox 40mg", 1, 38000, true)], subtotalMinor: 43000, deliveryFeeMinor: 3000, totalMinor: 46000, currency: "EGP",
  deliveryMethod: "DELIVERY", rxStatus: "VALID", rejectionReason: null, readyAt: null, dispensedAt: null, payment: null, createdAt: iso(-180), ...extra,
});
export const ORDERS = [
  order("o-pay", "PENDING_PAYMENT", { rxStatus: "PENDING", payment: { paymentId: "p1", status: "CREATED", checkoutUrl: "https://pay.example.test/fake-checkout/1" } }),
  order("o-sub", "SUBMITTED"),
  order("o-ready", "READY", { deliveryMethod: "PICKUP", deliveryFeeMinor: 0, totalMinor: 43000, readyAt: iso(-20) }),
  order("o-rej", "REJECTED", { rejectionReason: "One item is out of stock.", payment: { paymentId: "p2", status: "REFUNDED", checkoutUrl: null } }),
  order("o-can", "CANCELLED", { payment: { paymentId: "p3", status: "REFUNDED", checkoutUrl: null } }),
];
const lab = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, labId: "l1", tests: [{ code: "CBC", name: "Complete blood count", priceMinor: 12000 }, { code: "TSH", name: "TSH", priceMinor: 18000 }], collectionType: "HOME", slotStartsAt: iso(60 * 20), slotEndsAt: iso(60 * 21),
  subtotalMinor: 30000, collectionFeeMinor: 5000, totalMinor: 35000, currency: "EGP", resultRecordId: null, rejectionReason: null, payment: null, createdAt: iso(-300), ...extra,
});
export const LABS = [
  lab("l-pay", "PENDING_PAYMENT", { payment: { paymentId: "p4", status: "CREATED", checkoutUrl: "https://pay.example.test/fake-checkout/2" } }),
  lab("l-sub", "SUBMITTED"),
  lab("l-res", "RESULT_RELEASED", { collectionType: "WALK_IN", collectionFeeMinor: 0, totalMinor: 30000, resultRecordId: "rec1" }),
  lab("l-rej", "REJECTED", { rejectionReason: "The sample type is not accepted for home collection." }),
];
const tele = (id: string, status: string, startMin: number, extra: Record<string, unknown> = {}) => ({ id, bookingId: `b-${id}`, providerId: "pr1", status, scheduledStartsAt: iso(startMin), startedAt: null, endedAt: null, durationSec: null, consultFeeMinor: 0, joinOpensAt: iso(startMin - 15), ...extra });
export const SESSIONS = [tele("t-soon", "SCHEDULED", 90), tele("t-live", "IN_PROGRESS", -10, { startedAt: iso(-9) }), tele("t-end", "ENDED", -60 * 24, { durationSec: 1080 })];

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const byId = (list: { id: string }[], url: string) => list.find((x) => url.endsWith(`/${x.id}`));

/** Mock only GETs (and the mock video join) so the page code runs unchanged. */
export async function mockServiceStates(page: Page) {
  await page.route(/\/api\/v1\/pharmacy\/orders(\/[^/?]+)?(\?.*)?$/, (r) => { if (r.request().method() !== "GET") return r.continue(); const u = r.request().url().split("?")[0]; return u.endsWith("/orders") ? json(r, ORDERS) : byId(ORDERS, u) ? json(r, byId(ORDERS, u)) : json(r, { code: "NOT_FOUND", message: "x" }, 404); });
  await page.route(/\/api\/v1\/lab\/bookings(\/[^/?]+)?(\?.*)?$/, (r) => { if (r.request().method() !== "GET") return r.continue(); const u = r.request().url().split("?")[0]; return u.endsWith("/bookings") ? json(r, LABS) : byId(LABS, u) ? json(r, byId(LABS, u)) : json(r, { code: "NOT_FOUND", message: "x" }, 404); });
  await page.route(/\/api\/v1\/telemedicine\/sessions(\/[^/?]+)?(\?.*)?$/, (r) => { if (r.request().method() !== "GET") return r.continue(); const u = r.request().url().split("?")[0]; return u.endsWith("/sessions") ? json(r, SESSIONS) : byId(SESSIONS, u) ? json(r, byId(SESSIONS, u)) : json(r, { code: "NOT_FOUND", message: "x" }, 404); });
  await page.route(/\/api\/v1\/telemedicine\/sessions\/[^/]+\/join$/, (r) => json(r, { session: SESSIONS[1], video: { token: "t", room: "kx-demo-room", url: "", expiresAt: iso(60), role: "patient", provider: "mock" } }));
}

/** Awaiting-gate (launch-locked) state without depending on seed data: the effective-flags endpoint reports these verticals as AWAITING_GATE. */
export async function mockAwaitingGate(page: Page, keys = ["kiorex.pharmacy_orders", "kiorex.lab_bookings", "kiorex.telemedicine"]) {
  await page.route(/\/api\/v1\/flags\/effective/, async (r) => {
    const res = await r.fetch(); const b = (await res.json()) as { flags?: Record<string, unknown> };
    const flags = { ...(b.flags ?? {}) }; for (const k of keys) flags[k] = { enabled: false, scope: "GATE", reason: "AWAITING_GATE" };
    return json(r, { ...b, flags }, res.status());
  });
}

/** A pharmacy, two medicines and a filled cart (also answers the cart writes with the same cart) so the cart panel / mobile sheet can be exercised without seed data. */
export async function mockPharmacy(page: Page) {
  const cart = { pharmacyId: "ph1", items: [item("a", "Paracetamol 500mg", 2, 2500), item("b", "Pharmoenox 40mg", 1, 38000, true)], deliveryMethod: "DELIVERY", prescriptionRecordId: null, subtotalMinor: 43000, deliveryFeeMinor: 3000, totalMinor: 46000, currency: "EGP", rxRequired: true };
  await page.route(/\/api\/v1\/flags\/effective/, async (r) => { const res = await r.fetch(); const b = (await res.json()) as { flags?: Record<string, unknown> }; return json(r, { ...b, flags: { ...(b.flags ?? {}), "kiorex.pharmacy_orders": { enabled: true }, "kiorex.lab_bookings": { enabled: true }, "kiorex.telemedicine": { enabled: true } } }, res.status()); });
  await page.route(/\/api\/v1\/pharmacy\/pharmacies$/, (r) => json(r, [{ id: "ph1", name: "Nile Pharmacy - Maadi", pickup: true, deliveryEnabled: true, deliveryFeeMinor: 3000, prepMinutes: 25 }, { id: "ph2", name: "Delta Pharmacy", pickup: true, deliveryEnabled: false, deliveryFeeMinor: 0, prepMinutes: 15 }]));
  await page.route(/\/api\/v1\/pharmacy\/search/, (r) => json(r, { items: [{ pharmacyId: "ph1", sku: "a", name: "Paracetamol 500mg", strength: "500 mg", form: "tablet", priceMinor: 2500, rxRequired: false, available: true }, { pharmacyId: "ph1", sku: "b", name: "Pharmoenox 40mg", strength: "40 mg", form: "injection", priceMinor: 38000, rxRequired: true, available: true }] }));
  await page.route(/\/api\/v1\/pharmacy\/cart(\/delivery)?$/, (r) => r.request().method() === "DELETE" ? json(r, { ...cart, items: [], pharmacyId: null }) : json(r, cart));
}

/** Public family visit-status link payload (live visit, provider en route). */
export async function mockVisitStatus(page: Page) {
  await page.route("**/api/v1/public/visit-status/**", (r) => r.request().method() === "GET"
    ? json(r, { patientFirstName: "Hoda", startsAt: iso(60), status: "CONFIRMED", subState: "EN_ROUTE", steps: [{ key: "CONFIRMED", reached: true, at: null }, { key: "ON_THE_WAY", reached: true, at: null }, { key: "ARRIVED", reached: false, at: null }, { key: "FINISHED", reached: false, at: null }], eta: { minutes: 9, shared: true }, provider: { displayName: "Nurse Mona", badge: "RN" }, stopped: false })
    : r.continue());
}
