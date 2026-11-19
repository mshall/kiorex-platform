import { expect, test } from "@playwright/test";
import { payFakeDeposit, signIn } from "./helpers";

test("golden patient journey: search → profile → hold → confirm → appointment", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // search
  await page.getByTestId("search-input").fill("");
  await page.getByTestId("search-submit").click();
  await expect(page).toHaveURL(/\/search/);
  const cards = page.getByTestId("doctor-card");
  // Real stack prerequisite: Kiorly (:3000) running with a LIVE provider synced into Kiorex (POST /api/v1/admin/providers/sync).
  await page.getByTestId("result-count").waitFor();
  test.skip(!(await cards.count().then((n) => n > 0, () => false)), "No providers synced into the real stack — start Kiorly :3000 and run the provider sync (see README)");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().getByTestId("slot-button").first()).toBeVisible(); // next slots inline (KXMDS04)

  // profile (policy shown before booking)
  await cards.first().getByRole("link").first().click();
  await expect(page.getByTestId("doctor-name")).toBeVisible();
  await expect(page.getByTestId("cancellation-policy")).toBeVisible();
  await expect(page.getByTestId("verified-badge").first()).toBeVisible();
  await page.getByTestId("slot-calendar").getByTestId("slot-button").first().click();
  await page.getByTestId("continue-booking").click();

  // checkout: 5-minute hold countdown, consent, optional deposit
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByTestId("hold-countdown")).toContainText(/0[0-5]:\d\d/);
  await page.getByTestId("consent-data").click();
  await expect(page.getByTestId("confirm-booking")).toBeEnabled();
  await page.getByTestId("confirm-booking").click();

  // appointment
  await expect(page).toHaveURL(/\/appointments\//);
  await expect(page.getByTestId("appt-status")).toBeVisible();
  await expect(page.getByTestId("status-timeline")).toBeVisible();
  await expect(page.getByTestId("appt-status")).toHaveText(/مؤكَّد|بانتظار تأكيد العيادة/);

  // deposit (only when the visit type requires one) is paid on the appointment page after confirmation
  if (await page.getByTestId("pay-deposit-link").isVisible()) {
    await payFakeDeposit(page);
    await expect(page.getByTestId("deposit-status")).toBeVisible();
  }
});
