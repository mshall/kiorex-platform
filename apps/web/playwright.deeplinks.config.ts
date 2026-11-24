import { defineConfig, devices } from "@playwright/test";

/**
 * Web fallback page tests for deep links (GRW-P1-H): `npx playwright test -c playwright.deeplinks.config.ts`.
 * Starts its own tiny server on :4391 (the real renderer from apps/api, see e2e/deep-links/fallback-server.cts). No API, DB or other port is touched.
 */
export default defineConfig({
  testDir: "./e2e/deep-links",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4391", trace: "retain-on-failure" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }, { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "node -r ts-node/register/transpile-only ../web/e2e/deep-links/fallback-server.cts", url: "http://localhost:4391/__touches", reuseExistingServer: false, timeout: 60_000, cwd: "../api" },
});
