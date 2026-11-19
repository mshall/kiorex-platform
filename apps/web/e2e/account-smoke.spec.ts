import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Signed-in screens render against the configured API without an error state. */
test("signed-in pages load", async ({ page }) => {
  await signIn(page);
  for (const path of ["/", "/appointments", "/account", "/search"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("error-state"), `${path} shows an error state`).toHaveCount(0);
  }
  await page.goto("/account");
  for (const tab of ["الموافقات", "الأجهزة"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("error-state")).toHaveCount(0);
  }
});
