import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import axe from "axe-core";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import PayOpsPage from "@/pages/PayOpsPage";

const sig = { id: "pms_1", pspRef: "BK2", reference: "typo", amountMinor: 7000, currency: "EGP", confidence: 0.62, decision: "REVIEW", reasons: ["AMOUNT_EXACT"], candidates: [{ targetId: "pay_abc" }], payerMasked: "Ah**an" };
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => v.id);

describe("Pay matching and risk (ops)", () => {
  it("lists the review queue, confirms with the suggested payment, and is accessible", async () => {
    let confirmed: unknown = null;
    server.use(http.get("/api/v1/admin/payments/matching/queue", () => HttpResponse.json([sig])), http.post("/api/v1/admin/payments/matching/pms_1/confirm", async ({ request }) => { confirmed = await request.json(); return HttpResponse.json({ id: "pms_1", status: "CONFIRMED" }); }));
    renderOps(<PayOpsPage />);
    expect(await screen.findByText("BK2 / typo")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-pms_1"));
    await waitFor(() => expect(confirmed).toEqual({ targetId: "pay_abc" }));
    expect(await violations()).toEqual([]);
  });
  it("shows a finance-only message when the role is missing", async () => {
    server.use(http.get("/api/v1/admin/payments/matching/queue", () => HttpResponse.json({ code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderOps(<PayOpsPage />);
    expect(await screen.findByTestId("finance-only")).toBeInTheDocument();
  });
  it("fraud tab says scores never block, in Arabic RTL too", async () => {
    server.use(http.get("/api/v1/admin/payments/fraud/queue", () => HttpResponse.json([{ id: "pfa_1", paymentId: "pay_x", score: 70, band: "HIGH", signals: [{ rule: "VELOCITY", detail: "x" }], mode: "SHADOW" }])));
    renderOps(<PayOpsPage />, { lang: "ar" });
    await userEvent.click(await screen.findByTestId("tab-fraud"));
    expect(await screen.findByTestId("shadow-note")).toHaveTextContent("لا تمنع دفعة");
    expect(await screen.findByText("VELOCITY")).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });
});
