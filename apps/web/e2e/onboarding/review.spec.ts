import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { mockStack, newState } from "./mock";

/** Screenshot matrix for the UI review. Runs only with REVIEW_DIR set (it writes files, asserts nothing): REVIEW_DIR=/path npx playwright test -c playwright.onboarding.config.ts review --project=desktop */
const DIR = process.env.REVIEW_DIR;
test.skip(!DIR, "set REVIEW_DIR to produce the review screenshots");
test.setTimeout(300_000);
const prep = async (page: Page, lang: string, theme: string) => {
  await page.addInitScript(([l, t]) => { try { if (!sessionStorage.getItem("kx-t-init")) { sessionStorage.setItem("kx-t-init", "1"); localStorage.setItem("kx-lang", l); } localStorage.setItem("kx-theme", t); localStorage.setItem("kx-consent", "{}"); } catch { /* */ } }, [lang, theme]);
  await mockStack(page, newState());
};
test("landing matrix", async ({ browser }) => {
  mkdirSync(DIR!, { recursive: true });
  for (const w of [360, 390, 768, 1024, 1440, 1920]) for (const lang of ["en", "ar"]) for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: theme as "light" | "dark", locale: lang });
    const page = await ctx.newPage(); await prep(page, lang, theme);
    await page.goto("/"); await page.waitForTimeout(2600);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${w}-${lang}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
});
test("entry and onboarding matrix", async ({ browser }) => {
  mkdirSync(DIR!, { recursive: true });
  for (const w of [390, 1440]) for (const lang of ["en", "ar"]) for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: theme as "light" | "dark", locale: lang });
    const page = await ctx.newPage(); await prep(page, lang, theme);
    await page.goto("/join"); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/entry-join-${w}-${lang}-${theme}.png`, fullPage: true });
    await page.getByTestId("entry-continue").click(); await page.getByTestId("welcome").waitFor();
    const names = ["1-welcome", "2-name", "3-language", "4-interests", "5-privacy", "6-notify"];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500);
      if (theme === "light" || i === 2) await page.screenshot({ path: `${DIR}/onb-${names[i]}-${w}-${lang}-${theme}.png`, fullPage: true });
      await page.getByTestId("welcome-next").click();
    }
    await page.getByTestId("welcome-done").waitFor(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/onb-7-done-${w}-${lang}-${theme}.png`, fullPage: true });
    await page.getByTestId("welcome-go").click(); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/home-${w}-${lang}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
});
