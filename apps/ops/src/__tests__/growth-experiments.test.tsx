import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import ExperimentsRoute from "@/pages/growth/experiments/Page";
import i18nJson from "@/i18n/growth.experiments.json";

const A = "/api/v1/admin/growth/experiments"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage: false, manageCampaigns: false, manageExperiments: manage } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const exp = (o: Record<string, unknown> = {}) => ({ id: "e1", market: "EG", key: "home-hero-1", name: "Home hero copy", surface: "landing.home.hero_copy", hypothesis: "A shorter headline raises booking starts", status: "RUNNING", variants: [{ key: "control", weightBp: 5000 }, { key: "b", weightBp: 5000 }], allocationBp: 10000, eligibility: {}, primaryMetric: "booking_started", guardrails: [], mode: "FIXED", alphaBp: 500, minSample: 1000, plannedDays: 14, startedAt: "2027-02-01T00:00:00Z", stoppedAt: null, stopReason: null, createdBy: "adm_a", approvedBy: "adm_b", flagKey: null, createdAt: "2027-01-30T00:00:00Z", latestResult: null, events: [], ...o });
const catalog = { surfaces: [{ key: "landing.home.hero_copy", label: "Home page hero headline and sub-line", units: ["VISITOR"], ssr: true, platforms: ["web"] }], metrics: [{ key: "booking_started", event: "BookingInitiated", harmful: false, kind: "PRIMARY" }, { key: "message_opt_out", event: "MessageOptOut", harmful: true, kind: "GUARDRAIL" }], policy: { minRunDays: 7, srmAlpha: 0.001, maxConcurrentPerSurface: 1, kAnonymity: 10 } };

describe("experiments i18n", () => {
  it("English and Arabic carry the same keys, and Arabic has no English placeholder text", () => {
    const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar));
    expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]);
    expect(JSON.stringify(i18nJson.ar)).not.toMatch(/Experiments|Winner|Guardrail/);
  });
});

