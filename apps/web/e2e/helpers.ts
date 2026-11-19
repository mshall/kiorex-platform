import type { Page } from "@playwright/test";

export const MOCK = process.env.E2E_MODE === "mock";
export const PATIENT_PHONE = "+201000000001"; // seeded test patient (INTEGRATION.md); dev IdP accepts OTP 000000 outside production
export const DEV_OTP = "000000";

/** Signs the patient in. Mock mode is pre-authenticated; real mode drives the dev OIDC provider (Kiorex Account :4400). */
export async function signIn(page: Page) {
  await page.goto("/");
  if (MOCK) return;
  await page.getByTestId("sign-in").click();
  await page.waitForURL(/localhost:4400/);
  await page.locator("#phone").fill(PATIENT_PHONE);
  await page.locator('form[action$="/phone"] button[type="submit"]').click();
  await page.locator("#code").fill(DEV_OTP);
  await page.locator('form[action$="/verify"] button[type="submit"]').click();
  const skipPasskey = page.locator("form#finish button");
  await Promise.race([page.waitForURL(/localhost:5180/), skipPasskey.waitFor({ state: "visible" }).then(() => skipPasskey.click())]).catch(() => {});
  await page.waitForURL(/localhost:5180/);
}

/** Completes the sandbox deposit checkout from the appointment page (mock page in mock mode, API fake PSP page in real mode). */
export async function payFakeDeposit(page: Page) {
  const back = page.url();
  await page.getByTestId("pay-deposit-link").click();
  if (MOCK) await page.getByTestId("mock-pay").click();
  else { await page.waitForURL(/fake-checkout/); await page.locator("button, input[type=submit]").first().click(); await page.goto(back); }
  await page.waitForURL(/\/appointments\//);
}
