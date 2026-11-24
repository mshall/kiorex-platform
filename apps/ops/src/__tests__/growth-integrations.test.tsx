import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import GrowthIntegrationsPage from "@/pages/growth/GrowthIntegrationsPage";
import GrowthChannelsPage from "@/pages/growth/GrowthChannelsPage";
import integrationsI18n from "@/i18n/growth.integrations.json";

const G = "/api/v1/ops/growth"; const A = "/api/v1/admin/growth";
const caps = (manage: boolean) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: true, writeConfig: true, approveConfig: true, reviewFraud: true, manage, manageCampaigns: manage } });
const row = (o: Record<string, unknown> = {}) => ({ kind: "googleads", label: "Google Ads", mode: "mock", flagEffective: true, flagReason: "ON", secretRefSet: false, secretRefConfigured: false, accountLabelSet: false, pullSchedule: "daily", rateBudgetPerHour: 60, retentionMonths: 25, location: "Kiorex cell (frankfurt)", fallback: "manual spend entry", defaultOff: false, circuit: "CLOSED", consecutiveFailures: 0, lastOkAt: null, lastErrorAt: null, lastRun: null, health: { ok: true, detail: "synthetic" }, connected: false, synthetic: false, ...o });
const legacy = { market: "EG", selection: {}, whatsappPhoneNumberIdRef: null, selectionVersion: null, selectionSource: null, providers: [], planned: [], flags: [], rule: "" };
const perf = (o: Record<string, unknown> = {}) => ({ market: "EG", range: { from: "2027-01-01", to: "2027-01-30" }, currency: "EGP", kMin: 10, spendFloorMinor: 50_000, definitions: { cac: "spend / attended new patients" },
  channels: [{ kind: "googleads", label: "Google Ads", connected: true, synthetic: true, lastRunAt: null, paid: true, metrics: { spendMinor: 120_000, impressions: 9000, clicks: 300, conversions: 12, ctrPct: 3.33, cpcMinor: 400, cpmMinor: 13_333 } }, { kind: "tiktok", label: "TikTok Ads", connected: false, synthetic: false, lastRunAt: null, paid: true, metrics: null }],
  campaigns: [{ key: "eg-winter", campaignId: "c1", name: "Winter", status: "ACTIVE", synthetic: true, external: { spendMinor: 120_000, impressions: 9000, clicks: 300, conversions: 12, cpcMinor: 400, ctrPct: 3.33 }, firstParty: { attendedNewPatients: "<10", bookingsConfirmed: 14 }, spend: { approvedMinor: 100_000, externalMinor: 120_000, usedMinor: 120_000, source: "ADAPTER", deltaBp: 2000, conflict: true, note: "ADAPTER_WINS" }, cacMinor: "<10", cacHidden: "K_ANONYMITY", roas: null, roasHidden: "FINANCE_ONLY", revenueToDateMinor: null }],
  mix: [{ key: "PAID", count: "<10" }, { key: "ORGANIC", count: 40 }], blended: { spendMinor: 120_000, rewardCostMinor: 20_000, attendedNewPatients: 40, cacWithoutRewardsMinor: 3000, cacWithRewardsMinor: 3500, hidden: null, merHidden: "FINANCE_ONLY", mer: null },
  appFunnel: { storeConnected: false, installsStore: null, listingViews: null, installsFirstParty: 0, registrations: 0, firstCompletedBookings: 0, installToRegistrationPct: null, registrationToFirstBookingPct: null }, organic: [], vitals: [], notConnected: ["tiktok"], gaps: ["SYNTHETIC_DATA_PRESENT", "SPEND_CONFLICT:eg-winter"], ...o });

const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const stripPlural = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");

describe("integrations i18n (GRW-P2-F)", () => {
  it("English and Arabic carry the same keys (plural forms aside)", () => {
    const en = new Set(flat(integrationsI18n.en).map(stripPlural)); const ar = new Set(flat(integrationsI18n.ar).map(stripPlural));
    expect([...en].filter((k) => !ar.has(k))).toEqual([]); expect([...ar].filter((k) => !en.has(k))).toEqual([]);
  });
});

