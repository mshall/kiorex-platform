import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import MessagingPage from "@/pages/MessagingPage";
import FeesPage from "@/pages/FeesPage";
import OrdersPage from "@/pages/OrdersPage";
import OperationsPage from "@/pages/OperationsPage";
import PolicyPage from "@/pages/PolicyPage";

const msg = (over = {}) => ({ id: "m1", messageId: null, channel: "WHATSAPP", direction: "OUT", mode: "mock", sub: "s1", recipientMasked: "+2010****0001", templateId: "booking_confirmed", body: "Your booking is confirmed", status: "SENT", providerRef: null, error: null, createdAt: "2026-11-20T10:00:00Z", sentAt: "2026-11-20T10:00:00Z", deliveredAt: null, readAt: null, failedAt: null, locale: "ar", ...over });
const stats = (mode: "mock" | "real") => http.get("/api/v1/admin/messaging/stats", () => HttpResponse.json({ mode, channels: ["EMAIL", "WHATSAPP", "SMS", "PUSH"], counts: [{ channel: "WHATSAPP", direction: "OUT", status: "SENT", count: 3 }, { channel: "SMS", direction: "OUT", status: "FAILED", count: 1 }] }));

describe("messaging log", () => {
  it("mock mode: flagged as mock, simulate delivery sends the chosen state", async () => {
    let body: unknown;
    server.use(stats("mock"), http.get("/api/v1/admin/messaging/log", () => HttpResponse.json({ mode: "mock", items: [msg()] })), http.post("/api/v1/admin/messaging/log/:id/simulate", async ({ request }) => { body = await request.json(); return HttpResponse.json(msg({ status: "DELIVERED" })); }));
    renderOps(<MessagingPage />);
    expect(await screen.findByTestId("messaging-mock-note")).toBeInTheDocument();
    expect(screen.getByTestId("messaging-mode")).toHaveTextContent("Mock mode");
    await userEvent.click(await screen.findByTestId("sim-DELIVERED"));
    await waitFor(() => expect(body).toEqual({ state: "DELIVERED" }));
    expect(within(screen.getByTestId("messaging-tiles")).getByText("3")).toBeInTheDocument();
  });
  it("real mode: no simulate controls and no message body leak", async () => {
    server.use(stats("real"), http.get("/api/v1/admin/messaging/log", () => HttpResponse.json({ mode: "real", items: [msg({ body: null, mode: "real" })] })));
    renderOps(<MessagingPage />);
    expect(await screen.findByTestId("msg-status")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-DELIVERED")).not.toBeInTheDocument();
    expect(screen.queryByTestId("messaging-mock-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delivery-tick")).not.toBeInTheDocument();
  });
  it("renders the Arabic locale", async () => {
    server.use(stats("mock"), http.get("/api/v1/admin/messaging/log", () => HttpResponse.json({ mode: "mock", items: [] })));
    renderOps(<MessagingPage />, { lang: "ar" });
    expect(await screen.findByText("سجل الرسائل")).toBeInTheDocument();
  });
});

describe("fee statements", () => {
  it("shows per-partner lines, the VAT config line and totals; exports are enabled only with data", async () => {
    server.use(http.get("/api/v1/admin/fee-statements", () => HttpResponse.json({ from: "2026-10-20T00:00:00Z", to: "2026-11-20T00:00:00Z", currency: "EGP", vatBps: 1400, vatNote: "VAT rate from configuration", lines: [{ partner: "pharmacy", orders: 4, feeMinor: 10000, vatBps: 1400, vatMinor: 1400, totalMinor: 11400 }], totals: { feeMinor: 10000, vatMinor: 1400, totalMinor: 11400 } })));
    renderOps(<FeesPage />);
    expect(await screen.findByTestId("vat-note")).toHaveTextContent("VAT rate from configuration");
    expect(screen.getAllByTestId("row")).toHaveLength(1);
    expect(screen.getByTestId("export-fees")).toBeEnabled();
  });
  it("empty statement disables export", async () => {
    server.use(http.get("/api/v1/admin/fee-statements", () => HttpResponse.json({ from: "2026-10-20T00:00:00Z", to: "2026-11-20T00:00:00Z", currency: "EGP", vatBps: 0, vatNote: "VAT rate not configured", lines: [], totals: { feeMinor: 0, vatMinor: 0, totalMinor: 0 } })));
    renderOps(<FeesPage />);
    expect(await screen.findByText("No fees in this period")).toBeInTheDocument();
    expect(screen.getByTestId("export-fees")).toBeDisabled();
  });
});

describe("order monitors", () => {
  const order = { id: "po1", status: "PAID", pharmacyId: "ph_1", items: [{ sku: "A", name: "Amoxicillin", qty: 1, unitPriceMinor: 8000, rxRequired: true, available: true }], subtotalMinor: 8000, deliveryFeeMinor: 0, totalMinor: 8000, currency: "EGP", deliveryMethod: "PICKUP", rxStatus: "PENDING", rejectionReason: null, readyAt: null, dispensedAt: null, payment: null, createdAt: "2026-11-20T10:00:00Z", sub: "s1", platformFeeMinor: 320, takeRateBps: 400 };
  it("a PAID pharmacy order can be resubmitted after confirmation", async () => {
    let hit = "";
    server.use(http.get("/api/v1/admin/pharmacy/orders", () => HttpResponse.json([order])), http.post("/api/v1/admin/pharmacy/orders/:id/resubmit", ({ params }) => { hit = String(params.id); return HttpResponse.json({ status: "SUBMITTED" }); }));
    renderOps(<OrdersPage />);
    await userEvent.click(await screen.findByTestId("resubmit"));
    expect(hit).toBe(""); // not before confirming
    await userEvent.click(await screen.findByTestId("confirm-resubmit"));
    await waitFor(() => expect(hit).toBe("po1"));
  });
  it("PARTIAL_REVIEW orders can be settled with the market policy (pro-rata refund)", async () => {
    let hit = "";
    const partial = { id: "po7", status: "PARTIAL_REVIEW", sub: "s1", totalMinor: 14500, platformFeeMinor: 0, takeRateBps: 0, currency: "EGP", createdAt: "2026-11-20T10:00:00Z", rejectionReason: null, items: [{ sku: "A", name: "Panadol", qty: 3, unitPriceMinor: 2500 }] };
    server.use(http.get("/api/v1/admin/pharmacy/orders", () => HttpResponse.json([partial])), http.post("/api/v1/admin/pharmacy/orders/:id/resolve-partial", ({ params }) => { hit = String(params.id); return HttpResponse.json({ order: {}, refundTotalMinor: 5000 }); }));
    renderOps(<OrdersPage />);
    await userEvent.click(await screen.findByTestId("settle-partial"));
    await waitFor(() => expect(hit).toBe("po7"));
    expect(await screen.findByText(/refunded/)).toBeInTheDocument();
  });
  it("launch-locked vertical shows awaiting-approval state, not an error", async () => {
    server.use(http.get("/api/v1/admin/pharmacy/orders", () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "off", key: "kiorex.pharmacy_orders", scope: "GATE" }, { status: 403 })));
    renderOps(<OrdersPage />);
    expect(await screen.findByTestId("feature-unavailable")).toBeInTheDocument();
  });
});

