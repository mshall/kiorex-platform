import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import WaitlistPage from "@/pages/WaitlistPage";
import RecordsPage from "@/pages/RecordsPage";
import PharmacyPage from "@/pages/PharmacyPage";
import PharmacyOrderPage from "@/pages/PharmacyOrdersPage";
import LabBookingPage from "@/pages/LabBookingsPage";
import LabPage from "@/pages/LabPage";
import { TeleRoomPage } from "@/pages/TeleSessionPage";
import { MarketSelector } from "@/components/MarketSelector";
import { WaitlistJoin } from "@/components/WaitlistJoin";
import { PrescriptionCard } from "@/components/PrescriptionCard";
import { setAnalyticsSink, track, flushAnalytics } from "@/lib/analytics";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async (v: string) => `data:image/png;base64,${btoa(v).slice(0, 12)}`) } }));

const flagsAwaiting = (keys: string[]) => http.get("/api/v1/flags/effective", () => HttpResponse.json({ market: "EG", version: 1, flags: Object.fromEntries(keys.map((k) => [k, { enabled: false, reason: "AWAITING_GATE", scope: "GATE" }])) }));
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();
const entry = (over = {}) => ({ id: "w1", providerId: "d1", doctor: { id: "d1", nameEn: "Dr Laila", nameAr: "د. ليلى", specialty: "dermatology", photoUrl: null }, clinicNameEn: "Nile Clinic", clinicNameAr: "عيادة النيل", typeId: "d1-first", preferredFrom: null, preferredTo: null, status: "OFFERED", expiresAt: soon(), offers: [{ id: "o1", startsAt: "2026-12-02T10:00:00Z", endsAt: "2026-12-02T10:20:00Z", status: "OFFERED", expiresAt: soon(), bookingId: null }], ...over });

describe("waitlist (BK-12)", () => {
  it("shows an offer in the inbox and accept turns it into the normal hold", async () => {
    let accepted = "";
    server.use(
      http.get("/api/v1/waitlist", () => HttpResponse.json([entry()])),
      http.post("/api/v1/waitlist/offers/:id/accept", ({ params }) => { accepted = String(params.id); return HttpResponse.json({ id: "bk9", status: "HELD" }); }),
    );
    renderApp(<Routes><Route path="/waitlist" element={<WaitlistPage />} /><Route path="/checkout/:id" element={<p>checkout page</p>} /></Routes>, { route: "/waitlist" });
    expect(await screen.findByTestId("offers-inbox")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("offer-accept"));
    expect(await screen.findByText("checkout page")).toBeInTheDocument();
    expect(accepted).toBe("o1");
  });

  it("empty state, and a taken slot keeps the patient on the list with a message", async () => {
    server.use(http.get("/api/v1/waitlist", () => HttpResponse.json([])));
    const { unmount } = renderApp(<WaitlistPage />);
    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    unmount();
    server.use(http.get("/api/v1/waitlist", () => HttpResponse.json([entry()])), http.post("/api/v1/waitlist/offers/:id/accept", () => HttpResponse.json({ code: "SLOT_TAKEN", message: "taken" }, { status: 409 })));
    renderApp(<WaitlistPage />);
    await userEvent.click(await screen.findByTestId("offer-accept"));
    await waitFor(() => expect(screen.getByTestId("offer-accept")).toBeEnabled());
    expect(screen.getByTestId("waitlist-entry")).toBeInTheDocument();
  });

  it("join from the no-slot state posts provider + visit type", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.get("/api/v1/waitlist", () => HttpResponse.json([])), http.post("/api/v1/waitlist", async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(entry({ status: "WAITING", offers: [] })); }));
    renderApp(<WaitlistJoin providerId="d1" typeId="d1-first" />);
    await userEvent.click(await screen.findByTestId("waitlist-join-btn"));
    await waitFor(() => expect(body).toMatchObject({ providerId: "d1", typeId: "d1-first" }));
  });
});

describe("waitlist 409 SLOTS_AVAILABLE", () => {
  it("shows the open slots and a book-directly action instead of joining", async () => {
    server.use(http.post("/api/v1/waitlist", () => HttpResponse.json({ code: "SLOTS_AVAILABLE", message: "open", nextSlots: [{ startsAt: "2026-12-02T10:00:00Z", endsAt: "2026-12-02T10:20:00Z" }], openSlotCount: 4 }, { status: 409 })));
    renderApp(<WaitlistJoin providerId="d1" typeId="d1-first" />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("waitlist-join-btn"));
    expect(await screen.findByTestId("waitlist-slots-available")).toBeInTheDocument();
    expect(screen.getByTestId("book-directly")).toBeInTheDocument();
  });
});

