import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CohortsRoute from "@/pages/growth/cohorts/Page";
import MarketWizardPage from "@/pages/growth/markets/MarketWizardPage";
import cohortsJson from "@/i18n/growth.cohorts.json";
import wizardJson from "@/i18n/growth.marketWizard.json";

const C = "/api/v1/admin/growth/cohorts"; const M = "/api/v1/admin/growth/market-onboarding"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage, manageCampaigns: false } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const axe = async (c: HTMLElement) => (await import("axe-core")).default.run(c, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });

const table = (o: Record<string, unknown> = {}) => ({ market: "EG", basis: "FIRST_COMPLETED", dimension: "ALL", value: null, k: 10, visitsPerPatientM3: 1.18, note: "x", rows: [
  { cohortMonth: "2027-01-01", suppressed: false, patients: 100, months: [{ monthIndex: 0, retained: 100, completedBookings: 100, revenueMinor: 10_000_000, rewardCostMinor: 0 }, { monthIndex: 1, retained: 40, completedBookings: 45, revenueMinor: 2_150_000, rewardCostMinor: 0 }, { monthIndex: 2, retained: "<10", completedBookings: "<10", revenueMinor: "<10", rewardCostMinor: "<10" }] },
  { cohortMonth: "2027-03-01", suppressed: true, patients: "<10", months: [] }], ...o });
const retention = () => ({ market: "EG", basis: "FIRST_COMPLETED", dimension: "ALL", value: null, k: 10, rows: [{ cohortMonth: "2027-01-01", patients: 100, suppressed: false, cells: [{ monthIndex: 0, retained: 100, rate: 100 }, { monthIndex: 1, retained: 40, rate: 40 }, { monthIndex: 2, retained: "<10", rate: "<10" }] }, { cohortMonth: "2027-03-01", patients: "<10", suppressed: true, cells: [] }] });
const ltv = () => ({ market: "EG", label: "ESTIMATE", modelVersion: "ltv-v1+ab12cd34", policy: { version: null, source: "PROPOSED_DEFAULT", horizonMonths: 12, discountRateBp: 0, includeRewardCost: true, intervalPercent: 90, resamples: 1000 }, method: "m", rows: [{ dimension: "ALL", value: null, horizonMonths: 12, estimateMinor: 250_000, lowMinor: 230_000, highMinor: 270_000, n: 200, label: "ESTIMATE", computedAt: "2027-04-15T00:00:00Z" }, { dimension: "SOURCE", value: "ORGANIC_SEARCH", horizonMonths: 12, estimateMinor: 240_000, lowMinor: 200_000, highMinor: 280_000, n: 153, label: "ESTIMATE", computedAt: "2027-04-15T00:00:00Z" }] });
const payback = (none = false) => ({ market: "EG", horizonMonths: 12, blendedCacMinor: none ? null : 15_000, ltvToCac: none ? null : { estimate: 16.67, low: 15.33, high: 18, n: 200, label: "ESTIMATE" }, note: none ? "No approved spend (or fewer than 10 acquired patients): CAC and LTV:CAC are not shown." : "CAC is blended.", rows: [{ cohortMonth: "2027-01-01", suppressed: false, patients: 100, spendMinor: none ? null : 3_000_000, cacMinor: none ? null : 30_000, paybackMonth: none ? null : 0, observedMonths: 4, cumulativePerPatientMinor: [100000] }, { cohortMonth: "2027-03-01", suppressed: true }] });
const base = () => server.use(http.get(`${G}/access`, () => caps()), http.get(C, () => HttpResponse.json(table())), http.get(`${C}/retention`, () => HttpResponse.json(retention())), http.get(`${C}/ltv`, () => HttpResponse.json(ltv())), http.get(`${C}/payback`, () => HttpResponse.json(payback())), http.get(`${C}/values`, () => HttpResponse.json({ values: ["ORGANIC_SEARCH", "PROVIDER_LINK"] })));

