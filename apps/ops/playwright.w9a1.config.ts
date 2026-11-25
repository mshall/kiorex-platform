import { defineConfig, devices } from "@playwright/test";

/** GRW-P4-D in a real browser on a lane-private Vite :5391 (never :5181 shared, nor 3000, 5173, 5175). The API is answered by fixtures (page.route) with a synthetic session: the real endpoints are exercised by test/growth-loyalty.int.spec.ts. */
export default defineConfig({
  testDir: "./e2e", testMatch: /growth-loyalty\.spec\.ts/, timeout: 120_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: "http://localhost:5391", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5391 --strictPort", url: "http://localhost:5391", reuseExistingServer: true, timeout: 90_000 },
});
