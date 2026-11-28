import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { KIORLY_ROUTES, parseHosts, pathInEdition, resolveEdition } from "@/lib/edition";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";

describe("edition resolution (same console on admin.<env>.kiorex.com and admin.<env>.kiorly.com)", () => {
  const hosts = "admin.test.kiorly.example, ADMIN.pilot.kiorly.example";
  it("follows the host when the build lists the Kiorly admin hosts", () => {
    expect(parseHosts(hosts)).toEqual(["admin.test.kiorly.example", "admin.pilot.kiorly.example"]);
    expect(resolveEdition({ VITE_KIORLY_ADMIN_HOSTS: hosts }, "admin.test.kiorly.example")).toBe("kiorly");
    expect(resolveEdition({ VITE_KIORLY_ADMIN_HOSTS: hosts }, "Admin.Pilot.Kiorly.Example")).toBe("kiorly");
    expect(resolveEdition({ VITE_KIORLY_ADMIN_HOSTS: hosts }, "admin.test.other.example")).toBe("kiorex");
  });
  it("defaults to the Kiorex super admin and lets a dedicated build force an edition", () => {
    expect(resolveEdition({}, "anything.example")).toBe("kiorex");
    expect(resolveEdition({ VITE_OPS_EDITION: "kiorly" }, "anything.example")).toBe("kiorly");
    expect(resolveEdition({ VITE_OPS_EDITION: "kiorex", VITE_KIORLY_ADMIN_HOSTS: hosts }, "admin.test.kiorly.example")).toBe("kiorex");
    expect(resolveEdition({ VITE_OPS_EDITION: "nonsense" }, "x")).toBe("kiorex");
  });
  it("Kiorly views are the provider-product views; patient-side and growth views stay with the Kiorex super admin", () => {
    for (const p of ["/providers", "/commissions/42", "/partner-leads", "/leads", "/kiorly-markets", "/leads/settings", "/flags"]) expect(pathInEdition("kiorly", p), p).toBe(true);
    for (const p of ["/bookings", "/moderation", "/safety", "/held-deposits", "/home-gate", "/growth", "/growth/campaigns", "/acquisition", "/providersx"]) expect(pathInEdition("kiorly", p), p).toBe(false);
    expect(pathInEdition("kiorex", "/growth")).toBe(true);
    expect(new Set(KIORLY_ROUTES).size).toBe(KIORLY_ROUTES.length);
  });
});

/** The edition is read once at import time (a build-time and host-time fact), so each case loads fresh modules with its own environment. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  await import("@/i18n");
  const [{ OpsLayout }, { EditionHead }, edition, { renderOps }] = await Promise.all([import("@/components/OpsLayout"), import("@/components/EditionHead"), import("@/lib/edition"), import("@/test/utils")]);
  return { OpsLayout, EditionHead, edition, renderOps };
}
beforeEach(() => { server.use(http.get("*/api/v1/admin/partner-leads/unread", () => HttpResponse.json({ count: 0 })), http.get("*/api/v1/admin/leads/summary", () => HttpResponse.json({ byStatus: { NEW: 2 }, newLastSevenDays: 2, unassignedOpen: 2, testLeads: 0 }))); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("layout per edition", () => {
  const shell = (OpsLayout: React.ComponentType) => (
    <Routes><Route element={<OpsLayout />}><Route path="/providers" element={<p>providers page</p>} /></Route></Routes>
  );
  it("Kiorex super admin: full navigation, Growth group, Kiorex logo", async () => {
    const { OpsLayout, renderOps } = await load({ VITE_OPS_EDITION: "kiorex" });
    renderOps(shell(OpsLayout), { route: "/providers" });
    const nav = screen.getByTestId("sidebar-nav");
    expect(nav.querySelectorAll("a").length).toBeGreaterThan(20);
    expect(screen.getByTestId("growth-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("kiorly-logo")).toBeNull();
  });
  it("Kiorly admin: only provider views, no Growth group, Kiorly lockup (Arabic lockup in Arabic), no Kiorex logo", async () => {
    const { OpsLayout, renderOps } = await load({ VITE_OPS_EDITION: "kiorly" });
    const { unmount } = renderOps(shell(OpsLayout), { route: "/providers" });
    const links = [...screen.getByTestId("sidebar-nav").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.length).toBeGreaterThan(5);
    for (const href of links) expect(["/home", "/providers", "/orders", "/fees", "/commissions", "/commission-policy", "/finance", "/reconciliation", "/pay-ops", "/payments-connection", "/messaging", "/integrations", "/onboarding", "/partner-onboarding", "/partner-leads", "/leads", "/kiorly-markets", "/kiorly-plans", "/flags", "/operations", "/outbox"], String(href)).toContain(href);
    expect(links).not.toContain("/bookings"); expect(links).not.toContain("/safety"); expect(links).not.toContain("/growth-analytics");
    expect(screen.queryByTestId("growth-nav")).toBeNull(); expect(screen.queryByTestId("mobile-growth-link")).toBeNull();
    const logo = screen.getByTestId("kiorly-logo"); expect(logo.querySelector("img")?.getAttribute("src")).toBe("/kiorly/kiorly-lockup.svg");
    expect(document.body.innerHTML).not.toMatch(/kiorex-logo|KIOREX/i);
    unmount();
    renderOps(shell(OpsLayout), { route: "/providers", lang: "ar" });
    expect(screen.getByTestId("kiorly-logo").querySelector("img")?.getAttribute("src")).toBe("/kiorly/kiorly-lockup-ar.svg");
    expect(screen.getByText("إدارة كيورلي")).toBeInTheDocument();
  });
  it("Kiorly admin sets the tab title, the Kiorly icon and noindex; the Kiorex edition leaves the head alone", async () => {
    document.head.innerHTML = '<title>Kiorex Ops</title><meta name="description" content="x"><link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest">';
    const k = await load({ VITE_OPS_EDITION: "kiorex" }); k.renderOps(<k.EditionHead />);
    expect(document.title).toBe("Kiorex Ops");
    const { EditionHead, renderOps } = await load({ VITE_OPS_EDITION: "kiorly" });
    renderOps(<EditionHead />);
    expect(document.title).toBe("Kiorly Admin");
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/kiorly/favicon.svg");
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex,nofollow");
  });
  it("a Kiorex-only path is not routed in the Kiorly admin (redirects to the role home)", async () => {
    const { edition, renderOps } = await load({ VITE_OPS_EDITION: "kiorly" });
    const Where = () => <p data-testid="at">{useLocation().pathname}</p>;
    const Gate = () => { const { pathname } = useLocation(); return edition.pathInEdition(edition.OPS_EDITION, pathname) ? <Where /> : <Navigate to={edition.KIORLY_HOME_ROUTE} replace />; };
    renderOps(<Routes><Route path="*" element={<><Gate /></>} /></Routes>, { route: "/growth/campaigns" });
    expect(screen.getByTestId("at")).toHaveTextContent("/home");
  });
});
