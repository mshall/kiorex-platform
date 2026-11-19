import type { Page } from "@playwright/test";

export const MOCK = process.env.E2E_MODE === "mock";
export const OPS_PHONE = "+201000000099"; // seeded ops super admin (INTEGRATION.md); dev IdP accepts OTP 000000 outside production
export const DEV_OTP = "000000";

/** Mock mode is pre-authenticated; real mode drives the dev OIDC provider (Kiorex Account :4400, client kiorex-ops). */
export async function signIn(page: Page) {
  await page.goto("/flags");
  if (MOCK) return;
  await page.waitForURL(/localhost:4400/);
  await page.locator("#phone").fill(OPS_PHONE);
  await page.locator('form[action$="/phone"] button[type="submit"]').click();
  await page.locator("#code").fill(DEV_OTP);
  await page.locator('form[action$="/verify"] button[type="submit"]').click();
  const skip = page.locator("form#finish button");
  await Promise.race([page.waitForURL(/localhost:5181/), skip.waitFor({ state: "visible" }).then(() => skip.click())]).catch(() => {});
  await page.waitForURL(/localhost:5181/);
}
