import { defineConfig, devices } from "@playwright/test";

/** Landing page, entry page and first-run onboarding against a mock Passport and a mock API (no stack, no database). Port 5193. `npx playwright test -c playwright.onboarding.config.ts` */
export default defineConfig({
  testDir: "./e2e/onboarding",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5193", locale: "en-US", timezoneId: "Africa/Cairo", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "npx vite --port 5193 --strictPort", url: "http://localhost:5193", reuseExistingServer: true, timeout: 60_000, env: { KIOREX_API_URL: "http://localhost:9" } },
});
