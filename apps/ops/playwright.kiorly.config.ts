import { defineConfig, devices } from "@playwright/test";

/**
 * Kiorly admin edition (same console, edition by host). Self-contained: its own Vite dev server on a private port, a signed-in session injected into
 * sessionStorage, every /api call answered by the test (no IdP, no API, no database). `*.localhost` resolves to loopback in Chrome, so
 * `admin.kiorly.localhost` is the "Kiorly admin" host (listed in VITE_KIORLY_ADMIN_HOSTS) and plain `localhost` is the Kiorex super admin.
 *   npx playwright test -c playwright.kiorly.config.ts
 */
const PORT = Number(process.env.OPS_EDITION_E2E_PORT ?? 5281);
export default defineConfig({
  testDir: "./e2e", testMatch: /kiorly-edition\.spec\.ts/, timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, reporter: [["list"]], outputDir: "./test-results/kiorly-edition",
  use: { channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-US", timezoneId: "Africa/Cairo" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000,
    env: { VITE_OIDC_AUTHORITY: `http://localhost:${PORT + 1}`, VITE_KIORLY_ADMIN_HOSTS: "admin.kiorly.localhost" },
  },
});
