import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import SafetyPage from "@/pages/SafetyPage";
import HeldDepositsPage from "@/pages/HeldDepositsPage";
import HomeGatePage from "@/pages/HomeGatePage";

const iso = (offsetSec: number) => new Date(Date.now() + offsetSec * 1000).toISOString();
const alert = (o: Record<string, unknown> = {}) => ({
  id: "al1", alertId: "ext1", clinicId: "c1", kind: "SOS", status: "RAISED", bookingId: "b1", district: "nasr-city", raisedAt: iso(-10), receivedAt: iso(-9),
  slo: { deadlineAt: iso(50), deliveredAt: null, deliveryLagSeconds: null, met: null, seconds: 60, breached: false, receiveLagSeconds: 1 }, delivery: {}, acknowledgedAt: null, acknowledgedBy: null, ackLagSeconds: null,
  escalatedAt: null, resolvedAt: null, needsEscalation: false, providerName: "Nurse Mona", clinicPhone: "+20100", actions: [], escalationLevel: 0, ageSeconds: 10, ...o,
});
const summary = (o = {}) => ({ medianDeliverySeconds: 4, p95DeliverySeconds: 9, byKind: [], windowDays: 7, total: 3, open: 2, unacknowledged: 1, sloBreaches: 1, unsafeAborts: 1, depositsHeldForReview: 1, deliveryMode: "mock", sloSeconds: 60, ackEscalateMinutes: 10, ...o });

