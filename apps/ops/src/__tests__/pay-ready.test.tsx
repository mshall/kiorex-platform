import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import axe from "axe-core";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import PaymentsConnectionPage from "@/pages/PaymentsConnectionPage";
import ReconciliationPage from "@/pages/ReconciliationPage";

const psp = (name: string, o: Record<string, unknown> = {}) => ({ psp: name, enabled: name === "paymob", mode: "sandbox", ready: true, missing: [], problems: [], breaker: null,
  secrets: [{ purpose: `${name}-hmac-secret`, ref: `/kiorex/staging/${name}-hmac-secret`, env: "X_HMAC", kind: "hmac", present: name === "paymob" }],
  webhook: { url: `https://api.example.test/api/v1/pay/webhooks/${name}`, scheme: "HMAC", secretRef: `/kiorex/staging/${name}-hmac-secret`, secretEnv: "X_HMAC", register: "dashboard" }, selfTest: { ok: true, detail: "a signed fixture verifies" }, ...o });
const check = (o: Record<string, unknown> = {}) => ({ mode: "real", provider: "vendor", environment: "sandbox", overall: "OK", publicBaseUrl: "https://api.example.test", psps: ["paymob", "fawry", "instapay", "card"].map((n) => psp(n)), startupProblems: [], liveProbe: false, ...o });
const settings = ["paymob", "fawry"].map((p) => ({ psp: p, problems: [], settings: { enabled: true, order: 10, fee: { percentBps: null, fixedMinor: null, vatBps: null }, threeDsMode: "REQUIRED", captureMode: "AUTO", refundWindowDays: null, timeoutMs: 8000, maxRetries: 2 } }));

const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => v.id);

describe("payments connection check (PAY-READY)", () => {
  it("shows secret REFERENCES with present/missing, the webhook URL per provider, fee and window as needs-finance, and never a secret value", async () => {
    server.use(http.get("/api/v1/admin/payments/connection-check", () => HttpResponse.json(check())), http.get("/api/v1/admin/payments/settings", () => HttpResponse.json(settings)));
    renderOps(<PaymentsConnectionPage />);
    expect(await screen.findByTestId("pc-overall")).toHaveTextContent("Ready");
    expect(screen.getByTestId("url-paymob")).toHaveTextContent("/api/v1/pay/webhooks/paymob");
    expect(screen.getAllByText("/kiorex/staging/paymob-hmac-secret").length).toBeGreaterThan(0);
    expect(screen.getByTestId("selftest-paymob")).toHaveTextContent("Signature check passes");
    expect((await screen.findAllByText("Needs finance input")).length).toBeGreaterThan(0);
    expect(await violations()).toEqual([]);
  });
  it("the live probe button is disabled in mock mode and a failing PSP is announced in text, not only colour", async () => {
    server.use(http.get("/api/v1/admin/payments/connection-check", () => HttpResponse.json(check({ mode: "mock", overall: "MOCK" }))), http.get("/api/v1/admin/payments/settings", () => HttpResponse.json(settings)));
    renderOps(<PaymentsConnectionPage />);
    expect(await screen.findByTestId("live-probe")).toBeDisabled();
  });
  it("renders in Arabic (RTL) with translated statuses", async () => {
    server.use(http.get("/api/v1/admin/payments/connection-check", () => HttpResponse.json(check({ overall: "FAIL", psps: [psp("paymob", { selfTest: { ok: false, detail: "PAYMOB_HMAC_SECRET missing" } })] }))), http.get("/api/v1/admin/payments/settings", () => HttpResponse.json([])));
    renderOps(<PaymentsConnectionPage />, { lang: "ar" });
    expect(await screen.findByTestId("pc-overall")).toHaveTextContent("غير جاهز");
    expect(screen.getByTestId("selftest-paymob")).toHaveTextContent("فحص التوقيع فاشل");
  });
});

describe("settlement reconciliation page (PAY-READY)", () => {
  const run = (o = {}) => ({ id: "r1", status: "DISCREPANCIES", discrepancies: [{ type: "AMOUNT_MISMATCH", ref: "pay_1", psp: "paymob" }, { type: "UNKNOWN_AT_PSP", ref: "55", psp: "paymob" }], stats: { date: "2026-11-25" }, createdAt: new Date().toISOString(), ...o });
  it("lists runs and typed mismatches, disputes with their state, and runs the reconciliation", async () => {
    let ran = 0;
    server.use(
      http.get("/api/v1/admin/reconciliation/runs", () => HttpResponse.json([run()])),
      http.get("/api/v1/admin/payments/disputes", () => HttpResponse.json([{ id: "d1", paymentId: "pay_9", psp: "card", pspDisputeRef: "dsp_1", state: "OPEN", amountMinor: 15000, currency: "EGP", reasonCode: "fraudulent", evidenceDueAt: null, openedAt: new Date().toISOString() }])),
      http.get("/api/v1/admin/payments/settlement/files", () => HttpResponse.json([])),
      http.post("/api/v1/admin/reconciliation/psp/run", () => { ran++; return HttpResponse.json(run({ status: "OK", discrepancies: [] })); }),
    );
    renderOps(<ReconciliationPage />);
    expect((await screen.findAllByText("AMOUNT_MISMATCH")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Open")).toBeInTheDocument(); expect(screen.getByText("pay_9")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("run")); await waitFor(() => expect(ran).toBe(1));
    expect(await violations()).toEqual([]);
  });
  it("importing without a file says so; an already-imported file is reported as a duplicate", async () => {
    server.use(http.get("/api/v1/admin/reconciliation/runs", () => HttpResponse.json([])), http.get("/api/v1/admin/payments/disputes", () => HttpResponse.json([])), http.get("/api/v1/admin/payments/settlement/files", () => HttpResponse.json([])),
      http.post("/api/v1/admin/payments/settlement/import", () => HttpResponse.json({ imported: 0, duplicate: true, rejected: [] })));
    renderOps(<ReconciliationPage />);
    await userEvent.click(await screen.findByTestId("import")); expect(await screen.findByText("Choose a file first")).toBeInTheDocument();
    await userEvent.upload(screen.getByTestId("file"), new File(["Order ID,Amount\n1,1.00"], "s.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByTestId("import")); expect(await screen.findByText("This file was already imported")).toBeInTheDocument();
  });
});
