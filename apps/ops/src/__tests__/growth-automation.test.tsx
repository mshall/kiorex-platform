import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import AutomationRoute from "@/pages/growth/automation/Page";
import { emptyModel, fromGraph, toGraph, type Model } from "@/pages/growth/automation/model";
import i18nJson from "@/i18n/growth.automation.json";

const A = "/api/v1/admin/growth/automation"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage: false, manageCampaigns: manage, manageExperiments: manage, reviewPromotions: false } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const catalog = { nodeTypes: ["TRIGGER", "WAIT", "CONDITION", "SEND", "BRANCH_EXPERIMENT", "END"], triggers: ["REGISTERED", "STAGE_DORMANT", "VISIT_COMPLETED"], channels: ["PUSH", "WHATSAPP", "SMS", "EMAIL", "INAPP"], attributes: ["stage"], branchSurface: "lifecycle.winback.subject_line",
  policy: { maxNodes: 12, minWaitMinutes: 15, maxWaitMinutes: 129600, maxSendsPerJourney: 3, maxSendsPer30Days: 4 },
  templates: [{ key: "REENGAGE_DORMANT", messageClass: "MARKETING", channels: ["PUSH", "WHATSAPP", "SMS", "EMAIL"] }, { key: "FEEDBACK_REMINDER", messageClass: "TRANSACTIONAL", channels: ["PUSH", "WHATSAPP", "SMS", "EMAIL", "INAPP"] }] };
const status = (licence = false, automation = true) => ({ market: "EG", automation: { effective: automation, reason: automation ? "ON" : "OFF_GLOBAL" }, marketingLicence: { effective: licence, reason: licence ? "ON" : "AWAITING_GATE", flag: "growth.marketing_messaging" }, lifecycleJourneys: true });
const graph = { schema: 1, nodes: [{ id: "start", type: "TRIGGER", event: "STAGE_DORMANT" }, { id: "n1", type: "SEND", template: "REENGAGE_DORMANT", channels: ["PUSH"] }, { id: "n2", type: "WAIT", minutes: 10080 }, { id: "n3", type: "SEND", template: "REENGAGE_DORMANT" }, { id: "end", type: "END" }], edges: [{ from: "start", to: "n1" }, { from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "end" }] };
const journey = (o: Record<string, unknown> = {}) => ({ id: "j1", market: "EG", key: "winback-2", version: 1, status: "DRAFT", name: "Win-back, two steps", graph, checksum: "c", createdBy: "test-ops-1", approvedBy: null, submittedAt: null, publishedAt: null, retiredAt: null, killedAt: null, killedBy: null, killReason: null, createdAt: "2027-01-28T10:00:00Z", ...o });
const detail = (o: Record<string, unknown> = {}) => ({ ...journey(o), compiled: null, activeEnrolments: 3, runLog: [{ day: "2027-01-28", enrolled: 5, sent: 3, skipped: 2, ended: 1, byReason: {} }] });
const common = () => [http.get(`${G}/access`, () => caps()), http.get(`${A}/catalog`, () => HttpResponse.json(catalog)), http.get(`${A}/status`, () => HttpResponse.json(status()))];

describe("automation i18n", () => {
  it("English and Arabic carry the same keys; Arabic has no English placeholder text", () => {
    const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar));
    expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]);
    expect(JSON.stringify(i18nJson.ar)).not.toMatch(/Journey|Marketing automation|Consent and gate/);
  });
});

