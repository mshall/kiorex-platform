import { defineConfig, devices } from '@playwright/test';

/**
 * Widget browser suite (GRW-P1-G): `npm run e2e -w apps/widget`. server.cts boots the real API on :4393 with its own database, a Passport stand-in on :4394 and the
 * provider test sites on :4392 (see e2e/server.cts). No port of the shared dev stack is touched.
 */
export default defineConfig({
  testDir: './e2e', testMatch: /.*\.spec\.ts/, testIgnore: /real-passport/, timeout: 60_000, fullyParallel: false, workers: 1, reporter: [['list']],
  use: { baseURL: 'http://localhost:4392', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node -r ts-node/register/transpile-only ../widget/e2e/server.cts', url: 'http://localhost:4393/api/v1/health/live', reuseExistingServer: false, timeout: 180_000, cwd: '../api', stdout: 'pipe', stderr: 'pipe' },
});