describe("records vault (RC-01..03)", () => {
  const vault = (readOnly: boolean) => http.get("/api/v1/me/vault", () => HttpResponse.json({ readOnly, items: [{ id: "r1", kind: "UPLOAD", title: "xray.png", source: "PATIENT", clinicId: null, dependantId: null, signedAt: null, hasFile: true, fileName: "xray.png", mimeType: "image/png", sizeBytes: 70, createdAt: "2026-11-19T20:00:00Z" }] }));

  it("flag OFF: read-only banner in Arabic, list stays visible, upload disabled", async () => {
    server.use(vault(true));
    renderApp(<RecordsPage />, { lang: "ar" });
    expect(await screen.findByTestId("vault-readonly")).toHaveTextContent("للقراءة فقط");
    expect(await screen.findByText("xray.png")).toBeInTheDocument();
    expect(screen.getByTestId("upload-open")).toBeDisabled();
    expect(screen.getByTestId("delete-record")).toBeEnabled(); // deleting is always allowed
  });

  it("delete asks for confirmation then calls the API", async () => {
    let deleted = "";
    server.use(vault(false), http.delete("/api/v1/me/vault/:id", ({ params }) => { deleted = String(params.id); return HttpResponse.json({ ok: true }); }));
    renderApp(<RecordsPage />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("delete-record"));
    await userEvent.click(await screen.findByTestId("confirm-delete"));
    await waitFor(() => expect(deleted).toBe("r1"));
  });

  it("consent centre: granting is a plain toggle, revoking warns that copies are deleted", async () => {
    const calls: unknown[] = [];
    server.use(
      vault(false),
      http.get("/api/v1/me/record-sharing", () => HttpResponse.json({ canGrant: true, scopes: [{ scope: "VISIT_SUMMARY", granted: true, updatedAt: null }, { scope: "PRESCRIPTIONS", granted: false, updatedAt: null }, { scope: "LAB_RESULTS", granted: false, updatedAt: null }, { scope: "SHARE_WITH_OTHER_CLINICS", granted: false, updatedAt: null }] })),
      http.put("/api/v1/me/record-sharing/:scope", async ({ params, request }) => { calls.push([params.scope, await request.json()]); return HttpResponse.json({ scope: params.scope, granted: false, updatedAt: null }); }),
    );
    renderApp(<RecordsPage />, { route: "/records?tab=sharing", lang: "en" });
    await userEvent.click(await screen.findByTestId("share-VISIT_SUMMARY"));
    expect(await screen.findByTestId("confirm-revoke")).toBeInTheDocument();
    expect(calls).toHaveLength(0); // nothing sent before confirmation
    await userEvent.click(screen.getByTestId("confirm-revoke"));
    await waitFor(() => expect(calls).toEqual([["VISIT_SUMMARY", { granted: false }]]));
  });

  it("grant is blocked with an explanation when canGrant is false", async () => {
    server.use(vault(false), http.get("/api/v1/me/record-sharing", () => HttpResponse.json({ canGrant: false, scopes: [{ scope: "VISIT_SUMMARY", granted: false, updatedAt: null }] })));
    renderApp(<RecordsPage />, { route: "/records?tab=sharing", lang: "en" });
    expect(await screen.findByTestId("sharing-paused")).toBeInTheDocument();
    expect(screen.getByTestId("share-VISIT_SUMMARY")).toBeDisabled();
  });

  it("prescription renders its verification QR and medicine lines", async () => {
    server.use(http.get("/api/v1/me/vault/:id", () => HttpResponse.json({ id: "rx1", kind: "PRESCRIPTION", title: "Prescription", source: "CLINIC", clinicId: "c1", dependantId: null, signedAt: "2026-11-19T10:00:00Z", hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: "2026-11-19T10:00:00Z", prescription: { items: [{ name: "Amoxicillin", strength: "500 mg" }], itemsAvailable: true }, verification: { token: "kxrx1.rx1.mac", qrPayload: "kxrx1.rx1.mac", verifyUrl: "http://x/api/v1/rx/verify?t=kxrx1.rx1.mac" } })));
    renderApp(<PrescriptionCard item={{ id: "rx1", kind: "PRESCRIPTION", title: "Prescription", source: "CLINIC", clinicId: "c1", dependantId: null, signedAt: "2026-11-19T10:00:00Z", hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: "2026-11-19T10:00:00Z" }} />, { lang: "en" });
    expect(await screen.findByTestId("rx-qr")).toHaveAttribute("src", expect.stringContaining("data:image/png"));
    expect(screen.getByTestId("rx-items")).toHaveTextContent("Amoxicillin");
  });
});

