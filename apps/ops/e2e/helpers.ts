import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { totpCode } from "./totp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API = process.env.KIOREX_API_URL ?? "http://localhost:4000";
export const OPS_PHONE = "+201000000099"; // seeded ops super admin (INTEGRATION.md); dev IdP accepts OTP 000000 outside production
export const DEV_OTP = "000000";
const AUTH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".auth");

/** The dev IdP allows 5 OTP sends per phone per hour; re-running the suite would trip it. Clears only the counters (never sessions). Best effort. */
function resetOtpLimits() {
  try {
    execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_account", "-c", "TRUNCATE otp_challenges, otp_send_log, otp_lockouts"], { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "ignore" });
  } catch { /* psql not available */ }
}

type Cached = { key: string; value: string; expiresAt: number };
const cachePath = path.join(AUTH_DIR, "ops.json");
const readCache = (): Cached | null => { try { const c = JSON.parse(readFileSync(cachePath, "utf8")) as Cached; return c.expiresAt - Date.now() / 1000 > 180 ? c : null; } catch { return null; } };
const readOidc = (page: Page) => page.evaluate(() => {
  const key = Object.keys(sessionStorage).find((k) => k.startsWith("oidc.user:"));
  if (!key) return null;
  const value = sessionStorage.getItem(key)!;
  return { key, value, expiresAt: (JSON.parse(value) as { expires_at: number }).expires_at };
});

/** Signs the ops super admin in through the real Kiorex Passport (dev IdP :4400). The first call in a run drives the real OIDC + OTP UI; later tests reuse the session. */
export async function signIn(page: Page, to = "/flags") {
  const c = readCache();
  if (c) {
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [c.key, c.value]);
    await page.goto(to);
    await expect(page.getByRole("main")).toBeVisible();
    return;
  }
  resetOtpLimits();
  await page.goto(to);
  await page.waitForURL(/localhost:4400/);
  await page.locator("#phone").fill(OPS_PHONE);
  await page.locator('form[action$="/phone"] button[type="submit"]').click();
  await page.locator("#code").fill(DEV_OTP);
  await page.locator('form[action$="/verify"] button[type="submit"]').click();
  const skip = page.locator("form#finish button");
  const totp = page.locator("#totp"); // ops roles get a TOTP challenge after the SMS code
  await Promise.race([page.waitForURL(/localhost:5181/), skip.waitFor({ state: "visible" }).then(() => skip.click()), totp.waitFor({ state: "visible" }).then(async () => { await totp.fill(totpCode()); await page.locator('form[action$="/totp"] button[type="submit"]').click(); await Promise.race([page.waitForURL(/localhost:5181/), skip.waitFor({ state: "visible" }).then(() => skip.click())]); })]).catch(() => {});
  await page.waitForURL(/localhost:5181/);
  await page.waitForFunction(() => Object.keys(sessionStorage).some((k) => k.startsWith("oidc.user:")), undefined, { timeout: 15_000 });
  const fresh = await readOidc(page);
  if (fresh) { mkdirSync(AUTH_DIR, { recursive: true }); writeFileSync(cachePath, JSON.stringify(fresh)); }
  await expect(page.getByRole("main")).toBeVisible();
}

export const bearer = async (page: Page) => (JSON.parse((await readOidc(page))!.value) as { access_token: string }).access_token;