describe("form model", () => {
  it("round-trips the builder shapes: trigger, wait, condition, send and a split", () => {
    const m: Model = { trigger: "STAGE_DORMANT", steps: [{ kind: "SEND", template: "REENGAGE_DORMANT", channels: ["PUSH"] }, { kind: "WAIT", value: 7, unit: "days" }, { kind: "CONDITION", stage: ["DORMANT"], language: ["ar"], platform: [], hasDependants: "no", lastBookingMin: "30", lastBookingMax: "" }, { kind: "SEND", template: "REENGAGE_DORMANT", channels: [] }], split: null };
    expect(fromGraph(toGraph(m))).toEqual(m);
    const s: Model = { trigger: "VISIT_COMPLETED", steps: [{ kind: "WAIT", value: 90, unit: "minutes" }], split: { experiment: "winback-subject-test", arms: [{ variant: "control", template: "REENGAGE_DORMANT", channels: [] }, { variant: "short", template: "REFERRAL_NUDGE", channels: ["PUSH"] }] } };
    expect(fromGraph(toGraph(s))).toEqual(s);
  });
  it("converts units to minutes and never emits an unknown node type", () => {
    const g = toGraph({ trigger: "REGISTERED", steps: [{ kind: "WAIT", value: 2, unit: "hours" }, { kind: "WAIT", value: 3, unit: "days" }], split: null });
    expect(g.nodes.filter((n) => n.type === "WAIT").map((n) => n.minutes)).toEqual([120, 4320]);
    expect(g.nodes.every((n) => ["TRIGGER", "WAIT", "CONDITION", "SEND", "BRANCH_EXPERIMENT", "END"].includes(n.type))).toBe(true);
  });
  it("a graph the form cannot draw (a loop, a clinical-looking condition key, a mid-path split) is not editable", () => {
    const loop = { schema: 1 as const, nodes: [{ id: "start", type: "TRIGGER", event: "REGISTERED" }, { id: "a", type: "SEND", template: "WELCOME" }], edges: [{ from: "start", to: "a" }, { from: "a", to: "start" }] };
    expect(fromGraph(loop)).toBeNull();
    expect(fromGraph({ schema: 1, nodes: [{ id: "start", type: "TRIGGER", event: "REGISTERED" }, { id: "c", type: "CONDITION", segment: { weird: ["x"] } }, { id: "e", type: "END" }], edges: [{ from: "start", to: "c" }, { from: "c", to: "e" }] })).toBeNull();
  });
  it("the empty model is the starter win-back journey", () => { expect(emptyModel()).toMatchObject({ trigger: "STAGE_DORMANT", steps: [{ kind: "SEND", template: "REENGAGE_DORMANT" }] }); });
});

