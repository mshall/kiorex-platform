import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { API, bearer } from "./helpers";
import { OPS_A, OPS_B, OPS_FINANCE, resetOtp, rolesOf, setRoles, signInAs } from "./growth-helpers";
const signIn = (page: Page, to: string) => signInAs(page, OPS_A, to);

/**
 * Super Admin "Growth & Patient Acquisition" (GRW-P1-K) against the REAL local stack: Kiorex API :4000, Passport :4400 (OTP 000000 + dev TOTP), ops :5181.
 * Admin A is the seeded ops super admin; admin B is the seeded demo ops admin lifted to super_admin for this run (restored in afterAll), so the
 * maker-checker path is exercised by two real, different sessions. Screenshots: _docs/test-flow/growth/.
 */
const SHOTS = path.resolve(process.cwd(), "../../../_docs/test-flow/growth");
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
const RUN = Date.now().toString(36);
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const PLANNED: Array<[string, number]> = [["campaigns", 2], ["referrals", 2], ["rewards", 2], ["promotions", 2], ["whatsapp", 2], ["lifecycle", 2], ["experiments", 3]];

test.describe.configure({ mode: "serial" });
test.describe("ops Growth & Patient Acquisition (real stack)", () => {
  test.setTimeout(240_000);
  let originalRolesB = "";
  test.beforeAll(async () => { mkdirSync(SHOTS, { recursive: true }); originalRolesB = rolesOf(OPS_B.phone); setRoles(OPS_B.phone, ["ops_admin", "super_admin"]); });
  test.afterAll(() => { if (originalRolesB) setRoles(OPS_B.phone, JSON.parse(originalRolesB) as string[]); resetOtp(); });

  test("navigation group with the 22 founder sections plus configuration versions; planned pages are honest; the market selector stays hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth");
    await expect(page.getByTestId("growth-nav-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('#growth-nav-list a')).toHaveCount(23);
    await expect(page.getByTestId("growth-market")).toHaveCount(0); // one live market: no selector (founder rule)
    await expect(page.getByRole("heading", { name: "Executive overview" })).toBeVisible();
    await expect(page.getByTestId("overview-source")).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "overview-en-light-1440.png"), fullPage: true });
    for (const [key, phase] of PLANNED) {
      await page.getByTestId(`growth-nav-${key}`).click();
      await expect(page.getByTestId("planned-title")).toHaveText(`Planned: Phase ${phase}`);
      await expect(page.getByTestId("planned-scope")).toBeVisible(); await expect(page.getByTestId("planned-deps")).toBeVisible();
      expect(await page.getByTestId("planned-state").locator("form, input, select, textarea, button").count()).toBe(0);
    }
    await page.screenshot({ path: path.join(SHOTS, "planned-experiments-en-light-1440.png"), fullPage: true });
    // every Phase 1 page opens and renders without an error state
    for (const key of ["channels", "providers", "patients", "seo", "landing", "widgets", "templates", "attribution", "fraud", "analytics", "finance", "markets", "integrations", "audit", "config"]) {
      await page.getByTestId(`growth-nav-${key}`).click();
      await expect(page.getByTestId(`growth-page-${key}`)).toBeVisible();
      await expect(page.getByTestId("error-state")).toHaveCount(0);
    }
  });

  test("maker-checker with two real super admins: draft, submit, the author cannot approve, the second admin reviews the diff and approves, audit shows both", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth/config?kind=CONSENT_DEFAULTS");
    const panel = page.getByTestId("config-panel-CONSENT_DEFAULTS"); await expect(panel).toBeVisible();
    await expect(page.getByTestId("propagation")).toBeVisible();
    const cap = 2 + (Date.now() % 3); // 2..4 (the week cap defaults to 3 or higher below)
    await page.getByTestId("cfg-new").click();
    const dlg = page.getByTestId("version-dialog");
    await dlg.getByLabel(/maxMarketingPerWeek/).fill("20"); await dlg.getByLabel(/maxMarketingPerDay/).fill(String(cap));
    await page.getByTestId("cfg-ticket").fill(`E2E-${RUN}`); await page.getByTestId("cfg-reason").fill("e2e maker-checker");
    await page.getByTestId("cfg-save").click();
    await expect(dlg).toHaveCount(0);
    const draftRow = page.locator('[data-testid^="cfg-submit-"]').first(); await expect(draftRow).toBeVisible();
    const version = (await draftRow.getAttribute("data-testid"))!.replace("cfg-submit-", "");
    await expect(page.getByTestId(`cfg-status-${version}`)).toHaveText(/Draft/);
    await draftRow.click();
    await expect(page.getByTestId(`cfg-status-${version}`)).toHaveText(/Waiting for approval/);
    await expect(page.getByTestId(`cfg-wait-${version}`)).toHaveText("Waiting for a second super admin");
    await expect(page.getByTestId(`cfg-approve-${version}`)).toHaveCount(0); // the author has no approve control
    // the API refuses it too, even when asked directly with the author's own token
    const mine = await page.request.post(`${API}/api/v1/ops/growth/config/${(await page.request.get(`${API}/api/v1/ops/growth/config?kind=CONSENT_DEFAULTS&status=PENDING_APPROVAL`, { headers: { Authorization: `Bearer ${await bearer(page)}` } }).then((r) => r.json()) as Array<{ id: string }>)[0]!.id}/approve`, { headers: { Authorization: `Bearer ${await bearer(page)}` } });
    expect(mine.status()).toBe(403); expect((await mine.json()).code).toBe("GROWTH_CONFIG_SELF_APPROVAL");
    await page.screenshot({ path: path.join(SHOTS, "config-pending-en-light-1440.png"), fullPage: true });

    // second admin, a different real session
    const ctxB: BrowserContext = await browser.newContext({ baseURL: "http://localhost:5181", locale: "ar-EG", timezoneId: "Africa/Cairo", viewport: { width: 1440, height: 900 } });
    const b = await ctxB.newPage(); await b.addInitScript(prefs, ["en", "light"]);
    await signInAs(b, OPS_B, "/growth/config?kind=CONSENT_DEFAULTS");
    await expect(b.getByTestId(`cfg-approve-${version}`)).toBeVisible();
    await b.getByTestId(`cfg-review-${version}`).click();
    await expect(b.getByTestId("diff-list")).toContainText("maxMarketingPerDay");
    await expect(b.getByTestId("validate-result")).toContainText("Passes all checks");
    await b.getByTestId("review-decide").click();
    await b.getByTestId("decide-confirm").click();
    await expect(b.getByTestId(`cfg-status-${version}`)).toHaveText(/In force/);
    await expect(b.getByTestId("in-force-source")).toHaveText(`Version ${version} in force`);
    await b.screenshot({ path: path.join(SHOTS, "config-approved-en-light-1440.png"), fullPage: true });

    // A sees it, and the propagation monitor lists the API instance as a reader of that version
    await page.reload();
    await expect(page.getByTestId("in-force-source")).toHaveText(`Version ${version} in force`);
    await expect(page.getByTestId("payload-summary")).toContainText(String(cap));
    await expect.poll(async () => (await page.getByTestId("propagation").innerText()).includes("serve this version"), { timeout: 20_000 }).toBe(true);

    // audit log shows who did what
    await page.goto("/growth/audit"); await page.getByTestId("audit-action").fill("growth.config."); await page.getByTestId("audit-apply").click();
    await expect(page.getByRole("cell", { name: "growth.config.approve" }).first()).toBeVisible();
    await expect(page.locator("tbody").getByText("01HZKXD0000000000000009001").first()).toBeVisible();

    // roll back to the proposed default so the dev stack keeps its defaults: a NEW version that B approves
    await page.goto("/growth/config?kind=CONSENT_DEFAULTS");
    const rb = page.locator('[data-testid^="cfg-rollback-"]').last(); await rb.click();
    await page.getByTestId("rollback-reason").fill("e2e cleanup"); await page.getByTestId("rollback-confirm").click();
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
    await b.reload(); const approveRb = b.locator('[data-testid^="cfg-approve-"]').first(); await approveRb.click(); await b.getByTestId("decide-confirm").click();
    await expect(b.getByTestId("in-force-source")).toContainText(/in force/);
    await ctxB.close();
  });

  test("a money-policy change refuses less than 7 days notice with the server's reason", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth/attribution");
    await expect(page.getByTestId("attribution-rules")).toBeVisible();
    await expect(page.getByTestId("config-panel-ATTRIBUTION_POLICY")).toBeVisible();
    await page.getByTestId("cfg-new").click();
    const dlg = page.getByTestId("version-dialog");
    await dlg.getByLabel(/providerTouchWindowDays/).fill("40");
    const soon = new Date(Date.now() + 2 * 86_400_000); const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.getByTestId("cfg-effective").fill(local); await page.getByTestId("cfg-announcement").fill("Providers: the provider window grows to 40 days (e2e).");
    await page.getByTestId("cfg-ticket").fill(`E2E-${RUN}`); await page.getByTestId("cfg-save").click();
    await page.locator('[data-testid^="cfg-submit-"]').first().click();
    await expect(page.getByTestId("config-errors")).toContainText("GROWTH_CONFIG_EFFECTIVE_TOO_SOON");
    await page.screenshot({ path: path.join(SHOTS, "attribution-seven-day-en-light-1440.png"), fullPage: true });
  });

  test("SEO management shows thresholds, robots and sitemap status, the metadata template editor, and slug and redirect viewers", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth/seo");
    await expect(page.getByTestId("seo-thresholds")).toContainText("Live providers needed");
    await expect(page.getByTestId("seo-robots")).toBeVisible(); await expect(page.getByTestId("seo-sitemap")).toBeVisible(); await expect(page.getByTestId("seo-live")).toBeVisible();
    await page.getByTestId("cfg-new").click();
    await expect(page.getByTestId("seo-templates")).toBeVisible();
    await page.getByTestId("tpl-locale").selectOption("en"); await page.getByTestId("tpl-page").selectOption("doctor");
    await page.getByTestId("tpl-title").fill("{name} | {specialty} in {city}"); await page.getByTestId("tpl-add").click();
    await expect(page.getByTestId("seo-template-rows")).toContainText("EN · doctor");
    await page.getByTestId("tpl-title").fill("{nme} typo"); await page.getByTestId("tpl-page").selectOption("hub"); await page.getByTestId("tpl-add").click();
    await page.getByTestId("cfg-ticket").fill(`E2E-${RUN}`); await page.getByTestId("cfg-save").click();
    await expect(page.getByTestId("config-errors")).toContainText("unknown placeholders"); // F's validator, through the maker-checker write path
    await page.screenshot({ path: path.join(SHOTS, "seo-template-error-en-light-1440.png"), fullPage: true });
  });

  test("a finance persona sees financial performance but cannot draft or approve configuration; integrations never show a secret", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signInAs(page, OPS_FINANCE, "/growth/finance");
    await expect(page.getByTestId("finance-stats")).toBeVisible();
    await page.goto("/growth/attribution"); await expect(page.getByTestId("config-panel-ATTRIBUTION_POLICY")).toBeVisible();
    await expect(page.getByTestId("cfg-new")).toHaveCount(0);
    await expect(page.getByText(/need the super admin role/)).toBeVisible();
    await page.goto("/growth/integrations");
    await expect(page.getByTestId("secret-rule")).toBeVisible(); await expect(page.getByTestId("mode-SMS")).toBeVisible();
    expect(await page.locator("input, textarea").count()).toBe(0);
    const body = JSON.stringify(await page.request.get(`${API}/api/v1/ops/growth/integrations`, { headers: { Authorization: `Bearer ${await bearer(page)}` } }).then((r) => r.json()));
    expect(body).toMatch(/SMS_API_KEY/); expect(body).not.toMatch(/"(apiKey|secret|password|token)"/i);
    await page.screenshot({ path: path.join(SHOTS, "integrations-en-light-1440.png"), fullPage: true });
  });

  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
    test(`renders ${lang} ${theme} at ${width}px: RTL where Arabic, no horizontal overflow, axe clean on overview, attribution, integrations and a planned page`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.addInitScript(prefs, [lang, theme]);
      await signIn(page, "/growth");
      for (const [route, ready, name] of [["/growth", "overview-stats", "overview"], ["/growth/attribution", "config-panel-ATTRIBUTION_POLICY", "attribution"], ["/growth/integrations", "secret-rule", "integrations"], ["/growth/campaigns", "planned-state", "planned"]] as const) {
        await page.goto(route); await page.getByTestId(ready).waitFor();
        await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} overflows`).toBeLessThanOrEqual(1);
        expect(await axeSerious(page), `${route} axe`).toEqual([]);
        if (name === "overview" || name === "planned") await page.screenshot({ path: path.join(SHOTS, `${name}-${lang}-${theme}-${width}.png`), fullPage: true });
      }
    });
  }
});
