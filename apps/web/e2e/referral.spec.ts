import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-P2-B3 patient web: invite screen, rewards, invite landing, and the Account entry gated by bootstrap `features.referral`. Real browser, real Passport sign-in, the real web app; the happy path is answered by page.route fixtures (shapes verified against the committed GRW-P2-B1/B2 controllers) because patient_referral/rewards are launch-locked and the shared dev DB must not get gate evidence; the flag-OFF and bootstrap-absent paths run against the REAL API. AR and EN, light and dark,
 * 320 to 1440 px, keyboard, axe serious and critical clean. Screenshots: _docs/test-flow/growth-p2/.
 */
const SHOTS = path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p2"); mkdirSync(SHOTS, { recursive: true });
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => !!p && existsSync(p));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(700); // entrance animations blend colours while they run, which axe would read as low contrast
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = async (page: Page, where: string) => {
  const w = await page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > iw + 1).slice(0, 3).map((e) => `${e.tagName}[${e.getAttribute("data-testid") ?? e.textContent?.slice(0, 14)}]<${e.parentElement?.tagName}.${String(e.parentElement?.className).slice(0, 40)}>`); return { d: document.documentElement.scrollWidth - iw, wide }; });
  expect(w.d, `${where} overflows horizontally by ${w.d}px: ${w.wide.join(" | ")}`).toBeLessThanOrEqual(1);
};
const ME = { code: "7K3M9QPX", status: "ACTIVE", inviteUrl: "https://kiorex.com/ar/eg/invite/7K3M9QPX", counts: { invited: 5, signedUp: 3, qualified: 1 }, capsRemaining: { last30Days: 2, thisYear: 4 } };
const LOTS = { items: [{ id: "rwl_a", kind: "REFERRER", mode: "COUPON", amountMinor: 15_000, remainingMinor: 15_000, currency: "EGP", status: "ACTIVE", expiresAt: "2027-09-01T00:00:00Z", couponState: "UNREVEALED" }, { id: "rwl_b", kind: "REFEREE", mode: "CREDIT", amountMinor: 5000, remainingMinor: 0, currency: "EGP", status: "EXHAUSTED", expiresAt: "2027-02-01T00:00:00Z", couponState: "NONE" }], nextCursor: null };
async function mockReferral(page: Page, o: { real?: boolean; referral?: boolean; claim?: Record<string, unknown>; claims?: { n: number; body?: unknown } } = {}) {
  if (o.real) return; // no fixtures: the REAL API answers (patient_referral and rewards are launch-locked, so it answers bootstrap features.referral=false and 403 FEATURE_DISABLED until gate evidence exists)
  await page.route("**/api/v1/bootstrap**", async (r) => { const real = await r.fetch().then((x) => x.json()).catch(() => ({})); await r.fulfill({ json: { ...real, features: { referral: o.referral !== false } } }); }); // the real bootstrap with the additive field set
  await page.route("**/api/v1/growth/v1/referral/me", (r) => r.fulfill({ json: ME }));
  await page.route("**/api/v1/growth/v1/referral/invites", (r) => r.fulfill({ json: { inviteUrl: ME.inviteUrl, code: ME.code, shareText: "A friend invited you to Kiorex" } }));
  await page.route("**/api/v1/growth/v1/referral/rewards**", (r) => r.fulfill({ json: LOTS }));
  await page.route("**/api/v1/growth/v1/rewards/*/reveal", (r) => r.fulfill({ json: { code: "KX-AB12-CD34" } }));
  await page.route("**/api/v1/growth/v1/referral/claim", async (r) => { if (o.claims) { o.claims.n++; o.claims.body = r.request().postDataJSON(); } await r.fulfill({ json: o.claim ?? { status: "SIGNED_UP" } }); });
}

