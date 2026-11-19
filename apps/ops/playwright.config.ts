import { defineConfig, devices } from "@playwright/test";

/**
 * E2E_MODE=real (default)  → real local stack: X
 * E2E_MODE=mock            → MSW mock API + fake auth (no backend needed); used for UI/RTL checks when the stack is down.
 * See README.md in this folder for prerequisites.
 */
const mock = process.env.E2E_MODE === "mock";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:5181", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-EG", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /rtl\.spec\.ts/ }],
  webServer: {
    command: mock ? "VITE_MOCK=1 npx vite" : "npx vite",
    url: "http://localhost:5181",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
