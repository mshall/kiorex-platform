import { defineConfig } from "@playwright/test";

/**
 * Kiorex patient app (Expo WEB) against the real local stack (Passport :4400, Kiorex API :4000, seeded demo data).
 * Start the app:  cd kiorex-platform/apps/mobile && npx expo start --web --port 8081
 * Run:            cd kiorex-platform/apps/mobile/e2e-web && WEB_URL=http://localhost:8081 npx playwright test
 * Browser: a cached Chromium (override CHROMIUM_PATH). This is the WEB build of the app: native-only behaviour (ASWebAuthenticationSession,
 * push, secure store) is covered by the device notes in _docs/mobile/DEVICE_TEST_REPORT_2026-11-20.md, not here.
 */
const executablePath = process.env.CHROMIUM_PATH ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
export default defineConfig({
  testDir: ".", testMatch: /.*\.spec\.ts/, timeout: 90_000, expect: { timeout: 15_000 }, workers: 1, fullyParallel: false, retries: 0,
  reporter: [["list"]], outputDir: "./test-results",
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:8081", viewport: { width: 420, height: 900 }, locale: "en-US", launchOptions: { executablePath }, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
