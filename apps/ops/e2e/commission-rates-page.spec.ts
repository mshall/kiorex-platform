import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * COM-2 commission rates (default per organisation type, per-organisation panel), Arabic RTL and English, 320 / 640x450 / 1440 / 2560 px: renders, no horizontal overflow, axe serious and critical = 0, no page error.
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const session = (roles: string[]) => {
  const access = `${b64({ alg: "none" })}.${b64({ sub: "pw-finance", kx_roles: roles })}.x`;
  return JSON.stringify({ id_token: access, session_state: null, access_token: access, token_type: "Bearer", scope: "openid profile", expires_at: Math.floor(Date.now() / 1000) + 3600, profile: { sub: "pw-finance", name: "Finance", kx_roles: roles } });
};
const NOT_SET = { state: "NOT_SET", source: null, policyId: null, version: null, effectiveFrom: null, reason: null, spec: null };
const spec = { feeType: "PERCENT", percentBps: 1250, flatMinor: null, minMinor: 500, maxMinor: 9000, mode: "NET_FROM_PAYOUT" };
const eff = (source: string, s: object, reason: string | null = null) => ({ state: "SET", source, policyId: "crp_1", version: 1, effectiveFrom: "2026-12-01T00:00:00Z", reason, spec: s });
const hist = { id: "crp_1", scope: "DEFAULT", product: "CLINIC", scopeRef: "CLINIC", kind: "RATE", version: 1, status: "ACTIVE", spec, effectiveFrom: "2026-12-01T00:00:00Z", reason: null, proposedBy: "sa1", decidedBy: "sa2", decisionNote: null };
const flat = { ...spec, feeType: "FLAT", percentBps: null, flatMinor: 4000 };
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
async function stub(page: Page) {
  await page.route("**/api/v1/**", (r) => r.fulfill(json([])));
  await page.route("http://localhost:4400/**", (r) => r.abort());
  await page.route("**/api/v1/admin/commissions/**", (r) => {
    const p = new URL(r.request().url()).pathname.replace("/api/v1/admin/commissions", "");
    if (p === "/capabilities") return r.fulfill(json({ read: true, export: true, operate: true, proposeConfig: true, approveConfig: true, chooseProvider: true, proposeRate: true, approveRate: true }));
    if (p === "/summary") return r.fulfill(json({ figures: {}, counts: {} }));
    if (p === "/rates/defaults") return r.fulfill(json([{ product: "CLINIC", effective: eff("DEFAULT", spec), pending: null, upcoming: null, history: [hist] }, { product: "PHARMACY", effective: NOT_SET, pending: null, upcoming: null, history: [] }, { product: "LAB", effective: NOT_SET, pending: null, upcoming: null, history: [] }]));
    if (p === "/orgs") return r.fulfill(json([{ orgRef: "org_alpha", market: "EG", currency: "EGP", claims: 1, claimsMinor: 15000, collectedMinor: 15000, provider: "paymob", openRuns: 0 }]));
    if (p === "/orgs/org_alpha") return r.fulfill(json({ config: { settings: {}, missing: ["mode"] }, provider: "paymob", providersAvailable: ["paymob"] }));
    if (p.startsWith("/rates/orgs/")) return r.fulfill(json({ orgRef: "org_alpha", product: "CLINIC", linked: true, state: "SET", effective: eff("OVERRIDE", flat, "negotiated contract"), default: eff("DEFAULT", spec), override: eff("OVERRIDE", flat, "negotiated contract"), inheriting: false, mode: "NET_FROM_PAYOUT", pending: null, upcoming: null, history: [{ ...hist, id: "crp_2", scope: "ORG", scopeRef: "org_alpha", spec: flat, reason: "negotiated contract" }, hist] }));
    return r.fulfill(json({}));
  });
}
const axeSerious = async (page: Page) => { await page.mouse.move(0, 0); await page.waitForTimeout(400); /* let the hover colour transition of the last clicked button finish before measuring contrast */ await page.addScriptTag({ path: AXE! }); return page.evaluate(async () => { const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }); return r.violations.filter((v: any) => ["serious", "critical"].includes(v.impact)).map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`); }); };
const VIEWPORTS = [{ width: 320, height: 800 }, { width: 640, height: 450 }, { width: 1440, height: 900 }, { width: 2560, height: 1300 }];

for (const lang of ["ar", "en"]) for (const vp of VIEWPORTS) {
  test(`commission rates ${lang} ${vp.width}x${vp.height}: defaults and the organisation panel render, no overflow, axe clean`, async ({ page }) => {
    expect(AXE, "axe-core installed").toBeTruthy();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(vp);
    await page.addInitScript(([k, v, l]) => { sessionStorage.setItem(k!, v!); localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", "light"); }, ["oidc.user:http://localhost:4400:kiorex-ops", session(["super_admin", "finance"]), lang]);
    await stub(page);
    await page.goto("/commissions"); await expect(page.getByRole("main")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
    await page.getByTestId("com-tab-rates").click();
    await expect(page.getByTestId("rates-card-CLINIC")).toBeVisible();
    await expect(page.getByTestId("rates-card-PHARMACY").getByTestId("rate-not-set")).toBeVisible();
    await page.getByTestId("rates-open-CLINIC").click();
    await expect(page.getByTestId("rates-form-CLINIC")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow (defaults)").toBe(true);
    expect(await axeSerious(page)).toEqual([]);
    await page.getByTestId("com-tab-orgs").click();
    await page.getByText("org_alpha").first().click();
    await expect(page.getByTestId("rates-org-panel")).toBeVisible();
    await expect(page.getByTestId("rates-org-effective")).toBeVisible();
    await expect(page.getByTestId("rates-org-default")).toBeVisible();
    await expect(page.getByTestId("rates-org-override")).toBeVisible();
    await page.getByTestId("rates-toggle-override").click();
    await expect(page.getByTestId("rates-org-form")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow (organisation panel)").toBe(true);
    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
