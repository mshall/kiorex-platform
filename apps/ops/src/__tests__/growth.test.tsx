import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import i18n from "@/i18n";
import { GrowthNav } from "@/components/growth/GrowthNav";
import { GROWTH_SECTIONS, PLANNED_SECTIONS } from "@/components/growth/sections";
import GrowthPlannedPage from "@/pages/growth/GrowthPlannedPage";
import GrowthIntegrationsPage from "@/pages/growth/GrowthIntegrationsPage";
import GrowthExecutivePage from "@/pages/growth/GrowthExecutivePage";
import GrowthAttributionPage from "@/pages/growth/GrowthAttributionPage";
import GrowthFinancePage from "@/pages/growth/GrowthFinancePage";

const G = "/api/v1/ops/growth";
const caps = (o: Record<string, boolean> = {}) => ({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: true, writeConfig: true, approveConfig: true, reviewFraud: true, manage: true, ...o } });
const ATTR = { providerTouchWindowDays: 30, patientReferralWindowDays: 30, campaignClickWindowDays: 7, campaignViewWindowHours: 0, visitorKeyMaxDays: 180, newPatientLookbackMonths: 24, touchEvidenceRetentionMonths: 25, unlinkedTouchRetentionMonths: 13, minDwellMsForProviderTouch: 1000, ltTokenTtlMinutes: 30, precedence: "PROVIDER_FIRST", allowOfflineEvidence: false };
const schema = { type: "object", additionalProperties: false, required: ["providerTouchWindowDays", "precedence"], properties: { providerTouchWindowDays: { type: "integer", minimum: 1, maximum: 90, description: "Provider window" }, precedence: { enum: ["PROVIDER_FIRST", "LAST_NON_DIRECT", "FIRST_TOUCH"] }, allowOfflineEvidence: { type: "boolean" } } };
const row = (o: Record<string, unknown> = {}) => ({ id: "v1", kind: "ATTRIBUTION_POLICY", scope: "GLOBAL", scopeId: "", version: 1, status: "ACTIVE", payload: ATTR, effectiveFrom: "2026-11-24T00:00:00Z", effectiveTo: null, createdBy: "adm_a", createdAt: "2026-11-24T00:00:00Z", approvedBy: "adm_b", approvedAt: "2026-11-24T00:00:00Z", ticket: "T-1", reason: null, announcement: null, checksum: "x", supersedesId: null, ...o });
function mockConfig(rows: unknown[], access = caps(), inForceSource = "ACTIVE") {
  server.use(
    http.get(`${G}/access`, () => HttpResponse.json(access)),
    http.get(`${G}/config/kinds`, () => HttpResponse.json([{ kind: "ATTRIBUTION_POLICY", note: "Windows and precedence", moneyPolicy: true, schema, defaults: ATTR }])),
    http.get(`${G}/config/in-force`, () => HttpResponse.json({ kind: "ATTRIBUTION_POLICY", scope: "GLOBAL", scopeId: "", version: 1, versionId: "v1", source: inForceSource, effectiveFrom: null, payload: ATTR, scheduled: [] })),
    http.get(`${G}/config/propagation`, () => HttpResponse.json({ kind: "ATTRIBUTION_POLICY", scope: "GLOBAL", scopeId: "", cacheTtlMs: 5000, inForceVersion: 1, converged: false, stale: 1, liveReaders: 2, readers: [{ instanceId: "api@a:1", reader: "config-service", version: 1, loadedAt: "2026-11-24T00:00:00Z", lastSeenAt: "2026-11-24T00:00:00Z", live: true, upToDate: true }, { instanceId: "api@b:2", reader: "config-service", version: 0, loadedAt: "2026-11-24T00:00:00Z", lastSeenAt: "2026-11-24T00:00:00Z", live: true, upToDate: false }], scheduled: [] })),
    http.get(`${G}/config`, () => HttpResponse.json(rows)),
    http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }])),
  );
}

