import { defineConfig, devices } from "@playwright/test";

/** Configurability sweep: the Integrations Control Center in a real browser on a private stack: Vite :5397 proxying to the private Kiorex API :4397 (e2e/scripts/cfg-stack.sh), session injected from the real Passport login (PW_SESSION_JSON). Never :5181 (shared) nor 3000, 5173, 5175. */
export default defineConfig({
  testDir: "./e2e", testMatch: /integrations-center\.spec\.ts/, timeout: 120_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: "http://localhost:5397", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5397 --strictPort", url: "http://localhost:5397", reuseExistingServer: true, timeout: 90_000, env: { KIOREX_API_URL: "http://localhost:4397" } },
});