describe("Integrations page (GRW-P2-F)", () => {
  const base = (manage = true) => [http.get(`${G}/access`, () => caps(manage)), http.get(`${G}/integrations`, () => HttpResponse.json(legacy)), http.get(`${A}/integration-runs`, () => HttpResponse.json([{ id: "r1", kind: "googleads", mode: "mock", status: "FAILED", rows: 0, error: "UPSTREAM_STATUS", windowFrom: "2027-01-01", windowTo: "2027-01-02", startedAt: "2027-01-02T10:00:00Z", finishedAt: null }]))];
  it("lists mode, circuit state, secret reference presence as words (never a value) and the run history with its error code", async () => {
    server.use(...base(), http.get(`${A}/integration-status`, () => HttpResponse.json({ market: "EG", integrations: [row(), row({ kind: "metaads", label: "Meta Ads", mode: "real", circuit: "OPEN", consecutiveFailures: 5, secretRefConfigured: true, secretRefSet: false })], rules: { secrets: "", data: "", conversions: "" } })));
    renderOps(<GrowthIntegrationsPage />, { route: "/growth/integrations" });
    expect(await screen.findByTestId("ig-mode-googleads")).toHaveTextContent(/mock/i); expect(screen.getByTestId("ig-mode-metaads")).toHaveTextContent(/real/i);
    expect(screen.getByTestId("ig-circuit-metaads")).toHaveTextContent(/open/i); expect(screen.getByTestId("integration-rules")).toHaveTextContent(/No patient, booking, provider or health field leaves/i);
    expect(await screen.findByText("UPSTREAM_STATUS")).toBeInTheDocument();
  });
  it("a mock integration pulls directly; a real one asks for a request id and needs a confirmation", async () => {
    let ran: unknown = null; let requested = false; let confirmed: unknown = null;
    server.use(...base(), http.get(`${A}/integration-status`, () => HttpResponse.json({ market: "EG", integrations: [row(), row({ kind: "metaads", label: "Meta Ads", mode: "real" })], rules: { secrets: "", data: "", conversions: "" } })),
      http.post(`${A}/integrations/googleads/run`, async ({ request }) => { ran = await request.json(); return HttpResponse.json({ status: "OK", rows: 12 }); }),
      http.post(`${A}/integrations/metaads/run-requests`, () => { requested = true; return HttpResponse.json({ requestId: "aud_123" }); }),
      http.post(`${A}/integrations/metaads/run`, async ({ request }) => { confirmed = await request.json(); return HttpResponse.json({ status: "FAILED", rows: 0, reason: "NEEDS_HUMAN" }); }));
    renderOps(<GrowthIntegrationsPage />, { route: "/growth/integrations" });
    await userEvent.click(await screen.findByTestId("ig-pull-googleads")); await waitFor(() => expect(ran).toMatchObject({ market: "EG" }));
    await userEvent.click(screen.getByTestId("ig-pull-metaads")); await waitFor(() => expect(requested).toBe(true));
    expect(await screen.findByTestId("ig-request-metaads")).toHaveTextContent("aud_123");
    await userEvent.type(screen.getByPlaceholderText(/request id/i), "aud_123"); await userEvent.click(screen.getByTestId("ig-confirm-metaads"));
    await waitFor(() => expect(confirmed).toMatchObject({ requestId: "aud_123" }));
  });
  it("a read-only user sees no pull button", async () => {
    server.use(...base(false), http.get(`${A}/integration-status`, () => HttpResponse.json({ market: "EG", integrations: [row()], rules: { secrets: "", data: "", conversions: "" } })));
    renderOps(<GrowthIntegrationsPage />, { route: "/growth/integrations" });
    expect(await screen.findByTestId("ig-test-googleads")).toBeInTheDocument(); expect(screen.queryByTestId("ig-pull-googleads")).toBeNull();
  });
  it("renders in Arabic RTL", async () => {
    server.use(...base(), http.get(`${A}/integration-status`, () => HttpResponse.json({ market: "EG", integrations: [row()], rules: { secrets: "", data: "", conversions: "" } })));
    renderOps(<GrowthIntegrationsPage />, { route: "/growth/integrations", lang: "ar" });
    expect(await screen.findByText("تكاملات التسويق")).toBeInTheDocument();
  });
});

describe("Channel performance panel (GRW-P2-F)", () => {
  const chBase = [http.get(`${G}/access`, () => caps(true)), http.get(`${G}/channels`, () => HttpResponse.json({ kinds: [], sources: [] }))];
  it("shows not connected (not zero), synthetic labels, hidden CAC with its reason, the reconciliation note and both blended CAC figures", async () => {
    server.use(...chBase, http.get(`${A}/channel-performance`, () => HttpResponse.json(perf())));
    renderOps(<GrowthChannelsPage />, { route: "/growth/channels" });
    expect(await screen.findByTestId("channel-performance")).toBeInTheDocument();
    expect(screen.getByTestId("perf-state-tiktok")).toHaveTextContent(/not connected/i); expect(screen.getByTestId("perf-state-googleads")).toHaveTextContent(/connected/i);
    expect(screen.getByTestId("perf-cac-eg-winter")).toHaveTextContent("<10"); expect(screen.getByText(/fewer than 10 people/i)).toBeInTheDocument();
    expect(screen.getByTestId("perf-rec-eg-winter")).toHaveTextContent(/adapter figure used/i);
    const blended = within(screen.getByTestId("perf-blended")); expect(blended.getByText(/CAC without rewards/i)).toBeInTheDocument(); expect(blended.getByText(/CAC with rewards/i)).toBeInTheDocument();
    expect(screen.getByTestId("perf-gaps")).toHaveTextContent(/winter/i); expect(screen.getByTestId("perf-mix")).toHaveTextContent("<10");
  });
  it("an API error shows the error state with a retry", async () => {
    server.use(...chBase, http.get(`${A}/channel-performance`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderOps(<GrowthChannelsPage />, { route: "/growth/channels" });
    expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});
