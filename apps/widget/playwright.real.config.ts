import { defineConfig, devices } from '@playwright/test';

/**
 * Widget popup flow against the REAL local stack (no stand-in Passport, no hermetic API): `e2e/scripts/widget-real.sh` registers the host origin through the real Clinic API,
 * then runs this config. Kiorex API :4000 (serves the embed), Kiorly Clinic :3010, Passport :4400 (client `kiorex-widget`). Only the provider's host page is synthetic.
 */
export default defineConfig({
  testDir: './e2e', testMatch: /real-passport\.spec\.ts/, timeout: 120_000, fullyParallel: false, workers: 1, reporter: [['list']],
  // The host page is a synthetic https origin that loads the SDK from http://localhost:4000: recent Chrome blocks a public page reaching loopback (Local Network Access), which a real provider site never does
  // (it loads https://book.kiorex.com). The switch is test-browser only.
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'] } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
});
