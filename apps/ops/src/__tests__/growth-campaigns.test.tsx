import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CampaignsPage from "@/pages/growth/campaigns/CampaignsPage";
import PromotionsPage from "@/pages/growth/campaigns/PromotionsPage";
import CampaignWizard from "@/pages/growth/campaigns/CampaignWizard";
import CampaignDetailPage from "@/pages/growth/campaigns/CampaignDetailPage";
import ApprovalsPage from "@/pages/growth/campaigns/ApprovalsPage";
import { previewLinks, utmErrors } from "@/pages/growth/campaigns/UtmBuilder";

const G = "/api/v1/ops/growth"; const C = "/api/v1/admin/growth/campaigns";
const caps = (manage: boolean) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: true, writeConfig: true, approveConfig: true, reviewFraud: true, manage: true, manageCampaigns: manage } });
const brief = (o: Record<string, unknown> = {}) => ({ id: "cmp_1", market: "EG", key: "ramadan", utmCampaign: "eg-ramadan", name: "Ramadan check-up", objective: "ACQUISITION", status: "ACTIVE", channels: ["EMAIL"], budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000, currency: "EGP", startsAt: "2027-01-01T00:00:00Z", endsAt: "2027-02-01T00:00:00Z", ownerSub: "adm_a", pauseReason: null, version: 1, createdAt: "2027-01-01T00:00:00Z", approvedSpendMinor: 250_000, utilisationBp: 2500, ...o });
const full = (o: Record<string, unknown> = {}) => ({ ...brief(), eligibility: { cities: ["Cairo"], patientType: "NEW" }, utmConfig: {}, landingPageId: null, policyVersionId: "pv1", activatedAt: null, completedAt: null, archivedAt: null, autoExpiresAt: null, pausedUntil: null, statusReason: null, thresholdsFiredBp: [],
  links: { webUrl: "https://kiorex.com/ar/eg?utm_source=kiorex&utm_medium=email&utm_campaign=eg-ramadan", appLink: "https://kiorex.com/ar/eg?utm_source=kiorex&utm_medium=email&utm_campaign=eg-ramadan", landingPath: "/ar/eg", utm: {} },
  approval: { required: true, reasons: ["POLICY_FLAG"], current: true, payloadHash: "a".repeat(64), pending: [] }, budget: { approvedSpendMinor: 250_000, pendingSpendMinor: 0, utilisationBp: 2500, remainingMinor: 750_000 },
  actions: [{ to: "PAUSED", allowed: true }, { to: "COMPLETED", allowed: true }], ...o });
const report = (o: Record<string, unknown> = {}) => ({ campaign: brief(), range: { from: "2027-01-01", to: "2027-01-31" }, budget: { totalMinor: 1_000_000, dailyMinor: 100_000, approvedSpendMinor: 250_000, pendingSpendMinor: 0, utilisationBp: 2500, currency: "EGP" },
  funnel: [{ stage: "PageViewed", count: 1000, masked: false }, { stage: "SlotSelected", count: "<10", masked: true }], kpis: { cpa: { count: 50, masked: false, values: { cpaMinor: 5000, conversionPct: 5 } }, cac: { count: "<10", masked: true, values: { cacMinor: "<10" } }, roas: { count: 50, masked: false, values: { roas: 0.8 } }, kMin: 10, mask: "<10" },
  revenue: { netMinor: 200_000, masked: false, note: "Kiorex commission revenue net of reversals" }, daily: [{ day: "2027-01-05", spendMinor: 250_000, pageViews: 1000, bookingsConfirmed: 50 }], bySource: [{ sourceKind: "CAMPAIGN", pageViews: 1000, bookingsConfirmed: 50 }], external: { connected: false, kinds: [], metrics: {} }, ...o });

