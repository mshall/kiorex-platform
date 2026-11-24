import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Patient web AppLayout header must never overflow horizontally at tablet widths, signed in (six links, bell, language, theme and sign out), in English and Arabic. Regression: it overflowed 768 to 907 px in English. */
test.use({ actionTimeout: 20_000, navigationTimeout: 40_000 });
for (const lang of ["en", "ar"] as const) {
  test(`signed-in header does not overflow at 768 to 1280 px (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => { try { localStorage.setItem("kx-lang", l); } catch { /* storage unavailable */ } }, lang);
    await signIn(page, "/");
    for (const w of [768, 800, 850, 900, 960, 1024, 1280]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250);
      const o = await page.evaluate(() => { const c = document.querySelector("header")!.firstElementChild as HTMLElement; return { page: document.documentElement.scrollWidth - window.innerWidth, header: c.scrollWidth - c.clientWidth }; });
      expect(o, `header overflow at ${w}px (${lang})`).toEqual({ page: 0, header: 0 });
    }
  });
}
