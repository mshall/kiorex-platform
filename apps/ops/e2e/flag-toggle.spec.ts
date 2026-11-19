import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const KEY = "kiorex.reviews"; // non-money-path flag: a single super admin can toggle it

test("super admin toggles a flag OFF with reason + ticket, sees it in audit, and restores it", async ({ page }) => {
  await signIn(page);
  const row = () => page.getByRole("row").filter({ hasText: KEY });
  await expect(row()).toBeVisible();
  await expect(row().getByTestId("flag-state")).toHaveText("ON");

  // OFF with reason + ticket (required)
  await page.getByTestId(`toggle-${KEY}`).click();
  await expect(page.getByTestId("toggle-submit")).toBeDisabled();
  await page.getByLabel(/Reason/).fill("E2E: moderation backlog");
  await page.getByLabel(/Ticket/).fill("E2E-1");
  await page.getByTestId("toggle-submit").click();
  await expect(page.getByTestId("toggle-dialog")).toBeHidden();
  await expect(row().getByTestId("flag-state")).toHaveText("OFF");

  // audit trail records it
  await page.getByTestId("tab-audit").click();
  await expect(page.getByRole("row").filter({ hasText: KEY }).first()).toContainText("E2E-1");

  // propagation tab lists the products
  await page.getByTestId("tab-propagation").click();
  await expect(page.getByTestId("prop-status").first()).toBeVisible();

  // restore ON (clear override) so the real stack is left clean
  await page.getByTestId("tab-flags").click();
  await page.getByTestId(`toggle-${KEY}`).click();
  await page.getByLabel("Value").selectOption("ON");
  await page.getByLabel(/Reason/).fill("E2E: restore");
  await page.getByLabel(/Ticket/).fill("E2E-1");
  await page.getByTestId("toggle-submit").click();
  await expect(row().getByTestId("flag-state")).toHaveText("ON");
});