describe("Growth navigation", () => {
  it("lists the 22 founder sections plus configuration versions, in order, and marks the planned ones", async () => {
    renderOps(<GrowthNav />, { route: "/growth" });
    const items = await screen.findAllByRole("link");
    expect(items).toHaveLength(GROWTH_SECTIONS.length);
    expect(GROWTH_SECTIONS.filter((s) => s.key !== "config")).toHaveLength(22);
    expect(items.map((a) => a.getAttribute("data-testid"))).toEqual(GROWTH_SECTIONS.map((s) => `growth-nav-${s.key}`));
    expect(within(screen.getByTestId("growth-nav-campaigns")).getByText("P2")).toBeInTheDocument();
    expect(within(screen.getByTestId("growth-nav-experiments")).getByText("P3")).toBeInTheDocument();
    expect(within(screen.getByTestId("growth-nav-seo")).queryByText(/^P\d$/)).toBeNull();
  });
  it("is collapsed outside /growth and expands on demand", async () => {
    renderOps(<GrowthNav />, { route: "/flags" });
    const toggle = screen.getByTestId("growth-nav-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false"); expect(screen.queryByTestId("growth-nav-seo")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true"); expect(screen.getByTestId("growth-nav-seo")).toBeInTheDocument();
  });
});

describe("Planned pages are honest", () => {
  it.each(PLANNED_SECTIONS.map((s) => [s.key, s.phase] as const))("%s shows Planned: Phase %s with scope and dependencies and offers no action", async (key, phase) => {
    renderOps(<GrowthPlannedPage section={key} />, { route: `/growth/${key}` });
    expect(await screen.findByTestId("planned-title")).toHaveTextContent(`Planned: Phase ${phase}`);
    expect(screen.getAllByTestId("planned-scope")[0]!.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("planned-deps").querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("planned-today")).not.toBeEmptyDOMElement();
    const box = screen.getByTestId("planned-state");
    expect(box.querySelectorAll("form, input, select, textarea, button")).toHaveLength(0);
  });
  it("renders in Arabic with right-to-left text and the same structure", async () => {
    renderOps(<GrowthPlannedPage section="rewards" />, { route: "/growth/rewards", lang: "ar" });
    expect(await screen.findByTestId("planned-title")).toHaveTextContent("مخطط: المرحلة 2");
    await i18n.changeLanguage("en");
  });
});

describe("Integration management never shows a secret", () => {
  it("shows modes and secret REFERENCES, and has no input that could take a secret", async () => {
    server.use(http.get(`${G}/integrations`, () => HttpResponse.json({ market: "EG", selection: { whatsapp: true }, whatsappPhoneNumberIdRef: "prod/wa_phone_id", selectionVersion: 1, selectionSource: "ACTIVE", rule: "x",
      providers: [{ kind: "SMS", mode: "mock", provider: "gateway", apiUrlSet: false, senderIdSet: false, secretRefs: [{ name: "SMS_API_KEY", set: true }, { name: "SMS_WEBHOOK_SECRET", set: false }], problems: [], ready: true, selected: null }, { kind: "WHATSAPP", mode: "real", provider: "meta", apiUrlSet: true, senderIdSet: false, secretRefs: [{ name: "WHATSAPP_API_KEY", set: false }], problems: ["WHATSAPP_SENDER_ID is required when WHATSAPP_MODE=real"], ready: false, selected: true }],
      planned: [{ key: "google_ads", phase: 3, label: "Google Ads", direction: "push", note: "x" }], flags: [{ key: "growth.marketing_messaging", effective: false, reason: "GATE" }] })),
      http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }])));
    renderOps(<GrowthIntegrationsPage />, { route: "/growth/integrations" });
    expect(await screen.findByTestId("mode-SMS")).toHaveTextContent("Mock");
    expect(screen.getByTestId("mode-WHATSAPP")).toHaveTextContent("Real");
    expect(screen.getByText("SMS_API_KEY")).toBeInTheDocument(); expect(screen.getByText(/WHATSAPP_SENDER_ID is required/)).toBeInTheDocument();
    expect(screen.getByTestId("secret-rule")).toBeInTheDocument();
    expect(document.querySelectorAll("input, textarea, [type=password]")).toHaveLength(0);
    expect(screen.getByTestId("integration-selection")).toHaveTextContent("whatsapp: On");
  });
});

