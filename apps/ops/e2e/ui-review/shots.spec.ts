import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";

/** Not an assertion suite: before/after screenshots for the UI review. TAG=before|after. Output: _docs/ui-review/kiorex-ops */
const OUT = path.resolve(process.cwd(), "../../../_docs/ui-review/kiorex-ops");
const TAG = process.env.TAG ?? "after";
const LANGS = (process.env.LANGS ?? "en,ar").split(",");
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const PAGES = ["flags", "providers", "bookings", "outbox", "finance", "moderation", "liquidity", "orders", "fees", "operations", "safety", "held-deposits", "home-gate", "messaging"];
mkdirSync(OUT, { recursive: true });
test.setTimeout(300_000);
for (const lang of LANGS) for (const theme of THEMES) {
  test(`ops shots ${lang} ${theme}`, async ({ page }) => {
    await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);
    await page.setViewportSize({ width: 1360, height: 860 });
    await signIn(page, "/flags");
    for (const n of PAGES) {
      await page.goto("/" + n); await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `${TAG}-${n}-${lang}-${theme}.png`) });
    }
  });
}
