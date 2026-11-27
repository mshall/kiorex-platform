import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-P4-A in a real browser: the Cross-product journeys page (overview and funnel) in Arabic RTL and English, light and dark, 320 to 1440 px, no horizontal overflow, axe serious and critical clean,
 * keyboard-reachable tabs, masked cells read <10. The signed-in session is the cached real Passport session (`signIn`) or, with PW_SESSION_JSON (the OIDC user JSON of the same real login), an injected one
 * (a lane running its own Vite on another port cannot use the Passport redirect). `KX_CROSS_URL` points the run at a private ops instance. The funnel answer is a fixture (page.route) so the figures are deterministic;
 * the real endpoint is exercised by test/growth-cross-product.int.spec.ts and e2e 39. Screenshots: _docs/test-flow/growth-p4/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p4") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p4"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";
async function session(page: Page, to: string) {
  const injected = process.env.PW_SESSION_JSON;
  if (injected) { await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, injected]); await page.goto(to); await expect(page.getByRole("main")).toBeVisible(); return; }
  await signIn(page, to);
}
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(500); await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = async (page: Page, where: string) => {
  const w = await page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => { const sc = e.closest("[role='region'][tabindex='0']"); return !sc && e.getBoundingClientRect().right > iw + 1; }).slice(0, 3).map((e) => `${e.tagName}.${e.className}`.slice(0, 80)); return { d: document.documentElement.scrollWidth - iw, wide }; });
  expect(w.d, `${where} overflows horizontally by ${w.d}px: ${w.wide.join(" | ")}`).toBeLessThanOrEqual(1);
};
const row = (entryPoint: string, product: string, o: Record<string, unknown> = {}) => ({ product, entryPoint, offered: 40, dismissed: 12, continued: 20, notContinued: 8, bySourceOfFirstBooking: { PROVIDER_LED: "<10", MARKETPLACE: 20, UNATTRIBUTED: "<10" }, timeToContinue: { LT_24H: 14, D1_3: "<10", D3_7: 0, GT_7D: 0 }, ...o });
const FUNNEL = { days: 30, market: "EG", enabled: true, clinicVisitsCompleted: 120, products: [row("RX_TO_PHARMACY", "PHARMACY"), row("LAB_ORDER_TO_LAB", "LAB", { offered: "<10", continued: "<10", notContinued: "<10" }), row("CARE_PLAN_TO_HOME_VISIT", "NURSE", { offered: 0, dismissed: 0, continued: 0, notContinued: 0 })], rewards: "NONE", commissionLink: "INERT" };

test.use({ baseURL: process.env.KX_CROSS_URL ?? "http://localhost:5181", actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("ops cross-product journeys (real browser)", () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ page }) => { mkdirSync(SHOTS, { recursive: true }); await page.route("**/api/v1/ops/growth/cross-product/funnel**", (r) => r.fulfill({ json: FUNNEL })); });

  test("keyboard: the tabs are reachable and switch the panel; the funnel shows masked cells as <10", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, "/growth/cross-product");
    await expect(page.getByTestId("cp-overview")).toBeVisible(); await expect(page.getByTestId("cp-rewards")).toHaveText("None"); await expect(page.getByTestId("cp-commission")).toHaveText("Inert");
    await page.getByRole("tab", { name: "Overview" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("tab", { name: "Funnel" })).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("cp-funnel")).toBeVisible(); await expect(page.getByTestId("cp-LAB_ORDER_TO_LAB-offered")).toHaveText("<10"); await expect(page.getByTestId("cp-RX_TO_PHARMACY-offered")).toHaveText("40");
  });

  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) {
    test(`renders ${lang} ${theme} at 320, 768 and 1440 px: RTL where Arabic, no horizontal overflow, axe clean on the overview and the funnel`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await page.addInitScript(prefs, [lang, theme]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, "/growth/cross-product");
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
        for (const [tab, ready] of [["overview", "cp-overview"], ["funnel", "cp-funnel"]] as const) {
          await page.locator(`#cp-tab-${tab}`).click(); await expect(page.getByTestId(ready)).toBeVisible(); await noOverflow(page, `${tab} ${lang} ${width}`);
          expect(await axeSerious(page), `axe on ${tab} ${lang} ${theme} ${width}`).toEqual([]);
          if (width === 1440 || width === 320) await page.screenshot({ path: path.join(SHOTS, `cross-product-${tab}-${lang}-${theme}-${width}.png`), fullPage: true });
        }
      }
    });
  }
});