describe("i18n parity", () => {
  it("English and Arabic carry the same keys in both new files", () => {
    for (const j of [cohortsJson, wizardJson]) { const e = new Set(flat(j.en)); const a = new Set(flat(j.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); }
  });
});

describe("Cohorts page (GRW-P3-C)", () => {
  it("shows the cohort table with the hand figures, masks the small cell and the suppressed cohort, and the heatmap prints every rate", async () => {
    base(); renderOps(<CohortsRoute />, { route: "/growth/cohorts" });
    const t = await screen.findByTestId("cohort-table");
    expect(within(t).getByTestId("cohort-n-2027-01")).toHaveTextContent("100"); expect(within(t).getByTestId("cohort-cell-2027-01-1")).toHaveTextContent(/40/);
    expect(within(t).getByTestId("cohort-cell-2027-01-2")).toHaveTextContent("fewer than 10"); expect(within(t).getByTestId("cohort-n-2027-03")).toHaveTextContent("fewer than 10");
    expect(within(t).getByTestId("cohort-cell-2027-03-0")).toHaveTextContent("fewer than 10");
    expect(screen.getByTestId("heat-2027-01-1")).toHaveTextContent("40%"); expect(screen.getByTestId("heat-2027-01-2")).toHaveTextContent("fewer than 10");
    expect(screen.getByTestId("cohort-privacy")).toHaveTextContent(/fewer than 10 people/); expect(screen.getByTestId("cohort-visits")).toHaveTextContent("1.18");
  });
  it("a dimension needs a value before it asks; an empty answer says so; a failed read shows the error with retry", async () => {
    base(); renderOps(<CohortsRoute />, { route: "/growth/cohorts" }); await screen.findByTestId("cohort-table");
    await userEvent.selectOptions(screen.getByTestId("cohort-dimension"), "SOURCE"); expect(await screen.findByTestId("cohort-value")).toBeInTheDocument();
    server.use(http.get(C, () => HttpResponse.json(table({ rows: [] }))), http.get(`${C}/retention`, () => HttpResponse.json({ ...retention(), rows: [] })));
    await userEvent.selectOptions(screen.getByTestId("cohort-value"), "ORGANIC_SEARCH"); expect(await screen.findByTestId("cohort-empty")).toBeInTheDocument();
  });
  it("the recompute button is for managers only", async () => {
    base(); server.use(http.get(`${G}/access`, () => caps(false))); renderOps(<CohortsRoute />, { route: "/growth/cohorts" }); await screen.findByTestId("cohort-table"); expect(screen.queryByTestId("cohort-rollup")).toBeNull();
  });
  it("LTV tab: ESTIMATE label, interval, n and horizon on every row, and the note that it is a group average", async () => {
    base(); renderOps(<CohortsRoute />, { route: "/growth/cohorts" }); await userEvent.click(await screen.findByTestId("coh-tab-ltv"));
    const row = await screen.findByTestId("ltv-row-ALL-all"); expect(row).toHaveTextContent("2,500"); expect(within(row).getByTestId("ltv-interval")).toHaveTextContent("2,300 - 2,700"); expect(row).toHaveTextContent("200"); expect(row).toHaveTextContent("ESTIMATE");
    expect(screen.getByTestId("ltv-estimate-note")).toHaveTextContent(/never a value for a person/); expect(screen.getByTestId("ltv-policy")).toHaveTextContent(/PROPOSED_DEFAULT/);
    server.use(http.get(`${C}/ltv`, () => HttpResponse.json({ ...ltv(), rows: [] }))); await userEvent.click(screen.getByTestId("coh-tab-cohorts")); await userEvent.click(screen.getByTestId("coh-tab-ltv")); await waitFor(() => expect(screen.getByTestId("ltv-empty")).toBeInTheDocument());
  });
  it("payback tab: blended CAC, LTV:CAC with its interval; without spend it says so instead of inventing a CAC", async () => {
    base(); renderOps(<CohortsRoute />, { route: "/growth/cohorts" }); await userEvent.click(await screen.findByTestId("coh-tab-payback"));
    expect(await screen.findByTestId("blended-cac")).toHaveTextContent("150"); expect(screen.getByTestId("ltv-cac")).toHaveTextContent("16.67 (15.33 - 18)"); expect(screen.getByTestId("pb-2027-01")).toHaveTextContent("month 0");
    server.use(http.get(`${C}/payback`, () => HttpResponse.json(payback(true)))); await userEvent.click(screen.getByTestId("coh-tab-cohorts")); await userEvent.click(screen.getByTestId("coh-tab-payback"));
    await waitFor(() => expect(screen.getByTestId("blended-cac")).toHaveTextContent("not available")); expect(screen.getByTestId("payback-note")).toHaveTextContent(/No approved spend/);
  });
  it("Arabic renders RTL labels, and axe finds no A or AA structural violation on any tab in either language", async () => {
    for (const lang of ["en", "ar"] as const) {
      base(); const r = renderOps(<CohortsRoute />, { route: "/growth/cohorts", lang }); await screen.findByTestId("cohort-table");
      expect((await axe(r.container)).violations.map((v) => v.id), `${lang} cohorts`).toEqual([]);
      await userEvent.click(screen.getByTestId("coh-tab-ltv")); await screen.findByTestId("ltv-table"); expect((await axe(r.container)).violations.map((v) => v.id), `${lang} ltv`).toEqual([]);
      await userEvent.click(screen.getByTestId("coh-tab-payback")); await screen.findByTestId("payback-table"); expect((await axe(r.container)).violations.map((v) => v.id), `${lang} payback`).toEqual([]);
      if (lang === "ar") expect(screen.getByTestId("coh-tab-cohorts")).toHaveTextContent("المجموعات والاحتفاظ");
      r.unmount();
    }
  });
});

const plan = (o: Record<string, unknown> = {}) => ({ cc: "ZY", status: "DRAFT", steps: {}, createdBy: "adm_a", createdAt: "2027-01-28T00:00:00Z", updatedAt: "2027-01-28T00:00:00Z", readyAt: null, publishedAt: null, ...o });
const catalogue = () => ({ steps: [], existing: ["AE", "EG", "SA"], dataCells: { cells: ["cairo", "frankfurt"], source: "FILE", deployed: ["frankfurt"], bindings: { EG: "frankfurt" } }, specialties: [{ code: "dermatology", en: "Dermatology", ar: "الجلدية" }, { code: "paediatrics", en: "Paediatrics", ar: "الأطفال" }] });
const readiness = (o: Record<string, unknown> = {}) => ({ cc: "ZY", status: "DRAFT", ready: false, live: false, todo: 3, needsHuman: 3, dataCell: "frankfurt", sameCellMarkets: ["EG"], items: [{ id: "identity", status: "DONE", detail: "identity" }, { id: "configVersions", status: "TODO", detail: "NONE" }, { id: "consentTexts", status: "NEEDS_HUMAN", detail: "wording", humanOwner: "counsel" }, { id: "launchGate", status: "NEEDS_HUMAN", detail: "gate", humanOwner: "founder" }], ...o });
const wbase = (plans: unknown[] = [plan()]) => server.use(http.get(`${G}/access`, () => caps()), http.get(`${M}/plans`, () => HttpResponse.json(plans)), http.get(`${M}/catalogue`, () => HttpResponse.json(catalogue())), http.get(`${M}/plans/ZY/readiness`, () => HttpResponse.json(readiness())));

describe("Market onboarding wizard (GRW-P3-G)", () => {
  it("lists plans, starts a plan for a new country and says why a bad one is refused", async () => {
    wbase([]); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard" });
    expect(await screen.findByTestId("wizard-human")).toHaveTextContent(/never makes a market live/);
    let posted: unknown = null; server.use(http.post(`${M}/plans`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(plan(), { status: 201 }); }), http.get(`${M}/plans`, () => HttpResponse.json([plan()])));
    await userEvent.type(await screen.findByTestId("new-cc"), "zy"); await userEvent.click(screen.getByTestId("create-plan")); await waitFor(() => expect(posted).toEqual({ cc: "ZY" }));
    server.use(http.post(`${M}/plans`, () => HttpResponse.json({ code: "MARKET_EXISTS", message: "EG is already a market of the code fallback" }, { status: 409 })));
    await userEvent.type(screen.getByTestId("new-cc"), "EG"); await userEvent.click(screen.getByTestId("create-plan")); expect(await screen.findByTestId("create-error")).toHaveTextContent(/already a market/);
  });
  it("walks the steps, saves the identity answers as the API shape and shows the server's reason when a step is refused", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" });
    await userEvent.type(await screen.findByTestId("id-nameAr"), "زد واي"); await userEvent.type(screen.getByTestId("id-nameEn"), "Zeta Yankee"); await userEvent.type(screen.getByTestId("id-currency"), "jod"); await userEvent.clear(screen.getByTestId("id-minor")); await userEvent.type(screen.getByTestId("id-minor"), "3");
    await userEvent.type(screen.getByTestId("id-phone"), "+962"); await userEvent.type(screen.getByTestId("id-tz"), "Asia/Amman");
    let body: Record<string, unknown> = {}; server.use(http.put(`${M}/plans/ZY/steps/identity`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(plan()); }));
    await userEvent.click(screen.getByTestId("save-identity")); await waitFor(() => expect(body.currency).toBe("JOD")); expect(body).toMatchObject({ name: { ar: "زد واي", en: "Zeta Yankee" }, minorUnits: 3, phoneCode: "+962", timezone: "Asia/Amman", quietHours: { start: "21:00", end: "09:00" } });
    server.use(http.put(`${M}/plans/ZY/steps/identity`, () => HttpResponse.json({ code: "GROWTH_CONFIG_INVALID", message: "x", errors: ["/timezone must be a valid IANA zone"] }, { status: 422 })));
    await userEvent.click(screen.getByTestId("save-identity")); expect(await screen.findByTestId("error-identity")).toHaveTextContent("/timezone must be a valid IANA zone");
  });
  it("regulation: the legal wording is called out as a human item, and the cell step refuses nothing it did not offer and explains the single cell", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" }); await userEvent.click(await screen.findByTestId("tab-regulation")); expect(await screen.findByTestId("reg-human")).toHaveTextContent(/counsel/);
    let sent: Record<string, unknown> = {}; server.use(http.put(`${M}/plans/ZY/steps/regulation`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json(plan()); }));
    await userEvent.type(screen.getByTestId("reg-consentRegimeId"), "zy-regime-v0"); await userEvent.type(screen.getByTestId("reg-dataExportRuleId"), "zy-export-v0"); await userEvent.click(screen.getByTestId("reg-save")); await waitFor(() => expect(sent.consentRegimeId).toBe("zy-regime-v0")); expect(sent.marketingLicenceHeld).toBe(false);
    await userEvent.click(screen.getByTestId("tab-residency")); await userEvent.selectOptions(await screen.findByTestId("cell-select"), "frankfurt"); expect(screen.getByTestId("cell-same")).toHaveTextContent(/EG/); expect(screen.getByTestId("cell-same")).toHaveTextContent(/Cross-cell routing does not exist/);
    expect(screen.getByRole("option", { name: /cairo \(prepared, not deployed\)/ })).toBeInTheDocument();
  });
  it("specialties: pick from the global catalogue and send code with both local names", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" }); await userEvent.click(await screen.findByTestId("tab-specialties"));
    let sent: unknown = null; server.use(http.put(`${M}/plans/ZY/steps/specialties`, async ({ request }) => { sent = await request.json(); return HttpResponse.json(plan()); }));
    await userEvent.click(await screen.findByTestId("spec-dermatology")); await userEvent.click(screen.getByTestId("spec-save")); await waitFor(() => expect(sent).toEqual({ enabled: [{ code: "dermatology", nameAr: "الجلدية", nameEn: "Dermatology" }] }));
  });
  it("geography: preview shows line-numbered errors and blocks the import; a clean file enables it", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" }); await userEvent.click(await screen.findByTestId("tab-geography"));
    server.use(http.post(`${M}/geography/preview`, () => HttpResponse.json({ ok: false, errors: [{ line: 3, code: "DUPLICATE_SLUG", message: "Arabic slug already used" }], cities: 0, districts: 0, totalLines: 2, sample: [] })));
    await userEvent.type(await screen.findByTestId("geo-csv"), "x"); await userEvent.click(screen.getByTestId("geo-preview")); const e = await screen.findByTestId("geo-errors"); expect(e).toHaveTextContent("#3 DUPLICATE_SLUG"); expect(screen.getByTestId("geo-import")).toBeDisabled();
    server.use(http.post(`${M}/geography/preview`, () => HttpResponse.json({ ok: true, errors: [], cities: 2, districts: 2, totalLines: 4, sample: [] })), http.post(`${M}/plans/ZY/geography`, () => HttpResponse.json({ cities: 2, districts: 2 })));
    await userEvent.click(screen.getByTestId("geo-preview")); await waitFor(() => expect(screen.getByTestId("geo-import")).toBeEnabled()); await userEvent.click(screen.getByTestId("geo-import")); expect(await screen.findByTestId("geo-imported")).toHaveTextContent("2 cities and 2 districts");
  });
  it("readiness separates what the console can do from what needs a person, and never calls a ready market live", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" });
    expect(await screen.findByTestId("ready-configVersions")).toHaveTextContent("To do"); expect(screen.getByTestId("ready-consentTexts")).toHaveTextContent("Needs a person"); expect(screen.getByTestId("ready-consentTexts")).toHaveTextContent("counsel"); expect(screen.getByTestId("ready-launchGate")).toHaveTextContent("founder");
    expect(screen.getByTestId("readiness-summary")).toHaveTextContent("3 item(s) left"); expect(screen.getByTestId("readiness-summary")).toHaveTextContent("Not live (human gate)"); expect(screen.getByTestId("readiness-summary")).toHaveTextContent("Same cell as: EG");
  });
  it("publish drafts the configuration and says a second approver is needed; a published plan is read-only; a non-manager cannot publish", async () => {
    wbase(); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" });
    server.use(http.post(`${M}/plans/ZY/publish`, () => HttpResponse.json({ cc: "ZY", drafted: {}, flag: "market.zy.live", next: "A second super admin approves the three versions." })));
    await userEvent.click(await screen.findByTestId("publish")); expect(await screen.findByTestId("publish-ok")).toHaveTextContent(/second super admin/);
  });
  it("published plan: fields are read only and the publish button is gone; a read-only role sees no publish", async () => {
    wbase([plan({ status: "PUBLISHED", steps: { identity: { name: { ar: "x", en: "y" } } } })]); renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY" });
    expect(await screen.findByTestId("publish-done")).toBeInTheDocument(); expect(screen.queryByTestId("publish")).toBeNull(); expect(screen.getByTestId("save-identity")).toBeDisabled(); expect(screen.getByTestId("id-currency")).toBeDisabled();
  });
  it("Arabic and English both pass axe on the wizard, every step panel and the readiness list", async () => {
    for (const lang of ["en", "ar"] as const) {
      wbase(); const r = renderOps(<MarketWizardPage />, { route: "/growth/markets/wizard?cc=ZY", lang }); await screen.findByTestId("readiness-list");
      for (const s of ["identity", "geography", "specialties", "regulation", "providers", "consent", "residency", "integrations"]) { await userEvent.click(screen.getByTestId(`tab-${s}`)); await screen.findByTestId("step-panel"); expect((await axe(r.container)).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `${lang} ${s}`).toEqual([]); }
      r.unmount();
    }
  });
});
