import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { RequireOps } from "@/auth/RequireOps";
import { configureApi } from "@/api/client";
import { server } from "@/test/mocks/server";
import { OpsLayout } from "@/components/OpsLayout";
import RoleHomePage from "@/pages/RoleHomePage";
import NoAccessPage from "@/pages/NoAccessPage";
import i18n from "@/i18n";
import { canOpen, dashboardRole, heldRoles, isKiorlyOnly, isMixed, rolesAllowedFor } from "@/lib/roleAccess";

const ctx = (roles: string[]): AuthCtx => ({ status: "signedIn", user: { sub: "u1", name: "Tester", token: "t", roles }, login: async () => {}, logout: async () => {}, completeLogin: async () => "/" });
function mount(roles: string[], route = "/home", lang: "en" | "ar" = "en") {
  server.use(http.get("*/api/v1/admin/partner-leads/unread", () => HttpResponse.json({ count: 0 })), http.get("*/api/v1/admin/leads/summary", () => HttpResponse.json({ byStatus: {}, newLastSevenDays: 0, unassignedOpen: 0, testLeads: 0 })));
  void i18n.changeLanguage(lang); configureApi({ getToken: async () => "t" });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><AuthContext.Provider value={ctx(roles)}><MemoryRouter initialEntries={[route]}>
      <RequireOps><Routes><Route element={<OpsLayout />}>
        <Route path="/home" element={<RoleHomePage />} /><Route path="/orders" element={<p>orders page</p>} /><Route path="/leads" element={<p>leads page</p>} /><Route path="/providers" element={<p>providers page</p>} />
        <Route path="*" element={<NoAccessPage />} />
      </Route></Routes></RequireOps>
    </MemoryRouter></AuthContext.Provider></QueryClientProvider>,
  );
}
const J = (path: string, body: unknown, status = 200) => http.get(`*/api/v1${path}`, () => HttpResponse.json(body as never, { status }));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const KIORLY_MOCKS = () => [
  J("/admin/leads/summary", { byStatus: { NEW: 3, CONTACTED: 1 }, newLastSevenDays: 4, unassignedOpen: 2, testLeads: 0 }),
  http.get("*/api/v1/admin/leads", () => HttpResponse.json({ total: 3, page: 1, pageSize: 100, items: [
    { id: "l2", ref: "JR-0002", status: "NEW", providerType: "PHARMACY", market: "EG", createdAt: daysAgo(1) },
    { id: "l1", ref: "JR-0001", status: "NEW", providerType: "CLINIC", market: "EG", createdAt: daysAgo(6) },
    { id: "l3", ref: "JR-0003", status: "NEW", providerType: "LAB", market: "EG", createdAt: daysAgo(2) }] })),
  J("/admin/onboarding/partners", [{ id: "p1", kind: "CLINIC", name: "Nile Clinic", market: "EG", status: "AWAITING_APPROVAL", progress: 80, humanActions: [] }, { id: "p2", kind: "LAB", name: "Delta Lab", market: "EG", status: "CHANGES_REQUESTED", progress: 40, humanActions: [] }, { id: "p3", kind: "LAB", name: "Live Lab", market: "EG", status: "LIVE", progress: 100, humanActions: [] }]),
  J("/admin/onboarding/imports", [{ id: "b1", orgName: "Cairo Dental", label: "first import", status: "DRAFT", createdAt: daysAgo(3) }, { id: "b2", orgName: "Done Org", status: "COMMITTED", createdAt: daysAgo(9) }]),
  J("/admin/partner-leads/unread", { count: 5 }),
  J("/admin/onboarding/verification-updates", [{ ref: "v1", status: "OPEN" }, { ref: "v2", status: "APPROVED" }]),
  J("/admin/kiorly-plans", { canChange: false, clinic: { available: true, markets: [], plans: [{ id: "a", isPublic: true }, { id: "b", isPublic: false }] }, content: { config: { pharmacy: { plans: [{ visible: true }] }, lab: { plans: [{ visible: false }] } } } }),
  J("/admin/kiorly-markets", { canChange: false, items: [{ id: "mk_EG", code: "EG", nameEn: "Egypt", status: "LIVE", operability: "active" }, { id: "mk_SA", code: "SA", nameEn: "Saudi Arabia", status: "DRAFT", operability: "draft" }] }),
  J("/admin/commissions/policy", { markets: ["EG"] }),
  J("/admin/commissions/policy/EG", { paymentMode: "MOCK", counsel: { record: null } }),
];

