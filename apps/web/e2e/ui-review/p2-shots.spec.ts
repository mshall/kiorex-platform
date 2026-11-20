import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";

/** Not an assertion suite: Q11 P2 signature-screen shots. TAG=p2-before|p2-after LANGS=ar,en THEMES=light,dark VIEWS=desktop,mobile FLOW=1 (books a slot). Output: _docs/ui-review/kiorex-web */
const OUT = path.resolve(process.cwd(), "../../../_docs/ui-review/kiorex-web");
const TAG = process.env.TAG ?? "p2-after";
const LANGS = (process.env.LANGS ?? "ar,en").split(",");
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const VIEWS = (process.env.VIEWS ?? "desktop,mobile").split(",");
const ONLY = process.env.ONLY?.split(",");
const SIZE = { desktop: { width: 1280, height: 860 }, mobile: { width: 390, height: 844 } } as const;
mkdirSync(OUT, { recursive: true });
test.setTimeout(300_000);

const want = (n: string) => !ONLY || ONLY.includes(n);
async function shot(page: Page, name: string, lang: string, theme: string, view: string, full = false) {
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${view}-${lang}-${theme}.png`), fullPage: full });
}
for (const lang of LANGS) for (const theme of THEMES) for (const view of VIEWS as (keyof typeof SIZE)[]) {
  test(`p2 ${view} ${lang} ${theme}`, async ({ page }) => {
    await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* ignore */ } }, [lang, theme]);
    await page.setViewportSize(SIZE[view]);
    if (want("landing")) { await page.goto("/"); await shot(page, "landing", lang, theme, view, true); }
    await signIn(page, "/");
    if (want("home")) { await page.goto("/"); await shot(page, "home", lang, theme, view, true); }
    if (want("search")) { await page.goto("/search"); await page.getByTestId("doctor-card").first().waitFor({ timeout: 15000 }).catch(() => {}); await shot(page, "search", lang, theme, view, true); }
    await page.goto("/search"); await page.getByTestId("doctor-card").first().waitFor({ timeout: 15000 }).catch(() => {});
    const link = page.getByTestId("doctor-card").first().getByRole("link").first();
    if (await link.count()) {
      await link.click(); await page.getByTestId("doctor-name").waitFor({ timeout: 15000 }).catch(() => {});
      if (want("doctor")) await shot(page, "doctor", lang, theme, view, true);
      if (process.env.FLOW === "1" && want("flow")) {
        const ob = page.getByTestId("open-booking");
        if (await ob.isVisible()) { await ob.click(); await page.getByTestId("booking-sheet").waitFor(); await shot(page, "sheet", lang, theme, view, false); }
        const sl = page.getByTestId("slot-calendar").getByTestId("slot-button").first();
        if (await sl.count()) {
          await sl.click();
          await page.getByTestId("continue-booking").click();
          await page.waitForURL(/\/checkout\//).catch(() => {});
          await shot(page, "checkout", lang, theme, view, true);
          await page.getByTestId("consent-data").click();
          await page.getByTestId("confirm-booking").click();
          await page.waitForURL(/\/appointments\//).catch(() => {});
          await shot(page, "confirmed", lang, theme, view, false);
          await page.waitForTimeout(2500);
          await shot(page, "appointment", lang, theme, view, true);
        }
      }
    }
    for (const [n, u] of [["appointments", "/appointments"], ["records", "/records"], ["pharmacy", "/pharmacy"], ["lab", "/lab"], ["services", "/services"]] as const) {
      if (!want(n)) continue;
      await page.goto(u); await shot(page, n, lang, theme, view, true);
    }
  });
}