describe("pharmacy", () => {
  it("launch-locked: 'awaiting approval' in Arabic, no purchase UI", async () => {
    server.use(flagsAwaiting(["kiorex.pharmacy_orders"]));
    renderApp(<PharmacyPage />, { lang: "ar" });
    const s = await screen.findByTestId("feature-unavailable");
    expect(s).toHaveAttribute("data-awaiting", "true");
    expect(s).toHaveTextContent("بانتظار الاعتماد");
    expect(screen.queryByTestId("place-order")).not.toBeInTheDocument();
    expect(screen.getByTestId("my-orders-link")).toBeInTheDocument(); // history stays reachable
  });

  it("search → add to cart → place order lands on the order page with the payment panel", async () => {
    const cart = { pharmacyId: "ph_1", items: [{ sku: "PARA500", name: "Paracetamol 500mg", qty: 1, unitPriceMinor: 2500, rxRequired: false, available: true }], deliveryMethod: "PICKUP", prescriptionRecordId: null, subtotalMinor: 2500, deliveryFeeMinor: 0, totalMinor: 2500, currency: "EGP", rxRequired: false };
    let current: typeof cart | { items: [] } = { items: [] };
    const order = { id: "po1", status: "PENDING_PAYMENT", pharmacyId: "ph_1", items: cart.items, subtotalMinor: 2500, deliveryFeeMinor: 0, totalMinor: 2500, currency: "EGP", deliveryMethod: "PICKUP", rxStatus: "NOT_REQUIRED", rejectionReason: null, readyAt: null, dispensedAt: null, payment: { paymentId: "pay1", status: "CREATED", checkoutUrl: "http://localhost:4000/api/v1/pay/fake-checkout/pay1" }, createdAt: "2026-11-20T10:00:00Z" };
    server.use(
      http.get("/api/v1/pharmacy/pharmacies", () => HttpResponse.json([{ id: "ph_1", name: "Nile Pharmacy", pickup: true, deliveryEnabled: true, deliveryFeeMinor: 3000 }])),
      http.get("/api/v1/pharmacy/search", () => HttpResponse.json({ items: [{ pharmacyId: "ph_1", sku: "PARA500", name: "Paracetamol 500mg", priceMinor: 2500, rxRequired: false, available: true }] })),
      http.get("/api/v1/pharmacy/cart", () => HttpResponse.json(current)),
      http.put("/api/v1/pharmacy/cart", () => { current = cart; return HttpResponse.json(cart); }),
      http.post("/api/v1/pharmacy/orders", () => HttpResponse.json(order, { status: 201 })),
      http.get("/api/v1/pharmacy/orders/po1", () => HttpResponse.json(order)),
    );
    renderApp(<Routes><Route path="/pharmacy" element={<PharmacyPage />} /><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy", lang: "en" });
    await userEvent.click((await screen.findAllByTestId("pharmacy-option"))[0]);
    await userEvent.type(screen.getByTestId("medicine-search"), "para");
    await userEvent.click(screen.getByTestId("medicine-search-submit"));
    await userEvent.click(await screen.findByTestId("add-to-cart"));
    expect(await screen.findByTestId("cart-line")).toHaveTextContent("Paracetamol");
    await userEvent.click(screen.getByTestId("place-order"));
    expect(await screen.findByTestId("order-status")).toHaveTextContent("Awaiting payment");
    expect(screen.getByTestId("pay-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mock-notice")).toHaveAttribute("data-kind", "payment"); // sandbox checkout is called out honestly
    // sandbox checkout stays in this tab and carries a returnUrl so the patient lands back on the order
    expect(screen.getByTestId("pay-link")).not.toHaveAttribute("target");
    expect(screen.getByTestId("pay-link").getAttribute("href")).toContain("returnUrl=");
  });

  const orderState = (over: object) => http.get("/api/v1/pharmacy/orders/po2", () => HttpResponse.json({ id: "po2", status: "REJECTED", pharmacyId: "ph_1", items: [], subtotalMinor: 0, deliveryFeeMinor: 0, totalMinor: 0, currency: "EGP", deliveryMethod: "PICKUP", rxStatus: "NOT_REQUIRED", rejectionReason: "OUT_OF_STOCK", readyAt: null, dispensedAt: null, payment: { paymentId: "p", status: "REFUNDED", checkoutUrl: null }, createdAt: "2026-11-20T10:00:00Z", ...over }));
  it("delivery order shows the address and delivery wording (ready for delivery / delivered); pickup says collected", async () => {
    server.use(orderState({ status: "READY", deliveryMethod: "DELIVERY", deliveryAddress: { line1: "12 Road 9", area: "Maadi" }, rejectionReason: null, readyAt: "2026-11-23T10:00:00Z" }));
    const a = renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "en" });
    expect(await screen.findByTestId("order-status")).toHaveTextContent("Ready for delivery");
    expect(screen.getByTestId("order-address")).toHaveTextContent("12 Road 9, Maadi");
    a.unmount();
    server.use(orderState({ status: "DISPENSED", deliveryMethod: "PICKUP", rejectionReason: null, dispensedAt: "2026-11-23T11:00:00Z" }));
    renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "ar" });
    expect(await screen.findByTestId("order-status")).toHaveTextContent("تم الاستلام");
    expect(screen.queryByTestId("order-address")).not.toBeInTheDocument();
  });

  it("OUT_FOR_DELIVERY (1.8.0): delivery order shows the courier step in AR and EN, with the extra progress step", async () => {
    server.use(orderState({ status: "OUT_FOR_DELIVERY", deliveryMethod: "DELIVERY", deliveryAddress: { line1: "12 Road 9" }, rejectionReason: null, outForDeliveryAt: "2026-11-23T12:00:00Z", refund: null }));
    const a = renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "en" });
    expect(await screen.findByTestId("order-status")).toHaveTextContent("Out for delivery");
    expect(screen.getByTestId("order-out-for-delivery")).toHaveTextContent(/courier is on the way/);
    expect(within(screen.getByTestId("order-progress")).getAllByRole("listitem")).toHaveLength(6); // pending, paid, sent, ready, out for delivery, delivered
    expect(screen.queryByTestId("cancel-order")).not.toBeInTheDocument();
    a.unmount();
    renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "ar" });
    expect(await screen.findByTestId("order-status")).toHaveTextContent("خرج للتوصيل");
  });

  it("partially fulfilled order shows an itemised refund (Arabic names with English fallback)", async () => {
    const refund = { status: "SETTLED", currency: "EGP", goodsMinor: 5000, deliveryFeeMinor: 3000, totalMinor: 8000, fulfilledMinor: 4000, policyNote: "PROPOSED_DEFAULT delegated by founder 23 Nov 2026", refundedAt: "2026-11-23T12:30:00Z",
      lines: [{ sku: "PARA500", name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠", unitPriceMinor: 2500, qtyOrdered: 3, qtyFulfilled: 1, qtyRefunded: 2, refundMinor: 5000 }, { sku: "VITC", name: "Vitamin C 1000mg", unitPriceMinor: 4000, qtyOrdered: 1, qtyFulfilled: 1, qtyRefunded: 0, refundMinor: 0 }] };
    const items = [{ sku: "PARA500", name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠", qty: 3, unitPriceMinor: 2500, rxRequired: false, available: true }, { sku: "VITC", name: "Vitamin C 1000mg", qty: 1, unitPriceMinor: 4000, rxRequired: false, available: true }];
    server.use(orderState({ status: "PARTIALLY_FULFILLED", deliveryMethod: "DELIVERY", rejectionReason: null, dispensedAt: "2026-11-23T12:00:00Z", items, refund }));
    const a = renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "en" });
    expect(await screen.findByTestId("order-refund")).toBeInTheDocument();
    expect(screen.getByTestId("refund-status")).toHaveTextContent("Refunded");
    expect(within(screen.getByTestId("refund-lines")).getAllByRole("listitem")).toHaveLength(2); // the refunded line + the delivery fee; the fully filled line is not listed
    expect(screen.getByTestId("refund-lines")).toHaveTextContent("Paracetamol 500mg");
    expect(screen.getByTestId("refund-total")).toHaveTextContent("80");
    a.unmount();
    renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "ar" });
    expect(await screen.findByTestId("refund-lines")).toHaveTextContent("باراسيتامول ٥٠٠");
  });

  it("rejected order explains the automatic refund; cancelled shows the refund note", async () => {
    server.use(orderState({}));
    const a = renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "en" });
    expect(await screen.findByTestId("order-rejected")).toHaveTextContent("out of stock at the pharmacy"); // reason code is localised, never shown raw
    expect(screen.getByTestId("order-rejected")).toHaveTextContent(/refunded automatically/);
    expect(screen.queryByTestId("cancel-order")).not.toBeInTheDocument();
    a.unmount();
    server.use(orderState({ status: "CANCELLED", rejectionReason: null }));
    renderApp(<Routes><Route path="/pharmacy/orders/:id" element={<PharmacyOrderPage />} /></Routes>, { route: "/pharmacy/orders/po2", lang: "en" });
    expect(await screen.findByTestId("order-refunded")).toBeInTheDocument();
  });
});

