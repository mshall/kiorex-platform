import { defineConfig, devices } from "@playwright/test";

/**
 * Rev 2.3 ops-console journeys against the ISOLATED stack of apps/web/e2e/home/stack.mjs (Kiorex API :4001, throwaway DB, DEV-ONLY gate rows).
 * Run apps/web's home spec first (it creates the booking, SOS alert and unsafe abort this suite acts on):
 *   (cd ../web && node e2e/home/stack.mjs up && npx playwright test -c playwright.home.config.ts) && npx playwright test -c playwright.home.config.ts
 */
export default defineConfig({
  testDir: "./e2e/home",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5181", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite", url: "http://localhost:5181", reuseExistingServer: true, timeout: 60_000 },
});
