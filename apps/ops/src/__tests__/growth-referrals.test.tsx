import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import ReferralsPage from "@/pages/growth/referrals/ReferralsPage";
import ReferralReviewPage from "@/pages/growth/referrals/ReferralReviewPage";
import RewardsPage from "@/pages/growth/rewards/RewardsPage";
import RewardLotPage from "@/pages/growth/rewards/RewardLotPage";
import RewardsFinancePage from "@/pages/growth/rewards/RewardsFinancePage";
import i18nJson from "@/i18n/growth.referrals.json";

const G = "/api/v1/ops/growth"; const A = "/api/v1/admin/growth";
const caps = (o: Record<string, boolean> = {}) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: true, writeConfig: true, approveConfig: true, reviewFraud: true, manage: true, manageCampaigns: true, ...o } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const overview = (f: Record<string, unknown> = {}) => ({ funnel: { relationships: 120, signedUp: 80, booked: 40, qualified: 30, rejected: "<10", expired: 12, onHold: "<10", ...f }, queue: [{ id: "rel_1", status: "BOOKED", createdAt: "2027-01-02T10:00:00Z", holdUntil: "2027-01-09T10:00:00Z" }] });
const detail = (o: Record<string, unknown> = {}) => ({ id: "rel_1", status: "BOOKED", reviewState: "HOLD", rejectReason: null, createdAt: "2027-01-02T10:00:00Z", completedAt: null, holdUntil: "2027-01-09T10:00:00Z", qualifiedAt: null, ruleVersionId: "gcv_9", referrerRef: "a1b2c3d4e5f6", refereeRef: "f6e5d4c3b2a1", checks: [{ key: "RF_SELF", passed: true, detail: { match: false }, at: "2027-01-02T10:00:00Z" }, { key: "VISIT_COMPLETED", passed: false, detail: null, at: "2027-01-02T10:00:00Z" }], signals: [{ id: "s1", ruleId: "RF_FARM", score: 40, reviewStatus: "OPEN" }], ...o });
const lot = (o: Record<string, unknown> = {}) => ({ id: "rwl_1", patientRef: "p1p1p1p1p1p1", kind: "REFERRER", mode: "COUPON", funding: "PLATFORM_MARKETING", status: "ACTIVE", amountMinor: 15_000, currency: "EGP", availableMinor: 15_000, heldMinor: 0, reservedMinor: 0, expiresAt: "2027-09-01T00:00:00Z", createdAt: "2027-01-01T00:00:00Z", campaignId: null, ruleVersionId: "gcv_1", ...o });

describe("referral and rewards i18n", () => {
  it("English and Arabic carry the same keys (plural forms aside)", () => { const e = new Set(flat(i18nJson.en).map(base)); const a = new Set(flat(i18nJson.ar).map(base)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); });
});

describe("Referrals overview (GRW-P2-B3)", () => {
  it("shows funnel counts with k >= 10 masking, rates only when both sides are visible, the queue and no contact data", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals`, () => HttpResponse.json(overview())));
    renderOps(<ReferralsPage />, { route: "/growth/referrals" });
    const funnel = await screen.findByTestId("referrals-funnel"); expect(within(funnel).getByText("120")).toBeInTheDocument();
    expect(screen.getByTestId("rate-qualified")).toHaveTextContent("25"); expect(screen.getByTestId("rate-hold")).toHaveTextContent("<10");
    expect(screen.getByRole("link", { name: "rel_1" })).toHaveAttribute("href", "/growth/referrals/rel_1"); expect(screen.getByTestId("referrals-privacy")).toHaveTextContent(/no name, phone or e-mail/i);
    expect(screen.getByTestId("referral-rules-link")).toHaveAttribute("href", "/growth/config");
  });
  it("lookup opens the reviewer view by id", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals`, () => HttpResponse.json(overview())));
    renderOps(<Routes><Route path="/growth/referrals" element={<ReferralsPage />} /><Route path="/growth/referrals/:id" element={<p data-testid="opened">opened</p>} /></Routes>, { route: "/growth/referrals" });
    await userEvent.type(await screen.findByTestId("referral-lookup"), "rel_77"); await userEvent.click(screen.getByTestId("referral-lookup-go")); expect(await screen.findByTestId("opened")).toBeInTheDocument();
  });
  it("renders in Arabic and shows the error state with a retry", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderOps(<ReferralsPage />, { route: "/growth/referrals", lang: "ar" }); expect(await screen.findByRole("button", { name: /إعادة|retry|حاول/i })).toBeInTheDocument();
  });
});

