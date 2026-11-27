import { expect, test, type Page } from "@playwright/test";

const PORT = Number(process.env.OPS_EDITION_E2E_PORT ?? 5281);
const KIORLY = `http://admin.kiorly.localhost:${PORT}`;
const KIOREX = `http://localhost:${PORT}`;
const AUTHORITY = `http://localhost:${PORT + 1}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A signed-in ops super admin without any IdP: the session oidc-client-ts would have stored after the code exchange. */
async function signedIn(page: Page) {
  const access = `${b64({ alg: "none" })}.${b64({ sub: "ops-1", kx_roles: ["super_admin", "ops_admin"] })}.x`;
  const user = { access_token: access, id_token: access, token_type: "Bearer", scope: "openid profile", profile: { sub: "ops-1", name: "Ops Admin" }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await page.addInitScript(([k, v]) => { sessionStorage.setItem(k, v); try { localStorage.setItem("kx-lang", "en"); } catch { /* ignore */ } }, [`oidc.user:${AUTHORITY}:kiorex-ops`, JSON.stringify(user)]);
  await page.route((u) => u.pathname.startsWith("/api/"), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().url().includes("unread") ? { count: 0 } : []) }));
}

test.describe("Kiorly admin (admin.<env>.kiorly.com): same console, Kiorly edition", () => {
  test("shows the Kiorly lockup, the provider views only, the Kiorly tab title and noindex", async ({ page }) => {
    await signedIn(page);
    await page.goto(`${KIORLY}/`);
    await expect(page).toHaveURL(`${KIORLY}/providers`);
    await expect(page.getByTestId("kiorly-logo")).toBeVisible();
    await expect(page.getByTestId("kiorly-logo").locator("img").first()).toHaveAttribute("src", "/kiorly/kiorly-lockup.svg");
    await expect(page).toHaveTitle("Kiorly Admin");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/kiorly/favicon.svg");
    const nav = page.getByTestId("sidebar-nav");
    for (const name of ["Providers", "Orders", "Fee statements", "Partner leads", "Feature flags"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    for (const name of ["Booking timeline", "Moderation", "Safety console", "Held deposits", "Growth analytics"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);
    await expect(page.getByTestId("growth-nav")).toHaveCount(0);
    // no Kiorex logo on a Kiorly surface
    await expect(page.locator('svg[aria-label="KIOREX"], [title="KIOREX"]')).toHaveCount(0);
  });

  test("a Kiorex-only view is not routed here and falls back to the provider directory", async ({ page }) => {
    await signedIn(page);
    for (const p of ["/growth/campaigns", "/safety", "/bookings"]) {
      await page.goto(`${KIORLY}${p}`);
      await expect(page).toHaveURL(`${KIORLY}/providers`);
    }
  });

  test("Arabic: the Arabic Kiorly lockup and a right-to-left page", async ({ page }) => {
    await signedIn(page);
    await page.addInitScript(() => { try { localStorage.setItem("kx-lang", "ar"); } catch { /* ignore */ } });
    await page.goto(`${KIORLY}/providers`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("kiorly-logo").locator("img").first()).toHaveAttribute("src", "/kiorly/kiorly-lockup-ar.svg");
    await expect(page).toHaveTitle("إدارة كيورلي");
  });

  test("phone width: no horizontal scroll and the Kiorly mark in the header", async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${KIORLY}/providers`);
    await expect(page.getByTestId("kiorly-mark")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("Kiorex super admin on its own host is unchanged", () => {
  test("full navigation, Growth group and the Kiorex logo", async ({ page }) => {
    await signedIn(page);
    await page.goto(`${KIOREX}/providers`);
    await expect(page).toHaveTitle("Kiorex Ops");
    await expect(page.getByTestId("kiorly-logo")).toHaveCount(0);
    await expect(page.getByTestId("growth-nav")).toBeVisible();
    await expect(page.getByTestId("sidebar-nav").getByRole("link", { name: "Safety console" })).toBeVisible();
    await page.goto(`${KIOREX}/safety`);
    await expect(page).toHaveURL(`${KIOREX}/safety`);
  });
});
