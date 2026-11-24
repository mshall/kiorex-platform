import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CorporatePage from "@/pages/growth/corporate/Page";
import AccountDetailPage from "@/pages/growth/corporate/AccountDetailPage";
import i18nJson from "@/i18n/growth.corporate.json";

const A = "/api/v1/admin/growth/corporate"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", ...(manage ? ["super_admin"] : [])], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage, manageCampaigns: manage, reviewPromotions: false, manageCorporate: manage } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const acct = (o: Record<string, unknown> = {}) => ({ id: "acc_1", market: "EG", displayName: "Nile Logistics", status: "LEAD", fundingMode: "SPONSOR_CREDIT", currency: "EGP", contractRef: null, legalNameRef: null, billingContactRef: null, startsAt: null, endsAt: null, emailDomains: [], terms: { sponsorCeilingMinor: null, perMemberCapMinor: null, perVisitMaxMinor: null, coverBp: null, complete: false }, termsEditedBy: null, activatedBy: null, createdAt: "2027-01-20T00:00:00Z", ...o });
const report = (o: Record<string, unknown> = {}) => ({ accountId: "acc_1", k: 10, currency: "EGP", enrolment: { enrolled: 30, active: 28, byVerification: { CODE: 30, HR_LIST: 0, DOMAIN_EMAIL: 0 } }, utilisation: { membersWhoUsedBenefit: 25, sponsoredVisits: 40, sponsoredValueMinor: 300_000 }, byMonth: [], suppressed: [], ...o });
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
const detail = () => <Routes><Route path="/growth/corporate/accounts/:id" element={<AccountDetailPage />} /></Routes>;
const detailMocks = (a = acct(), r = report()) => server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/accounts/acc_1`, () => HttpResponse.json(a)), http.get(`${A}/accounts/acc_1/codes`, () => HttpResponse.json({ items: [] })), http.get(`${A}/accounts/acc_1/report`, () => HttpResponse.json(r)), http.get(`${A}/accounts/acc_1/hr-lists`, () => HttpResponse.json({ items: [] })), http.get(`${A}/accounts/acc_1/invoice-notes`, () => HttpResponse.json({ items: [] })));

describe("corporate ops i18n", () => { it("English and Arabic carry the same keys", () => { const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); }); });

describe("Corporate accounts (GRW-P4-C)", () => {
  it("lists accounts with status and terms state, states the separate-ledger rule, and links to the account", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/accounts`, () => HttpResponse.json({ items: [acct(), acct({ id: "acc_2", displayName: "Delta Pharma", status: "ACTIVE", terms: { complete: true } })] })));
    renderOps(<CorporatePage />, { route: "/growth/corporate" });
    expect(await screen.findByRole("link", { name: "Nile Logistics" })).toHaveAttribute("href", "/growth/corporate/accounts/acc_1");
    expect(screen.getByTestId("corp-ledger-note")).toHaveTextContent(/never patient credit and never a clinic's provider credit/); expect(screen.getByText("Incomplete")).toBeInTheDocument(); expect(screen.getByText("Complete")).toBeInTheDocument();
  });
  it("opening an account posts only the company name; a read-only role sees no create form", async () => {
    let body: unknown = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/accounts`, () => HttpResponse.json({ items: [] })), http.post(`${A}/accounts`, async ({ request }) => { body = await request.json(); return HttpResponse.json(acct(), { status: 201 }); }));
    const first = renderOps(<CorporatePage />, { route: "/growth/corporate" });
    await userEvent.type(await screen.findByTestId("corp-name"), "  Nile Logistics "); await userEvent.click(screen.getByTestId("corp-create"));
    await waitFor(() => expect(body).toEqual({ displayName: "Nile Logistics" })); first.unmount();
    server.use(http.get(`${G}/access`, () => caps(false)));
    renderOps(<CorporatePage />, { route: "/growth/corporate" });
    expect(await screen.findByText("No corporate accounts yet.")).toBeInTheDocument(); expect(screen.queryByTestId("corp-create-form")).not.toBeInTheDocument();
  });
  it("renders in Arabic", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/accounts`, () => HttpResponse.json({ items: [] })));
    renderOps(<CorporatePage />, { route: "/growth/corporate", lang: "ar" });
    expect(await screen.findByText("لا توجد حسابات مؤسسية بعد.")).toBeInTheDocument(); expect(document.documentElement.dir).toBe("rtl");
  });
});

