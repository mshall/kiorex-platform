import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import KiorlyPlansPage from "@/pages/KiorlyPlansPage";
import { cleanContent, contentIssues, emptyProposalForm, formatWhen, linesToList, priceState, proposalActions, sortPrices, toProposalBody, validateProposal } from "@/lib/kiorlyPlansLogic";
import type { ContentConfig, ContentPlan, PlansOverview, PriceProposal } from "@/api/kiorlyPlans";

const B = "/api/v1/admin/kiorly-plans";
const cp = (id: string, o: Partial<ContentPlan> = {}): ContentPlan => ({ id, visible: true, name: { en: id.toUpperCase(), ar: `ع ${id}` }, summary: { en: "S", ar: "م" }, limits: { en: ["One"], ar: ["واحد"] }, features: { en: ["F1", "F2"], ar: ["م1", "م2"] }, ...o });
const config = (): ContentConfig => ({ pharmacy: { plans: [cp("lite"), cp("pro")] }, lab: { plans: [cp("lite")] } });
const price = (o: Record<string, unknown> = {}) => ({ id: "pr1", planId: "pl_pro", marketId: "mk_EG", currency: "EGP", interval: "MONTHLY", unit: "PER_CLINICIAN", amount: "1299", includedClinicians: 1, extraClinicianAmount: null, cohortKey: null, priceVersion: 1, validFrom: "2026-01-01T00:00:00Z", validTo: null, ...o });
const overview = (o: Partial<PlansOverview> = {}): PlansOverview => ({
  canChange: true,
  clinic: { available: true, markets: [{ id: "mk_EG", code: "EG", nameEn: "Egypt", defaultCurrency: "EGP" }], plans: [
    { id: "pl_pro", key: "PRO", nameEn: "Pro", nameAr: "برو", isPublic: true, sortOrder: 20, entitlements: [], prices: [price() as never, price({ id: "pr0", priceVersion: 0, validTo: "2026-06-01T00:00:00Z" }) as never] },
    { id: "pl_lite", key: "LITE", nameEn: "Lite", nameAr: "لايت", isPublic: false, sortOrder: 10, entitlements: [], prices: [] },
  ] },
  content: { version: 0, config: config(), isDefault: true, updatedAt: null, updatedBy: null, defaults: config() },
  pharmacy: { available: true, configured: true, editions: ["LITE", "PRO", "CHAIN"], prices: [], organisations: [{ edition: "PRO", marketCode: "EG", count: 2 }] },
  lab: { available: false, configured: false, code: "PRODUCT_PRICES_NOT_CONFIGURED", editions: [], prices: [], organisations: [] },
  proposals: [],
  capabilities: { canPropose: true, canApprove: true, you: "super_1" },
  catalogueWarnings: [],
  ...o,
});
const proposal = (o: Partial<PriceProposal> = {}): PriceProposal => ({ id: "kpp_1", product: "PHARMACY", planRef: "PRO", planKey: "PRO", marketCode: "EG", interval: "MONTHLY", unit: "PER_TENANT", currency: "EGP", amount: "250.00", includedClinicians: null, extraClinicianAmount: null, effectiveFrom: "2026-12-01T10:00:00Z", requestedFrom: null, note: null, status: "PENDING", warnings: [], preview: { priceVersion: 1, supersedes: false, validFrom: "2026-12-01T10:00:00Z", affected: 2, mrrDelta: null, from: null }, proposedBy: "ops_1", proposedByEmail: "ops@example.com", proposedAt: "2026-11-30T10:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, publishedVersion: null, lastError: null, lastAttemptAt: null, ...o });
const mount = (lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/kiorly-plans" element={<KiorlyPlansPage />} /></Routes>, { route: "/kiorly-plans", lang });
const get = (o: PlansOverview) => http.get(B, () => HttpResponse.json(o));

describe("Kiorly admin: Plans screen", () => {
  it("shows the Clinic plans in order with their price versions and states, and 'no price' where none is set", async () => {
    server.use(get(overview()));
    mount();
    const pro = await screen.findByTestId("clinic-plan-PRO");
    expect(within(pro).getByTestId("price-PRO-1-MONTHLY")).toHaveTextContent("1299 EGP");
    expect(within(pro).getByTestId("price-PRO-1-MONTHLY")).toHaveTextContent(/active now/i);
    expect(within(pro).getByTestId("price-PRO-0-MONTHLY")).toHaveTextContent(/replaced/i);
    expect(screen.getByTestId("public-PRO")).toHaveTextContent(/shown on the landing page/i);
    expect(screen.getByTestId("public-LITE")).toHaveTextContent(/hidden/i);
    expect(screen.getByTestId("no-price-LITE")).toHaveTextContent(/pricing to be announced/i);
    const order = screen.getAllByTestId(/^clinic-plan-/).map((e) => e.getAttribute("data-testid"));
    expect(order).toEqual(["clinic-plan-LITE", "clinic-plan-PRO"]);
  });

  it("Kiorly ops: may propose a price but not edit a plan, change wording or decide; a read-only role proposes nothing", async () => {
    server.use(get(overview({ canChange: false, capabilities: { canPropose: true, canApprove: false, you: "ops_1" }, proposals: [proposal()] })));
    mount();
    await screen.findByTestId("clinic-plan-PRO");
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByTestId("price-rule-note")).toHaveTextContent(/propose a new price version/i);
    for (const id of ["edit-PRO", "content-save", "approve-kpp_1", "reject-kpp_1"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId("new-price-PRO")).toBeInTheDocument();
    expect(screen.getByTestId("withdraw-kpp_1")).toBeInTheDocument(); // it is their own proposal
    expect(await screen.findByTestId("visible-pharmacy-lite")).toBeDisabled();
  });

  it("nothing can be proposed without the right: no propose button anywhere", async () => {
    server.use(get(overview({ canChange: false, capabilities: { canPropose: false, canApprove: false, you: "x" } })));
    mount();
    await screen.findByTestId("clinic-plan-PRO");
    expect(screen.queryByTestId("new-price-PRO")).toBeNull();
    expect(screen.queryByTestId("propose-pharmacy-PRO")).toBeNull();
  });

  it("an unreachable Clinic is explained, and the Pharmacy and Lab wording is still there", async () => {
    server.use(get(overview({ clinic: { available: false, markets: [], plans: [] } })));
    mount();
    expect(await screen.findByTestId("clinic-unavailable")).toBeInTheDocument();
    expect(await screen.findByTestId("content-plan-pharmacy-lite")).toBeInTheDocument();
  });

  it("propose (Clinic): needs a preview first, shows the impact and the warnings, sends the whitelisted body to the proposals route, publishes nothing", async () => {
    const bodies: { url: string; body: Record<string, unknown> }[] = [];
    server.use(get(overview()),
      http.post(`${B}/prices/preview`, async ({ request }) => { bodies.push({ url: "preview", body: (await request.json()) as never }); return HttpResponse.json({ input: {}, preview: { priceVersion: 2, supersedes: true, validFrom: "2026-12-01T00:00:00Z", affected: 3, mrrDelta: "300.00", from: { amount: "1299", currency: "EGP", priceVersion: 1 } }, warnings: [{ code: "ANNUAL_NOT_ABOVE_MONTHLY", params: { annual: "999.00", monthly: "1299.00", currency: "EGP" } }] }); }),
      http.post(`${B}/proposals`, async ({ request }) => { bodies.push({ url: "proposals", body: (await request.json()) as never }); return HttpResponse.json(proposal({ product: "CLINIC" }), { status: 201 }); }),
      http.post(`${B}/clinic/pl_pro/prices`, () => HttpResponse.json({}, { status: 500 }))); // the old direct route is never used
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("new-price-PRO"));
    expect(screen.getByTestId("propose-submit")).toBeDisabled();
    await u.click(screen.getByTestId("propose-preview")); // invalid: nothing sent
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(bodies).toHaveLength(0);
    await u.type(screen.getByLabelText(/^amount$/i), "1400");
    await u.click(screen.getByTestId("propose-preview"));
    expect(await screen.findByTestId("price-preview")).toHaveTextContent(/3 subscriber/i);
    expect(screen.getByTestId("price-preview")).toHaveTextContent(/version 2/i);
    expect(await screen.findByTestId("price-warnings")).toHaveTextContent(/yearly price \(999\.00 EGP\) is not above the monthly price \(1299\.00 EGP\)/i);
    expect(bodies[0]!.body).toMatchObject({ product: "CLINIC", planRef: "pl_pro", marketCode: "EG", currency: "EGP", interval: "MONTHLY", unit: "PER_TENANT", amount: "1400", includedClinicians: 1 });
    await u.click(screen.getByTestId("propose-submit"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.url).toBe("proposals");
    expect(await screen.findByTestId("page-note")).toHaveTextContent(/different super admin approves/i);
  });

  it("propose (Pharmacy): per organisation (no unit, no clinicians), the market is typed, an unreachable product shows its own message", async () => {
    let sent: Record<string, unknown> = {}; let down = false;
    server.use(get(overview()), http.post(`${B}/prices/preview`, async ({ request }) => { sent = (await request.json()) as never; return down ? HttpResponse.json({ code: "PRODUCT_UNAVAILABLE", message: "x" }, { status: 503 }) : HttpResponse.json({ input: {}, preview: { priceVersion: 1, supersedes: false, validFrom: "2026-12-01T00:00:00Z", affected: 2, mrrDelta: null, from: null }, warnings: [] }); }));
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("propose-pharmacy-PRO"));
    const dlg = within(screen.getByTestId("propose-dialog"));
    expect(dlg.queryByLabelText(/price per/i)).toBeNull(); expect(dlg.queryByLabelText(/clinicians included/i)).toBeNull();
    await u.type(dlg.getByLabelText(/^currency$/i), "egp"); await u.type(dlg.getByLabelText(/^amount$/i), "250");
    await u.click(dlg.getByTestId("propose-preview"));
    expect(await dlg.findByTestId("price-preview")).toHaveTextContent(/2 organisation\(s\) are on this edition/i);
    expect(sent).toMatchObject({ product: "PHARMACY", planRef: "PRO", marketCode: "EG", currency: "EGP", amount: "250" });
    expect(sent).not.toHaveProperty("unit");
    down = true; await u.type(dlg.getByLabelText(/^amount$/i), "1");
    await u.click(dlg.getByTestId("propose-preview"));
    expect(await dlg.findByTestId("propose-error")).toHaveTextContent(/not reachable/i);
  });

  it("Pharmacy and Lab sections: the editions with their price versions, 'no price' where none exists, and a clear state when the connection is not set up", async () => {
    server.use(get(overview({ pharmacy: { available: true, configured: true, editions: ["LITE", "PRO", "CHAIN"], organisations: [{ edition: "PRO", marketCode: "EG", count: 2 }], prices: [{ id: "x1", edition: "PRO", marketCode: "EG", interval: "MONTHLY", currency: "EGP", amount: "250.00", validFrom: "2026-01-01T00:00:00Z", validTo: null, priceVersion: 1, proposalId: "kpp_9", proposedBy: "ops_1", publishedBy: "super_1", createdAt: "2026-01-01T00:00:00Z" }] } })));
    mount();
    expect(await screen.findByTestId("pharmacy-price-PRO-EG-MONTHLY-1")).toHaveTextContent("250.00 EGP");
    expect(screen.getByTestId("pharmacy-no-price-CHAIN")).toHaveTextContent(/pricing to be announced/i);
    expect(screen.getByTestId("lab-unavailable")).toHaveTextContent(/not set up/i);
  });

  it("proposals: every status stays in the history; a different super admin approves or rejects with a note; the proposer cannot, and can withdraw", async () => {
    const calls: { id: string; action: string; body: unknown }[] = [];
    const list = [proposal({ id: "kpp_a", proposedBy: "ops_1", warnings: [{ code: "BIG_CHANGE", params: { from: "100.00", to: "400.00", percent: 300, currency: "EGP" } }] }), proposal({ id: "kpp_b", proposedBy: "super_1", planRef: "CHAIN", planKey: "CHAIN" }), proposal({ id: "kpp_c", status: "REJECTED", decidedBy: "super_2", decisionNote: "too low" }), proposal({ id: "kpp_d", status: "WITHDRAWN", decidedBy: "ops_1" }), proposal({ id: "kpp_e", status: "APPROVED", decidedBy: "super_2", publishedVersion: 3 })];
    server.use(get(overview({ proposals: list })), http.post(`${B}/proposals/:id/:action`, async ({ params, request }) => { calls.push({ id: String(params.id), action: String(params.action), body: await request.json() }); return HttpResponse.json(list[0]); }));
    const u = userEvent.setup(); mount();
    await screen.findByTestId("proposals-section");
    expect(screen.getAllByTestId(/^proposal-kpp_/)).toHaveLength(5);
    expect(screen.getByTestId("status-kpp_c")).toHaveTextContent(/rejected/i); expect(screen.getByTestId("status-kpp_d")).toHaveTextContent(/withdrawn/i); expect(screen.getByTestId("proposal-kpp_e")).toHaveTextContent(/version 3/i);
    // someone else's pending proposal: decide; your own: withdraw only, with a hint; decided ones: nothing
    expect(screen.getByTestId("approve-kpp_a")).toBeInTheDocument();
    for (const id of ["approve-kpp_b", "reject-kpp_b", "approve-kpp_c", "withdraw-kpp_c", "withdraw-kpp_a", "approve-kpp_e"]) expect(screen.queryByTestId(id), id).toBeNull();
    expect(screen.getByTestId("withdraw-kpp_b")).toBeInTheDocument(); expect(screen.getByTestId("own-kpp_b")).toHaveTextContent(/different super admin/i);
    await u.click(screen.getByTestId("filter-REJECTED"));
    expect(screen.getAllByTestId(/^proposal-kpp_/)).toHaveLength(1);
    await u.click(screen.getByTestId("filter-ALL"));
    await u.click(screen.getByTestId("approve-kpp_a"));
    expect(within(screen.getByTestId("decide-dialog")).getByTestId("decide-warnings")).toHaveTextContent(/300 percent/i); // the approver sees the warnings
    await u.type(screen.getByLabelText(/^note/i), "checked with finance");
    await u.click(screen.getByTestId("decide-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: "kpp_a", action: "approve", body: { note: "checked with finance" } });
    expect(await screen.findByTestId("proposals-msg")).toHaveTextContent(/approved and published/i);
    await u.click(screen.getByTestId("withdraw-kpp_b"));
    await waitFor(() => expect(calls[1]).toEqual({ id: "kpp_b", action: "withdraw", body: {} }));
  });

  it("proposals: a refusal (the two-person rule, a product that is down) is shown translated and the proposal stays", async () => {
    server.use(get(overview({ proposals: [proposal({ id: "kpp_a" })] })), http.post(`${B}/proposals/kpp_a/approve`, () => HttpResponse.json({ code: "PRODUCT_UNAVAILABLE", message: "x" }, { status: 503 })));
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("approve-kpp_a"));
    await u.click(screen.getByTestId("decide-confirm"));
    expect(await screen.findByTestId("decide-error")).toHaveTextContent(/not reachable/i);
    expect(screen.getByTestId("proposal-kpp_a")).toBeInTheDocument();
  });

  it("the catalogue as it stands is checked: an annual price at or below the monthly one is flagged for everyone to see", async () => {
    server.use(get(overview({ catalogueWarnings: [{ code: "ANNUAL_NOT_ABOVE_MONTHLY", params: { annual: "999.00", monthly: "1299.00", currency: "EGP", plan: "Clinic PRO", market: "EG" }, product: "CLINIC", planKey: "PRO", market: "EG", interval: "ANNUAL", unit: "PER_CLINICIAN" }] })));
    mount();
    expect(await screen.findByTestId("catalogue-warnings-list")).toHaveTextContent(/999\.00 EGP/);
  });

  it("plan: renames and hides a plan through the API", async () => {
    let body: Record<string, unknown> = {};
    server.use(get(overview()), http.patch(`${B}/clinic/pl_pro`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}); }));
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("edit-PRO"));
    const dlg = within(screen.getByTestId("plan-dialog"));
    const en = dlg.getByLabelText(/name \(english\)/i); await u.clear(en); await u.type(en, "Pro Plus");
    await u.click(dlg.getByLabelText(/show on the landing page/i));
    await u.click(screen.getByTestId("plan-save"));
    await waitFor(() => expect(body).toMatchObject({ nameEn: "Pro Plus", isPublic: false, sortOrder: 20 }));
  });

  it("wording: edit, validation (English and Arabic must match), save with the opened version, stale answer is explained", async () => {
    let sent: { version?: number; config?: ContentConfig } = {}; let stale = false;
    server.use(get(overview()), http.put(`${B}/content`, async ({ request }) => { sent = (await request.json()) as typeof sent; return stale ? HttpResponse.json({ code: "PLAN_CONTENT_STALE", message: "x" }, { status: 409 }) : HttpResponse.json({}); }));
    const u = userEvent.setup(); mount();
    const card = await screen.findByTestId("content-plan-pharmacy-lite");
    expect(screen.getByTestId("content-version")).toHaveTextContent(/ships with the product/i);
    expect(screen.getByTestId("content-save")).toBeDisabled(); // nothing changed
    const feats = within(card).getByLabelText(/features, one per line \(english\)/i);
    await u.type(feats, "{enter}F3");
    expect(await within(card).findByRole("alert")).toHaveTextContent(/same number of lines/i);
    expect(screen.getByTestId("content-save")).toBeDisabled();
    await u.type(within(card).getByLabelText(/features, one per line \(arabic\)/i), "{enter}م3");
    await waitFor(() => expect(screen.getByTestId("content-save")).toBeEnabled());
    await u.click(screen.getByTestId("content-save"));
    await waitFor(() => expect(sent.version).toBe(0));
    expect(sent.config!.pharmacy.plans[0]!.features).toEqual({ en: ["F1", "F2", "F3"], ar: ["م1", "م2", "م3"] });
    expect(JSON.stringify(sent.config)).not.toMatch(/price/i);
    // second round: the API says someone saved first
    stale = true;
    await u.click(within(await screen.findByTestId("content-plan-pharmacy-lite")).getByTestId("visible-pharmacy-lite"));
    await u.click(await screen.findByTestId("content-save"));
    expect(await screen.findByTestId("content-msg")).toHaveTextContent(/saved the wording first/i);
  });

  it("is fully available in Arabic (right to left labels, no English leak in the headings)", async () => {
    server.use(get(overview({ canChange: false })));
    mount("ar");
    expect(await screen.findByRole("heading", { name: "الباقات" })).toBeInTheDocument();
    expect(await screen.findByTestId("read-only-note")).toHaveTextContent("المشرف العام");
    expect(await screen.findByTestId("no-price-LITE")).toHaveTextContent("الأسعار تعلن قريبا");
    expect(screen.getByTestId("public-LITE")).toHaveTextContent("مخفية");
    expect(screen.getByRole("heading", { name: "أسعار الصيدلية" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "مقترحات الأسعار" })).toBeInTheDocument();
  });
});

