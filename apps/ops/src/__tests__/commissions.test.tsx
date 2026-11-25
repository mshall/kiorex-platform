import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import axe from "axe-core";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CommissionsPage from "@/pages/CommissionsPage";

const B = "/api/v1/admin/commissions";
const caps = (o: Record<string, boolean> = {}) => ({ read: true, export: true, operate: true, proposeConfig: false, approveConfig: false, chooseProvider: false, ...o });
const summary = { figures: { collectedMinor: 15000, deductedMinor: 6000, invoiceOpenMinor: 4000, overdueMinor: 0, disputedOpenMinor: 0, creditDueMinor: 0, claimsInRunsMinor: 25000, invoicedMinor: 4000, invoicePaidMinor: 0 }, counts: {} };
const claim = { id: "ccl_1", orgRef: "org_alpha", chargeId: "chg_1", appointmentId: "apt_1", amountMinor: 15000, decisionAmountMinor: 15000, feeBasisMinor: 30000, sponsoredDiscountMinor: 5000, basisPolicyVersion: "BP1", policyVersion: "CP1@base", currency: "EGP", chargeStatus: "CONFIRMED", disputeStatus: null, collectionStatus: "COLLECTED", collectedMinor: 15000, reversedAfterCollection: false, runId: "crn_1" };
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => v.id);

describe("commissions console (COM-1)", () => {
  it("finance sees the money cards, the ledger with the fee-basis fields, and the page is accessible", async () => {
    server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(caps())), http.get(`${B}/summary`, () => HttpResponse.json(summary)), http.get(`${B}/claims`, () => HttpResponse.json({ total: 1, items: [claim] })));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    expect(await screen.findByTestId("com-card-collected")).toHaveTextContent("150");
    expect(screen.getByTestId("com-card-deducted")).toHaveTextContent("60");
    await user.click(screen.getByTestId("com-tab-ledger"));
    expect(await screen.findByText("chg_1")).toBeInTheDocument();
    expect(screen.getByText("(BP1)")).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });
  it("a role without the finance view sees no money, and no figure request is made", async () => {
    let asked = false;
    server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(caps({ read: false, export: false, operate: false }))), http.get(`${B}/summary`, () => { asked = true; return HttpResponse.json(summary); }));
    renderOps(<CommissionsPage />);
    expect(await screen.findByTestId("com-no-access")).toBeInTheDocument();
    expect(asked).toBe(false);
  });
  it("drills a collection run to its attempts and status timeline and shows clean books", async () => {
    const run = { id: "crn_1", orgRef: "org_alpha", periodKey: "2026-12-05", status: "COLLECTED", mode: "AUTO_CHARGE_SAVED_METHOD", modeRequested: "AUTO_CHARGE_SAVED_METHOD", fallbackReason: null, provider: "paymob", currency: "EGP", claimsCount: 1, claimsMinor: 15000, collectedMinor: 15000, deductedMinor: 0, invoicedMinor: 0, paidMinor: 0, invoiceNo: null };
    server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(caps())), http.get(`${B}/runs`, () => HttpResponse.json({ total: 1, items: [run] })),
      http.get(`${B}/runs/crn_1`, () => HttpResponse.json({ run, claims: [claim], attempts: [{ id: "a1", attemptNo: 1, kind: "CHARGE", status: "SUCCEEDED", amountMinor: 15000, failureCode: null, providerRef: "mockchg_1", payoutRef: null }], timeline: [{ id: "t1", at: "2026-12-07T10:00:00Z", event: "CHARGE_SUCCEEDED", actor: "system", detail: {} }], findings: [] })));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-collections"));
    await user.click(await screen.findByText("org_alpha"));
    expect(await screen.findByTestId("com-run-clean")).toBeInTheDocument();
    expect(screen.getByTestId("com-timeline")).toHaveTextContent("CHARGE_SUCCEEDED");
  });
  it("export is requested with the active organisation filter; the run button posts the trigger", async () => {
    const hits: string[] = []; let body: unknown;
    server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(caps())), http.get(`${B}/summary`, () => HttpResponse.json(summary)), http.get(`${B}/orgs`, () => HttpResponse.json([{ orgRef: "org_alpha", market: "EG", currency: "EGP", claims: 1, claimsMinor: 15000, collectedMinor: 15000, provider: "paymob", openRuns: 0 }])),
      http.get(`${B}/orgs/org_alpha`, () => HttpResponse.json({ config: { settings: {}, missing: ["mode"] }, provider: "paymob", providersAvailable: ["paymob"] })),
      http.get(`${B}/claims`, ({ request }) => { hits.push(new URL(request.url).search); return HttpResponse.json({ total: 0, items: [] }); }),
      http.post(`${B}/runs/trigger`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ outcomes: [] }); }));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-orgs")); await user.click(await screen.findByText("org_alpha"));
    expect(await screen.findByTestId("com-org-panel")).toHaveTextContent("mode");
    await user.click(screen.getByTestId("com-tab-ledger"));
    await waitFor(() => expect(hits.some((h) => h.includes("org=org_alpha"))).toBe(true));
    await user.click(screen.getByTestId("com-run"));
    await waitFor(() => expect(body).toEqual({ orgRef: "org_alpha" }));
  });
  it("renders Arabic (RTL) with translated tabs and cards", async () => {
    server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(caps())), http.get(`${B}/summary`, () => HttpResponse.json(summary)));
    renderOps(<CommissionsPage />, { lang: "ar" });
    expect(await screen.findByText("دفتر العمولات")).toBeInTheDocument();
    expect(await screen.findByText("فواتير مفتوحة")).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });
});