describe("Campaign Management list (GRW-P2-A)", () => {
  it("shows the campaigns with state, budget meter and the plans-only banner; a super admin gets the New button", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(C, () => HttpResponse.json([brief(), brief({ id: "cmp_2", name: "Winter promo", status: "DRAFT", utmCampaign: "eg-winter", approvedSpendMinor: 0, utilisationBp: 0 })])));
    renderOps(<CampaignsPage />, { route: "/growth/campaigns" });
    expect(await screen.findByText("Ramadan check-up")).toBeInTheDocument();
    expect(screen.getByText("Winter promo")).toBeInTheDocument();
    expect(screen.getAllByTestId("campaign-status").map((e) => e.getAttribute("data-status"))).toEqual(["ACTIVE", "DRAFT"]);
    expect(screen.getAllByTestId("budget-meter")[0]).toHaveAttribute("data-bp", "2500");
    expect(screen.getByTestId("campaigns-plans-only")).toHaveTextContent(/never creates, edits or spends on an ad platform/i);
    expect(await screen.findByTestId("campaign-new")).toBeInTheDocument();
  });
  it("a user without the manage capability sees no New button and a read-only note", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(C, () => HttpResponse.json([])));
    renderOps(<CampaignsPage />, { route: "/growth/campaigns" });
    expect(await screen.findByTestId("campaigns-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("campaign-new")).toBeNull();
  });
  it("the status filter and the search reach the API as query parameters", async () => {
    const seen: string[] = []; server.use(http.get(`${G}/access`, () => caps(true)), http.get(C, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json([]); }));
    renderOps(<CampaignsPage />, { route: "/growth/campaigns" });
    await userEvent.selectOptions(await screen.findByTestId("campaign-status-filter"), "PAUSED"); await userEvent.type(screen.getByTestId("campaign-search"), "rama");
    await waitFor(() => expect(seen.some((s) => s.includes("status=PAUSED") && s.includes("q=rama"))).toBe(true));
  });
  it("Promotional Campaigns asks only for promotional campaigns and says it does not change a patient price", async () => {
    const seen: string[] = []; server.use(http.get(`${G}/access`, () => caps(true)), http.get(C, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json([brief({ objective: "PROMOTION" })]); }));
    renderOps(<PromotionsPage />, { route: "/growth/promotions" });
    expect(await screen.findByText("Ramadan check-up")).toBeInTheDocument(); expect(seen.some((s) => s.includes("promotional=1"))).toBe(true);
    expect(screen.getByTestId("campaigns-plans-only")).toHaveTextContent(/does not change a patient price/i); expect(screen.getByTestId("growth-page-promotions")).toBeInTheDocument();
  });
  it("renders in Arabic with RTL-ready text", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(C, () => HttpResponse.json([brief()])));
    renderOps(<CampaignsPage />, { route: "/growth/campaigns", lang: "ar" });
    expect(await screen.findByText("Ramadan check-up")).toBeInTheDocument(); expect(screen.getByTestId("campaigns-plans-only")).toHaveTextContent("خطط فقط"); expect(screen.getByTestId("campaign-status")).toHaveTextContent("نشطة");
  });
});

describe("UTM builder rules", () => {
  it("previews the same links as the server builder and flags invalid tokens", () => {
    const p = previewLinks({ market: "EG", key: "k1", channels: ["EMAIL"], form: { source: "", medium: "", content: "banner", term: "", targetPath: "/doctors" } });
    expect(p.url).toBe("https://kiorex.com/ar/eg/doctors?utm_source=kiorex&utm_medium=email&utm_campaign=eg-k1&utm_content=banner");
    expect(utmErrors({ source: "UPPER", medium: "ok", content: "", term: "", targetPath: "https://evil.example" })).toMatchObject({ source: true, medium: false, targetPath: true });
  });
});