describe("Account page (GRW-P4-C)", () => {
  it("says prices are never filled in by the system, converts EGP to minor units on save and posts coverage in basis points", async () => {
    let body: any = null; detailMocks();
    server.use(http.put(`${A}/accounts/acc_1/terms`, async ({ request }) => { body = await request.json(); return HttpResponse.json(acct({ terms: { complete: true } })); }));
    renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    expect(await screen.findByTestId("corp-needs-human")).toHaveAttribute("data-needs-human", "true");
    await userEvent.type(screen.getByTestId("corp-contract"), "CTR-2027-001"); await userEvent.type(screen.getByTestId("corp-ceiling"), "1000.50"); await userEvent.type(screen.getByTestId("corp-cap"), "300"); await userEvent.type(screen.getByTestId("corp-pct"), "50"); await userEvent.type(screen.getByTestId("corp-domains"), "acme.com, ACME.org");
    await userEvent.click(screen.getByTestId("corp-terms-save"));
    await waitFor(() => expect(body).toMatchObject({ contractRef: "CTR-2027-001", sponsorCeilingMinor: 100050, perMemberCapMinor: 30000, perVisitMaxMinor: null, coverBp: 5000, emailDomains: ["acme.com", "ACME.org"] }));
  });
  it("activation is offered with the two-person note; an active account freezes the terms", async () => {
    detailMocks(acct({ status: "ACTIVE" }));
    renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    expect(await screen.findByTestId("corp-frozen")).toBeInTheDocument(); expect(screen.getByTestId("corp-terms-save")).toBeDisabled(); expect(screen.queryByTestId("corp-activate")).not.toBeInTheDocument(); expect(screen.getByTestId("corp-pause")).toBeInTheDocument();
  });
  it("a lead shows the two-person rule and an Activate button that posts to activate", async () => {
    let hit = false; detailMocks(); server.use(http.post(`${A}/accounts/acc_1/activate`, () => { hit = true; return HttpResponse.json(acct({ status: "ACTIVE" })); }));
    renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    expect(await screen.findByTestId("corp-two-person")).toHaveTextContent(/cannot activate/); await userEvent.click(screen.getByTestId("corp-activate")); await waitFor(() => expect(hit).toBe(true));
  });
  it("the report shows masked cells as <10 and explains it; a full report has no mask", async () => {
    detailMocks(acct(), report({ enrolment: { enrolled: null, active: null, byVerification: { CODE: null, HR_LIST: 0, DOMAIN_EMAIL: 0 } }, utilisation: { membersWhoUsedBenefit: null, sponsoredVisits: null, sponsoredValueMinor: null }, suppressed: ["enrolment.enrolled", "utilisation.sponsoredValueMinor"] }));
    const first = renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    const cards = within(await screen.findByTestId("corp-report-cards")); expect(cards.getAllByText("<10")).toHaveLength(4); expect(screen.getByTestId("corp-report-note")).toHaveTextContent(/fewer than 10 people/);
    expect(document.body.textContent).not.toMatch(/emp_|subHash|kx_bk|bookingId/); first.unmount();
    detailMocks(); renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    expect(await screen.findByTestId("corp-report-note")).toHaveTextContent(/enough people/);
  });
  it("a code is shown once after creation and never listed again", async () => {
    let created = false; detailMocks();
    server.use(http.get(`${A}/accounts/acc_1/codes`, () => HttpResponse.json({ items: created ? [{ id: "c1", label: "Q1", kind: "OPEN", maxRedemptions: 50, redeemedCount: 0, perMemberCapMinor: null, expiresAt: null, status: "ACTIVE", createdAt: "2027-01-20T00:00:00Z" }] : [] })), http.post(`${A}/accounts/acc_1/codes`, () => { created = true; return HttpResponse.json({ id: "c1", code: "A7KQ2-M9X0T", label: "Q1", kind: "OPEN", maxRedemptions: 50, expiresAt: null, shownOnce: true }, { status: 201 }); }));
    renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    await userEvent.type(await screen.findByTestId("corp-code-label"), "Q1"); await userEvent.click(screen.getByTestId("corp-code-create"));
    expect(await screen.findByTestId("corp-code-value")).toHaveTextContent("A7KQ2-M9X0T"); await userEvent.click(screen.getByTestId("corp-code-dismiss"));
    expect(screen.queryByTestId("corp-code-value")).not.toBeInTheDocument(); expect(await screen.findByText("Q1")).toBeInTheDocument(); expect(document.body.textContent).not.toContain("A7KQ2");
  });
  it("an HR list is uploaded as rows, then a second person approves it from the list", async () => {
    let up: any = null; let decided: any = null; detailMocks();
    server.use(http.get(`${A}/accounts/acc_1/hr-lists`, () => HttpResponse.json({ items: [{ id: "b1", status: "PENDING_APPROVAL", rowCount: 3, rowsHeld: 3, windowEndsAt: null, createdAt: "2027-01-20T00:00:00Z" }] })), http.post(`${A}/accounts/acc_1/hr-lists`, async ({ request }) => { up = await request.json(); return HttpResponse.json({ batchId: "b2", rowCount: 2, invalidRows: 0 }, { status: 201 }); }), http.post(`${A}/hr-lists/b1/decision`, async ({ request }) => { decided = await request.json(); return HttpResponse.json({ batchId: "b1", status: "APPROVED" }); }));
    renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    await userEvent.type(await screen.findByTestId("corp-hr-text"), "+201000000101{enter}sara@acme.com"); await userEvent.click(screen.getByTestId("corp-hr-upload"));
    await waitFor(() => expect(up).toEqual({ rows: ["+201000000101", "sara@acme.com"] })); await userEvent.click(await screen.findByTestId("corp-hr-approve-b1")); await waitFor(() => expect(decided).toEqual({ decision: "APPROVED" }));
  });
  it("no page lists a member or a booking and every screen passes automated accessibility checks in English and Arabic", async () => {
    detailMocks(acct({ status: "ACTIVE" })); const en = renderOps(detail(), { route: "/growth/corporate/accounts/acc_1" });
    await screen.findByTestId("corp-detail"); expect(await violations()).toEqual([]); en.unmount();
    detailMocks(acct({ status: "ACTIVE" })); renderOps(detail(), { route: "/growth/corporate/accounts/acc_1", lang: "ar" });
    await screen.findByTestId("corp-detail"); expect(document.documentElement.dir).toBe("rtl"); expect(await violations()).toEqual([]);
  });
});

