import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signIn } from "./helpers";

test("screenshots for visual review (EN default, AR/RTL)", async ({ page }) => {
  mkdirSync("e2e/screenshots", { recursive: true });
  await signIn(page);
  await page.getByTestId("tab-flags").waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "e2e/screenshots/flags-en.png", fullPage: true });
  await page.getByTestId("lang-toggle").click();
  await page.screenshot({ path: "e2e/screenshots/flags-ar.png", fullPage: true });
});