describe("Automation list (GRW-P3-E)", () => {
  it("lists journeys with status, shows the marketing licence banner, and a New button only for a super admin", async () => {
    server.use(...common(), http.get(`${A}/journeys`, () => HttpResponse.json([journey(), journey({ id: "j2", key: "feedback", version: 2, status: "PUBLISHED", name: "Feedback", killedAt: "2027-01-29T00:00:00Z" })])));
    renderOps(<AutomationRoute />, { route: "/growth/automation" });
    expect(await screen.findByTestId("auto-row-winback-2-1")).toHaveTextContent("Draft");
    expect(screen.getByTestId("auto-row-feedback-2")).toHaveTextContent("Stopped by kill switch");
    expect(await screen.findByTestId("auto-banner-licence")).toHaveTextContent(/every marketing send is skipped/i);
    expect(await screen.findByTestId("auto-new")).toBeInTheDocument();
  });
  it("hides New from a read-only role, and tells an automation OFF market that nothing can be published", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${A}/catalog`, () => HttpResponse.json(catalog)), http.get(`${A}/status`, () => HttpResponse.json(status(true, false))), http.get(`${A}/journeys`, () => HttpResponse.json([])));
    renderOps(<AutomationRoute />, { route: "/growth/automation" });
    expect(await screen.findByTestId("auto-empty")).toBeInTheDocument(); expect(screen.queryByTestId("auto-new")).toBeNull();
    expect(await screen.findByTestId("auto-banner-off")).toBeInTheDocument(); expect(screen.getByTestId("auto-banner-licence")).toHaveTextContent(/is effective/i);
  });
});

describe("Journey builder (GRW-P3-E)", () => {
  it("builds a two-step journey, validates on the server, shows the inserted consent and gate marker, and posts the closed graph", async () => {
    let sent: unknown; let validated = 0;
    server.use(...common(), http.post(`${A}/validate`, () => { validated++; return HttpResponse.json({ valid: true, errors: [], checksum: "x", compiled: { steps: [], gateNodes: [], truncated: false, trigger: "STAGE_DORMANT", key: "auto.eg.k" } }); }),
      http.post(`${A}/journeys`, async ({ request }) => { sent = await request.json(); return HttpResponse.json(journey({ id: "jnew" }), { status: 201 }); }));
    renderOps(<AutomationRoute />, { route: "/growth/automation?new=1" });
    await userEvent.type(await screen.findByTestId("auto-key"), "winback-2"); await userEvent.type(screen.getByTestId("auto-name"), "Win-back");
    expect(screen.getByTestId("auto-gate-note-0")).toHaveTextContent(/cannot be removed/i); expect(screen.getByTestId("flow-gate")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("auto-add-wait")); await userEvent.clear(screen.getByTestId("auto-wait-value-1")); await userEvent.type(screen.getByTestId("auto-wait-value-1"), "7");
    await userEvent.click(screen.getByTestId("auto-add-send"));
    await waitFor(() => expect(screen.getByTestId("auto-check-state")).toHaveTextContent("passes every check"), { timeout: 3000 });
    expect(validated).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("auto-save"));
    await waitFor(() => expect(sent).toBeTruthy());
    expect(sent).toMatchObject({ key: "winback-2", name: "Win-back", graph: { schema: 1, nodes: [{ id: "start", type: "TRIGGER", event: "STAGE_DORMANT" }, { type: "SEND", template: "REENGAGE_DORMANT" }, { type: "WAIT", minutes: 10080 }, { type: "SEND" }, { type: "END" }] } });
    expect(JSON.stringify(sent)).not.toMatch(/GATE|script|code/i);
  });
  it("shows the server's validation errors in words with their path, and blocks saving", async () => {
    server.use(...common(), http.post(`${A}/validate`, () => HttpResponse.json({ valid: false, errors: [{ code: "WAIT_RANGE", path: "/nodes/2/minutes", message: "x" }, { code: "CLINICAL_REFERENCE", path: "/nodes/3/segment/specialty", message: "y" }] })));
    renderOps(<AutomationRoute />, { route: "/growth/automation?new=1" });
    await userEvent.type(await screen.findByTestId("auto-key"), "bad-one");
    expect(await screen.findByTestId("auto-error-WAIT_RANGE", {}, { timeout: 3000 })).toHaveTextContent("between 15 minutes and 90 days");
    expect(screen.getByTestId("auto-error-CLINICAL_REFERENCE")).toHaveTextContent(/Health, provider or order information cannot be used/);
    expect(screen.getByTestId("auto-error-WAIT_RANGE")).toHaveTextContent("/nodes/2/minutes");
    expect(screen.getByTestId("auto-save")).toBeDisabled();
  });
  it("the form offers only catalogue triggers, templates and channels (no free text anywhere for a message)", async () => {
    server.use(...common(), http.post(`${A}/validate`, () => HttpResponse.json({ valid: true, errors: [], checksum: "x", compiled: { steps: [], gateNodes: [], truncated: false, trigger: "x", key: "x" } })));
    renderOps(<AutomationRoute />, { route: "/growth/automation?new=1" });
    const trig = await screen.findByTestId("auto-trigger"); await waitFor(() => expect(within(trig).getAllByRole("option")).toHaveLength(3));
    const tpl = screen.getByTestId("auto-send-template-0"); expect(within(tpl).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["REENGAGE_DORMANT", "FEEDBACK_REMINDER"]);
    expect(screen.getByTestId("auto-form").querySelectorAll("textarea")).toHaveLength(0);
    for (const c of ["PUSH", "WHATSAPP", "SMS", "EMAIL"]) expect(screen.getByTestId(`auto-send-ch-${c}-0`)).toBeInTheDocument();
    expect(screen.queryByTestId("auto-send-ch-INAPP-0")).toBeNull(); // in-app is not a marketing channel
  });
  it("a published journey is read-only, shows counts only, and offers retire and the kill switch (reason required)", async () => {
    let killed: unknown;
    server.use(...common(), http.get(`${A}/journeys/j1`, () => HttpResponse.json(detail({ status: "PUBLISHED", approvedBy: "adm_b", publishedAt: "2027-01-28T11:00:00Z" }))), http.post(`${A}/journeys/j1/kill`, async ({ request }) => { killed = await request.json(); return HttpResponse.json(journey()); }));
    renderOps(<AutomationRoute />, { route: "/growth/automation?id=j1" });
    expect(await screen.findAllByTestId("flow-gate")).toHaveLength(2); expect(screen.queryByTestId("auto-form")).toBeNull(); expect(screen.queryByTestId("auto-save")).toBeNull();
    expect(screen.getByTestId("auto-active")).toHaveTextContent("3"); expect(screen.getByTestId("auto-runlog")).toHaveTextContent("2027-01-28");
    expect(screen.getByTestId("auto-kill")).toBeDisabled(); await userEvent.type(screen.getByTestId("auto-kill-reason"), "copy under review"); await userEvent.click(screen.getByTestId("auto-kill"));
    await waitFor(() => expect(killed).toEqual({ reason: "copy under review" })); expect(screen.getByTestId("auto-retire")).toBeInTheDocument();
  });
  it("the author who tries to approve is told in words that a different person must (two-person rule)", async () => {
    server.use(...common(), http.get(`${A}/journeys/j1`, () => HttpResponse.json(detail({ status: "PENDING_APPROVAL" }))), http.post(`${A}/journeys/j1/approve`, () => HttpResponse.json({ code: "JOURNEY_TWO_PERSON_RULE", message: "x" }, { status: 403 })));
    renderOps(<AutomationRoute />, { route: "/growth/automation?id=j1" });
    await userEvent.click(await screen.findByTestId("auto-approve"));
    expect(await screen.findByTestId("auto-error")).toHaveTextContent("A different person must approve this journey.");
  });
  it("a read-only role sees the flow and no actions", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${A}/catalog`, () => HttpResponse.json(catalog)), http.get(`${A}/status`, () => HttpResponse.json(status())), http.get(`${A}/journeys/j1`, () => HttpResponse.json(detail({ status: "PENDING_APPROVAL" }))));
    renderOps(<AutomationRoute />, { route: "/growth/automation?id=j1" });
    expect(await screen.findByTestId("flow")).toBeInTheDocument(); expect(screen.queryByTestId("auto-approve")).toBeNull(); expect(screen.getByTestId("auto-needs-role")).toBeInTheDocument();
  });
  it("renders in Arabic with the same structure", async () => {
    server.use(...common(), http.get(`${A}/journeys/j1`, () => HttpResponse.json(detail({ status: "PUBLISHED", approvedBy: "adm_b" }))));
    renderOps(<AutomationRoute />, { route: "/growth/automation?id=j1", lang: "ar" });
    expect((await screen.findAllByTestId("flow-gate"))[0]).toHaveTextContent("الموافقة والبوابة"); expect(screen.getByTestId("flow-trigger")).toHaveTextContent("شخص يصبح غير نشط");
  });
});

