import { expect, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { totpCode } from "./totp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API = process.env.KIOREX_API_URL ?? "http://localhost:4000";
/** The Passport (dev IdP) and its database. Defaults are the shared dev stack; a PRIVATE stack (e2e/scripts/reg-stack.sh) sets PW_PASSPORT_URL=http://localhost:4810, PW_ACCOUNT_DB=reg_kiorex_account and starts the web with VITE_OIDC_AUTHORITY=<same url>. */
export const PASSPORT_URL = process.env.PW_PASSPORT_URL ?? "http://localhost:4400";
export const ACCOUNT_DB = process.env.PW_ACCOUNT_DB ?? "kiorex_account";
export const PASSPORT_HOST_RE = new RegExp(PASSPORT_URL.replace(/^https?:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
export const PATIENT_PHONE = "+201000000001"; // seeded test patient (INTEGRATION.md); dev IdP accepts OTP 000000 outside production
export const OPS_PHONE = "+201000000099"; // seeded ops super admin
export const DEV_OTP = "000000";
const AUTH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".auth");

/** The dev IdP allows 5 OTP sends per phone per hour; re-running the suite would trip it. Clears only the counters (never sessions). Best effort. */
export function resetOtpLimits() {
  try {
    execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", ACCOUNT_DB, "-c", "TRUNCATE otp_challenges, otp_send_log, otp_lockouts"], { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "ignore" });
  } catch { /* psql not available: the cached sign-in below usually avoids needing it */ }
}

type Cached = { key: string; value: string; expiresAt: number };
const readCache = (name: string): Cached | null => {
  try {
    const c = JSON.parse(readFileSync(path.join(AUTH_DIR, `${name}.json`), "utf8")) as Cached;
    return c.expiresAt - Date.now() / 1000 > 180 ? c : null;
  } catch { return null; }
};
const writeCache = (name: string, c: Cached) => { mkdirSync(AUTH_DIR, { recursive: true }); writeFileSync(path.join(AUTH_DIR, `${name}.json`), JSON.stringify(c)); };
const readOidc = (page: Page) => page.evaluate(() => {
  const key = Object.keys(sessionStorage).find((k) => k.startsWith("oidc.user:"));
  if (!key) return null;
  const value = sessionStorage.getItem(key)!;
  return { key, value, expiresAt: (JSON.parse(value) as { expires_at: number }).expires_at };
});

async function uiLogin(page: Page, phone: string, home: RegExp) {
  await page.locator("#phone").fill(phone);
  await page.locator('form[action$="/phone"] button[type="submit"]').click();
  await page.locator("#code").fill(DEV_OTP);
  await page.locator('form[action$="/verify"] button[type="submit"]').click();
  const skipPasskey = page.locator("form#finish button");
  const totp = page.locator("#totp"); // privileged roles (ops) get a TOTP challenge after the SMS code
  await Promise.race([page.waitForURL(home), skipPasskey.waitFor({ state: "visible" }).then(() => skipPasskey.click()), totp.waitFor({ state: "visible" }).then(async () => { await totp.fill(totpCode()); await page.locator('form[action$="/totp"] button[type="submit"]').click(); await Promise.race([page.waitForURL(home), skipPasskey.waitFor({ state: "visible" }).then(() => skipPasskey.click())]); })]).catch(() => {});
  await page.waitForURL(home);
  await page.waitForFunction(() => Object.keys(sessionStorage).some((k) => k.startsWith("oidc.user:")), undefined, { timeout: 15_000 }); // callback page exchanges the code asynchronously
}

/** Signs the patient in through the real Kiorex Passport (dev IdP :4400). The first call in a run drives the real OIDC + OTP UI;
 *  later tests reuse the resulting session (sessionStorage is not part of Playwright storageState, so it is re-injected). */
export async function signIn(page: Page, to = "/", phone: string = PATIENT_PHONE) {
  const cacheName = phone === PATIENT_PHONE ? "patient" : `patient${phone.replace(/\D/g, "")}`; // other demo personas (TEST_DATA.md) get their own cached session
  const c = readCache(cacheName);
  if (c) {
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [c.key, c.value]);
    await page.goto(to);
    await expect(page.getByTestId("sign-in")).toHaveCount(0, { timeout: 10_000 });
    return;
  }
  resetOtpLimits();
  await page.goto("/");
  await page.getByTestId("sign-in").click();
  await page.getByTestId("entry-continue").click(); // the Kiorex entry page (Sign in / Join us) sits before Passport since 28 Nov 2026
  await page.waitForURL(PASSPORT_HOST_RE);
  await uiLogin(page, phone, /localhost:5180/);
  const fresh = await readOidc(page);
  if (fresh) writeCache(cacheName, fresh);
  if (to !== "/") await page.goto(to);
}

export const bearer = async (page: Page) => {
  const o = await readOidc(page);
  return (JSON.parse(o!.value) as { access_token: string }).access_token;
};

/** Access token for the seeded ops super admin, obtained by really signing in to the ops console in a throwaway context. */
export async function opsToken(browser: Browser): Promise<string> {
  const c = readCache("ops");
  if (c) return (JSON.parse(c.value) as { access_token: string }).access_token;
  resetOtpLimits();
  const ctx = await browser.newContext({ baseURL: "http://localhost:5181" });
  const page = await ctx.newPage();
  await page.goto("/flags");
  await page.waitForURL(PASSPORT_HOST_RE);
  await uiLogin(page, OPS_PHONE, /localhost:5181/);
  const fresh = await readOidc(page);
  await ctx.close();
  if (!fresh) throw new Error("ops sign-in produced no session");
  writeCache("ops", fresh);
  return (JSON.parse(fresh.value) as { access_token: string }).access_token;
}

export const apiHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "X-Kiorex-Market": "EG" });