describe("lab bookings", () => {
  it("launch-locked state in English", async () => {
    server.use(flagsAwaiting(["kiorex.lab_bookings"]));
    renderApp(<LabPage />, { lang: "en" });
    expect(await screen.findByTestId("feature-unavailable")).toHaveTextContent("Awaiting approval");
  });
  it("result delivered into the vault links to the record", async () => {
    server.use(http.get("/api/v1/lab/bookings/lb1", () => HttpResponse.json({ id: "lb1", status: "RESULT_RELEASED", labId: "lab_1", tests: [{ code: "CBC", name: "Complete blood count", priceMinor: 15000 }], collectionType: "HOME", slotStartsAt: "2026-12-01T09:00:00Z", slotEndsAt: "2026-12-01T10:00:00Z", subtotalMinor: 15000, collectionFeeMinor: 5000, totalMinor: 20000, currency: "EGP", resultRecordId: "rec9", rejectionReason: null, payment: null, createdAt: "2026-11-20T10:00:00Z" })));
    renderApp(<Routes><Route path="/lab/bookings/:id" element={<LabBookingPage />} /></Routes>, { route: "/lab/bookings/lb1", lang: "en" });
    expect(await screen.findByTestId("lab-result-link")).toHaveAttribute("href", "/records/rec9");
  });
});