describe("Experiments page (GRW-P3-A)", () => {
  it("lists experiments with status chips, a policy line that names what can never be tested, and a New button only for a super admin", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json([exp(), exp({ id: "e2", key: "signup-vp", name: "Sign-up value", status: "PENDING_APPROVAL", approvedBy: null })])));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments" });
    expect(await screen.findByTestId("exp-row-home-hero-1")).toHaveTextContent("Running"); expect(screen.getByTestId("exp-row-signup-vp")).toHaveTextContent("Waiting for a second person");
    expect(screen.getByTestId("exp-policy")).toHaveTextContent(/never sit on emergency, triage, safety, consent/i); expect(await screen.findByTestId("exp-new")).toBeInTheDocument();
  });
  it("hides the New button from a read-only role", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(A, () => HttpResponse.json([])));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments" }); expect(await screen.findByTestId("exp-empty")).toBeInTheDocument(); expect(screen.queryByTestId("exp-new")).toBeNull();
  });
  it("the wizard posts the design, offers only catalogue surfaces, and shows the server's refusal for a forbidden surface in words", async () => {
    let sent: unknown; server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/catalog`, () => HttpResponse.json(catalog)),
      http.post(A, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ code: "EXPERIMENT_SURFACE_FORBIDDEN", message: "x" }, { status: 422 }); }));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments?new=1" });
    const surface = await screen.findByTestId("exp-surface"); await waitFor(() => expect(within(surface).getAllByRole("option")).toHaveLength(2)); // the empty option and the one allowed surface
    await userEvent.click(screen.getByTestId("exp-create")); expect(screen.getAllByText("Check this field.").length).toBeGreaterThan(2);
    await userEvent.type(screen.getByTestId("exp-key"), "home-hero-2"); await userEvent.type(screen.getByTestId("exp-name"), "Hero 2"); await userEvent.selectOptions(surface, "landing.home.hero_copy");
    await userEvent.type(screen.getByTestId("exp-hypothesis"), "A shorter headline raises starts"); await userEvent.type(screen.getByTestId("exp-guard-message_opt_out"), "0.5");
    await userEvent.click(screen.getByTestId("exp-create"));
    expect(await screen.findByTestId("exp-error")).toHaveTextContent(/not on the allowed list/);
    expect(sent).toMatchObject({ key: "home-hero-2", surface: "landing.home.hero_copy", variants: [{ key: "control", weightBp: 5000 }, { key: "b", weightBp: 5000 }], allocationBp: 10000, mode: "FIXED", guardrails: [{ metric: "message_opt_out", marginAbs: 0.005 }] });
  });
  it("a collecting experiment shows why nothing is shown yet and no winner, interval or p-value", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/e1`, () => HttpResponse.json(exp({ latestResult: { id: "r", experimentId: "e1", computedAt: "x", dayNumber: 3, verdict: "COLLECTING", srmP: 1, payload: { hidden: true, blockers: ["MIN_DAYS", "MIN_SAMPLE"], dayNumber: 3, arms: [{ variant: "control", n: 120, x: 12, rate: 0.1 }, { variant: "b", n: "<10", x: "<10", rate: null }], srm: { chi2: 0, pValue: 1, detected: false } } } }))));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments?id=e1" });
    expect(await screen.findByTestId("exp-verdict")).toHaveTextContent("Collecting data"); expect(screen.getByTestId("exp-hidden")).toHaveTextContent(/minimum run time/i);
    expect(screen.getByTestId("arm-b")).toHaveTextContent("<10"); expect(screen.queryByTestId("exp-treatments")).toBeNull(); expect(screen.queryByText("Winner")).toBeNull();
  });
  it("a concluded winner shows the interval and offers a ship PROPOSAL that says it changes nothing by itself", async () => {
    let shipped = 0; server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/e1`, () => HttpResponse.json(exp({ status: "CONCLUDED", latestResult: { id: "r", experimentId: "e1", computedAt: "x", dayNumber: 14, verdict: "WINNER", srmP: 0.5, payload: { hidden: false, winner: "b", arms: [{ variant: "control", n: 1400, x: 140, rate: 0.1 }, { variant: "b", n: 1400, x: 224, rate: 0.16 }], treatments: [{ variant: "b", diff: 0.06, relativeLift: 0.6, ci: { low: 0.03, high: 0.09 }, pValue: 0.0001, pAdjusted: 0.0001, pAlwaysValid: null, significant: true, direction: "UP" }], guardrails: [{ metric: "message_opt_out", breach: false, observedDiff: 0, pAlwaysValid: 1 }] } } }))),
      http.post(`${A}/e1/ship-winner`, () => { shipped++; return HttpResponse.json({ requested: true, duplicate: false, proposal: {} }); }));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments?id=e1" });
    expect(await screen.findByTestId("exp-treatments")).toHaveTextContent("3.00% to 9.00%"); expect(screen.getByTestId("exp-guardrails")).toHaveTextContent("Within margin");
    expect(screen.getByText(/only records a proposal/i)).toBeInTheDocument(); await userEvent.click(screen.getByTestId("act-ship")); await waitFor(() => expect(shipped).toBe(1));
  });
  it("a running experiment needs a reason to stop; a pending one offers approve and shows the server's two-person refusal", async () => {
    let stop: unknown; server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/e1`, () => HttpResponse.json(exp())), http.post(`${A}/e1/stop`, async ({ request }) => { stop = await request.json(); return HttpResponse.json({}); }));
    const { unmount } = renderOps(<ExperimentsRoute />, { route: "/growth/experiments?id=e1" });
    const btn = await screen.findByTestId("act-stop"); expect(btn).toBeDisabled(); await userEvent.type(screen.getByTestId("stop-reason"), "copy under review"); expect(btn).toBeEnabled(); await userEvent.click(btn); await waitFor(() => expect(stop).toEqual({ reason: "copy under review" }));
    unmount();
    server.use(http.get(`${A}/e1`, () => HttpResponse.json(exp({ status: "PENDING_APPROVAL", approvedBy: null }))), http.post(`${A}/e1/approve`, () => HttpResponse.json({ code: "SECOND_APPROVER_REQUIRED", message: "x" }, { status: 403 })));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments?id=e1" }); await userEvent.click(await screen.findByTestId("act-approve"));
    expect(await screen.findByTestId("exp-action-error")).toHaveTextContent(/different super admin/i);
  });
  it("the history tab renders every event as text, never as markup", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/e1`, () => HttpResponse.json(exp())), http.get(`${A}/e1/history`, () => HttpResponse.json([{ id: "h1", experimentId: "e1", at: "2027-02-01T00:00:00Z", kind: "STOPPED", actor: "adm_a", reason: "<img src=x onerror=alert(1)> stop", diff: { note: "<script>alert(1)</script>" } }])));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments?id=e1&tab=history" });
    const row = await screen.findByTestId("hist-STOPPED"); expect(row).toHaveTextContent("<img src=x onerror=alert(1)> stop"); expect(row.querySelector("img")).toBeNull(); expect(row.querySelector("script")).toBeNull();
  });
  it("renders in Arabic: RTL labels, Arabic status and policy text", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json([exp()])));
    renderOps(<ExperimentsRoute />, { route: "/growth/experiments", lang: "ar" });
    expect(await screen.findByTestId("exp-row-home-hero-1")).toHaveTextContent("قيد التشغيل"); expect(screen.getByTestId("exp-policy")).toHaveTextContent("لا يمكن إجراء تجربة"); expect(document.documentElement.dir).toBe("rtl");
  });
  it("accessibility (axe, structural rules) is clean on the list, wizard and detail in English and Arabic", async () => {
    const axe = (await import("axe-core")).default;
    for (const lang of ["en", "ar"] as const) for (const route of ["/growth/experiments", "/growth/experiments?new=1", "/growth/experiments?id=e1"]) {
      server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json([exp()])), http.get(`${A}/catalog`, () => HttpResponse.json(catalog)), http.get(`${A}/e1`, () => HttpResponse.json(exp({ latestResult: { id: "r", experimentId: "e1", computedAt: "x", dayNumber: 3, verdict: "COLLECTING", srmP: 1, payload: { hidden: true, blockers: ["MIN_DAYS"], arms: [{ variant: "control", n: 120, x: 12, rate: 0.1 }] } } }))));
      const { container, unmount } = renderOps(<ExperimentsRoute />, { route, lang });
      await screen.findByTestId(route.includes("new") ? "exp-wizard" : route.includes("id=") ? "exp-design" : "exp-list");
      const r = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `${lang} ${route}`).toEqual([]);
      unmount();
    }
  });
});
