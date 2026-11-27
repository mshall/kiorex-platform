import { defineConfig, devices } from "@playwright/test";

/**
 * Join requests screens (Kiorex super admin and Kiorly admin edition). Self-contained like playwright.kiorly.config.ts: its own Vite server on a private port,
 * a signed-in session injected into sessionStorage, and a small in-memory /api/v1/admin/leads implemented by the test. `admin.kiorly.localhost` is the Kiorly host.
 *   npx playwright test -c playwright.leads.config.ts
 */
const PORT = Number(process.env.OPS_LEADS_E2E_PORT ?? 5283);
export default defineConfig({
  testDir: "./e2e", testMatch: /site-leads\.spec\.ts/, timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, reporter: [["list"]], outputDir: "./test-results/site-leads",
  use: { channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-US", timezoneId: "Africa/Cairo" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000,
    env: { VITE_OIDC_AUTHORITY: `http://localhost:${PORT + 1}`, VITE_KIORLY_ADMIN_HOSTS: "admin.kiorly.localhost" },
  },
});