describe("operations", () => {
  it("runs the waitlist scan and shows counts", async () => {
    server.use(http.post("/api/v1/admin/waitlist/scan", () => HttpResponse.json({ offersCreated: 2, offersExpired: 1 })));
    renderOps(<OperationsPage />);
    await userEvent.click(screen.getByTestId("waitlist-scan"));
    expect(await screen.findByTestId("scan-result")).toHaveTextContent("2");
  });
});

const policies = (over: Record<string, unknown> = {}) => ({
  market: "EG", proposedDefaultNote: "PROPOSED_DEFAULT delegated by founder 23 Nov 2026",
  items: [
    { key: "pay.deposit_default", titleEn: "Default deposit", titleAr: "العربون الافتراضي", descriptionEn: "d", descriptionAr: "و", value: { enabled: true, percentBps: 1000, capMajor: 200 }, source: "PROPOSED_DEFAULT", proposedDefault: true, note: "PROPOSED_DEFAULT delegated by founder 23 Nov 2026", defaults: { enabled: true, percentBps: 1000, capMajor: 200 }, scopes: ["GLOBAL", "MARKET", "ORG"], overrides: [], ...over },
    { key: "pharmacy.partial_fulfilment", titleEn: "Partial pharmacy orders", titleAr: "الطلبات الجزئية للصيدلية", descriptionEn: "d", descriptionAr: "و", value: { mode: "PRO_RATA_REFUND", refundDeliveryFeeIfNotDelivered: true, releaseFulfilledToPharmacy: true }, source: "PROPOSED_DEFAULT", proposedDefault: true, note: "PROPOSED_DEFAULT delegated by founder 23 Nov 2026", defaults: {}, scopes: ["GLOBAL", "MARKET", "ORG"], overrides: [] },
  ],
});

