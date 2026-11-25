import { defineConfig, devices } from "@playwright/test";

/** COM-1: Commissions page in a real browser on a PRIVATE vite server (port 5731, never 3000/5173/5175/5181); the API is answered at the network layer with fixture JSON (no shared server, no real vendor). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /commission(s|-rates)-page\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5731", locale: "en", ...devices["Desktop Chrome"] },
  webServer: { command: "npx vite --port 5731 --strictPort --host 127.0.0.1", url: "http://127.0.0.1:5731", reuseExistingServer: false, timeout: 90_000 },
});
