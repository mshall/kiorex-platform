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