describe("Referral review (GRW-P2-B3)", () => {
  const page = () => <Routes><Route path="/growth/referrals/:id" element={<ReferralReviewPage />} /></Routes>;
  it("shows checks, signals and opaque references; a release posts the decision with the note", async () => {
    let body: unknown = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals/rel_1`, () => HttpResponse.json(detail())), http.post(`${A}/referrals/rel_1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ok: true }); }));
    renderOps(page(), { route: "/growth/referrals/rel_1" });
    expect(await screen.findByTestId("referrer-ref")).toHaveTextContent("a1b2c3d4e5f6"); expect(screen.getByText("RF_FARM")).toBeInTheDocument(); expect(screen.getByText("RF_SELF")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\+20\d{9}|@[a-z]+\./);
    await userEvent.type(screen.getByTestId("decision-note"), "family, legit"); await userEvent.click(screen.getByTestId("decision-release"));
    await waitFor(() => expect(body).toEqual({ decision: "RELEASE_HOLD", note: "family, legit" }));
  });
  it("an override that the server says needs a second person tells the reviewer; a read-only role cannot decide", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals/rel_1`, () => HttpResponse.json(detail())), http.post(`${A}/referrals/rel_1/decision`, () => HttpResponse.json({ pendingSecondApprover: true })));
    const a = renderOps(page(), { route: "/growth/referrals/rel_1" }); await userEvent.click(await screen.findByTestId("decision-override")); expect(await screen.findByTestId("decision-message")).toHaveTextContent(/different super admin/i); a.unmount();
    server.use(http.get(`${G}/access`, () => caps({ reviewFraud: false, manage: false })));
    renderOps(page(), { route: "/growth/referrals/rel_1" }); expect(await screen.findByTestId("referral-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("decision-reject")).toBeNull();
  });
  it("an unknown id shows a neutral not-found", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/referrals/nope`, () => HttpResponse.json({ error: "REFERRAL_NOT_FOUND" })));
    renderOps(<Routes><Route path="/growth/referrals/:id" element={<ReferralReviewPage />} /></Routes>, { route: "/growth/referrals/nope" }); expect(await screen.findByTestId("referral-notfound")).toBeInTheDocument();
  });
});

