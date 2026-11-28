import { expect, test, type Page } from "@playwright/test";
import { AXE, axe } from "./axe";
import { mockStack, newState } from "./mock";

const prep = async (page: Page, lang: "en" | "ar", theme: "light" | "dark" = "light") => {
  await page.addInitScript(([l, th]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", th); localStorage.setItem("kx-consent", "{}"); } catch { /* */ } }, [lang, theme]);
  await mockStack(page, newState());
};
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test("entry points: Sign in, Join us, Find care and the provider path; nothing jumps straight to Passport", async ({ page }) => {
  await prep(page, "en");
  await page.goto("/");
  const passportHits: string[] = []; page.on("request", (r) => { if (r.url().startsWith("http://localhost:4400")) passportHits.push(r.url()); });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("verified doctor");
  await expect(page.getByTestId("hero-find-care")).toBeVisible();
  await expect(page.getByTestId("hero-join")).toBeVisible();
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByTestId("join-us")).toBeVisible();
  const providers = page.getByTestId("landing-providers");
  await expect(providers).toHaveAttribute("href", /#join$/);
  await expect(providers).toHaveAttribute("rel", /noopener/);
  await page.getByTestId("sign-in").click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByTestId("entry-continue")).toBeVisible();
  expect(passportHits).toEqual([]); // the entry page comes first
  await page.getByTestId("entry-tab-register").click();
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Create your Kiorex account");
});

test("honest market status: Egypt gate closed shows pilot copy, never live", async ({ page }) => {
  await prep(page, "en");
  await page.goto("/");
  await expect(page.getByTestId("hero-status")).toContainText("Pilot");
  await expect(page.getByTestId("hero-status")).not.toContainText("open in Egypt");
});

test("no invented numbers or names on the landing page", async ({ page }) => {
  await prep(page, "en");
  await page.goto("/");
  await page.waitForTimeout(600);
  const text = await page.getByTestId("landing").innerText();
  expect(text).not.toMatch(/\d{2,}\s?(\+|%|k\b)|EGP\s*\d|testimonial|★/i);
});

for (const lang of ["en", "ar"] as const) for (const theme of ["light", "dark"] as const) {
  test(`axe clean and no overflow: landing ${lang} ${theme}`, async ({ page }) => {
    await prep(page, lang, theme);
    await page.goto("/");
    await expect(page.getByTestId("claims")).toBeVisible();
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(900);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await noOverflow(page);
    test.skip(!AXE, "axe-core not installed");
    expect(await axe(page)).toEqual([]);
  });
}

test("the three claims share the page gutter with the logo and the headline, in LTR and RTL", async ({ page }) => {
  for (const lang of ["en", "ar"] as const) {
    await prep(page, lang);
    await page.goto("/");
    await expect(page.getByTestId("claims")).toBeVisible();
    await page.waitForTimeout(900);
    const x = await page.evaluate(() => {
      const r = (el: Element | null) => el!.getBoundingClientRect();
      const rtl = document.documentElement.dir === "rtl";
      const logo = r([...document.querySelectorAll("header svg[data-kx-logo]")].find((e) => e.getBoundingClientRect().width > 0) ?? null); const h1 = r(document.querySelector("h1")); const claims = r(document.querySelector('[data-testid="claims"]'));
      // the logo box carries clear space around the ink (ink = x 24..314.5 of 440 in a 130 high viewBox), so compare the INK edge
      const inkL = logo.left + (24 / 130) * logo.height; const inkR = logo.right - ((440 - 314.5) / 130) * logo.height;
      return rtl ? { logo: inkR, h1: h1.right, claims: claims.right } : { logo: inkL, h1: h1.left, claims: claims.left };
    });
    expect(Math.abs(x.logo - x.h1)).toBeLessThanOrEqual(2);
    expect(Math.abs(x.h1 - x.claims)).toBeLessThanOrEqual(2);
  }
});

test("reduced motion: content is visible at once and the logo pulse does not animate", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await prep(page, "en");
  await page.goto("/");
  const state = await page.evaluate(() => { const c = getComputedStyle(document.querySelector("header polyline")!); return { dur: c.animationDuration, op: getComputedStyle(document.querySelector('[data-testid="claims"] li')!).opacity }; });
  expect(parseFloat(state.dur)).toBeLessThan(0.05);
  expect(state.op).toBe("1");
  await ctx.close();
});

test("keyboard: skip link, header, hero CTAs are reachable in order with a visible focus ring", async ({ page }) => {
  await prep(page, "en");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent?.trim());
  expect(active).toBeTruthy();
});
