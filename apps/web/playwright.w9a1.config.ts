import { defineConfig, devices } from "@playwright/test";

/** GRW-P4-D patient web in a real browser on a lane-private Vite :5392 (never :5180 shared, nor 3000, 5173, 5175). The API is answered by fixtures (page.route) behind a synthetic session; the real endpoints are exercised by apps/api/test/growth-loyalty.int.spec.ts. */
export default defineConfig({
  testDir: "./e2e", testMatch: /loyalty\.spec\.ts/, timeout: 120_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: "http://localhost:5392", storageState: "./e2e/consent-seed.json", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5392 --strictPort", url: "http://localhost:5392", reuseExistingServer: true, timeout: 90_000 },
});
