/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * COM-3 commission policy page (counsel sign-off, disclosure texts, real-mode gates, settlement statement), Arabic RTL and English, 320 / 640x450 / 1440 / 2560 px: renders, no horizontal overflow, axe serious and critical = 0, no page error.
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const session = (roles: string[]) => {
  const access = `${b64({ alg: "none" })}.${b64({ sub: "pw-finance", kx_roles: roles })}.x`;
  return JSON.stringify({ id_token: access, session_state: null, access_token: access, token_type: "Bearer", scope: "openid profile", expires_at: Math.floor(Date.now() / 1000) + 3600, profile: { sub: "pw-finance", name: "Finance", kx_roles: roles } });
};
const DEF = { status: "NOT_REVIEWED", reviewerName: "", documentId: "", reviewedOn: "", conditions: "", collectionModes: [], payoutRoutes: [] };
const gates = [...["NET_FROM_PAYOUT", "AUTO_CHARGE_SAVED_METHOD", "INVOICE_AND_COLLECT"].map((key) => ({ kind: "COLLECTION_MODE", key, allowed: false, reason: "COUNSEL_NOT_REVIEWED", status: "NOT_REVIEWED", conditions: null })), ...["PAYMOB", "FAWRY", "INSTAPAY", "CARD_GATEWAY", "BANK_IPN"].map((key) => ({ kind: "PAYOUT_ROUTE", key, allowed: false, reason: "COUNSEL_NOT_REVIEWED", status: "NOT_REVIEWED", conditions: null }))];
const hist = { id: "gcv_1", kind: "COMMISSION_COUNSEL_SIGNOFF", version: 1, status: "PENDING_APPROVAL", payload: { ...DEF, status: "REJECTED", reviewerName: "x" }, effectiveFrom: null, createdBy: "sa1", approvedBy: null, reason: "recorded" };
const state = { market: "EG", paymentMode: "mock", realBlocked: 8, gates, counsel: { record: DEF, version: null, effectiveFrom: null, source: "DEFAULT", pending: hist, history: [hist] }, disclosure: { disclosure: { rateDisclosure: { en: "", ar: "" }, termsSummary: { en: "", ar: "" }, showOverrideReason: false }, version: null, wordingSet: false, missing: { rateDisclosure: ["en", "ar"], termsSummary: ["en", "ar"] }, source: "DEFAULT", pending: null, history: [] } };
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
async function stub(page: Page) {
  await page.route("**/api/v1/**", (r) => r.fulfill(json([])));
  await page.route("http://localhost:4400/**", (r) => r.abort());
  await page.route("**/api/v1/admin/commissions/**", (r) => {
    const p = new URL(r.request().url()).pathname.replace("/api/v1/admin/commissions", "");
    if (p === "/capabilities") return r.fulfill(json({ read: true, export: true, operate: true, proposeConfig: true, approveConfig: true, chooseProvider: true, proposeRate: true, approveRate: true }));
    if (p === "/policy") return r.fulfill(json({ markets: ["EG", "SA"] }));
    if (p === "/policy/EG") return r.fulfill(json(state));
    if (p.startsWith("/settlement-statement/")) return r.fulfill(json({ orgRef: "org_alpha", currency: "EGP", onlineCollectionsMinor: 30000, cashVisitCommissionAccruedMinor: 4000, cashVisitCommissionNettedMinor: 0, cashVisitCommissionOpenMinor: 4000, deductions: { commissionMinor: 10000, feesMinor: null, refundsMinor: 0, chargebacksMinor: 0 }, netPayableMinor: 20000, paidByBankTransferMinor: 20000, reconciliation: "UNMATCHED", payouts: [{ payoutRef: "po_1", bankReference: null, reconciliation: "UNMATCHED", cashMinor: 20000 }] }));
    return r.fulfill(json({}));
  });
}
const axeSerious = async (page: Page) => { await page.mouse.move(0, 0); await page.waitForTimeout(400); /* let the hover colour transition of the last clicked button finish before measuring contrast */ await page.addScriptTag({ path: AXE! }); return page.evaluate(async () => { const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }); return r.violations.filter((v: any) => ["serious", "critical"].includes(v.impact)).map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`); }); };
const VIEWPORTS = [{ width: 320, height: 800 }, { width: 640, height: 450 }, { width: 1440, height: 900 }, { width: 2560, height: 1300 }];

for (const lang of ["ar", "en"]) for (const vp of VIEWPORTS) {
  test(`commission policy ${lang} ${vp.width}x${vp.height}: gates, counsel record, wording not set, forms and settlement render, no overflow, axe clean`, async ({ page }) => {
    expect(AXE, "axe-core installed").toBeTruthy();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(vp);
    await page.addInitScript(([k, v, l]) => { sessionStorage.setItem(k!, v!); localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", "light"); }, ["oidc.user:http://localhost:4400:kiorex-ops", session(["super_admin", "finance"]), lang]);
    await stub(page);
    await page.goto("/commission-policy"); await expect(page.getByRole("main")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
    await expect(page.getByTestId("founder-direction")).toBeVisible();
    await expect(page.getByTestId("policy-gates").getByTestId("gate-COLLECTION_MODE-NET_FROM_PAYOUT")).toBeVisible();
    await expect(page.getByTestId("counsel-current")).toBeVisible();
    await expect(page.getByTestId("wording-not-set")).toBeVisible();
    await page.getByTestId("disclosure-open").click(); await expect(page.getByTestId("disclosure-form")).toBeVisible();
    await page.getByTestId("settlement-org").fill("org_alpha"); await page.getByTestId("settlement-go").click(); await expect(page.getByTestId("settlement-figures")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow").toBe(true);
    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