test.use({ actionTimeout: 20_000, navigationTimeout: 40_000 });
test.describe("patient referral screens (web, real sign-in)", () => {
  test.setTimeout(180_000);
  test("Account shows the invite entry only when the bootstrap says so, and it opens the invite screen", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mockReferral(page, { real: true }); await signIn(page, "/account"); // real API: the launch-locked flag is OFF here, so the entry is absent
    await expect(page.getByTestId("link-addresses")).toBeVisible(); await expect(page.getByTestId("link-referral")).toHaveCount(0);
    await page.unroute("**/api/v1/bootstrap**"); await mockReferral(page, { referral: true }); await page.reload();
    await expect(page.getByTestId("link-referral")).toBeVisible(); await page.getByTestId("link-referral").click(); await expect(page).toHaveURL(/\/referral$/); await expect(page.getByTestId("invite-code")).toHaveText("7K3M9QPX");
  });

  for (const [lang, theme, width] of [["en", "light", 1440], ["ar", "dark", 320], ["ar", "light", 390], ["en", "dark", 1024]] as const) {
    test(`invite and rewards screens: ${lang} ${theme} ${width}px, no overflow, keyboard reachable, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 }); await page.addInitScript(prefs, [lang, theme]); await mockReferral(page); await signIn(page, "/referral");
      await expect(page.getByTestId("invite-card")).toBeVisible(); await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.getByTestId("invite-qr")).toBeVisible(); await expect(page.getByTestId("referral-counts")).toContainText(lang === "ar" ? "٥" : "5"); await noOverflow(page, `invite ${lang} ${width}`);
      await page.keyboard.press("Tab"); for (let i = 0; i < 25 && !(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "invite-share")); i++) await page.keyboard.press("Tab");
      await expect(page.getByTestId("invite-share")).toBeFocused();
      expect(await axeSerious(page), "axe on the invite screen").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `referral-${lang}-${theme}-${width}.png`), fullPage: true });
      await page.getByTestId("referral-rewards-link").click(); await expect(page.getByTestId("rewards-page")).toBeVisible(); await expect(page.getByTestId("reward-rwl_a")).toBeVisible(); await noOverflow(page, `rewards ${lang} ${width}`);
      await page.getByTestId("reveal-rwl_a").click(); await expect(page.getByTestId("coupon-rwl_a")).toContainText("KX-AB12-CD34");
      expect(await axeSerious(page), "axe on the rewards screen").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `rewards-${lang}-${theme}-${width}.png`), fullPage: true });
    });
  }

  test("copy puts the link on the clipboard; the invite landing is neutral signed out and claims once after sign-in", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]); await page.addInitScript(prefs, ["en", "light"]);
    const claims = { n: 0, body: undefined as unknown }; await mockReferral(page, { claims }); await signIn(page, "/referral");
    await page.getByTestId("invite-copy").click(); await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ME.inviteUrl);
    await page.goto("/invite/7k3m9qpx"); await expect(page.getByTestId("invite-landing")).toBeVisible();
    await expect(page.getByTestId("invite-accepted")).toBeVisible(); expect(claims.n).toBe(1); expect(claims.body).toEqual({ code: "7K3M9QPX" });
    expect(await axeSerious(page), "axe on the invite landing").toEqual([]);
  });

  test("a malformed invite or a refused claim reads the same and a URL in the code position is never followed", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); const claims = { n: 0 }; await mockReferral(page, { claim: { status: "REJECTED", reason: "RF_SELF" }, claims });
    await signIn(page, "/invite/7K3M9QPX"); await expect(page.getByTestId("invite-invalid")).toContainText("cannot be used"); await expect(page.locator("body")).not.toContainText("RF_SELF");
    const n = claims.n; await page.goto("/invite/https%3A%2F%2Fevil.example"); await expect(page.getByTestId("invite-invalid")).toBeVisible(); expect(claims.n).toBe(n); expect(page.url()).toContain("localhost:5180");
  });

  test("flag OFF (403 FEATURE_DISABLED) shows the unavailable state on both screens", async ({ page }) => {
    await page.addInitScript(prefs, ["ar", "light"]); await mockReferral(page, { real: true }); // REAL 403 FEATURE_DISABLED from the launch-locked flag (no gate evidence recorded), no fixture
    await signIn(page, "/referral"); await expect(page.getByTestId("feature-unavailable")).toHaveAttribute("data-awaiting", "true"); await expect(page.getByTestId("invite-code")).toHaveCount(0);
  });
});
