import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import LifecyclePage from "@/pages/growth/lifecycle/Page";
import JourneyDetailPage from "@/pages/growth/lifecycle/JourneyDetailPage";
import SendGatePage from "@/pages/growth/lifecycle/SendGatePage";
import SuppressionPage from "@/pages/growth/lifecycle/SuppressionPage";
import growthLifecycle from "@/i18n/growth.lifecycle.json";

const G = "/api/v1/ops/growth"; const L = "/api/v1/admin/growth/lifecycle";
const caps = (manage: boolean) => HttpResponse.json({ roles: ["ops_admin"], capabilities: { read: true, readFinance: false, writeConfig: false, approveConfig: false, reviewFraud: false, manage, manageCampaigns: false } });
const step = (n: number, messageClass: string, kind: string, channels: string[], delayMinutes = 0) => ({ step: n, messageClass, kind, channels, delayMinutes });
const overview = (o: Record<string, unknown> = {}) => ({
  market: "EG", flags: { lifecycleJourneys: true, marketingMessaging: false },
  policy: { version: 1, source: "PROPOSED_DEFAULT", caps: { perDay: 1, perWeek: 3 }, quietHours: { start: "21:00", end: "09:00", timezone: "Africa/Cairo" }, holdoutBps: 500 },
  journeys: [
    { key: "welcome", trigger: "REGISTERED", anchored: false, describe: { en: "Welcome card after registration.", ar: "بطاقة ترحيب بعد التسجيل." }, enabled: true, activeEnrolments: 4, hasMarketingStep: false, steps: [step(1, "TRANSACTIONAL", "WELCOME", ["INAPP"])] },
    { key: "reengagement", trigger: "STAGE_DORMANT", anchored: true, describe: { en: "A generic message to dormant people.", ar: "رسالة عامة للأشخاص غير النشطين." }, enabled: false, activeEnrolments: 0, hasMarketingStep: true, steps: [step(1, "MARKETING", "REENGAGE_DORMANT", ["PUSH", "WHATSAPP"]), step(2, "MARKETING", "REENGAGE_DORMANT", ["PUSH"], 43200)] },
  ], ...o,
});
const tpl = [
  { kind: "WELCOME", messageClass: "TRANSACTIONAL", purpose: "TRANSACTIONAL", promotional: false, copyReview: "PENDING", templateId: "TODO_NEEDS_HUMAN_welcome", en: "Welcome to Kiorex. Your account is ready.", ar: "أهلاً بيك في كيوريكس. حسابك جاهز." },
  { kind: "REENGAGE_DORMANT", messageClass: "MARKETING", purpose: "MARKETING", promotional: true, copyReview: "PENDING", templateId: "TODO_NEEDS_HUMAN_reengage_dormant", en: "It has been a while.", ar: "بقالك فترة غايب." },
];
const use = (extra: Parameters<typeof server.use> = [] as never) => server.use(
  http.get(`${G}/access`, () => caps(true)), http.get(L, () => HttpResponse.json(overview())), http.get(`${L}/funnel`, () => HttpResponse.json([{ stage: "REGISTERED", count: 120 }, { stage: "DORMANT", count: null }])), http.get(`${L}/templates`, () => HttpResponse.json(tpl)), ...(extra as never[]),
);

