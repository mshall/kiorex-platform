import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import axe from "axe-core";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CommissionPolicyPage from "@/pages/CommissionPolicyPage";

const B = "/api/v1/admin/commissions";
const caps = (o: object = {}) => ({ read: true, export: true, operate: true, proposeConfig: false, approveConfig: false, ...o });
const DEF = { status: "NOT_REVIEWED", reviewerName: "", documentId: "", reviewedOn: "", conditions: "", collectionModes: [], payoutRoutes: [] };
const gates = (allowed = false) => [...["NET_FROM_PAYOUT", "AUTO_CHARGE_SAVED_METHOD", "INVOICE_AND_COLLECT"].map((key) => ({ kind: "COLLECTION_MODE", key, allowed, reason: "COUNSEL_NOT_REVIEWED", status: "NOT_REVIEWED", conditions: null })), ...["PAYMOB", "FAWRY", "INSTAPAY", "CARD_GATEWAY", "BANK_IPN"].map((key) => ({ kind: "PAYOUT_ROUTE", key, allowed, reason: "COUNSEL_NOT_REVIEWED", status: "NOT_REVIEWED", conditions: null }))];
const state = (o: object = {}) => ({ market: "EG", paymentMode: "mock", realBlocked: 8, gates: gates(),
  counsel: { record: DEF, version: null, effectiveFrom: null, source: "DEFAULT", pending: null, history: [] },
  disclosure: { disclosure: { rateDisclosure: { en: "", ar: "" }, termsSummary: { en: "", ar: "" }, showOverrideReason: false }, version: null, wordingSet: false, missing: { rateDisclosure: ["en", "ar"], termsSummary: ["en", "ar"] }, source: "DEFAULT", pending: null, history: [] }, ...o });
const serve = (c: object, s: object) => server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(c)), http.get(`${B}/policy`, () => HttpResponse.json({ markets: ["EG", "SA"] })), http.get(`${B}/policy/EG`, () => HttpResponse.json(s)));
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => v.id);

describe("commission policy page (COM-3)", () => {
  it("ships nothing: NOT_REVIEWED, every real-money gate blocked with a reason, 'wording not set', founder direction without a legal claim; a read-only role has no proposal button", async () => {
    serve(caps(), state());
    renderOps(<CommissionPolicyPage />);
    expect(await screen.findByTestId("counsel-current")).toHaveTextContent(/not reviewed/i);
    const rows = within(screen.getByTestId("policy-gates")).getAllByTestId(/^gate-/);
    expect(rows).toHaveLength(8);
    for (const r of rows) { expect(within(r).getByText(/blocked/i)).toBeInTheDocument(); expect(within(r).getByText(/Counsel has not reviewed/i)).toBeInTheDocument(); }
    expect(screen.getByTestId("wording-not-set")).toBeInTheDocument();
    expect(screen.getByTestId("founder-direction")).toHaveTextContent(/not legal clearance/i);
    expect(screen.queryByTestId("counsel-open")).toBeNull(); expect(screen.queryByTestId("disclosure-open")).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it("a super admin proposes a counsel record: an approval needs reviewer, document id and date; the request carries them and a reason", async () => {
    serve(caps({ proposeConfig: true }), state());
    let sent: Record<string, unknown> | null = null;
    server.use(http.post(`${B}/policy/EG/propose`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: "v1" }); }));
    const user = userEvent.setup(); renderOps(<CommissionPolicyPage />);
    await user.click(await screen.findByTestId("counsel-open"));
    await user.selectOptions(screen.getByTestId("counsel-status"), "APPROVED");
    expect(screen.getByTestId("counsel-submit")).toBeDisabled();
    await user.type(screen.getByTestId("counsel-reviewer"), "Test Counsel"); await user.type(screen.getByTestId("counsel-document"), "DOC-1");
    await user.type(screen.getByTestId("counsel-date"), "2026-12-01"); await user.type(screen.getByTestId("counsel-reason"), "recorded after review");
    await user.click(screen.getByLabelText(/INVOICE_AND_COLLECT|invoice/i));
    await user.click(screen.getByTestId("counsel-submit"));
    await waitFor(() => expect(sent).toMatchObject({ kind: "COMMISSION_COUNSEL_SIGNOFF", reason: "recorded after review", payload: { status: "APPROVED", reviewerName: "Test Counsel", documentId: "DOC-1", reviewedOn: "2026-12-01", collectionModes: ["INVOICE_AND_COLLECT"] } }));
  });

  it("disclosure: wording entered in both languages is shown as entered; the proposal form sends AR and EN text and the reason-visibility switch", async () => {
    serve(caps({ proposeConfig: true, approveConfig: true }), state());
    let sent: Record<string, unknown> | null = null;
    server.use(http.post(`${B}/policy/EG/propose`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: "v2" }); }));
    const user = userEvent.setup(); renderOps(<CommissionPolicyPage />);
    await user.click(await screen.findByTestId("disclosure-open"));
    await user.type(screen.getByTestId("disclosure-rateDisclosure-en"), "text typed by counsel"); await user.type(screen.getByTestId("disclosure-rateDisclosure-ar"), "نص");
    await user.click(screen.getByTestId("disclosure-show-reason")); await user.type(screen.getByTestId("disclosure-reason"), "counsel text");
    await user.click(screen.getByTestId("disclosure-submit"));
    await waitFor(() => expect(sent).toMatchObject({ kind: "COMMISSION_DISCLOSURE", payload: { rateDisclosure: { en: "text typed by counsel", ar: "نص" }, showOverrideReason: true } }));
  });

  it("a pending proposal can be approved by a checker; the settlement card shows both sides' figures including cash-visit commission and the reconciliation status", async () => {
    const pending = { id: "gcv_1", kind: "COMMISSION_COUNSEL_SIGNOFF", version: 1, status: "PENDING_APPROVAL", payload: { ...DEF, status: "REJECTED" }, effectiveFrom: null, createdBy: "sa1", approvedBy: null, reason: "x" };
    serve(caps({ approveConfig: true, export: true }), state({ counsel: { record: DEF, version: null, effectiveFrom: null, source: "DEFAULT", pending, history: [pending] } }));
    let decided: unknown = null;
    server.use(http.post(`${B}/policy/versions/gcv_1/decide`, async ({ request }) => { decided = await request.json(); return HttpResponse.json({}); }),
      http.get(`${B}/settlement-statement/org_alpha`, () => HttpResponse.json({ orgRef: "org_alpha", currency: "EGP", onlineCollectionsMinor: 30000, cashVisitCommissionAccruedMinor: 4000, cashVisitCommissionNettedMinor: 0, cashVisitCommissionOpenMinor: 4000, deductions: { commissionMinor: 10000, feesMinor: null, refundsMinor: 0, chargebacksMinor: 0 }, netPayableMinor: 20000, paidByBankTransferMinor: 20000, reconciliation: "MATCHED", payouts: [{ payoutRef: "po_1", bankReference: "po_1", reconciliation: "MATCHED", cashMinor: 20000 }] })));
    const user = userEvent.setup(); renderOps(<CommissionPolicyPage />);
    await user.click(await screen.findByTestId("policy-approve"));
    await waitFor(() => expect(decided).toEqual({ approve: true }));
    await user.type(screen.getByTestId("settlement-org"), "org_alpha"); await user.click(screen.getByTestId("settlement-go"));
    const f = await screen.findByTestId("settlement-figures");
    expect(f).toHaveTextContent(/cash-visit commission accrued/i); expect(f).toHaveTextContent(/matched/i);
  });
});
