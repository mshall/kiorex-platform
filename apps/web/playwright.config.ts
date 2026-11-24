import { defineConfig, devices } from "@playwright/test";

/**
 * Real local stack only (no mocks): Kiorex API :4000, Kiorex Passport (dev IdP) :4400, Postgres :5433, Kiorly :3000.
 * See README.md in this folder for prerequisites.
 */

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:5180", storageState: "./e2e/consent-seed.json" /* consent already answered (reject): the privacy banner is covered by e2e/consent.spec.ts only */, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /rtl\.spec\.ts/ }],
  webServer: {
    command: "npx vite",
    url: "http://localhost:5180",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
