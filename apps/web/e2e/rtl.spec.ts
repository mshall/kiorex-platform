import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signIn } from "./helpers";

/** RTL verification: Arabic is the default, <html dir=rtl>, no horizontal overflow, screenshots saved for review. */
const shots = "e2e/screenshots";
mkdirSync(shots, { recursive: true });

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("Arabic layout is RTL on landing, results, profile; English flips to LTR", async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: `${shots}/${tag}-1-landing-ar.png`, fullPage: true });
  await noOverflow(page);

  await signIn(page);
  await page.screenshot({ path: `${shots}/${tag}-1b-home-ar.png`, fullPage: true });
  await page.goto("/search");
  await expect(page.getByTestId("doctor-card").first()).toBeVisible();
  await page.screenshot({ path: `${shots}/${tag}-2-results-ar.png`, fullPage: true });
  await noOverflow(page);

  await page.getByTestId("open-filters").click();
  await expect(page.getByTestId("filters-sheet")).toBeVisible();
  await page.screenshot({ path: `${shots}/${tag}-3-filters-ar.png` });
  await page.keyboard.press("Escape");

  await page.getByTestId("doctor-card").first().getByRole("link").first().click();
  await expect(page.getByTestId("slot-calendar")).toBeVisible();
  await page.screenshot({ path: `${shots}/${tag}-4-profile-ar.png`, fullPage: true });
  await noOverflow(page);

  await page.getByTestId("lang-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.screenshot({ path: `${shots}/${tag}-5-profile-en.png`, fullPage: true });
  await noOverflow(page);
});

test("emergency keyword shows 123 guidance and no booking", async ({ page }) => {
  await page.goto("/search");
  await page.getByTestId("search-input").fill("ألم في الصدر");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("emergency-banner")).toBeVisible();
  await expect(page.getByTestId("emergency-banner")).toContainText("123");
  await expect(page.getByTestId("doctor-card")).toHaveCount(0);
  await page.screenshot({ path: `${shots}/emergency-ar.png` });
});