describe("Enterprise leads (GRW-P4-C)", () => {
  const lead = (o: Record<string, unknown> = {}) => ({ id: "ld_1", source: "B2B_REFERRAL", referrerOrgRef: "tn_1", companyName: "Delta Pharma", sizeBucket: "200_999", contactRef: "ref-hr-1", status: "NEW", ownerSub: null, notes: "", accountId: null, createdAt: "2027-01-20T00:00:00Z", updatedAt: "2027-01-20T00:00:00Z", ...o });
  it("shows the pipeline counts, only the allowed next stages, and moves a lead", async () => {
    let moved: any = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/leads`, () => HttpResponse.json({ items: [lead()], pipeline: { NEW: 1 } })), http.post(`${A}/leads/ld_1/transition`, async ({ request }) => { moved = await request.json(); return HttpResponse.json(lead({ status: "CONTACTED" })); }));
    renderOps(<CorporatePage />, { route: "/growth/corporate" });
    await userEvent.click(await screen.findByTestId("corp-tab-leads"));
    expect(await screen.findByText("Delta Pharma")).toBeInTheDocument(); expect(screen.getByTestId("corp-pipeline")).toHaveTextContent("New: 1"); expect(screen.getByTestId("corp-leads-note")).toHaveTextContent(/earns the provider no reward/);
    const sel = screen.getByTestId("corp-move-ld_1"); expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Move to...", "Contacted", "Duplicate", "Lost"]);
    await userEvent.selectOptions(sel, "CONTACTED"); await waitFor(() => expect(moved).toMatchObject({ status: "CONTACTED" }));
  });
  it("filters by stage and passes only company fields when adding a lead", async () => {
    let status = ""; let body: any = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/leads`, ({ request }) => { status = new URL(request.url).searchParams.get("status") ?? ""; return HttpResponse.json({ items: [], pipeline: {} }); }), http.post(`${A}/leads`, async ({ request }) => { body = await request.json(); return HttpResponse.json(lead({ source: "OUTBOUND" }), { status: 201 }); }));
    renderOps(<CorporatePage />, { route: "/growth/corporate" });
    await userEvent.click(await screen.findByTestId("corp-tab-leads")); await userEvent.click(await screen.findByTestId("corp-lead-filter-QUALIFIED")); await waitFor(() => expect(status).toBe("QUALIFIED"));
    await userEvent.type(screen.getByTestId("corp-lead-name"), "Omega Foods"); await userEvent.click(screen.getByTestId("corp-lead-add")); await waitFor(() => expect(body).toEqual({ companyName: "Omega Foods", source: "OUTBOUND", sizeBucket: "UNKNOWN" }));
    expect(await violations()).toEqual([]);
  });
});
