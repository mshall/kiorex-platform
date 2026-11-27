import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEV_OTP } from "./helpers";
import { totpCode, localTotpSeed } from "./totp";

/** Seeded demo ops personas (TEST_DATA.md). 9001 is a plain ops_admin; the test lifts it to super_admin for the maker-checker run and puts it back afterwards. */
export const OPS_B = { phone: "+201000009001", get totp() { return localTotpSeed("+201000009001"); } };
export const OPS_FINANCE = { phone: "+201000009002", get totp() { return localTotpSeed("+201000009002"); } };

const psql = (sql: string) => execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_account", "-t", "-A", "-c", sql], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
export const rolesOf = (phone: string) => psql(`SELECT roles FROM accounts WHERE phone='${phone}'`);
export const setRoles = (phone: string, roles: string[]) => psql(`UPDATE accounts SET roles='${JSON.stringify(roles)}' WHERE phone='${phone}'`);
export const resetOtp = () => { try { psql("TRUNCATE otp_challenges, otp_send_log, otp_lockouts"); } catch { /* best effort */ } };

export const OPS_A = { phone: "+201000000099", get totp() { return localTotpSeed("+201000000099"); } };

/**
 * Real Passport sign-in (phone, OTP 000000, TOTP) for a persona. Always fresh: the token carries the roles of the moment. The dev IdP accepts each TOTP step once, and
 * other suites share the same seeded personas, so a rejected code is retried with the NEXT 30 s step instead of failing the run.
 */
export async function signInAs(page: Page, who: { phone: string; totp: string }, to = "/growth") {
  resetOtp();
  await page.goto(to);
  await page.waitForURL(/localhost:4400/);
  await page.locator("#phone").fill(who.phone);
  await page.locator('form[action$="/phone"] button[type="submit"]').click();
  await page.locator("#code").fill(DEV_OTP);
  await page.locator('form[action$="/verify"] button[type="submit"]').click();
  const skip = page.locator("form#finish button"); const totp = page.locator("#totp");
  await Promise.race([page.waitForURL(/localhost:5181/), skip.waitFor({ state: "visible" }).then(() => skip.click()), totp.waitFor({ state: "visible" })]).catch(() => {});
  for (let attempt = 0; attempt < 4 && !/localhost:5181/.test(page.url()); attempt++) {
    if (await totp.isVisible().catch(() => false)) {
      await totp.fill(totpCode(who.totp)); await page.locator('form[action$="/totp"] button[type="submit"]').click();
      const done = await page.waitForURL(/localhost:5181/, { timeout: 6_000 }).then(() => true, () => false);
      if (done) break;
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_200); // wait for the next TOTP step
    } else if (await skip.isVisible().catch(() => false)) { await skip.click(); await page.waitForURL(/localhost:5181/, { timeout: 8_000 }).catch(() => {}); }
    else await page.waitForTimeout(1_000);
  }
  await page.waitForURL(/localhost:5181/, { timeout: 15_000 });
  await page.waitForFunction(() => Object.keys(sessionStorage).some((k) => k.startsWith("oidc.user:")), undefined, { timeout: 15_000 });
  await expect(page.getByRole("main")).toBeVisible();
}
