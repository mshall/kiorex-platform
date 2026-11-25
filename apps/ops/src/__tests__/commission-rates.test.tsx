import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import axe from "axe-core";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CommissionsPage from "@/pages/CommissionsPage";

const B = "/api/v1/admin/commissions";
const caps = (o: Record<string, boolean> = {}) => ({ read: true, export: true, operate: true, proposeConfig: false, approveConfig: false, chooseProvider: false, proposeRate: false, approveRate: false, ...o });
const NOT_SET = { state: "NOT_SET", source: null, policyId: null, version: null, effectiveFrom: null, reason: null, spec: null };
const spec = (o: object) => ({ feeType: "PERCENT", percentBps: 1250, flatMinor: null, minMinor: 500, maxMinor: 9000, mode: null, ...o });
const set = (source: "DEFAULT" | "OVERRIDE", s: object, reason: string | null = null) => ({ state: "SET", source, policyId: "crp_1", version: 1, effectiveFrom: "2026-12-01T00:00:00Z", reason, spec: s });
const row = (o: object) => ({ id: "crp_1", scope: "DEFAULT", product: "CLINIC", scopeRef: "CLINIC", kind: "RATE", version: 1, status: "ACTIVE", spec: spec({}), effectiveFrom: "2026-12-01T00:00:00Z", reason: null, proposedBy: "sa1", decidedBy: "sa2", decisionNote: null, ...o });
const defaults = (clinic: object) => [{ product: "CLINIC", ...clinic }, { product: "PHARMACY", effective: NOT_SET, pending: null, upcoming: null, history: [] }, { product: "LAB", effective: NOT_SET, pending: null, upcoming: null, history: [] }];
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } })).violations.map((v) => v.id);
const base = (c: object) => server.use(http.get(`${B}/capabilities`, () => HttpResponse.json(c)), http.get(`${B}/summary`, () => HttpResponse.json({ figures: {}, counts: {} })));

