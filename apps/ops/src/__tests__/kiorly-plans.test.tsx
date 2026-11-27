import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import KiorlyPlansPage from "@/pages/KiorlyPlansPage";
import { cleanContent, contentIssues, emptyPriceForm, linesToList, priceState, sortPrices, toPriceBody, validatePrice } from "@/lib/kiorlyPlansLogic";
import type { ContentConfig, ContentPlan, PlansOverview } from "@/api/kiorlyPlans";

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
  ...o,
});
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

  it("read-only for Kiorly ops: a note, no change button anywhere, fields locked", async () => {
    server.use(get(overview({ canChange: false })));
    mount();
    await screen.findByTestId("clinic-plan-PRO");
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    for (const id of ["edit-PRO", "new-price-PRO", "content-save"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(await screen.findByTestId("visible-pharmacy-lite")).toBeDisabled();
  });

  it("an unreachable Clinic is explained, and the Pharmacy and Lab wording is still there", async () => {
    server.use(get(overview({ clinic: { available: false, markets: [], plans: [] } })));
    mount();
    expect(await screen.findByTestId("clinic-unavailable")).toBeInTheDocument();
    expect(await screen.findByTestId("content-plan-pharmacy-lite")).toBeInTheDocument();
  });

  it("price: needs a preview before publishing, sends the whitelisted body, then refreshes", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(get(overview()), http.post(`${B}/clinic/pl_pro/prices`, async ({ request }) => { const b = (await request.json()) as Record<string, unknown>; bodies.push(b); return b.preview ? HttpResponse.json({ preview: true, priceVersion: 2, supersedes: true, impact: { tenantsAffected: 3, mrrDelta: "300.00" } }) : HttpResponse.json(price({ id: "pr2", priceVersion: 2, amount: "1400" })); }));
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("new-price-PRO"));
    expect(screen.getByTestId("price-publish")).toBeDisabled();
    await u.click(screen.getByTestId("price-preview-btn")); // invalid: nothing sent
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(bodies).toHaveLength(0);
    await u.type(screen.getByLabelText(/^amount$/i), "1400");
    await u.click(screen.getByTestId("price-preview-btn"));
    expect(await screen.findByTestId("price-preview")).toHaveTextContent(/3 subscriber/i);
    expect(bodies[0]).toMatchObject({ marketId: "mk_EG", currency: "EGP", interval: "MONTHLY", unit: "PER_TENANT", amount: "1400", preview: true });
    await u.click(screen.getByTestId("price-publish"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).not.toHaveProperty("preview");
    expect(await screen.findByTestId("page-note")).toHaveTextContent(/saved/i);
  });

  it("price: a Clinic refusal and an unreachable Clinic show their own translated message", async () => {
    server.use(get(overview()), http.post(`${B}/clinic/pl_pro/prices`, () => HttpResponse.json({ code: "CLINIC_UNAVAILABLE", message: "x" }, { status: 503 })));
    const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("new-price-PRO"));
    await u.type(screen.getByLabelText(/^amount$/i), "10");
    await u.click(screen.getByTestId("price-preview-btn"));
    expect(await screen.findByTestId("price-error")).toHaveTextContent(/not reachable/i);
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
    expect(await screen.findByTestId("read-only-note")).toHaveTextContent("للمشرف العام");
    expect(await screen.findByTestId("no-price-LITE")).toHaveTextContent("الأسعار تعلن قريبا");
    expect(screen.getByTestId("public-LITE")).toHaveTextContent("مخفية");
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
  it("validates amounts like the Clinic and builds the body", () => {
    const ok = { ...emptyPriceForm({ id: "mk", code: "EG", nameEn: "E", defaultCurrency: "egp" }), amount: "499.50" };
    expect(validatePrice(ok)).toEqual({});
    for (const amount of ["", "abc", "-1", "1e3", "1.234", "1,5"]) expect(validatePrice({ ...ok, amount }).amount, amount).toBe(true);
    expect(validatePrice({ ...ok, marketId: "" }).market).toBe(true);
    expect(validatePrice({ ...ok, currency: "EG" }).currency).toBe(true);
    expect(validatePrice({ ...ok, includedClinicians: "0" }).included).toBe(true);
    expect(toPriceBody({ ...ok, validFrom: "" }, false)).toEqual({ marketId: "mk", currency: "EGP", interval: "MONTHLY", unit: "PER_TENANT", amount: "499.50", includedClinicians: 1 });
    expect(toPriceBody(ok, true)).toMatchObject({ preview: true });
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