describe("telemedicine room (mock video provider)", () => {
  it("joins, shows the mock-room notice and ends the call", async () => {
    const session = { id: "ts1", bookingId: "b1", providerId: "d1", status: "IN_PROGRESS", scheduledStartsAt: "2026-12-01T10:00:00Z", startedAt: "2026-12-01T10:00:00Z", endedAt: null, durationSec: null, consultFeeMinor: 0, joinOpensAt: "2026-12-01T09:45:00Z" };
    let ended = false;
    server.use(
      http.post("/api/v1/telemedicine/sessions/ts1/join", () => HttpResponse.json({ session, video: { token: "fake", room: "kx-room-ts1", url: "https://mock.invalid/room", expiresAt: soon(), role: "patient", provider: "mock" } })),
      http.post("/api/v1/telemedicine/sessions/ts1/end", () => { ended = true; return HttpResponse.json({ ...session, status: "ENDED" }); }),
      http.get("/api/v1/telemedicine/sessions/ts1", () => HttpResponse.json({ ...session, status: "ENDED", durationSec: 600 })),
    );
    renderApp(<Routes><Route path="/telemedicine/:id/room" element={<TeleRoomPage />} /><Route path="/telemedicine/:id" element={<p>session page</p>} /></Routes>, { route: "/telemedicine/ts1/room", lang: "en" });
    expect(await screen.findByTestId("tele-room")).toBeInTheDocument();
    expect(screen.getByTestId("mock-notice")).toHaveAttribute("data-kind", "video");
    await userEvent.click(screen.getByTestId("tele-mic"));
    expect(screen.getByTestId("tele-mic")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("tele-end"));
    await waitFor(() => expect(ended).toBe(true));
    expect(await screen.findByText("session page")).toBeInTheDocument();
  });
});

describe("market selector (market.<cc>.live)", () => {
  it("is hidden while only one market is live (Egypt launch), even if others are gated", async () => {
    server.use(http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true, flag: "market.eg.live", state: "LIVE" }, { code: "SA", live: false, flag: "market.sa.live", state: "AWAITING_GATE" }])));
    const { container } = renderApp(<MarketSelector />, { lang: "en" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("market-select")).toBeNull();
    expect(screen.queryByText(/country|market/i)).toBeNull();
    expect(container.querySelector("label")).toBeNull();
  });

  it("is visible once two markets are live; gated markets are listed as coming soon", async () => {
    server.use(http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true, flag: "market.eg.live", state: "LIVE" }, { code: "SA", live: true, flag: "market.sa.live", state: "LIVE" }, { code: "AE", live: false, flag: "market.ae.live", state: "AWAITING_GATE" }])));
    renderApp(<MarketSelector />, { lang: "en" });
    const sel = await screen.findByTestId("market-select");
    await waitFor(() => expect(within(sel).getAllByRole("option")).toHaveLength(3));
    const ae = within(sel).getAllByRole("option")[2] as HTMLOptionElement;
    expect(ae).toBeDisabled(); expect(ae.textContent).toMatch(/soon/);
  });
});

