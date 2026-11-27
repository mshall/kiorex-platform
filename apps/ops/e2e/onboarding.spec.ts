/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fixtures and the import console wire shape (resolution tasks carry arbitrary context) */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { buildSample } from "../../api/src/onboarding-import/sample/sample-data";
import { loginWithPhone } from "../../../../e2e/src/passport";
import { localTotpSeed } from "./totp";

/**
 * Org onboarding through the REAL console on the real stack: ops_admin (+201000009001) prepares in one browser context - creates the batch,
 * uploads the messy dump + 20 patient files, resolves every blocker in the resolution queue, requests the commit - and a DIFFERENT person, the
 * super admin (+201000000099), approves and commits in another context. Tokens come from real Kiorex Passport (OIDC + OTP + TOTP).
 */
const KEY = "oidc.user:http://localhost:4400:kiorex-ops";
async function signInAs(page: Page, login: Awaited<ReturnType<typeof loginWithPhone>>, to: string) {
  const value = JSON.stringify({ access_token: login.accessToken, id_token: login.idToken, token_type: "Bearer", scope: "openid profile", expires_at: login.claims.exp, profile: { sub: login.sub, name: (login.claims as any).name, iss: "http://localhost:4400", aud: "kiorex-ops", exp: login.claims.exp, iat: login.claims.iat } });
  await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), [KEY, value]);
  await page.goto(to);
  await expect(page.getByRole("main")).toBeVisible();
}
/** Passport accepts each TOTP time step once per credential: a second login inside the same 30 s step waits for the next one. */
async function login(phone: string, o: { otp: string; totpSecret?: string }) {
  for (let i = 0; ; i++) {
    try { return await loginWithPhone(phone, { clientId: "kiorex-ops", ...o }); }
    catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1500)); resetOtpLimits(); }
  }
}
function resetOtpLimits() {
  try { execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_account", "-c", "TRUNCATE otp_challenges, otp_send_log, otp_lockouts"], { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "ignore" }); } catch { /* optional */ }
}

test("import a messy SQL dump + 20 patient files through the console: resolve, request, second person approves, commit, roll back", async ({ browser }) => {
  test.setTimeout(240_000);
  resetOtpLimits();
  const prep = await login("+201000009001", { otp: "000000", totpSecret: localTotpSeed("+201000009001") });
  const sup = await login("+201000000099", { otp: "000000" });
  const s = buildSample(); const dir = path.join(os.tmpdir(), `onb-sample-${Date.now()}`); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "clinicpro_dump.sql"), s.sql); for (const f of s.files) writeFileSync(path.join(dir, f.name), f.bytes);
  writeFileSync(path.join(dir, s.extras.malware.name.replace(".pdf", "_bad.pdf")), s.extras.malware.bytes);
  const files = [...s.files.map((f) => f.name), "clinicpro_dump.sql", s.extras.malware.name.replace(".pdf", "_bad.pdf")].map((n) => path.join(dir, n));

  const ctxA = await browser.newContext({ locale: "en-US" }); const A = await ctxA.newPage();
  await signInAs(A, prep, "/onboarding");
  await A.getByTestId("onb-new").click(); await A.getByTestId("onb-org-id").fill("e2e_ui_org"); await A.getByTestId("onb-org-name").fill("E2E UI Clinic"); await A.getByTestId("onb-create").click();
  await A.waitForURL(/\/onboarding\/[a-z0-9]+$/); const batchUrl = A.url();
  await A.getByTestId("onb-file-input").setInputFiles(files);
  await expect(A.getByTestId("batch-status")).toHaveText(/Needs review/, { timeout: 90_000 });
  await expect(A.getByTestId("onb-tiles")).toBeVisible();
  await A.getByTestId("tab-tasks").click();

  // resolve every blocker with the console's own controls (filter the queue to blockers)
  await A.getByLabel("Severity").selectOption("BLOCKER");
  for (let guard = 0; guard < 80; guard++) {
    if (await A.getByTestId("no-tasks").isVisible().catch(() => false)) break;
    const card = A.locator('[data-testid^="task-"][data-status="OPEN"]').first();
    await card.waitFor({ timeout: 10_000 }).catch(() => undefined); if (!(await card.isVisible().catch(() => false))) break;
    const type = (await card.getAttribute("data-testid"))!.replace("task-", "");
    if (type === "DUPLICATE_PATIENT") await card.getByTestId("act-merge").click();
    else if (type === "MISSING_REQUIRED" && (await card.textContent())?.includes("fullName")) await card.getByTestId("act-skip-row").click();
    else if (type === "MISSING_REQUIRED" || type === "INVALID_VALUE") { const f = (await card.textContent()) ?? ""; await card.getByTestId("task-value").fill(f.includes("phone") ? "01099990000" : f.includes("amount") ? "100" : "2026-01-01"); await card.getByTestId("act-edit").click(); }
    else if (type === "ORPHAN_REFERENCE") await card.getByTestId("act-skip-row").click();
    else if (type === "ORPHAN_FILE" || type === "AMBIGUOUS_FILE") { if ((await card.textContent())?.includes("scan_unknown")) { await card.getByTestId("patient-search").fill("1014"); await card.getByTestId("pick-1014").click(); } else await card.getByTestId("act-skip-file").click(); }
    else throw new Error(`unexpected blocker ${type}`);
    await A.waitForTimeout(250);
  }
  await expect(A.getByTestId("no-tasks")).toBeVisible({ timeout: 15_000 });
  await expect(A.getByTestId("batch-status")).toHaveText(/Ready/);
  await A.getByTestId("tab-commit").click();
  await expect(A.getByTestId("dry-run")).toContainText("13"); // patients to create
  await A.getByTestId("act-request").click();
  await expect(A.getByTestId("batch-status")).toHaveText(/Awaiting approval/);
  await expect(A.getByTestId("act-approve")).toHaveCount(0); // ops_admin has no approve control at all

  // a different person approves and commits
  const ctxB = await browser.newContext({ locale: "en-US" }); const Bp = await ctxB.newPage();
  await signInAs(Bp, sup, batchUrl.replace(/^https?:\/\/[^/]+/, ""));
  await Bp.getByTestId("tab-commit").click(); await Bp.getByTestId("act-approve").click();
  await expect(Bp.getByTestId("batch-status")).toHaveText(/Approved/);
  await Bp.getByTestId("tab-commit").click(); await Bp.getByTestId("act-commit").click();
  await expect(Bp.getByTestId("batch-status")).toHaveText(/Committed/, { timeout: 60_000 });
  await Bp.getByTestId("tab-commit").click(); await expect(Bp.getByTestId("commit-done")).toBeVisible();
  await Bp.getByTestId("rollback-reason").fill("ui e2e rollback"); await Bp.getByTestId("act-rollback").click();
  await expect(Bp.getByTestId("batch-status")).toHaveText(/Rolled back/);
  await ctxA.close(); await ctxB.close();
});

test.afterAll(() => { try { execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_platform", "-c", "delete from \"ImportBatch\" where \"orgId\" like 'e2e\\_%'"], { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "ignore" }); } catch { /* optional */ } });

test("Arabic console renders the queue RTL", async ({ browser }) => {
  resetOtpLimits();
  const sup = await login("+201000000099", { otp: "000000" });
  const ctx = await browser.newContext({ locale: "ar-EG" }); const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("kx-lang", "ar"));
  await signInAs(p, sup, "/onboarding");
  await expect(p.getByRole("heading").first()).toContainText("إدماج المؤسسات");
  expect(await p.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await ctx.close();
});
