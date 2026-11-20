import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";

/** Not an assertion suite: before/after screenshots for the UI review. TAG=before|after LANGS=ar,en THEMES=light,dark. Output: _docs/ui-review/kiorex-web */
const OUT = path.resolve(process.cwd(), "../../../_docs/ui-review/kiorex-web");
const TAG = process.env.TAG ?? "after";
const LANGS = (process.env.LANGS ?? "ar,en").split(",");
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const PAGES: [string, string][] = [["home", "/"], ["search", "/search"], ["appointments", "/appointments"], ["records", "/records"], ["pharmacy", "/pharmacy"], ["lab", "/lab"], ["services", "/services"], ["account", "/account"], ["notfound", "/zzz-missing"]];
mkdirSync(OUT, { recursive: true });
test.setTimeout(240_000);
for (const lang of LANGS) for (const theme of THEMES) {
  test(`shots ${lang} ${theme}`, async ({ page }) => {
    await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);
    await page.setViewportSize({ width: 1280, height: 860 });
    await signIn(page, "/");
    for (const [n, u] of PAGES) {
      await page.goto(u); await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(OUT, `${TAG}-${n}-${lang}-${theme}.png`), fullPage: false });
    }
    // doctor profile (first result) + mobile home
    await page.goto("/search"); await page.waitForTimeout(1200);
    const first = page.locator('a[href^="/doctors/"]').first();
    if (await first.count()) { await first.click(); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, `${TAG}-doctor-${lang}-${theme}.png`) }); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/"); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${TAG}-home-mobile-${lang}-${theme}.png`) });
  });
}

for (const lang of LANGS) for (const theme of THEMES) {
  test(`landing (signed out) ${lang} ${theme}`, async ({ page }) => {
    await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto("/"); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${TAG}-landing-${lang}-${theme}.png`) });
  });
}