describe("Dry run (GRW-P3-E)", () => {
  it("runs the saved journey on a synthetic cohort and shows volumes, reasons and exits; says when the licence flag is off", async () => {
    let body: unknown;
    server.use(...common(), http.get(`${A}/journeys/j1`, () => HttpResponse.json(detail())), http.post(`${A}/dry-run`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ checksum: "c", compiled: {}, result: { cohort: 1000, seed: 1, steps: [{ step: 1, template: "REENGAGE_DORMANT", messageClass: "MARKETING", reached: 1000, sent: 0, skipped: { MARKETING_FLAG_OFF: 1000 }, deferred: 0 }], totalSent: 0, exits: { CONDITION_FALSE: 12 }, gateNodes: [], perPersonMax: 3, marketingFlagOn: false, note: { en: "", ar: "" } } }); }));
    renderOps(<AutomationRoute />, { route: "/growth/automation?id=j1&view=dryrun" });
    await waitFor(() => expect(screen.getByTestId("dry-run")).not.toBeDisabled()); await userEvent.click(screen.getByTestId("dry-run"));
    expect(await screen.findByTestId("dry-step-1")).toHaveTextContent("Marketing licence flag 1000"); expect(screen.getByTestId("dry-flag-off")).toBeInTheDocument();
    expect(screen.getByTestId("dry-sent-1")).toHaveTextContent("0"); expect(screen.getByText(/Condition not met 12/)).toBeInTheDocument();
    expect(body).toMatchObject({ size: 1000, graph: { schema: 1 } });
  });
});
