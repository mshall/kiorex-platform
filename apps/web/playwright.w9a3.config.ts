import { defineConfig, devices } from "@playwright/test";

/** Wave 9 lane A3: the patient web preference centre in a real browser on a lane-private stack: Vite :5394 proxying to the private Kiorex API :4393 (e2e/scripts/w9a3-stack.sh). Never :5180 (shared) nor 3000, 5173, 5175. */
export default defineConfig({
  testDir: "./e2e", testMatch: /preference-centre-w9\.spec\.ts/, timeout: 90_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: "http://localhost:5394", storageState: "./e2e/consent-seed.json", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5394 --strictPort", url: "http://localhost:5394", reuseExistingServer: true, timeout: 90_000, env: { KIOREX_API_URL: "http://localhost:4393" } },
});