describe("plans logic", () => {
  it("price state, ordering and cohort prices last", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    expect(priceState({ validFrom: "2026-01-01T00:00:00Z", validTo: null }, now)).toBe("active");
    expect(priceState({ validFrom: "2026-08-01T00:00:00Z", validTo: null }, now)).toBe("scheduled");
    expect(priceState({ validFrom: "2026-01-01T00:00:00Z", validTo: "2026-06-01T00:00:00Z" }, now)).toBe("past");
    const rows = sortPrices([price({ id: "a", cohortKey: "founding" }), price({ id: "b", priceVersion: 1 }), price({ id: "c", priceVersion: 2 })] as never);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("validates a proposal like the API and builds the body", () => {
    const ok = { ...emptyProposalForm("CLINIC", "pl_pro", { code: "EG", defaultCurrency: "egp" }), amount: "499.50" };
    expect(validateProposal(ok)).toEqual({});
    for (const amount of ["", "abc", "-1", "1e3", "1.234", "1,5"]) expect(validateProposal({ ...ok, amount }).amount, amount).toBe(true);
    expect(validateProposal({ ...ok, marketCode: "EGY" }).market).toBe(true);
    expect(validateProposal({ ...ok, currency: "EG" }).currency).toBe(true);
    expect(validateProposal({ ...ok, includedClinicians: "0" }).included).toBe(true);
    expect(validateProposal({ ...ok, product: "PHARMACY", includedClinicians: "0" })).toEqual({}); // no clinician fields for Pharmacy
    expect(toProposalBody({ ...ok, validFrom: "" })).toEqual({ product: "CLINIC", planRef: "pl_pro", marketCode: "EG", currency: "EGP", interval: "MONTHLY", amount: "499.50", unit: "PER_TENANT", includedClinicians: 1 });
    expect(toProposalBody({ ...ok, product: "LAB", planRef: "PRO", note: " why " })).toEqual({ product: "LAB", planRef: "PRO", marketCode: "EG", currency: "EGP", interval: "MONTHLY", amount: "499.50", note: "why" });
  });
  it("who may do what with a proposal", () => {
    const p = (status: PriceProposal["status"], by: string) => ({ status, proposedBy: by });
    expect(proposalActions(p("PENDING", "ops_1"), { canApprove: true, you: "super_1" })).toMatchObject({ approve: true, reject: true, withdraw: false });
    expect(proposalActions(p("PENDING", "super_1"), { canApprove: true, you: "super_1" })).toMatchObject({ approve: false, reject: false, withdraw: true, ownPending: true });
    expect(proposalActions(p("PENDING", "ops_1"), { canApprove: false, you: "ops_2" })).toMatchObject({ approve: false, reject: false, withdraw: false });
    expect(proposalActions(p("APPROVED", "ops_1"), { canApprove: true, you: "ops_1" })).toEqual({ approve: false, reject: false, withdraw: false, ownPending: false });
    expect(proposalActions(p("PENDING", "ops_1"), undefined)).toMatchObject({ approve: false, withdraw: false });
  });
  it("dates use Western digits in Arabic too", () => {
    expect(formatWhen("2026-12-01T10:00:00Z", "ar")).toMatch(/^[\d\s\u00b7:\u0600-\u06ff\u200f\u200e]+$/);
    expect(formatWhen("2026-12-01T10:00:00Z", "ar")).not.toMatch(/[\u0660-\u0669]/);
    expect(formatWhen(null, "en")).toBe("-");
  });
  it("content issues mirror the API", () => {
    expect(contentIssues(cp("x"))).toEqual([]);
    expect(contentIssues(cp("x", { features: { en: ["a"], ar: [] } }))).toContain("lines");
    expect(contentIssues(cp("x", { name: { en: "<b>", ar: "x" } }))).toContain("markup");
    expect(contentIssues(cp("x", { name: { en: "", ar: "x" } }))).toContain("name");
    expect(contentIssues(cp("x", { summary: { en: "x".repeat(201), ar: "" } }))).toContain("length");
    expect(linesToList("a\n\n  b  \n")).toEqual(["a", "b"]);
    expect(cleanContent({ ...config(), pharmacy: { plans: [cp("lite", { name: { en: " A ", ar: " ب " } })] } }).pharmacy.plans[0]!.name).toEqual({ en: "A", ar: "ب" });
  });
});
