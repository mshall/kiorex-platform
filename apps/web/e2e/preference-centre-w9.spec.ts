import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Wave 9 (GC-5): the patient web preference centre (signed out: cookie state and choices) in a real browser, Arabic RTL and English, 320 and 1440 px: renders, no horizontal overflow, axe serious
 * and critical violations zero, controls at least 44 px, the cookie dialog opens from the keyboard. Private stack (e2e/scripts/w9a3-stack.sh). Screenshots: _docs/test-flow/growth-w9/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-w9") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-w9"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots;
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
test.beforeAll(() => { expect(AXE, "axe-core must be installed").toBeTruthy(); mkdirSync(SHOTS, { recursive: true }); });

for (const lang of ["ar", "en"] as const) {
  for (const w of [320, 1440]) {
    test(`preference centre ${lang} ${w}px: no overflow, axe clean, 44px controls`, async ({ page }) => {
      const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((l) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-consent", JSON.stringify({ v: 1, textVersion: "TODO_NEEDS_HUMAN_v0", analytics: false, marketing: false, consentId: null, at: "2026-11-24T00:00:00Z" })); } catch { /* storage unavailable */ } }, lang);
      await page.setViewportSize({ width: w, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" }); // axe must not measure a fade-in mid-animation (the contrast it would read is not the resting one)
      await page.goto("/preferences");
      await expect(page.getByTestId("preference-centre")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow").toBe(true);
      await page.addScriptTag({ path: AXE! });
      const v = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return r.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").map((x: any) => `${x.id}: ${x.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
      });
      expect(v).toEqual([]);
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-testid='preference-centre'] button, [data-testid='preference-centre'] a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 - 1); }).map((e) => `${e.tagName}:${(e.textContent ?? "").trim().slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`));
      expect(small, "touch targets under 44px").toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `preference-centre-${lang}-${w}.png`) });
    });
  }
}

test("keyboard: the cookie choices dialog opens from the preference centre with Enter", async ({ page }) => {
  await page.goto("/preferences");
  await page.getByTestId("pc-open-cookies").focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("consent-dialog")).toBeVisible();
});