describe("Lifecycle CRM console (GRW-P2-E)", () => {
  it("lists the journeys with class badges, state and active people; marketing is shown as locked off; the privacy note is visible", async () => {
    use(); renderOps(<LifecyclePage />, { route: "/growth/lifecycle" });
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Re-engagement")).toBeInTheDocument();
    const policy = screen.getByTestId("lifecycle-policy");
    expect(within(policy).getByText("Off (launch-locked)")).toBeInTheDocument();
    expect(within(policy).getByText("1 / 3")).toBeInTheDocument();
    expect(within(policy).getByText(/21:00 - 09:00/)).toBeInTheDocument();
    expect(screen.getAllByTestId("class-MARKETING").length).toBeGreaterThan(0);
    expect(screen.getByTestId("lifecycle-privacy")).toHaveTextContent(/k >= 10/);
  });
  it("the stage funnel shows <10 instead of a small count", async () => {
    use(); renderOps(<LifecyclePage />, { route: "/growth/lifecycle" });
    const f = await screen.findByTestId("lifecycle-funnel");
    expect(within(f).getByText("120")).toBeInTheDocument(); expect(within(f).getByText("<10")).toBeInTheDocument();
  });
  it("the template catalogue shows the class badge, the copy review state and both languages", async () => {
    use(); renderOps(<LifecyclePage />, { route: "/growth/lifecycle" });
    expect(await screen.findByText("TODO_NEEDS_HUMAN_reengage_dormant")).toBeInTheDocument();
    expect(screen.getAllByText("Review pending")).toHaveLength(2);
    expect(screen.getByText("بقالك فترة غايب.")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("It has been a while.")).toHaveAttribute("lang", "en");
  });
  it("renders in Arabic with Arabic labels and no raw keys", async () => {
    use(); renderOps(<LifecyclePage />, { route: "/growth/lifecycle", lang: "ar" });
    expect(await screen.findByText("الترحيب")).toBeInTheDocument();
    expect(screen.getByText("إعادة التفاعل")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/growth\.lifecycle\./);
  });
  it("a journey page shows its steps in order with the channel order and a marketing note", async () => {
    use(); renderOps(<Routes><Route path="/growth/lifecycle/:key" element={<JourneyDetailPage />} /></Routes>, { route: "/growth/lifecycle/reengagement" });
    expect(await screen.findByTestId("journey-detail")).toBeInTheDocument();
    expect(screen.getByTestId("journey-marketing-note")).toBeInTheDocument();
    expect(screen.getAllByText("Push > WhatsApp")).toHaveLength(1);
    expect(screen.getByText("After 43200 min")).toBeInTheDocument();
  });
  it("the send gate page groups decisions by reason code with a plain explanation and totals", async () => {
    use([http.get(`${L}/decisions`, ({ request }) => { expect(new URL(request.url).searchParams.get("days")).toBe("7"); return HttpResponse.json([{ journeyKey: "welcome", messageClass: "TRANSACTIONAL", decision: "SEND", reason: "OK", count: 9 }, { journeyKey: "reengagement", messageClass: "MARKETING", decision: "SKIP", reason: "MARKETING_FLAG_OFF", count: 5 }]); })] as never);
    renderOps(<SendGatePage />, { route: "/growth/lifecycle/send-gate" });
    expect(await screen.findByText("MARKETING_FLAG_OFF")).toBeInTheDocument();
    expect(screen.getByText("Marketing messages are off")).toBeInTheDocument();
    expect(screen.getByTestId("gate-totals")).toHaveTextContent("Sent 9 · Not sent 5");
  });
  it("suppression: adding needs an address and a written reason; lifting is two steps and never shows an address", async () => {
    const posts: unknown[] = [];
    use([
      http.get(`${L}/suppressions`, () => HttpResponse.json([{ id: "sup_1", market: "EG", channel: "SMS", reason: "STOP", source: "whatsapp", createdAt: "2027-03-01T10:00:00Z", liftedAt: null, hashTail: "a1b2c3" }])),
      http.post(`${L}/suppressions`, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ id: "sup_2" }, { status: 201 }); }),
      http.post(`${L}/suppressions/sup_1/lift-request`, () => HttpResponse.json({ requestId: "a1", state: "AWAITING_SECOND_PERSON" })),
      http.post(`${L}/suppressions/sup_1/lift-approve`, () => HttpResponse.json({ error: { code: "GROWTH_CONFIG_SELF_APPROVAL", message: "The person who asked cannot approve it" } }, { status: 403 })),
    ] as never);
    renderOps(<SuppressionPage />, { route: "/growth/lifecycle/suppression" });
    expect(await screen.findByText("…a1b2c3")).toBeInTheDocument();
    const submit = screen.getByTestId("suppression-submit"); expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Phone or e-mail/), "+201000000555"); await userEvent.type(screen.getByLabelText(/Reason \(written\)/), "asked by phone");
    expect(submit).toBeEnabled(); await userEvent.click(submit);
    await waitFor(() => expect(posts).toHaveLength(1)); expect(posts[0]).toMatchObject({ address: "+201000000555", channel: "ALL", note: "asked by phone" });
    expect(await screen.findByTestId("suppression-msg")).toHaveTextContent("Suppression added");
    await userEvent.click(screen.getByTestId("lift-sup_1"));
    const panel = screen.getByTestId("lift-panel"); expect(within(panel).getByTestId("lift-request")).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText(/Consent evidence/), "Written opt-in, scan ref 77");
    await userEvent.click(within(panel).getByTestId("lift-request"));
    expect(await screen.findByTestId("suppression-msg")).toHaveTextContent("second person");
    await userEvent.click(within(panel).getByTestId("lift-approve"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/403|cannot approve/);
    expect(document.body.textContent).not.toContain("201000000");
  });
  it("without the manage capability the suppression list is read only", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${L}/suppressions`, () => HttpResponse.json([])));
    renderOps(<SuppressionPage />, { route: "/growth/lifecycle/suppression" });
    expect(await screen.findByTestId("suppression-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("suppression-add")).toBeNull();
  });
  it("English and Arabic catalogues have the same keys and the same placeholders", () => {
    const flat = (o: Record<string, unknown>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const get = (o: unknown, path: string) => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o) as string;
    const en = growthLifecycle.en.growth.lifecycle; const ar = growthLifecycle.ar.growth.lifecycle;
    expect(flat(en).sort()).toEqual(flat(ar).sort());
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const k of flat(en)) { expect(get(en, k).length, k).toBeGreaterThan(0); expect(get(ar, k).length, k).toBeGreaterThan(0); expect(ph(get(en, k)), k).toBe(ph(get(ar, k))); }
  });
});
