import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Every console page renders against the real API without an error state (empty tables are fine). */
test("console pages load", async ({ page }) => {
  await signIn(page);
  for (const path of ["providers", "outbox", "finance", "moderation", "liquidity", "messaging", "orders", "fees", "operations", "flags"]) {
    await page.goto(`/${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("error-state"), `${path} shows an error state`).toHaveCount(0, { timeout: 8000 });
  }
});