describe("client analytics", () => {
  it("sends only whitelisted names and props, never free text", async () => {
    setAnalyticsSink(null); flushAnalytics(); // drop events queued by earlier tests
    const got: unknown[] = [];
    setAnalyticsSink((b) => got.push(...b));
    track("waitlist_joined", { providerId: "d1", symptoms: "chest pain", q: "free text" });
    track("search_started", { specialtyCode: "other" });
    flushAnalytics();
    setAnalyticsSink(null);
    expect(got).toEqual([{ name: "waitlist_joined", props: { providerId: "d1" } }, { name: "search_started", props: {} }]);
  });
});

describe("bilingual search and names (1.8.0)", () => {
  it("pharmacy search results show the Arabic name and dosage form in Arabic and the English ones in English; a medicine with no Arabic name falls back", async () => {
    server.use(
      http.get("/api/v1/pharmacy/pharmacies", () => HttpResponse.json([{ id: "ph_1", name: "Nile Pharmacy", pickup: true, deliveryEnabled: true, deliveryFeeMinor: 3000 }])),
      http.get("/api/v1/pharmacy/search", () => HttpResponse.json({ items: [
        { pharmacyId: "ph_1", sku: "PARA500", name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠", strength: "500mg", form: "tablet", formAr: "أقراص", priceMinor: 2500, rxRequired: false, available: true },
        { pharmacyId: "ph_1", sku: "VITC", name: "Vitamin C 1000mg", strength: "1000mg", form: "effervescent tablet", priceMinor: 4000, rxRequired: false, available: true },
      ] })),
    );
    const a = renderApp(<PharmacyPage />, { lang: "ar" });
    await userEvent.click((await screen.findAllByTestId("pharmacy-option"))[0]);
    await userEvent.type(screen.getByTestId("medicine-search"), "باراسيتامول"); // an Arabic query is sent as typed; the pharmacy matches Arabic and English
    await userEvent.click(screen.getByTestId("medicine-search-submit"));
    const rows = await screen.findAllByTestId("medicine");
    expect(rows[0]).toHaveTextContent("باراسيتامول ٥٠٠");
    expect(rows[0]).toHaveTextContent("أقراص");
    expect(rows[1]).toHaveTextContent("Vitamin C 1000mg"); // fallback, never blank
    a.unmount();
    renderApp(<PharmacyPage />, { lang: "en" });
    await userEvent.click((await screen.findAllByTestId("pharmacy-option"))[0]);
    await userEvent.type(screen.getByTestId("medicine-search"), "para");
    await userEvent.click(screen.getByTestId("medicine-search-submit"));
    const en = await screen.findAllByTestId("medicine");
    expect(en[0]).toHaveTextContent("Paracetamol 500mg");
    expect(en[0]).not.toHaveTextContent("باراسيتامول");
  });

  it("lab tests show Arabic name and preparation in Arabic with English fallback", async () => {
    server.use(http.get("/api/v1/lab/tests", () => HttpResponse.json({ items: [
      { labId: "lab_1", labName: "Nile Lab", code: "CBC", name: "Complete blood count", nameAr: "صورة دم كاملة", priceMinor: 15000, sampleType: "blood", sampleTypeAr: "دم", homeCollection: true, preparation: "No preparation needed", preparationAr: "لا يلزم أي تحضير" },
      { labId: "lab_1", labName: "Nile Lab", code: "TSH", name: "Thyroid stimulating hormone", priceMinor: 20000, sampleType: "blood", homeCollection: false },
    ] })));
    renderApp(<LabPage />, { lang: "ar" });
    const rows = await screen.findAllByTestId("lab-test");
    expect(rows[0]).toHaveTextContent("صورة دم كاملة");
    expect(rows[0]).toHaveTextContent("لا يلزم أي تحضير");
    expect(rows[1]).toHaveTextContent("Thyroid stimulating hormone");
  });
});
