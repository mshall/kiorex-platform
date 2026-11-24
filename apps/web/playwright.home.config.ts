import { defineConfig, devices } from "@playwright/test";

/**
 * Rev 2.3 home-visit journeys against the ISOLATED stack from e2e/home/stack.mjs: Kiorex API :4001 on a throwaway DB with DEV-ONLY gate rows
 * (GHV1, GHV2, GPR1 recorded; GKN1/GKN2 not, so care plans stay awaiting-gate), real Passport :4400, the API's HMAC-verifying fake Kiorly.
 * Uses whatever web dev server owns :5180 (Passport redirect URIs are registered for it); the spec re-points /api to :4001.
 *   node e2e/home/stack.mjs up && npx playwright test -c playwright.home.config.ts ; node e2e/home/stack.mjs down
 */
export default defineConfig({
  testDir: "./e2e/home",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5180", storageState: "./e2e/consent-seed.json" /* consent already answered (reject): the privacy banner is covered by e2e/consent.spec.ts only */, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite", url: "http://localhost:5180", reuseExistingServer: true, timeout: 60_000 }, // /api calls are re-pointed to :4001 by the spec (see home.spec.ts)
});
