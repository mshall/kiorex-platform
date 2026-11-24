import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import GrowthFraudPage from "@/pages/growth/GrowthFraudPage";
import GrowthSeoPage from "@/pages/growth/GrowthSeoPage";
import fraudJson from "@/i18n/growth.fraudV2.json";
import seoJson from "@/i18n/growth.seoAutomation.json";

const G = "/api/v1/ops/growth"; const A = "/api/v1/admin/growth/fraud"; const S = "/api/v1/admin/growth/seo-automation";
const caps = (o: Record<string, boolean> = {}) => HttpResponse.json({ roles: ["ops_admin", "support"], capabilities: { read: true, readFinance: false, writeConfig: false, approveConfig: false, reviewFraud: true, manage: true, manageCampaigns: false, ...o } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const same = (j: { en: unknown; ar: unknown }) => { const e = new Set(flat(j.en)); const a = new Set(flat(j.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); };

const row = (o: Record<string, unknown> = {}) => ({ id: "cmcase0000000001", kind: "REWARD", score: 81, band: "HIGH", status: "OPEN", mode: "SHADOW", slaDueAt: "2027-01-10T10:00:00Z", breached: false, assignedTo: null, createdAt: "2027-01-08T10:00:00Z", subjectRef: "ab12cd34ef56", ...o });
const evidence = (o: Record<string, unknown> = {}) => ({
  case: { id: "cmcase0000000001", kind: "REWARD", score: 81, band: "HIGH", status: "OPEN", mode: "SHADOW", slaDueAt: null, assignedTo: null, decision: { decision: null, reverse: false, suspendDays: 0 }, decisionNote: null, decidedBy: null, createdAt: "2027-01-08T10:00:00Z", decidedAt: null, subjectRef: "ab12cd34ef56", ...o },
  signals: [{ ruleId: "r_redeem", weight: 81, evidenceRef: "rel:rel_1", at: "2027-01-08T10:00:00Z" }], checks: [{ relationshipRef: "rel_1", key: "RF_SELF", passed: true, detail: {}, at: "2027-01-08T10:00:00Z" }], log: [{ action: "OPENED", from: null, to: "OPEN", actor: "system:fraud", note: "HOLD 81", at: "2027-01-08T10:00:00Z" }],
});
const rules = (enforce = false) => ({ ruleIds: ["r_self", "r_farm"], editable: false, source: "PROPOSED_DEFAULT", config: { enforce, bands: { review: 30, hold: 70 }, diminishing: 0.6, reviewSlaHours: 48, holdDays: 30, suspendDays: 30, appealWindowDays: 14, banMaxDays: 180, twoPersonOnMoney: true, rules: { r_self: { enabled: true, weight: 100, cap: 100, enforce: false }, r_farm: { enabled: true, weight: 70, cap: 75, enforce: enforce } }, actions: { REWARD: { REVIEW: "OPEN_CASE", HOLD: "HOLD_REWARD" } }, thresholds: { touchBurstPerMinute: 20 }, version: null } });
const base = (cases = [row()], can = true) => server.use(
  http.get(`${G}/access`, () => caps({ reviewFraud: can })), http.get(`${A}/cases/summary`, () => HttpResponse.json({ open: [{ kind: "REWARD", band: "HIGH", mode: "SHADOW", count: 1 }], breached: 0 })),
  http.get(`${A}/cases`, () => HttpResponse.json({ rows: cases })), http.get(`${A}/cases/cmcase0000000001`, () => HttpResponse.json(evidence())),
);

describe("fraud and SEO automation i18n", () => {
  it("English and Arabic carry the same keys", () => { same(fraudJson); same(seoJson); });
});

describe("Fraud management (GRW-P3-D)", () => {
  it("the case queue shows risk, mode and the review deadline, with a shadow banner on the rules tab", async () => {
    base(); renderOps(<GrowthFraudPage />, { route: "/growth/fraud" });
    expect(await screen.findByTestId("case-open-cmcase0000000001")).toHaveTextContent("00000001");
    const stats = screen.getByTestId("fraud-case-stats"); expect(within(stats).getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shadow").length).toBeGreaterThan(0); expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    server.use(http.get(`${A}/rules`, () => HttpResponse.json(rules())));
    await userEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect(await screen.findByTestId("fraud-mode-banner")).toHaveTextContent(/Shadow mode/); expect(screen.getByTestId("fraud-config-link")).toHaveAttribute("href", "/growth/config");
    expect(screen.getByTestId("fraud-rules-source")).toHaveTextContent("PROPOSED_DEFAULT");
  });

  it("a case shows hashed evidence only, and a decision needs a reason; reversing reward value announces the second person", async () => {
    base(); let posted: Record<string, unknown> | null = null;
    server.use(http.post(`${A}/cases/cmcase0000000001/decision`, async ({ request }) => { posted = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ status: "CONFIRM_REQUESTED" }); }));
    renderOps(<GrowthFraudPage />, { route: "/growth/fraud" });
    await userEvent.click(await screen.findByTestId("case-open-cmcase0000000001"));
    const detail = await screen.findByTestId("fraud-case-detail"); expect(detail).toHaveTextContent("r_redeem"); expect(detail).toHaveTextContent("rel:rel_1"); expect(detail).not.toHaveTextContent(/@|\+20|sub_/);
    expect(screen.getByTestId("fraud-dismiss")).toBeDisabled();
    await userEvent.type(screen.getByTestId("fraud-note"), "Verified by phone: family");
    expect(screen.getByTestId("fraud-dismiss")).toBeEnabled();
    expect(screen.queryByTestId("fraud-two-person")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("fraud-reverse")); expect(screen.getByTestId("fraud-two-person")).toHaveTextContent(/second reviewer/i);
    await userEvent.type(screen.getByTestId("fraud-suspend"), "30"); await userEvent.click(screen.getByTestId("fraud-confirm"));
    await waitFor(() => expect(posted).toMatchObject({ decision: "CONFIRM", reverseRewards: true, suspendDays: 30 }));
    expect(await screen.findByText(/different reviewer must confirm/i)).toBeInTheDocument();
  });

  it("a reader without the reviewer capability sees the case but no action", async () => {
    base([row()], false); renderOps(<GrowthFraudPage />, { route: "/growth/fraud" });
    await userEvent.click(await screen.findByTestId("case-open-cmcase0000000001"));
    expect(await screen.findByTestId("fraud-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("fraud-confirm")).not.toBeInTheDocument(); expect(screen.queryByTestId("fraud-dismiss")).not.toBeInTheDocument();
  });

  it("bulk dismissal lists only low and medium cases and needs a written reason", async () => {
    base([row(), row({ id: "cmcase0000000002", band: "MEDIUM", score: 45 })]); let body: Record<string, unknown> | null = null;
    server.use(http.post(`${A}/cases/bulk-dismiss`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ requested: 1, dismissed: 1, skipped: 0 }); }));
    renderOps(<GrowthFraudPage />, { route: "/growth/fraud" });
    await screen.findByTestId("fraud-bulk");
    expect(screen.getAllByRole("checkbox", { name: /Select case/ })).toHaveLength(1); // the HIGH case has none
    await userEvent.click(screen.getByRole("checkbox", { name: /Select case/ })); expect(screen.getByTestId("fraud-bulk-go")).toBeDisabled();
    await userEvent.type(screen.getByTestId("fraud-bulk-reason"), "Reviewed together: legitimate siblings"); await userEvent.click(screen.getByTestId("fraud-bulk-go"));
    await waitFor(() => expect(body).toMatchObject({ ids: ["cmcase0000000002"], reason: "Reviewed together: legitimate siblings" }));
  });

  it("the shadow report hides precision until a rule has enough labels, and the fairness check masks small groups", async () => {
    base();
    server.use(
      http.get(`${A}/shadow-report`, () => HttpResponse.json({ days: 90, enforce: false, configVersion: null, wouldHaveBeenHeld: 3, rules: [{ ruleId: "r_farm", flagged: 30, labelled: 25, confirmed: 20, dismissed: 5, precision: 0.8, pending: 5, weight: 70, enforce: false }, { ruleId: "r_self", flagged: 4, labelled: 3, confirmed: 3, dismissed: 0, precision: null, pending: 1, weight: 100, enforce: false }] })),
      http.get(`${A}/fairness`, () => HttpResponse.json({ weekStart: "2027-01-01", language: [{ group: "ar", total: 200, held: 10, rate: 0.05, flagged: false }, { group: "en", total: "<10", held: "<10", rate: null, flagged: false }], city: [], note: "" })),
    );
    renderOps(<GrowthFraudPage />, { route: "/growth/fraud" }); await userEvent.click(await screen.findByRole("tab", { name: "Shadow report" }));
    expect(await screen.findByTestId("prec-r_farm")).toHaveTextContent("80.0%"); expect(screen.getByTestId("prec-r_self")).toHaveTextContent(/not enough labels/);
    expect(within(screen.getByTestId("fraud-fairness")).getAllByText("<10").length).toBeGreaterThanOrEqual(2);
  });

  it("renders in Arabic with the Arabic tab names and shows an error state with a retry", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/cases/summary`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })), http.get(`${A}/cases`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderOps(<GrowthFraudPage />, { route: "/growth/fraud", lang: "ar" });
    expect(await screen.findByRole("tab", { name: "الحالات" })).toBeInTheDocument(); expect(await screen.findByRole("button", { name: /إعادة|retry|حاول/i })).toBeInTheDocument();
  });
});

const overview = (o: Record<string, unknown> = {}) => ({ autoNoindex: false, configVersion: null, measured: true, bundleAvailable: true, byTemplate: [{ template: "doctor", pages: 16, failed: 4, avgScore: 88, checks: { "thin-content": 4 } }], worst: [{ pageKey: "doctor:dina-salem", locale: "ar", templateKind: "doctor", score: 80, failedChecks: ["thin-content"], noindex: true, checkedAt: "2027-01-08T02:00:00Z" }], pagesChecked: 25, wouldNoindex: 4, links: { total: 120, byRule: [{ rule: "DOCTOR_CLINIC", count: 16 }] }, orphans: ["district:cardiology/cairo/haram"], ...o });
describe("SEO automation tabs (GRW-P3-F)", () => {
  const go = async (tab: string) => { renderOps(<GrowthSeoPage />, { route: "/growth/seo" }); await userEvent.click(await screen.findByRole("tab", { name: tab })); };
  it("quality: the mode is stated, failing pages are listed with the check names, and a page is only 'noindex' when the toggle is on", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/overview`, () => HttpResponse.json(overview())));
    await go("Quality");
    expect(await screen.findByTestId("seo-auto-mode")).toHaveTextContent(/Automatic noindex is OFF/); expect(screen.getAllByText("Thin content", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText("report only")).toBeInTheDocument(); expect(screen.queryByText("noindex")).not.toBeInTheDocument();
    expect(screen.getByTestId("seo-run")).toBeInTheDocument();
  });
  it("quality: a gate that has never run says so honestly instead of showing zeros", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/overview`, () => HttpResponse.json(overview({ measured: false, byTemplate: [], worst: [], pagesChecked: 0, bundleAvailable: false }))));
    await go("Quality"); expect(await screen.findByTestId("seo-not-measured")).toHaveTextContent(/bundle is not built/i); expect(screen.queryByTestId("seo-quality-stats")).not.toBeInTheDocument();
  });
  it("links: totals by rule, orphan pages, and one page's links", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/overview`, () => HttpResponse.json(overview())), http.get(`${S}/links`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get("from") ? { from: "doctor:x", groups: [{ kind: "CLINIC", links: [{ label: { en: "Nile Clinic", ar: "عيادة النيل" }, path: "/en/eg/clinic/nile-clinic" }] }] } : { totals: overview().links })));
    await go("Links");
    expect(await screen.findByText("DOCTOR_CLINIC")).toBeInTheDocument(); expect(screen.getByTestId("seo-orphans")).toHaveTextContent("district:cardiology/cairo/haram");
    await userEvent.type(screen.getByTestId("seo-link-key"), "doctor:x"); await userEvent.click(screen.getByTestId("seo-link-go"));
    expect(await screen.findByRole("link", { name: "Nile Clinic" })).toHaveAttribute("href", "/en/eg/clinic/nile-clinic");
  });
  it("vitals: 'not measured' is stated plainly, then numbers with budgets and a breach flag; indexation shows 'not measured' for indexed", async () => {
    const none = { budgets: { lcpMs: 2500, inpMs: 200, cls: 0.1, tbtMs: 200, perfScore: 90 }, trend: [], latest: [], breaches: [], lab: { measured: false, note: "Not measured: the Lighthouse audit has not produced output." }, field: { measured: false, note: "Not measured: the CrUX adapter has not pulled rows." }, readiness: { productionIndexing: [{ key: "vitals_measured", ok: false }, { key: "vitals_within_budget", ok: false }] } };
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/vitals`, () => HttpResponse.json(none)), http.get(`${S}/indexation`, () => HttpResponse.json({ rows: [{ templateKind: "doctor", day: "2027-01-08", submitted: 16, indexed: null, excluded: 0, reasons: {}, indexedKnown: false }], note: "n" })));
    await go("Vitals");
    expect(await screen.findByTestId("vitals-lab-none")).toHaveTextContent(/Not measured/); expect(screen.getByTestId("vitals-field-none")).toBeInTheDocument(); expect(screen.getByTestId("indexed-doctor")).toHaveTextContent("not measured");
    expect(within(screen.getByTestId("vitals-readiness")).getAllByText("—")).toHaveLength(2);
  });
  it("vitals: measured lab numbers are compared with the budgets", async () => {
    const lab = { budgets: { lcpMs: 2500, inpMs: 200, cls: 0.1, tbtMs: 200, perfScore: 90 }, trend: [], latest: [{ templateKind: "clinic", metric: "lcp_ms", source: "LAB", day: "2027-01-08", p75: 2900, sampleSize: 3 }, { templateKind: "doctor", metric: "lcp_ms", source: "LAB", day: "2027-01-08", p75: 1800, sampleSize: 3 }], breaches: [{ templateKind: "clinic", metric: "lcp_ms", source: "LAB", value: 2900, budget: 2500 }], lab: { measured: true }, field: { measured: false, note: "Not measured: CrUX." }, readiness: { productionIndexing: [{ key: "vitals_measured", ok: true }, { key: "vitals_within_budget", ok: false }] } };
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/vitals`, () => HttpResponse.json(lab)), http.get(`${S}/indexation`, () => HttpResponse.json({ rows: [], note: "" })));
    await go("Vitals"); expect(await screen.findByText("Over budget")).toBeInTheDocument(); expect(screen.getByText("Within budget")).toBeInTheDocument();
  });
  it("renders in Arabic", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/overview`, () => HttpResponse.json(overview())));
    renderOps(<GrowthSeoPage />, { route: "/growth/seo", lang: "ar" });
    await userEvent.click(await screen.findByRole("tab", { name: "الجودة" })); expect(await screen.findByTestId("seo-auto-mode")).toHaveTextContent(/متوقف/);
  });
});

describe("accessibility of the fraud and SEO automation pages (axe, WCAG 2 A and AA structural rules)", () => {
  const run = async (container: HTMLElement) => (await import("axe-core")).default.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  const labText = { budgets: { lcpMs: 2500, inpMs: 200, cls: 0.1, tbtMs: 200, perfScore: 90 }, trend: [], latest: [{ templateKind: "doctor", metric: "lcp_ms", source: "LAB", day: "2027-01-08", p75: 1800, sampleSize: 1 }], breaches: [], lab: { measured: true }, field: { measured: false, note: "Not measured." }, readiness: { productionIndexing: [{ key: "vitals_measured", ok: true }, { key: "vitals_within_budget", ok: true }] } };
  it("fraud: the queue, a case, the rules and the shadow report; SEO: quality, links and vitals, in English and Arabic", async () => {
    for (const lang of ["en", "ar"] as const) {
      base();
      server.use(http.get(`${A}/rules`, () => HttpResponse.json(rules())), http.get(`${A}/shadow-report`, () => HttpResponse.json({ days: 90, enforce: false, configVersion: null, wouldHaveBeenHeld: 0, rules: [{ ruleId: "r_farm", flagged: 3, labelled: 2, confirmed: 1, dismissed: 1, precision: null, pending: 1, weight: 70, enforce: false }] })), http.get(`${A}/fairness`, () => HttpResponse.json({ weekStart: "2027-01-01", language: [{ group: "ar", total: "<10", held: "<10", rate: null, flagged: false }], city: [], note: "" })));
      const f = renderOps(<GrowthFraudPage />, { route: "/growth/fraud", lang });
      await screen.findByTestId("case-open-cmcase0000000001"); expect((await run(f.container)).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `${lang} cases`).toEqual([]);
      await userEvent.click(screen.getByTestId("case-open-cmcase0000000001")); await screen.findByTestId("fraud-case-detail"); expect((await run(f.container)).violations.map((v) => v.id), `${lang} case`).toEqual([]);
      await userEvent.click(screen.getByTestId("fraud-case-back")); await userEvent.click(screen.getByRole("tab", { name: lang === "en" ? "Rules" : "القواعد" })); await screen.findByTestId("fraud-rules-tab"); expect((await run(f.container)).violations.map((v) => v.id), `${lang} rules`).toEqual([]);
      await userEvent.click(screen.getByRole("tab", { name: lang === "en" ? "Shadow report" : "تقرير الوضع التجريبي" })); await screen.findByTestId("fraud-shadow-tab"); await screen.findByTestId("prec-r_farm"); expect((await run(f.container)).violations.map((v) => v.id), `${lang} shadow`).toEqual([]);
      f.unmount();
      server.use(http.get(`${G}/access`, () => caps()), http.get(`${S}/overview`, () => HttpResponse.json(overview())), http.get(`${S}/links`, () => HttpResponse.json({ totals: overview().links })), http.get(`${S}/vitals`, () => HttpResponse.json(labText)), http.get(`${S}/indexation`, () => HttpResponse.json({ rows: [{ templateKind: "doctor", day: "2027-01-08", submitted: 16, indexed: null, excluded: 2, reasons: { "thin-content": 2 }, indexedKnown: false }], note: "n" })));
      const s = renderOps(<GrowthSeoPage />, { route: "/growth/seo", lang });
      for (const [tab, id] of [[lang === "en" ? "Quality" : "الجودة", "seo-quality-tab"], [lang === "en" ? "Links" : "الروابط", "seo-links-tab"], [lang === "en" ? "Vitals" : "الأداء", "seo-vitals-tab"]] as const) {
        await userEvent.click(await screen.findByRole("tab", { name: tab })); await screen.findByTestId(id);
        expect((await run(s.container)).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `${lang} ${id}`).toEqual([]);
      }
      s.unmount();
    }
  });
});