describe("market policy (PROPOSED_DEFAULT, founder-delegated 23 Nov 2026)", () => {
  it("shows the default deposit (10% capped at 200 EGP) marked as a proposed default, in English and Arabic", async () => {
    server.use(http.get("/api/v1/admin/policy", () => HttpResponse.json(policies())));
    const a = renderOps(<PolicyPage />);
    const dep = await screen.findByTestId("policy-pay.deposit_default");
    expect(within(dep).getByTestId("proposed-default")).toHaveTextContent("Proposed default");
    expect(within(dep).getByTestId("policy-summary")).toHaveTextContent("10% of the consultation fee, capped at 200 EGP");
    expect(within(dep).getByTestId("proposed-note")).toHaveTextContent("PROPOSED_DEFAULT delegated by founder 23 Nov 2026");
    expect(within(screen.getByTestId("policy-pharmacy.partial_fulfilment")).getByTestId("policy-summary")).toHaveTextContent("pro-rata");
    a.unmount();
    renderOps(<PolicyPage />, { lang: "ar" });
    expect(await screen.findByText("العربون الافتراضي")).toBeInTheDocument();
  });
  it("super admin saves a market override and resets it", async () => {
    let put: unknown; let cleared = "";
    server.use(
      http.get("/api/v1/admin/policy", () => HttpResponse.json(policies())),
      http.put("/api/v1/admin/policy/:key", async ({ request, params }) => { put = { key: params.key, ...(await request.json() as object) }; return HttpResponse.json({ key: params.key, scope: "MARKET", scopeId: "EG", value: {} }); }),
      http.delete("/api/v1/admin/policy/:key", ({ request }) => { cleared = new URL(request.url).search; return HttpResponse.json({ cleared: 1 }); }),
    );
    renderOps(<PolicyPage />);
    const ed = await screen.findByTestId("policy-editor-pay.deposit_default");
    const pct = within(ed).getByTestId("dep-percent"); await userEvent.clear(pct); await userEvent.type(pct, "20");
    await userEvent.click(within(ed).getByTestId("policy-save"));
    await waitFor(() => expect(put).toMatchObject({ key: "pay.deposit_default", scope: "MARKET", scopeId: "EG", value: { enabled: true, percentBps: 2000, capMajor: 200 } }));
    server.use(http.get("/api/v1/admin/policy", () => HttpResponse.json(policies({ source: "MARKET", proposedDefault: false, overrides: [{ scope: "MARKET", scopeId: "EG", value: { percentBps: 2000 }, note: null, updatedBy: "adm1", updatedAt: "2026-11-23T10:00:00Z" }] }))));
    await userEvent.click(within(await screen.findByTestId("policy-editor-pay.deposit_default")).getByTestId("policy-save")); // refetch brings the override row
    await userEvent.click(await screen.findByTestId("policy-reset"));
    await waitFor(() => expect(cleared).toContain("scope=MARKET"));
  });
});
