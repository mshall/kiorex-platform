import { defineConfig, devices } from "@playwright/test";

/**
 * Real local stack only (no mocks): Kiorex API :4000, Kiorex Passport (dev IdP) :4400, Postgres :5433, Kiorly :3000.
 * See README.md in this folder for prerequisites.
 */

export default defineConfig({
  testDir: "./e2e",
  // Specs with their OWN config, server and port (each documented in README.md) are not part of the default run against the shared-web setup: they start different servers
  // (deep-links :4391, home, verticals, w9a1 loyalty :5392, w9a3 preference centre, sponsored label :5393) or need a session file (real-stack), and failed here only for that reason.
  testIgnore: ["**/deep-links/**", "**/home/**", "**/verticals/**", "**/ui-review/**", "**/loyalty.spec.ts", "**/preference-centre-w9.spec.ts", "**/sponsored-label.spec.ts", "**/real-stack.spec.ts"],
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
