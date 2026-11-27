import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * GRW-P3-C (cohorts, LTV, payback) and GRW-P3-G (market wizard, readiness) in a real browser against a real Kiorex API process with its own database: Arabic RTL and English, light and dark, 320 to 2560 px,
 * no horizontal page overflow, axe serious and critical clean (colour contrast included), keyboard-only step walk, the wizard never offers a way to go live. The cohort fixture is 140 synthetic patients written to the private database
 * and recomputed through the real rollup endpoint; the wizard plan ZY is the one suite 38 made. Sign-in: the injected session of a real Passport login (PW_SESSION_JSON). Screenshots: _docs/test-flow/growth-p3/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p3") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p3"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots;
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const WIDTHS = [320, 768, 1440, 2560];

async function session(page: Page, to: string) {
  const injected = process.env.PW_SESSION_JSON; test.skip(!injected, "needs PW_SESSION_JSON (a real Passport login of the ops super admin)");
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, injected!]);
  await page.goto(to); await expect(page.getByRole("main")).toBeVisible();
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
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.use({ actionTimeout: 25_000, navigationTimeout: 45_000, reducedMotion: "reduce" }); // entrance animations are off (the app honours prefers-reduced-motion), so axe never measures a half-faded colour
test.describe("ops cohorts and market wizard (private real stack)", () => {
  test.beforeAll(() => { mkdirSync(SHOTS, { recursive: true }); });
  test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");

  for (const lang of ["en", "ar"] as const) for (const theme of ["light", "dark"] as const) for (const w of WIDTHS) {
    test(`cohorts, LTV and payback: ${lang} ${theme} ${w}px, no overflow, axe clean`, async ({ page }) => {
      await page.addInitScript(prefs, [lang, theme]); await page.setViewportSize({ width: w, height: 900 }); await session(page, "/growth/cohorts");
      await expect(page.getByTestId("cohort-table")).toBeVisible(); await expect(page.getByTestId("cohort-heatmap")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(lang === "ar" ? "rtl" : "ltr");
      expect(await noOverflow(page), "cohort tab overflows the page").toBe(true); expect(await axeSerious(page), "cohorts").toEqual([]);
      if (theme === "light" || w === 1440) await page.screenshot({ path: path.join(SHOTS, `cohorts-${lang}-${theme}-${w}.png`), fullPage: true });
      await page.getByTestId("coh-tab-ltv").click(); await expect(page.getByTestId("ltv-table")).toBeVisible(); await expect(page.getByTestId("ltv-estimate-note")).toBeVisible();
      expect(await noOverflow(page), "ltv tab overflows").toBe(true); expect(await axeSerious(page), "ltv").toEqual([]);
      await page.getByTestId("coh-tab-payback").click(); await expect(page.getByTestId("payback-note")).toBeVisible(); expect(await noOverflow(page), "payback tab overflows").toBe(true); expect(await axeSerious(page), "payback").toEqual([]);
    });
    test(`market wizard and readiness: ${lang} ${theme} ${w}px, no overflow, axe clean`, async ({ page }) => {
      await page.addInitScript(prefs, [lang, theme]); await page.setViewportSize({ width: w, height: 900 }); await session(page, "/growth/markets/wizard?cc=ZY");
      await expect(page.getByTestId("readiness-list")).toBeVisible(); await expect(page.getByTestId("ready-launchGate")).toBeVisible();
      expect(await noOverflow(page), "wizard overflows the page").toBe(true); expect(await axeSerious(page), "wizard identity").toEqual([]);
      for (const s of ["geography", "specialties", "regulation", "providers", "consent", "residency", "integrations"]) { await page.getByTestId(`tab-${s}`).click(); await expect(page.getByTestId("step-panel")).toBeVisible(); expect(await noOverflow(page), `${s} overflows`).toBe(true); expect(await axeSerious(page), s).toEqual([]); }
      if (theme === "light" || w === 1440) await page.screenshot({ path: path.join(SHOTS, `market-wizard-${lang}-${theme}-${w}.png`), fullPage: true });
    });
  }

  test("keyboard only: the step tabs, the geography preview and the readiness list work without a pointer; nothing in the wizard can make the market live", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, "/growth/markets/wizard?cc=ZY");
    await page.getByTestId("tab-identity").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("id-nameEn")).toBeVisible();
    await page.getByTestId("tab-geography").focus(); await page.keyboard.press("Enter"); await page.getByTestId("geo-csv").focus(); await page.keyboard.type("level,key,parentKey,nameAr,nameEn,slugAr,slugEn\nCITY,x,,عمان,Amman,amman,amman");
    await page.getByTestId("geo-preview").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("geo-result")).toContainText(/Valid|problem/);
    await expect(page.getByTestId("ready-launchGate")).toContainText("Needs a person"); await expect(page.getByTestId("readiness-summary")).toContainText("Not live (human gate)");
    const buttons = await page.getByRole("button").allTextContents(); expect(buttons.join("|")).not.toMatch(/go live|launch|activate market/i);
  });

  test("a phone-width wizard keeps every control at least 44 px high", async ({ page }) => {
    await page.addInitScript(prefs, ["ar", "light"]); await page.setViewportSize({ width: 320, height: 800 }); await session(page, "/growth/markets/wizard?cc=ZY");
    const small = await page.evaluate(() => [...document.querySelectorAll("main button, main select, main input:not([type=checkbox])")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43; }).map((e) => (e as HTMLElement).dataset.testid ?? e.tagName));
    expect(small).toEqual([]);
  });
});