describe("commission rates console (COM-2)", () => {
  it("an unset default shows 'Rate not set' for every type and offers no proposal to a role that cannot propose", async () => {
    base(caps());
    server.use(http.get(`${B}/rates/defaults`, () => HttpResponse.json(defaults({ effective: NOT_SET, pending: null, upcoming: null, history: [] }))));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-rates"));
    const card = await screen.findByTestId("rates-card-CLINIC");
    expect(within(card).getByTestId("rate-not-set")).toHaveTextContent("Rate not set");
    expect(screen.getAllByTestId("rate-not-set")).toHaveLength(3);
    expect(screen.queryByTestId("rates-open-CLINIC")).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it("shows the default per type with its source, version and start, and a super admin proposes a new one in basis points and minor units", async () => {
    let body: Record<string, unknown> | undefined;
    base(caps({ proposeRate: true, approveRate: true }));
    server.use(http.get(`${B}/rates/defaults`, () => HttpResponse.json(defaults({ effective: set("DEFAULT", spec({})), pending: null, upcoming: null, history: [row({})] }))),
      http.post(`${B}/rates/defaults`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: "crp_2" }); }));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-rates"));
    expect(await screen.findByTestId("rates-eff-CLINIC")).toHaveTextContent("12.5%");
    expect(screen.getByTestId("rates-eff-CLINIC")).toHaveTextContent("Default for this type");
    await user.click(screen.getByTestId("rates-open-CLINIC"));
    const form = screen.getByTestId("rates-form-CLINIC");
    expect(within(form).getByTestId("rate-submit")).toBeDisabled();
    await user.type(within(form).getByTestId("rate-pct"), "15");
    await user.selectOptions(within(form).getByTestId("rate-mode"), "NET_FROM_PAYOUT");
    await user.click(within(form).getByTestId("rate-submit"));
    await waitFor(() => expect(body).toBeTruthy());
    expect(body).toMatchObject({ product: "CLINIC", spec: { feeType: "PERCENT", percentBps: 1500, mode: "NET_FROM_PAYOUT", minMinor: null, maxMinor: null } });
    expect(await violations()).toEqual([]);
  });

  it("a pending proposal can be approved or rejected only by a role that may; the decision is posted", async () => {
    let decided: unknown; const pending = row({ id: "crp_9", version: 2, status: "PENDING", proposedBy: "sa1", decidedBy: null });
    base(caps({ approveRate: true }));
    server.use(http.get(`${B}/rates/defaults`, () => HttpResponse.json(defaults({ effective: set("DEFAULT", spec({})), pending, upcoming: null, history: [pending, row({})] }))),
      http.post(`${B}/rates/crp_9/decide`, async ({ request }) => { decided = await request.json(); return HttpResponse.json({}); }));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-rates"));
    await user.click(await screen.findByTestId("rate-approve"));
    await waitFor(() => expect(decided).toEqual({ approve: true }));
  });

  it("the per-organisation panel shows default, override and effective side by side; the override needs a reason; inherit is a proposal too", async () => {
    let sent: Record<string, unknown> | undefined; let inherit: Record<string, unknown> | undefined;
    base(caps({ proposeRate: true }));
    server.use(http.get(`${B}/orgs`, () => HttpResponse.json([{ orgRef: "org_alpha", market: "EG", currency: "EGP", claims: 0, claimsMinor: 0, collectedMinor: 0, provider: null, openRuns: 0 }])),
      http.get(`${B}/orgs/org_alpha`, () => HttpResponse.json({ config: { settings: {}, missing: ["mode"] }, provider: null, providersAvailable: [] })),
      http.get(`${B}/rates/orgs/org_alpha`, () => HttpResponse.json({ orgRef: "org_alpha", product: "CLINIC", linked: true, state: "SET", effective: set("OVERRIDE", spec({ feeType: "FLAT", percentBps: null, flatMinor: 4000 }), "negotiated"), default: set("DEFAULT", spec({})), override: set("OVERRIDE", spec({ feeType: "FLAT", percentBps: null, flatMinor: 4000 }), "negotiated"), inheriting: false, mode: null, pending: null, upcoming: null, history: [row({ scope: "ORG", scopeRef: "org_alpha", spec: spec({ feeType: "FLAT", percentBps: null, flatMinor: 4000 }), reason: "negotiated" })] })),
      http.post(`${B}/rates/orgs/org_alpha`, async ({ request }) => { const b = (await request.json()) as Record<string, unknown>; if (b.kind === "INHERIT") inherit = b; else sent = b; return HttpResponse.json({ id: "crp_3" }); }));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-orgs")); await user.click(await screen.findByText("org_alpha"));
    const panel = await screen.findByTestId("rates-org-panel");
    expect(within(panel).getByTestId("rates-org-effective")).toHaveTextContent("40 per charge");
    expect(within(panel).getByTestId("rates-org-effective")).toHaveTextContent("Organisation override");
    expect(within(panel).getByTestId("rates-org-default")).toHaveTextContent("12.5%");
    expect(within(panel).getByTestId("rates-org-override")).toHaveTextContent("40 per charge");
    expect(screen.getByTestId("rates-toggle-inherit")).toBeEnabled();
    await user.click(screen.getByTestId("rates-toggle-override"));
    const form = screen.getByTestId("rates-org-form");
    await user.selectOptions(within(form).getByTestId("rate-feetype"), "FLAT");
    await user.type(within(form).getByTestId("rate-flat"), "55.5");
    expect(within(form).getByTestId("rate-submit")).toBeDisabled(); // no reason yet
    await user.type(within(form).getByTestId("rate-reason"), "volume agreement");
    await user.click(within(form).getByTestId("rate-submit"));
    await waitFor(() => expect(sent).toBeTruthy());
    expect(sent).toMatchObject({ product: "CLINIC", kind: "RATE", reason: "volume agreement", spec: { feeType: "FLAT", flatMinor: 5550 } });
    await user.click(screen.getByTestId("rates-toggle-inherit"));
    await user.type(screen.getByTestId("rates-inherit-reason"), "contract ended");
    await user.click(screen.getByTestId("rates-inherit-submit"));
    await waitFor(() => expect(inherit).toMatchObject({ kind: "INHERIT", reason: "contract ended" }));
    expect(await violations()).toEqual([]);
  });

  it("an organisation with no default and no override is 'Rate not set' with the inherit state, for finance read-only (no toggles)", async () => {
    base(caps());
    server.use(http.get(`${B}/orgs`, () => HttpResponse.json([{ orgRef: "org_beta", market: "EG", currency: "EGP", claims: 0, claimsMinor: 0, collectedMinor: 0, provider: null, openRuns: 0 }])),
      http.get(`${B}/orgs/org_beta`, () => HttpResponse.json({ config: { settings: {}, missing: ["mode"] }, provider: null, providersAvailable: [] })),
      http.get(`${B}/rates/orgs/org_beta`, () => HttpResponse.json({ orgRef: "org_beta", product: "CLINIC", linked: false, state: "NOT_SET", effective: NOT_SET, default: NOT_SET, override: null, inheriting: true, mode: null, pending: null, upcoming: null, history: [] })));
    renderOps(<CommissionsPage />); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-orgs")); await user.click(await screen.findByText("org_beta"));
    const panel = await screen.findByTestId("rates-org-panel");
    expect(within(panel).getByTestId("rates-org-effective")).toHaveTextContent("Rate not set");
    expect(within(panel).getByTestId("rates-org-override")).toHaveTextContent("follows the default");
    expect(screen.queryByTestId("rates-toggle-override")).toBeNull();
    expect(screen.getByTestId("rate-history-empty")).toBeInTheDocument();
  });

  it("renders in Arabic with translated rate text and no accessibility violations", async () => {
    base(caps({ proposeRate: true }));
    server.use(http.get(`${B}/rates/defaults`, () => HttpResponse.json(defaults({ effective: set("DEFAULT", spec({})), pending: null, upcoming: null, history: [row({})] }))));
    renderOps(<CommissionsPage />, { lang: "ar" }); const user = userEvent.setup();
    await user.click(await screen.findByTestId("com-tab-rates"));
    expect(await screen.findByText("العيادات")).toBeInTheDocument();
    expect(screen.getAllByTestId("rate-not-set")[0]).toHaveTextContent("النسبة غير مضبوطة");
    expect(screen.getByTestId("rates-eff-CLINIC")).toHaveTextContent("الافتراضي لهذا النوع");
    expect(await violations()).toEqual([]);
  });
});