describe("Executive overview", () => {
  const base = { source: "internal", days: 30, market: "EG", since: "2026-10-25T00:00:00Z", funnel: [{ name: "PageViewed", count: 12 }, { name: "BookingConfirmed", count: 3 }], origins: [{ origin: "PROVIDER_LED", count: 2 }, { origin: "MARKETPLACE", count: 1 }], reasons: [{ reason: "PROVIDER_TOUCH_IN_WINDOW", count: 2 }], touchesBySource: [{ sourceKind: "DIRECT", count: 9 }], providerLedShare: 2 / 3, fraudOpen: 1, activeWidgets: 2, landingPages: { total: 5, indexable: 3 }, slugs: 4,
    config: [{ kind: "ATTRIBUTION_POLICY", source: "PROPOSED_DEFAULT", version: 1, scope: "GLOBAL", scopeId: "", effectiveFrom: null, pending: 1, scheduled: 0 }] };
  it("falls back to the raw tables and says so when analytics v1 does not answer", async () => {
    server.use(http.get(`${G}/overview`, () => HttpResponse.json(base)), http.get("/api/v1/ops/growth-analytics/overview", () => HttpResponse.json({ code: "NOT_FOUND" }, { status: 404 })), http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }])));
    renderOps(<GrowthExecutivePage />, { route: "/growth" });
    expect(await screen.findByTestId("overview-stats")).toHaveTextContent("67%");
    expect(screen.getByTestId("overview-source")).toHaveTextContent("Raw growth tables");
    expect(screen.queryByTestId("overview-analytics")).toBeNull();
    expect(screen.getByTestId("funnel-BookingConfirmed")).toHaveTextContent("3");
    expect(screen.getByText("Proposed default (not approved)")).toBeInTheDocument();
  });
  it("uses analytics v1 when it answers and keeps its masked cells masked", async () => {
    server.use(http.get(`${G}/overview`, () => HttpResponse.json(base)), http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }])),
      http.get("/api/v1/ops/growth-analytics/overview", () => HttpResponse.json({ period: { from: "a", to: "b" }, k: 10, freshness: { rolledUpAt: "2026-11-24T08:00:00Z", lastEventAt: null }, bookings: 42, attendedNewPatients: "<10", providerLedShare: 61, originMix: { providerLed: 25, marketplace: 17, unattributed: "<10" } })));
    renderOps(<GrowthExecutivePage />, { route: "/growth" });
    const a = await screen.findByTestId("overview-analytics");
    expect(a).toHaveTextContent("42"); expect(a).toHaveTextContent("<10"); expect(a).toHaveTextContent("61%");
    expect(screen.getByTestId("overview-source")).toHaveTextContent("Analytics v1");
  });
});

describe("Financial performance is role-gated", () => {
  it("tells a non-finance user that the page is not for them and never requests the money endpoint", async () => {
    let asked = false;
    server.use(http.get(`${G}/access`, () => HttpResponse.json(caps({ readFinance: false }))), http.get(`${G}/finance`, () => { asked = true; return HttpResponse.json({}); }), http.get("/api/v1/markets", () => HttpResponse.json([{ code: "EG", live: true }])));
    renderOps(<GrowthFinancePage />, { route: "/growth/finance" });
    expect(await screen.findByTestId("finance-denied")).toBeInTheDocument(); expect(asked).toBe(false);
  });
});