describe("safety console (KXMOP12)", () => {
  it("shows the alert feed with live 60 s SLO timers: counting, breached and met", async () => {
    server.use(
      http.get("/api/v1/admin/safety/summary", () => HttpResponse.json(summary())),
      http.get("/api/v1/admin/safety/alerts", () => HttpResponse.json({ items: [
        alert(),
        alert({ id: "al2", slo: { deadlineAt: iso(-5), deliveredAt: null, deliveryLagSeconds: null, met: null, seconds: 60, breached: true, receiveLagSeconds: 1 } }),
        alert({ id: "al3", status: "ACKNOWLEDGED", slo: { deadlineAt: iso(-20), deliveredAt: iso(-40), deliveryLagSeconds: 12, met: true, seconds: 60, breached: false, receiveLagSeconds: 1 } }),
      ] })),
    );
    renderOps(<SafetyPage />);
    await screen.findAllByTestId("slo");
    const states = screen.getAllByTestId("slo").map((e) => e.getAttribute("data-state"));
    expect(states).toEqual(["counting", "breached", "met"]);
    expect(screen.getByTestId("safety-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("safety-mock-note")).toBeInTheDocument();
  });
  it("acknowledge sends the note; escalate and resolve hit their endpoints", async () => {
    const calls: string[] = []; let body: unknown;
    server.use(
      http.get("/api/v1/admin/safety/summary", () => HttpResponse.json(summary())),
      http.get("/api/v1/admin/safety/alerts", () => HttpResponse.json({ items: [alert({ needsEscalation: true })] })),
      http.post("/api/v1/admin/safety/alerts/:id/:action", async ({ params, request }) => { calls.push(String(params.action)); body = await request.json(); return HttpResponse.json(alert({ status: "ACKNOWLEDGED" })); }),
    );
    renderOps(<SafetyPage />);
    expect(await screen.findByTestId("needs-escalation")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("ack-al1"));
    await userEvent.type(await screen.findByTestId("safety-note"), "on it");
    await userEvent.click(screen.getByTestId("safety-confirm"));
    await waitFor(() => expect(calls).toEqual(["acknowledge"]));
    expect(body).toEqual({ note: "on it" });
    await userEvent.click(await screen.findByTestId("esc-al1"));
    await userEvent.click(await screen.findByTestId("safety-confirm"));
    await waitFor(() => expect(calls).toEqual(["acknowledge", "escalate"]));
    await userEvent.click(await screen.findByTestId("res-al1"));
    await userEvent.click(await screen.findByTestId("safety-confirm"));
    await waitFor(() => expect(calls).toEqual(["acknowledge", "escalate", "resolve"]));
  });
  it("empty and error states, Arabic", async () => {
    server.use(http.get("/api/v1/admin/safety/summary", () => HttpResponse.json(summary({ open: 0, deliveryMode: "real" }))), http.get("/api/v1/admin/safety/alerts", () => HttpResponse.json({ items: [] })));
    const { unmount } = renderOps(<SafetyPage />, { lang: "ar" });
    expect(await screen.findByText("لا توجد تنبيهات")).toBeInTheDocument(); unmount();
    server.use(http.get("/api/v1/admin/safety/summary", () => HttpResponse.json({ code: "X", message: "x" }, { status: 500 })), http.get("/api/v1/admin/safety/alerts", () => HttpResponse.json({ code: "X", message: "x" }, { status: 500 })));
    renderOps(<SafetyPage />);
    expect((await screen.findAllByTestId("error-state")).length).toBeGreaterThan(0);
  });
});

describe("held deposits (KXMPAY07)", () => {
  const row = { bookingId: "b1", reason: "UNSAFE_ABORT", heldForReviewAt: iso(-7200), ageHours: 2, providerId: "p1", district: "nasr-city", abortedAt: iso(-7300), paymentId: "pay1", clinicId: "c1", amountMinor: 20000, currency: "EGP" };
  it("needs a reason, then releases or refunds", async () => {
    const calls: { path: string; body: unknown }[] = [];
    server.use(
      http.get("/api/v1/admin/payments/held-for-review", () => HttpResponse.json([row])),
      http.post("/api/v1/admin/payments/:id/review/:decision", async ({ params, request }) => { calls.push({ path: String(params.decision), body: await request.json() }); return HttpResponse.json({ outcome: "RELEASED_TO_PROVIDER", paymentId: "pay1", amountMinor: 20000 }); }),
    );
    renderOps(<HeldDepositsPage />);
    await userEvent.click(await screen.findByTestId("release-pay1"));
    expect(screen.getByTestId("review-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("review-reason"), "provider was in danger");
    await userEvent.click(screen.getByTestId("review-confirm"));
    await waitFor(() => expect(calls).toEqual([{ path: "release", body: { reason: "provider was in danger" } }]));
    await userEvent.click(await screen.findByTestId("refund-pay1"));
    await userEvent.type(await screen.findByTestId("review-reason"), "patient unsafe");
    await userEvent.click(screen.getByTestId("review-confirm"));
    await waitFor(() => expect(calls[1]).toEqual({ path: "refund", body: { reason: "patient unsafe" } }));
  });
  it("empty queue", async () => {
    server.use(http.get("/api/v1/admin/payments/held-for-review", () => HttpResponse.json([])));
    renderOps(<HeldDepositsPage />, { lang: "ar" });
    expect(await screen.findByText("لا توجد عربونات بانتظار المراجعة")).toBeInTheDocument();
  });
});

describe("home-visit gate metric (KXMOP06)", () => {
  it("shows per-cluster progress and never presents the metric as satisfying a gate", async () => {
    server.use(http.get("/api/v1/admin/home-visits/gate-metric", () => HttpResponse.json({
      threshold: 50, clusterBasis: "governorate", safetyConsoleLive: true, anyMet: true, allMet: false, gates: { GHV1: { recordedFor: ["a", "b"], requiredFor: ["a", "b"] }, GHV2: { recordedFor: ["a"], requiredFor: ["a", "b"] } },
      clusters: [{ cluster: "cairo", homeEnabledProviders: 55, threshold: 50, met: true, byCareType: { HOME_NURSING: 40, PHYSIOTHERAPY: 15 } }, { cluster: "giza", homeEnabledProviders: 12, threshold: 50, met: false, byCareType: {} }],
    })));
    renderOps(<HomeGatePage />, { lang: "en" });
    expect(await screen.findByTestId("cluster-met")).toBeInTheDocument();
    expect(screen.getByTestId("cluster-short")).toHaveTextContent("38 short");
    expect(screen.getByTestId("gate-GHV1")).toHaveAttribute("data-recorded", "true");
    expect(screen.getByTestId("gate-GHV2")).toHaveAttribute("data-recorded", "false");
  });
});

import FlagsPage from "@/pages/FlagsPage";
describe("flag catalogue shows launch gates (ADR-024)", () => {
  it("lists the gate board and records one gate for every flag that lists it", async () => {
    let put: unknown;
    server.use(
      http.get("/api/v1/admin/gates", () => HttpResponse.json({ gates: [
        { gateId: "GHV1", flags: [{ key: "clinic.home_visits", requiredGates: ["GHV1", "GHV2"], evidence: null }, { key: "kiorex.home_visits", requiredGates: ["GHV1", "GHV2"], evidence: { approver: "Counsel", approvedOn: iso(-86400) } }] },
        { gateId: "GKN1", flags: [{ key: "nurse.care_plans", requiredGates: ["GKN1"], evidence: null }] },
      ] })),
      http.put("/api/v1/admin/gates/:id", async ({ request }) => { put = await request.json(); return HttpResponse.json({ gateId: "GKN1", flags: ["nurse.care_plans"], version: 2 }); }),
    );
    renderOps(<FlagsPage />);
    await userEvent.click(await screen.findByTestId("tab-gates"));
    expect(await screen.findByTestId("board-GHV1")).toBeInTheDocument();
    expect(screen.getByTestId("board-GKN1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("record-GKN1"));
    await userEvent.type(await screen.findByLabelText(/Approver/), "CMO");
    await userEvent.type(screen.getByLabelText(/Approved on/), "2026-11-01");
    await userEvent.type(screen.getByLabelText(/Document link/), "https://docs.example/gkn1");
    await userEvent.click(screen.getByTestId("gate-all-submit"));
    await waitFor(() => expect(put).toMatchObject({ approver: "CMO", documentUrl: "https://docs.example/gkn1" }));
  });
});