describe("access table", () => {
  it("each Kiorly role opens only the Kiorly routes; everything else is refused (deny by default)", () => {
    for (const r of [["kiorly_ops"], ["kiorly_admin"]]) {
      for (const p of ["/home", "/providers", "/leads", "/leads/x1", "/partner-leads", "/onboarding", "/partner-onboarding/p1", "/fees", "/kiorly-markets", "/kiorly-plans", "/commission-policy"]) expect(canOpen(r, p), p).toBe(true);
      for (const p of ["/orders", "/finance", "/reconciliation", "/payments-connection", "/messaging", "/integrations", "/flags", "/operations", "/outbox", "/commissions", "/pay-ops", "/growth", "/growth/channels", "/bookings", "/moderation", "/unknown"]) expect(canOpen(r, p), p).toBe(false);
    }
  });
  it("the Kiorex roles keep their places; finance and growth_admin get their own", () => {
    expect(canOpen(["ops_admin"], "/orders")).toBe(true); expect(canOpen(["ops_admin"], "/commissions")).toBe(false);
    expect(canOpen(["finance"], "/commissions")).toBe(true); expect(canOpen(["finance"], "/orders")).toBe(false); expect(canOpen(["finance"], "/growth/finance")).toBe(true);
    expect(canOpen(["growth_admin"], "/growth/seo")).toBe(true); expect(canOpen(["growth_admin"], "/growth/finance")).toBe(false); expect(canOpen(["growth_admin"], "/commissions")).toBe(false);
    expect(canOpen(["super_admin"], "/commissions")).toBe(true); expect(rolesAllowedFor("/nowhere")).toEqual([]);
  });
  it("dashboard choice follows a fixed priority and a person can switch among the roles they hold", () => {
    expect(dashboardRole(["finance", "ops_admin"])).toBe("ops_admin"); expect(dashboardRole(["finance", "ops_admin"], "finance")).toBe("finance"); expect(dashboardRole(["finance"], "super_admin")).toBe("finance");
    expect(dashboardRole(["patient"])).toBeNull(); expect(heldRoles(["kiorly_ops", "super_admin"])).toEqual(["super_admin", "kiorly_ops"]);
    expect(isKiorlyOnly(["kiorly_ops"])).toBe(true); expect(isMixed(["kiorly_ops", "ops_admin"])).toBe(true); expect(isMixed(["kiorly_admin"])).toBe(false);
  });
});

describe("kiorly_ops dashboard (Kiorly edition shell)", () => {
  it("is refused by the Kiorex console (default edition) with the Kiorly-only message", () => {
    mount(["kiorly_ops"]);
    expect(screen.getByTestId("no-access-reason")).toHaveTextContent(/Kiorly admin/);
  });
});