describe("Rewards (GRW-P2-B3)", () => {
  const ovr = (o: Record<string, unknown> = {}) => ({ mode: "COUPON", effectiveMode: "COUPON", ruleVersionId: "gcv_1", source: "ACTIVE", flags: { rewards: true, patientCredit: false, refundAsCredit: false, family: false, goodwill: false, referral: true }, banner: null, openApprovals: 1, ...o });
  it("shows mode, switches, the no-deposit banner, lots with patient references only, and the approval queue with approve and reject", async () => {
    let decided: unknown = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/rewards`, () => HttpResponse.json(ovr({ banner: "NO_DEPOSIT_CONFIGURED" }))), http.get(`${A}/rewards/lots`, () => HttpResponse.json([lot(), lot({ id: "rwl_2", status: "HELD", availableMinor: 0, heldMinor: 5000 })])),
      http.get(`${A}/rewards/approvals`, () => HttpResponse.json([{ id: "apr_1", kind: "MANUAL_ISSUE", amountMinor: 50_000, reason: "late cancel", bookingId: null, ticketRef: "T-1", requestedBy: "adm_a", createdAt: "2027-01-01T00:00:00Z" }])),
      http.post(`${A}/rewards/approvals/apr_1/decide`, async ({ request }) => { decided = await request.json(); return HttpResponse.json({}); }));
    renderOps(<RewardsPage />, { route: "/growth/rewards" });
    expect(await screen.findByTestId("rewards-no-deposit")).toBeInTheDocument(); expect(screen.getByTestId("rewards-overview")).toHaveTextContent(/Coupon/);
    expect(await screen.findByRole("link", { name: "rwl_1" })).toHaveAttribute("href", "/growth/rewards/lots/rwl_1"); expect(screen.getAllByText("p1p1p1p1p1p1").length).toBe(2);
    await userEvent.click(await screen.findByTestId("approve-apr_1")); await waitFor(() => expect(decided).toMatchObject({ decision: "APPROVED" }));
  });
  it("the status filter reaches the API and manual issue validates before it posts", async () => {
    const seen: string[] = []; let posted: unknown = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/rewards`, () => HttpResponse.json(ovr())), http.get(`${A}/rewards/approvals`, () => HttpResponse.json([])), http.get(`${A}/rewards/lots`, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json([]); }),
      http.post(`${A}/rewards/manual-issue`, async ({ request }) => { posted = await request.json(); return HttpResponse.json({ approvalId: "apr_9" }); }));
    renderOps(<RewardsPage />, { route: "/growth/rewards" });
    await userEvent.selectOptions(await screen.findByTestId("lot-status-filter"), "HELD"); await waitFor(() => expect(seen.some((s) => s.includes("status=HELD"))).toBe(true));
    await userEvent.click(screen.getByTestId("manual-issue-open")); const submit = await screen.findByTestId("mi-submit"); expect(submit).toBeDisabled();
    await userEvent.type(screen.getByTestId("mi-sub"), "pat_1234"); await userEvent.type(screen.getByTestId("mi-amount"), "75"); await userEvent.type(screen.getByTestId("mi-reason"), "Provider cancelled late"); expect(submit).toBeEnabled();
    await userEvent.click(submit); await waitFor(() => expect(posted).toEqual({ sub: "pat_1234", amountMinor: 7500, reason: "Provider cancelled late" }));
  });
  it("a plain ops admin sees no manual issue button", async () => {
    server.use(http.get(`${G}/access`, () => caps({ manage: false })), http.get(`${A}/rewards`, () => HttpResponse.json(ovr())), http.get(`${A}/rewards/approvals`, () => HttpResponse.json([])), http.get(`${A}/rewards/lots`, () => HttpResponse.json([])));
    renderOps(<RewardsPage />, { route: "/growth/rewards" }); expect(await screen.findByTestId("rewards-overview")).toBeInTheDocument(); expect(screen.queryByTestId("manual-issue-open")).toBeNull();
  });
  it("a lot page shows the append-only ledger and hold and release", async () => {
    let held = false;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/rewards/lots`, () => HttpResponse.json([lot()])), http.get(`${A}/rewards/lots/rwl_1/ledger`, () => HttpResponse.json([{ id: "e1", type: "ISSUE", amountMinor: 15_000, reasonCode: "REFERRER_QUALIFIED", bookingId: "bk_1", refundId: null, actor: "system", idempotencyKey: "rwd:issue:1", createdAt: "2027-01-01T00:00:00Z" }])),
      http.post(`${A}/rewards/lots/rwl_1/hold`, () => { held = true; return HttpResponse.json({}); }));
    renderOps(<Routes><Route path="/growth/rewards/lots/:id" element={<RewardLotPage />} /></Routes>, { route: "/growth/rewards/lots/rwl_1" });
    expect(await screen.findByText("REFERRER_QUALIFIED")).toBeInTheDocument(); expect(screen.getByTestId("lot-release")).toBeDisabled(); await userEvent.click(screen.getByTestId("lot-hold")); await waitFor(() => expect(held).toBe(true));
  });
});

describe("Rewards finance (GRW-P2-B3)", () => {
  const report = { month: "2027-01", rows: [{ market: "EG", currency: "EGP", kind: "REFERRER", funding: "PLATFORM_MARKETING", ruleVersionId: "gcv_1", campaignId: null, issuedMinor: 150_000, redeemedMinor: 50_000, reversedMinor: 0, expiredMinor: 0 }], totals: { issuedMinor: 150_000, redeemedMinor: 50_000, reversedMinor: 0, expiredMinor: 0 }, outstanding: [{ market: "EG", currency: "EGP", platformFundedMinor: 100_000, serviceRecoveryMinor: 0, refundCreditLiabilityMinor: 20_000, totalMinor: 120_000 }], recoverableLossMinor: 0, kiorexRevenueEffectMinor: 0, note: "x" };
  it("shows totals, the patient's own refund credit apart, the zero revenue effect statement and exports the CSV through the authenticated client", async () => {
    let csvAsked = false;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/rewards/finance`, () => HttpResponse.json(report)), http.get(`${A}/rewards/finance.csv`, () => { csvAsked = true; return new HttpResponse("month,market\n", { headers: { "content-type": "text/csv" } }); }));
    URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => undefined;
    renderOps(<RewardsFinancePage />, { route: "/growth/rewards/finance" });
    expect(await screen.findByTestId("finance-totals")).toHaveTextContent(/1,500|١٬٥٠٠/); expect(screen.getByTestId("refund-credit-liability")).toHaveTextContent(/200/); expect(screen.getByTestId("finance-note")).toHaveTextContent(/never revenue/i);
    await userEvent.click(screen.getByTestId("finance-csv")); await waitFor(() => expect(csvAsked).toBe(true));
  });
  it("a role without the finance view gets a plain explanation", async () => {
    server.use(http.get(`${G}/access`, () => caps({ readFinance: false })), http.get(`${A}/rewards/finance`, () => HttpResponse.json({ code: "FORBIDDEN", message: "no" }, { status: 403 })));
    renderOps(<RewardsFinancePage />, { route: "/growth/rewards/finance" }); expect(await screen.findByTestId("finance-forbidden")).toBeInTheDocument();
  });
});
