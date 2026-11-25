import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * COM-1 platform finance console, Arabic RTL and English, 320 / 768 / 1440 / 2560 px: renders, no horizontal overflow, axe (wcag2a, 2aa, 21aa) serious and critical = 0, no page error.
 * A role without the finance view sees the no-access state and no figure request is made.
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const session = (roles: string[]) => {
  const access = `${b64({ alg: "none" })}.${b64({ sub: "pw-finance", kx_roles: roles })}.x`;
  return JSON.stringify({ id_token: access, session_state: null, access_token: access, token_type: "Bearer", scope: "openid profile", expires_at: Math.floor(Date.now() / 1000) + 3600, profile: { sub: "pw-finance", name: "Finance", kx_roles: roles } });
};
const claim = { id: "ccl_1", orgRef: "org_alpha", chargeId: "chg_1", appointmentId: "apt_1", amountMinor: 15000, decisionAmountMinor: 15000, feeBasisMinor: 30000, sponsoredDiscountMinor: 5000, basisPolicyVersion: "BP1", policyVersion: "CP1@base", currency: "EGP", chargeStatus: "CONFIRMED", disputeStatus: null, collectionStatus: "COLLECTED", collectedMinor: 15000, reversedAfterCollection: false, runId: "crn_1" };
const run = { id: "crn_1", orgRef: "org_alpha", periodKey: "2026-12-05", status: "COLLECTED", mode: "AUTO_CHARGE_SAVED_METHOD", modeRequested: "AUTO_CHARGE_SAVED_METHOD", fallbackReason: null, provider: "paymob", currency: "EGP", claimsCount: 1, claimsMinor: 15000, collectedMinor: 15000, deductedMinor: 0, invoicedMinor: 0, paidMinor: 0, invoiceNo: null };
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
async function stub(page: Page, roles: string[], asked: string[]) {
  // nothing may reach a shared API (the vite proxy would): every other API call is answered locally, auth redirects to the shared Passport are refused
  await page.route("**/api/v1/**", (r) => r.fulfill(json([])));
  await page.route("http://localhost:4400/**", (r) => r.abort());
  await page.route("**/api/v1/admin/commissions/**", (r) => {
    const u = new URL(r.request().url()); asked.push(u.pathname);
    const p = u.pathname.replace("/api/v1/admin/commissions", "");
    const read = roles.includes("finance") || roles.includes("super_admin");
    if (p === "/capabilities") return r.fulfill(json({ read, export: read, operate: read, proposeConfig: false, approveConfig: false, chooseProvider: false }));
    if (p === "/summary") return r.fulfill(json({ figures: { collectedMinor: 15000, deductedMinor: 6000, invoiceOpenMinor: 4000, overdueMinor: 0, disputedOpenMinor: 0, creditDueMinor: 0 }, counts: {} }));
    if (p === "/claims") return r.fulfill(json({ total: 1, items: [claim] }));
    if (p === "/runs") return r.fulfill(json({ total: 1, items: [run] }));
    return r.fulfill(json({}));
  });
}
const open = async (page: Page, roles: string[], lang: string, asked: string[]) => {
  await page.addInitScript(([k, v, l]) => { sessionStorage.setItem(k!, v!); localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", "light"); }, ["oidc.user:http://localhost:4400:kiorex-ops", session(roles), lang]);
  await stub(page, roles, asked);
  await page.goto("/commissions"); await expect(page.getByRole("main")).toBeVisible();
};
const axeSerious = async (page: Page) => { await page.addScriptTag({ path: AXE! }); return page.evaluate(async () => { const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }); return r.violations.filter((v: any) => ["serious", "critical"].includes(v.impact)).map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`); }); };

for (const lang of ["ar", "en"]) for (const w of [320, 768, 1440, 2560]) {
  test(`commissions ${lang} ${w}px: cards and ledger render, no overflow, axe clean`, async ({ page }) => {
    expect(AXE, "axe-core installed").toBeTruthy();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: w, height: 900 });
    await open(page, ["ops_admin", "finance"], lang, []);
    await expect(page.getByTestId("com-cards")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
    expect(await axeSerious(page)).toEqual([]);
    await page.getByTestId("com-tab-ledger").click();
    await expect(page.getByText("chg_1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow").toBe(true);
    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("ops_admin without finance sees no money and no figure request is made", async ({ page }) => {
  const asked: string[] = [];
  await open(page, ["ops_admin"], "en", asked);
  await expect(page.getByTestId("com-no-access")).toBeVisible();
  expect(asked.filter((p) => !p.endsWith("/capabilities"))).toEqual([]);
});
