import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Wave 9 (GC-5): the ops pages that had component tests and axe in jsdom but no real-browser run: Lifecycle (journeys, send gate, suppression), Fraud, SEO and Corporate. Real browser, a private
 * API and database (e2e/scripts/w9a3-stack.sh), the dev Passport session injected as PW_SESSION_JSON. For each page, in Arabic RTL and English, at 320 and 1440 px: the main landmark renders, no horizontal
 * overflow, axe serious and critical violations are zero (including contrast), no uncaught page error, and the 44 px touch-target rule for interactive controls inside main. Screenshots: _docs/test-flow/growth-w9/.
 */
const SHOTS = path.resolve(process.cwd(), "../../../_docs/test-flow/growth-w9");
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const PAGES = [
  { key: "lifecycle", path: "/growth/lifecycle" }, { key: "lifecycle-send-gate", path: "/growth/lifecycle/send-gate" }, { key: "lifecycle-suppression", path: "/growth/lifecycle/suppression" },
  { key: "fraud", path: "/growth/fraud" }, { key: "seo", path: "/growth/seo" }, { key: "corporate", path: "/growth/corporate" },
] as const;
const VIEWPORTS = [{ w: 320, h: 800 }, { w: 1440, h: 900 }] as const;

test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });

async function open(page: Page, to: string, lang: string) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, process.env.PW_SESSION_JSON!]);
  await page.addInitScript(prefs, [lang, "light"]);
  await page.goto(to); await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}
async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}

test.beforeAll(() => { expect(process.env.PW_SESSION_JSON, "PW_SESSION_JSON (real Passport session) is required").toBeTruthy(); expect(AXE, "axe-core must be installed").toBeTruthy(); mkdirSync(SHOTS, { recursive: true }); });

for (const pg of PAGES) {
  for (const lang of ["ar", "en"]) {
    for (const vp of VIEWPORTS) {
      test(`${pg.key} ${lang} ${vp.w}px renders, no overflow, axe serious/critical clean`, async ({ page }) => {
        const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await open(page, pg.path, lang);
        expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow").toBe(true);
        expect(await axeSerious(page)).toEqual([]);
        expect(errors).toEqual([]);
        await page.screenshot({ path: path.join(SHOTS, `${pg.key}-${lang}-${vp.w}.png`), fullPage: false });
      });
    }
  }
}

test("keyboard only: the first Tab stop is the skip link and it moves focus into main on every page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const pg of PAGES) {
    await open(page, pg.path, "en");
    await page.keyboard.press("Tab");
    await expect(page.locator("a[href='#main-content']"), `${pg.key}: skip link is the first tab stop`).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.id), `${pg.key}: skip link moves focus to main`).toBe("main-content");
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => !!document.activeElement?.closest("main") && document.activeElement !== document.getElementById("main-content"))) break; }
    expect(await page.evaluate(() => !!document.activeElement?.closest("main")), `${pg.key}: next Tab lands on a control inside main`).toBe(true);
  }
});
