import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 3 verticals (pharmacy, lab, telemedicine) against the ISOLATED stack from e2e/verticals/stack.mjs:
 * Kiorex API :4001 on a throwaway DB with TEST-FIXTURE gate rows, real Kiorly Pharmacy/Lab dev services, real Passport :4400, real Kiorly :3010.
 * The web dev server is started here pointed at :4001, so :5180 must be free (stop the normal dev web server first).
 *   node e2e/verticals/stack.mjs up && npx playwright test -c playwright.verticals.config.ts ; node e2e/verticals/stack.mjs down
 */
export default defineConfig({
  testDir: "./e2e/verticals",
  testMatch: /.*\.spec\.ts/,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5180", storageState: "./e2e/consent-seed.json" /* consent already answered (reject): the privacy banner is covered by e2e/consent.spec.ts only */, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "KIOREX_API_URL=http://localhost:4001 npx vite", url: "http://localhost:5180", reuseExistingServer: false, timeout: 60_000 },
});
