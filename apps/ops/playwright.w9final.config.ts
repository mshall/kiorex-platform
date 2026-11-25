import { defineConfig, devices } from "@playwright/test";

/**
 * Final close-out lane: the ops pages that carry a viewport matrix (growth-ops-pages-w9, integrations-center, growth-automation) at 320, 640x450, 1440 and 2560 in Arabic and English, in a real browser against the
 * PRIVATE full stack (e2e/scripts/w9-stack.sh: Kiorex :4713, Passport :4710). Vite on :5721 proxies /api to the private Kiorex and trusts the private Passport (VITE_OIDC_AUTHORITY); the session is minted from that
 * Passport (`e2e/scripts/ops-web-session.ts`, PW_SESSION_JSON) and PW_OIDC_AUTHORITY names it. Never :5181 (shared), never 3000, 5173, 5175, never the shared Passport :4400.
 */
const AUTH = process.env.PW_OIDC_AUTHORITY ?? "http://localhost:4710";
export default defineConfig({
  testDir: "./e2e", testMatch: /(growth-ops-pages-w9|integrations-center|growth-automation)\.spec\.ts/, timeout: 120_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, reporter: [["list"]],
  use: { baseURL: "http://localhost:5721", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-GB", timezoneId: "Africa/Cairo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5721 --strictPort", url: "http://localhost:5721", reuseExistingServer: false, timeout: 90_000, env: { KIOREX_API_URL: "http://localhost:4713", VITE_OIDC_AUTHORITY: AUTH } },
});