/** Completes the sandbox deposit checkout from the appointment page (API fake PSP page). */
export async function payFakeDeposit(page: Page) {
  const back = page.url();
  await page.getByTestId("pay-deposit-link").click();
  await page.waitForURL(/fake-checkout/);
  await page.locator("button, input[type=submit]").first().click();
  await page.goto(back);
  await page.waitForURL(/\/appointments\//);
}

/** Pays a Kiorex Pay sandbox checkout (opened by the order/booking page in a new tab). */
export async function paySandbox(page: Page, checkoutUrl: string) {
  const pay = await page.context().newPage();
  await pay.goto(checkoutUrl);
  await pay.locator('button[value="pay"]').click();
  await pay.waitForLoadState("networkidle");
  await pay.close();
}

// ───── Kiorly Clinic outbox simulation (the real contract: HMAC-signed POST /webhooks/kiorly, INTEGRATION.md) ─────
import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
const KIORLY_WEBHOOK_SECRET = process.env.KIORLY_WEBHOOK_SECRET ?? "kx_dev_webhook_secret";
const RECORD_SHARE_SECRET = process.env.KIOREX_RECORD_SHARE_HMAC_SECRET ?? "dev-record-share-secret";

export async function kiorlyWebhook(request: APIRequestContext, type: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ eventId: randomUUID(), type, aggregateType: "Encounter", aggregateId: String(data.encounterId ?? "x"), occurredAt: new Date().toISOString(), target: "KIOREX", data });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `sha256=${createHmac("sha256", KIORLY_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex")}`;
  const res = await request.post(`${API}/api/v1/webhooks/kiorly`, { data: body, headers: { "content-type": "application/json", "x-kiorly-event": type, "x-kiorly-event-id": JSON.parse(body).eventId, "x-kiorly-timestamp": ts, "x-kiorly-signature": sig } });
  return { status: res.status(), body: await res.json().catch(() => null) as unknown };
}

export const recordShareSignature = (summary: unknown) => createHmac("sha256", RECORD_SHARE_SECRET).update(JSON.stringify(summary ?? null), "utf8").digest("hex");