describe("Configuration panel (maker-checker UI)", () => {
  const page = () => renderOps(<Routes><Route path="/growth/attribution" element={<GrowthAttributionPage />} /></Routes>, { route: "/growth/attribution" });

  it("shows what is in force, the propagation status and the versions with maker and checker", async () => {
    mockConfig([row(), row({ id: "v0", version: 0 })].slice(0, 1));
    page();
    expect(await screen.findByTestId("in-force-source")).toHaveTextContent("Version 1 in force");
    expect(screen.getByTestId("payload-summary")).toHaveTextContent("providerTouchWindowDays");
    expect(screen.getByTestId("propagation")).toHaveTextContent("1 reader(s) still on an older version");
    expect(screen.getByTestId("cfg-status-1")).toHaveTextContent("In force");
  });
  it("marks a proposed default honestly when nobody approved a version", async () => {
    mockConfig([], caps(), "PROPOSED_DEFAULT"); page();
    expect(await screen.findByTestId("in-force-source")).toHaveTextContent("Proposed default (not approved)");
    expect(await screen.findByText("No version yet. The proposed default applies.")).toBeInTheDocument();
  });
  it("the author of a pending version sees a waiting note and no approve button; another super admin sees Approve", async () => {
    mockConfig([row({ id: "p1", version: 2, status: "PENDING_APPROVAL", createdBy: "test-ops-1", approvedBy: null }), row({ id: "p2", version: 3, status: "PENDING_APPROVAL", createdBy: "someone-else", approvedBy: null })]);
    page();
    expect(await screen.findByTestId("cfg-wait-2")).toHaveTextContent("Waiting for a second super admin");
    expect(screen.queryByTestId("cfg-approve-2")).toBeNull();
    expect(screen.getByTestId("cfg-approve-3")).toBeInTheDocument(); expect(screen.queryByTestId("cfg-wait-3")).toBeNull();
  });
  it("approves through a confirmation dialog and sends the approve call", async () => {
    const calls: string[] = [];
    mockConfig([row({ id: "p2", version: 3, status: "PENDING_APPROVAL", createdBy: "someone-else", approvedBy: null })]);
    server.use(http.post(`${G}/config/p2/approve`, () => { calls.push("approve"); return HttpResponse.json(row({ id: "p2", status: "APPROVED" })); }));
    page(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("cfg-approve-3"));
    expect(await screen.findByTestId("decide-dialog")).toHaveTextContent("second pair of eyes");
    await user.click(screen.getByTestId("decide-confirm"));
    await waitFor(() => expect(calls).toEqual(["approve"]));
  });
  it("an ops admin without the super admin role can read but has no drafting, approving or rollback controls", async () => {
    mockConfig([row({ id: "p2", version: 3, status: "PENDING_APPROVAL", createdBy: "someone-else", approvedBy: null }), row({ id: "old", version: 1, status: "SUPERSEDED" })], caps({ writeConfig: false, approveConfig: false, manage: false }));
    page();
    expect(await screen.findByTestId("cfg-review-3")).toBeInTheDocument();
    expect(screen.queryByTestId("cfg-new")).toBeNull(); expect(screen.queryByTestId("cfg-approve-3")).toBeNull(); expect(screen.queryByTestId("cfg-rollback-1")).toBeNull();
    expect(screen.getByText(/need the super admin role/)).toBeInTheDocument();
  });
  it("a money-policy draft needs an announcement text and sends the effective date; server errors are listed", async () => {
    const bodies: Record<string, unknown>[] = [];
    mockConfig([]);
    server.use(http.post(`${G}/config`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); return HttpResponse.json({ code: "GROWTH_CONFIG_INVALID", message: "Change refused by a guardrail", errors: ["/providerTouchWindowDays: 30 to 90 days is more than x2 in one version; change it in steps"] }, { status: 422 }); }));
    page(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("cfg-new"));
    const dlg = await screen.findByTestId("version-dialog");
    expect(within(dlg).getAllByText(/at least 7 days after approval/i).length).toBeGreaterThanOrEqual(1);
    const win = within(dlg).getByLabelText(/providerTouchWindowDays/); await user.clear(win); await user.type(win, "90");
    await user.type(screen.getByTestId("cfg-announcement"), "Providers: the window grows.");
    await user.click(screen.getByTestId("cfg-save"));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ kind: "ATTRIBUTION_POLICY", scope: "GLOBAL", announcement: "Providers: the window grows.", payload: { providerTouchWindowDays: 90 } });
    expect(typeof bodies[0]!.effectiveFrom).toBe("string");
    expect(await screen.findByTestId("config-errors")).toHaveTextContent("more than x2");
  });
  it("opens the compare dialog with the field-level diff and the checks", async () => {
    mockConfig([row({ id: "p2", version: 3, status: "PENDING_APPROVAL", createdBy: "someone-else", approvedBy: null })]);
    server.use(http.get(`${G}/config/p2/diff`, () => HttpResponse.json({ id: "p2", version: 3, against: { id: "v1", version: 1, status: "ACTIVE" }, againstIsDefault: false, changes: [{ path: "/providerTouchWindowDays", kind: "changed", before: 30, after: 45 }] })),
      http.get(`${G}/config/p2/validate`, () => HttpResponse.json({ valid: true, errors: [], warnings: ["/precedence changes"] })),
      http.get(`${G}/config/p2`, () => HttpResponse.json({ ...row({ id: "p2", version: 3, status: "PENDING_APPROVAL", createdBy: "someone-else", approvedBy: null }), audit: [{ id: "a1", actor: "someone-else", action: "growth.config.create", metadata: {}, createdAt: "2026-11-24T00:00:00Z" }] })));
    page(); await userEvent.click(await screen.findByTestId("cfg-review-3"));
    const list = await screen.findByTestId("diff-list");
    expect(list).toHaveTextContent("/providerTouchWindowDays"); expect(list).toHaveTextContent("45");
    expect(await screen.findByTestId("validate-result")).toHaveTextContent("Passes all checks");
    expect(screen.getByTestId("trail")).toHaveTextContent("growth.config.create");
  });
});
void MemoryRouter;