describe("Campaign wizard", () => {
  const open = (route = "/growth/campaigns/new") => renderOps(<Routes><Route path="/growth/campaigns/new" element={<CampaignWizard />} /><Route path="/growth/campaigns/:id" element={<div data-testid="landed" />} /></Routes>, { route });
  it("walks the five steps, validates each, previews the tracked link and posts the plan; the audience carries only non-clinical keys", async () => {
    let posted: Record<string, unknown> | null = null;
    server.use(http.get(`${G}/access`, () => caps(true)), http.post(C, async ({ request }) => { posted = (await request.json()) as Record<string, unknown>; return HttpResponse.json(full({ id: "cmp_new" }), { status: 201 }); }));
    open();
    const next = await screen.findByTestId("cw-next"); expect(next).toBeDisabled();
    await userEvent.type(screen.getByTestId("cw-name"), "Ramadan check-up"); await userEvent.type(screen.getByTestId("cw-key"), "Bad Key"); expect(next).toBeDisabled();
    await userEvent.clear(screen.getByTestId("cw-key")); await userEvent.type(screen.getByTestId("cw-key"), "ramadan-checkup"); await userEvent.type(screen.getByTestId("cw-starts"), "2027-03-01T09:00"); await userEvent.type(screen.getByTestId("cw-ends"), "2027-03-30T09:00");
    await userEvent.click(next);
    expect(next).toBeDisabled(); await userEvent.type(screen.getByTestId("cw-total"), "10000"); await userEvent.type(screen.getByTestId("cw-daily"), "500");
    await userEvent.click(screen.getByTestId("cw-channel-WHATSAPP")); expect(screen.getByTestId("cw-sensitive")).toBeInTheDocument(); await userEvent.click(screen.getByTestId("cw-channel-WHATSAPP"));
    await userEvent.click(next);
    expect(screen.getByTestId("cw-audience")).toHaveTextContent(/never a specialty/i); await userEvent.selectOptions(screen.getByTestId("cw-patient-type"), "NEW"); await userEvent.type(screen.getByTestId("cw-cities"), "Cairo, Giza");
    await userEvent.click(next);
    await userEvent.type(screen.getByTestId("utm-content"), "banner-a"); await userEvent.type(screen.getByTestId("utm-path"), "/doctors");
    expect(screen.getByTestId("utm-tag")).toHaveTextContent("eg-ramadan-checkup"); expect(screen.getByTestId("utm-url")).toHaveTextContent("utm_content=banner-a");
    await userEvent.click(next);
    expect(screen.getByTestId("cw-approval-note")).toHaveTextContent(/second approver/i);
    await userEvent.click(screen.getByTestId("cw-create"));
    expect(await screen.findByTestId("landed")).toBeInTheDocument();
    expect(posted).toMatchObject({ key: "ramadan-checkup", name: "Ramadan check-up", objective: "ACQUISITION", budgetTotalMinor: 1_000_000, budgetDailyMinor: 50_000, channels: ["EMAIL"], eligibility: { patientType: "NEW", cities: ["Cairo", "Giza"] }, utmConfig: { content: "banner-a", targetPath: "/doctors" } });
    expect(Object.keys((posted as unknown as { eligibility: object }).eligibility).join(" ")).not.toMatch(/specialty|provider|doctor|diagnos/i);
  });
  it("a promotional wizard starts with the Promotion objective; a server error is shown in words", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.post(C, () => HttpResponse.json({ code: "CAMPAIGN_KEY_TAKEN", message: "exists" }, { status: 409 })));
    open("/growth/campaigns/new?objective=PROMOTION");
    expect((await screen.findByTestId("cw-objective")) as HTMLSelectElement).toHaveValue("PROMOTION");
    await userEvent.type(screen.getByTestId("cw-name"), "Winter promo"); await userEvent.type(screen.getByTestId("cw-key"), "winter-promo");
    for (let i = 0; i < 1; i++) await userEvent.click(screen.getByTestId("cw-next"));
    await userEvent.type(screen.getByTestId("cw-total"), "500"); for (let i = 0; i < 3; i++) await userEvent.click(screen.getByTestId("cw-next"));
    await userEvent.click(screen.getByTestId("cw-create"));
    expect(await screen.findByTestId("cw-error")).toHaveTextContent("A campaign with this key already exists.");
  });
  it("without the manage capability the create button is disabled and a read-only note is shown", async () => {
    server.use(http.get(`${G}/access`, () => caps(false))); open();
    expect(await screen.findByTestId("wizard-readonly")).toBeInTheDocument();
  });
});