describe("role dashboards", () => {
  it("ops_admin lands on its Kiorex queues and sees no Kiorly-only or finance cards; the menu offers only what ops may open", async () => {
    server.use(J("/admin/moderation", [{ id: "m1" }, { id: "m2" }]), J("/admin/complaints", [{ id: "c1" }]), J("/admin/outbox", { stats: { dead: 4, pending: 9 }, items: [] }), J("/admin/payments/held-for-review", []),
      J("/admin/safety/summary", { open: 1, unacknowledged: 1, sloBreaches: 0, unsafeAborts: 0 }), ...KIORLY_MOCKS());
    mount(["ops_admin"]);
    await waitFor(() => expect(screen.getByTestId("dash-moderation")).toHaveTextContent("2"));
    expect(screen.getByTestId("role-home")).toHaveAttribute("data-role", "ops_admin");
    expect(screen.getByTestId("dash-outbox-dead")).toHaveTextContent("4");
    expect(screen.getByTestId("dashboard-ops_admin")).toBeInTheDocument();
    const nav = screen.getByTestId("sidebar-nav"); const hrefs = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/home"); expect(hrefs).toContain("/orders"); expect(hrefs).not.toContain("/commissions");
  });

  it("finance sees reconciliation and statements, and its menu has no ops pages; a hand-typed ops URL shows the no-access page", async () => {
    server.use(J("/admin/commissions/summary", { figures: {}, counts: { claims: 12, runs: 3 } }), J("/admin/commissions/aging", { buckets: {}, rows: [{}, {}] }), J("/admin/commissions/disputes", { total: 1, items: [{}] }),
      J("/admin/commissions/reconciliation", [{ code: "X" }, { code: "Y" }, { code: "Z" }]), J("/admin/commissions/runs", { items: [{ id: "r1", periodKey: "2026-11", status: "PAID", mode: "NETTED", claimsMinor: 12500, currency: "EGP", orgRef: "org1" }] }), J("/admin/payments/matching/queue", [{}]));
    mount(["finance"]);
    await waitFor(() => expect(screen.getByTestId("dash-findings")).toHaveTextContent("3"));
    expect(screen.getByTestId("dash-aging")).toHaveTextContent("2"); expect(screen.getByTestId("dash-matching")).toHaveTextContent("1"); expect(screen.getByTestId("dash-runs")).toHaveTextContent("2026-11");
    const hrefs = [...screen.getByTestId("sidebar-nav").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/commissions"); expect(hrefs).not.toContain("/orders"); expect(hrefs).not.toContain("/flags");
  });

  it("a refused route (typed by hand) shows the no-access page inside the console, not the page", async () => {
    mount(["finance"], "/orders");
    expect(await screen.findByTestId("no-access-page")).toBeInTheDocument();
    expect(screen.queryByText("orders page")).toBeNull();
    expect(screen.getByTestId("sidebar-nav")).toBeInTheDocument();
  });

  it("growth_admin sees the growth KPIs only", async () => {
    server.use(J("/ops/growth/overview", { source: "internal", days: 30, market: "EG", since: "", funnel: [{ name: "search", count: 120 }, { name: "booking", count: 30, masked: true }], origins: [{ origin: "a", count: 40 }, { origin: "b", count: 2 }], reasons: [], touchesBySource: [], providerLedShare: 0.25, fraudOpen: 3, activeWidgets: 7, landingPages: { total: 10, indexable: 8 }, slugs: 1, config: [] }));
    mount(["growth_admin"]);
    await waitFor(() => expect(screen.getByTestId("dash-decisions")).toHaveTextContent("42"));
    expect(screen.getByTestId("dash-fraud-open")).toHaveTextContent("3");
    const hrefs = [...screen.getByTestId("sidebar-nav").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/orders"); expect(hrefs).not.toContain("/commissions");
  });

  it("super_admin sees the maker-checker queue across flows with an honest total, and the audit highlights", async () => {
    server.use(J("/admin/commissions/policy", { markets: ["EG"] }), J("/admin/commissions/policy/EG", { counsel: { history: [{ status: "PENDING_APPROVAL" }, { status: "APPLIED" }] }, disclosure: { history: [{ status: "PENDING_APPROVAL" }] } }),
      J("/admin/commissions/rates/defaults", [{ product: "CLINIC", pending: { id: "x" } }, { product: "LAB", pending: null }]), J("/admin/commissions/config", [{ status: "PENDING_APPROVAL" }]),
      J("/admin/flags/requests", [{ status: "PENDING" }, { status: "APPROVED" }]), J("/admin/kiorly-markets", { items: [{ id: "mk_EG", code: "EG" }] }), J("/admin/kiorly-markets/mk_EG/change-requests", [{ id: "r1", status: "PENDING" }]),
      J("/admin/onboarding/partners", [{ id: "p1", name: "N", status: "AWAITING_APPROVAL" }]), J("/admin/kiorly-plans", { canChange: true }),
      J("/admin/audit-log", [{ id: "a1", action: "kiorly.market.launch", resource: "KiorlyMarket", createdAt: new Date().toISOString() }]), J("/admin/outbox", { stats: { dead: 0, pending: 0 }, items: [] }));
    mount(["super_admin"]);
    await waitFor(() => expect(screen.getByTestId("dash-approvals-total")).toHaveTextContent("7")); // 2 policy + 1 rate + 1 config + 1 flag + 1 market + 1 partner
    expect(screen.getByTestId("dash-approval-plans")).toHaveTextContent(/not enabled yet/);
    expect(screen.getByTestId("dash-audit")).toHaveTextContent("kiorly.market.launch");
  });

  it("super_admin: a list that cannot be read shows 'unknown', never a made-up zero", async () => {
    server.use(J("/admin/commissions/policy", { code: "BOOM" }, 500));
    mount(["super_admin"]);
    await waitFor(() => expect(screen.getByTestId("dash-approval-pol")).toHaveTextContent(/unknown/));
    expect(screen.getByTestId("dash-approvals-partial")).toBeInTheDocument();
  });

  it("kiorly_ops (Kiorly host) shows join requests with ages oldest first, onboarding queues, plans, markets and policy, with no change shortcuts", async () => {
    server.use(...KIORLY_MOCKS());
    const m = await import("@/lib/edition"); void m; // the edition of the test run is Kiorex: this test renders the dashboard component directly
    const KiorlyDashboard = (await import("@/pages/dashboards/KiorlyDashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); configureApi({ getToken: async () => "t" }); void i18n.changeLanguage("en");
    render(<QueryClientProvider client={qc}><MemoryRouter><KiorlyDashboard admin={false} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("dash-new-count")).toHaveTextContent("3"));
    const oldest = within(screen.getByTestId("dash-oldest")).getAllByRole("listitem").map((li) => li.textContent);
    expect(oldest[0]).toContain("JR-0001"); expect(oldest[0]).toContain("6 d"); expect(oldest[2]).toContain("JR-0002");
    await waitFor(() => expect(screen.getByTestId("dash-partner-awaiting")).toHaveTextContent("1"));
    expect(screen.getByTestId("dash-partner-open")).toHaveTextContent("2"); // LIVE is not in the queue
    expect(screen.getByTestId("dash-drafts")).toHaveTextContent("1");
    expect(screen.getByTestId("dash-partner-leads")).toHaveTextContent("5"); expect(screen.getByTestId("dash-verif-open")).toHaveTextContent("1");
    expect(screen.getByTestId("dash-plans-visible")).toHaveTextContent("2"); expect(screen.getByTestId("dash-plans-proposals")).toHaveTextContent("-");
    expect(within(screen.getByTestId("dash-markets")).getAllByRole("listitem")).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("dash-policy-mode")).toHaveTextContent("MOCK"));
    expect(screen.getByTestId("dashboard-kiorly_ops")).toBeInTheDocument();
    expect(screen.queryByTestId("dash-shortcuts")).toBeNull(); // no change shortcuts for kiorly_ops
    expect(document.body.textContent).not.toMatch(/patient/i); // no patient identifiers or wording on a Kiorly dashboard
  });

  it("kiorly_admin gets the same cards plus the change shortcuts; empty queues say so honestly", async () => {
    server.use(J("/admin/leads/summary", { byStatus: {}, newLastSevenDays: 0, unassignedOpen: 0, testLeads: 0 }), http.get("*/api/v1/admin/leads", () => HttpResponse.json({ total: 0, page: 1, pageSize: 100, items: [] })), J("/admin/onboarding/imports", []), J("/admin/onboarding/partners", []), ...KIORLY_MOCKS());
    const KiorlyDashboard = (await import("@/pages/dashboards/KiorlyDashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); configureApi({ getToken: async () => "t" }); void i18n.changeLanguage("en");
    render(<QueryClientProvider client={qc}><MemoryRouter><KiorlyDashboard admin /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("dash-oldest-empty")).toHaveTextContent(/No new join requests/));
    expect(screen.getByTestId("dash-partner-rows-empty")).toBeInTheDocument(); expect(screen.getByTestId("dash-draft-rows-empty")).toBeInTheDocument();
    expect(screen.getByTestId("dash-shortcuts")).toBeInTheDocument(); expect(screen.getByTestId("dashboard-kiorly_admin")).toBeInTheDocument();
  });

  it("a card the API refuses (403) says it is not part of this role's work instead of an error", async () => {
    server.use(J("/admin/kiorly-plans", { code: "FORBIDDEN_ROLE", message: "Insufficient role" }, 403), ...KIORLY_MOCKS());
    const KiorlyDashboard = (await import("@/pages/dashboards/KiorlyDashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); configureApi({ getToken: async () => "t" }); void i18n.changeLanguage("en");
    render(<QueryClientProvider client={qc}><MemoryRouter><KiorlyDashboard admin={false} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(within(screen.getByTestId("card-plans")).getByRole("alert")).toHaveTextContent(/not part of your role/));
  });

  it("Arabic: the dashboard is in Arabic with RTL-safe markup and Western digits only", async () => {
    server.use(...KIORLY_MOCKS());
    const KiorlyDashboard = (await import("@/pages/dashboards/KiorlyDashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); configureApi({ getToken: async () => "t" }); await i18n.changeLanguage("ar");
    render(<QueryClientProvider client={qc}><MemoryRouter><KiorlyDashboard admin /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("dash-new-count")).toHaveTextContent("3"));
    expect(screen.getByText("طلبات الانضمام")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    await i18n.changeLanguage("en");
  });
});