describe("Campaign detail", () => {
  const open = (lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/growth/campaigns/:id" element={<CampaignDetailPage />} /></Routes>, { route: "/growth/campaigns/cmp_1", lang });
  it("shows budget, approval state, the audience, tracked links and only the transitions that exist; a blocked one is disabled with its reason", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/cmp_1`, () => HttpResponse.json(full({ actions: [{ to: "PAUSED", allowed: true }, { to: "COMPLETED", allowed: false, code: "CAMPAIGN_INVALID_TRANSITION", message: "Not now" }] }))));
    open();
    expect(await screen.findByTestId("campaign-name")).toHaveTextContent("Ramadan check-up"); expect(screen.getByTestId("campaign-tag")).toHaveTextContent("eg-ramadan");
    expect(screen.getByTestId("campaign-budget")).toHaveTextContent(/10,000|١٠٬٠٠٠/); expect(screen.getByTestId("approval-state")).toHaveTextContent(/second approver/i);
    expect(screen.getByTestId("eligibility-list")).toHaveTextContent("Cairo"); expect(screen.getByTestId("campaign-links")).toHaveTextContent("utm_campaign=eg-ramadan");
    expect(screen.getByTestId("action-PAUSED")).toBeEnabled(); expect(screen.getByTestId("action-COMPLETED")).toBeDisabled(); expect(screen.getByTestId("action-reasons")).toHaveTextContent("Not now"); expect(screen.queryByTestId("action-ARCHIVED")).toBeNull();
  });
  it("pausing asks for a reason first and sends it with the transition", async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/cmp_1`, () => HttpResponse.json(full())), http.post(`${C}/cmp_1/transition`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json(full({ status: "PAUSED" })); }));
    open();
    await userEvent.click(await screen.findByTestId("action-PAUSED")); const ok = screen.getByTestId("reason-confirm"); expect(ok).toBeDisabled();
    await userEvent.type(screen.getByTestId("reason-input"), "Agency asked"); await userEvent.click(ok);
    await waitFor(() => expect(sent).toMatchObject({ to: "PAUSED", reason: "Agency asked" }));
  });
  it("a read-only user cannot press an action", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${C}/cmp_1`, () => HttpResponse.json(full())));
    open(); expect(await screen.findByTestId("action-PAUSED")).toBeDisabled();
  });
  it("performance: masked cells stay masked, a missing external number is 'Not connected' and never zero", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/cmp_1`, () => HttpResponse.json(full())), http.get(`${C}/cmp_1/report`, () => HttpResponse.json(report())));
    open(); await userEvent.click(await screen.findByTestId("tab-report"));
    const kpis = await screen.findByTestId("report-kpis"); expect(within(kpis).getAllByText("<10").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("report-funnel")).getByText(/Slots chosen/).closest("li")).toHaveTextContent("<10");
    expect(screen.getByTestId("report-external")).toHaveAttribute("data-connected", "false"); expect(screen.getByTestId("report-external")).toHaveTextContent(/no ad-platform numbers/i); expect(screen.getByTestId("report-external")).not.toHaveTextContent(/\b0\b/);
  });
  it("in Arabic the detail renders translated labels and the tabs are a real tablist", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/cmp_1`, () => HttpResponse.json(full())));
    open("ar"); expect(await screen.findByRole("tablist")).toBeInTheDocument(); expect(screen.getByTestId("tab-approvals")).toHaveTextContent("الموافقات"); expect(screen.getByTestId("campaign-status")).toHaveTextContent("نشطة");
  });
});

describe("Campaign approvals page", () => {
  const ap = (o: Record<string, unknown> = {}) => ({ id: "apr_1", campaignId: "cmp_1", kind: "ACTIVATE", requestedBy: "adm_a", requestedAt: "2027-01-01T00:00:00Z", decidedBy: null, decidedAt: null, decision: null, reason: null, snapshot: { payload: { budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000, currency: "EGP", channels: ["EMAIL"], startsAt: null, endsAt: null }, note: null }, snapshotHash: "b".repeat(64), campaign: { id: "cmp_1", key: "ramadan", name: "Ramadan check-up", status: "PENDING_APPROVAL", market: "EG", budgetTotalMinor: 1_000_000, currency: "EGP", channels: ["EMAIL"] }, ...o });
  it("the requester sees the request but no decision buttons; another admin approves with the payload hash they reviewed", async () => {
    let decided: Record<string, unknown> | null = null;
    server.use(http.get(`${G}/access`, () => caps(true)),
      http.get(`${C}/approvals`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get("status") === "pending" ? [ap({ requestedBy: "test-ops-1" }), ap({ id: "apr_2" })] : [])),
      http.post(`${C}/approvals/apr_2/decide`, async ({ request }) => { decided = (await request.json()) as Record<string, unknown>; return HttpResponse.json(ap({ id: "apr_2", decision: "APPROVED" })); }));
    renderOps(<ApprovalsPage />, { route: "/growth/approvals" });
    const cards = await screen.findAllByTestId("approval-card"); expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByTestId("approval-self")).toBeInTheDocument(); expect(within(cards[0]!).queryByTestId("approval-approve")).toBeNull();
    await userEvent.click(within(cards[1]!).getByTestId("approval-approve"));
    await waitFor(() => expect(decided).toMatchObject({ decision: "APPROVED", snapshotHash: "b".repeat(64) }));
  });
  it("a rejection needs a reason", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/approvals`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get("status") === "pending" ? [ap({ id: "apr_3" })] : [])));
    renderOps(<ApprovalsPage />, { route: "/growth/approvals" });
    const reject = await screen.findByTestId("approval-reject"); expect(reject).toBeDisabled(); await userEvent.type(screen.getByTestId("approval-reason"), "Too high"); expect(reject).toBeEnabled();
  });
  it("an empty queue says so", async () => {
    server.use(http.get(`${G}/access`, () => caps(true)), http.get(`${C}/approvals`, () => HttpResponse.json([])));
    renderOps(<ApprovalsPage />, { route: "/growth/approvals" }); expect(await screen.findByTestId("approvals-empty")).toBeInTheDocument();
  });
});
