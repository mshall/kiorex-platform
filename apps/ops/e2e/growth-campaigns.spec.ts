import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { API, bearer, signIn } from "./helpers";
import { OPS_B, OPS_FINANCE, resetOtp, rolesOf, setRoles, signInAs } from "./growth-helpers";

/**
 * GRW-P2-A against the REAL local stack: Campaign Management, Promotional Campaigns and Approvals in the ops console, with the seeded ops super admin (A) and a second super admin (B: the seeded demo ops admin
 * lifted to super_admin for the run and restored afterwards), Arabic RTL and English, light and dark, 320 to 1440 px, axe serious and critical clean. Screenshots: _docs/test-flow/growth-p2/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p2") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p2"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
const RUN = Date.now().toString(36);
const KEY = `pw-${RUN}`;
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
const api = async (page: Page, method: "get" | "post", p: string, data?: object) => { const r = await page.request[method](`${API}/api/v1${p}`, { headers: { Authorization: `Bearer ${await bearer(page)}` }, ...(data ? { data } : {}) }); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
async function second(browser: Browser, to: string) { const ctx = await browser.newContext({ locale: "en-GB" }); const page = await ctx.newPage(); await page.addInitScript(prefs, ["en", "light"]); await signInAs(page, OPS_B, to); return { ctx, page }; }

// not serial: a flaky Vite reload in one test must not skip the matrix; the tests that need the campaign skip themselves when it was not created
test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("ops campaigns (real stack)", () => {
  test.setTimeout(240_000);
  let originalRolesB = ""; let campaignId = "";
  test.beforeAll(async () => { mkdirSync(SHOTS, { recursive: true }); originalRolesB = rolesOf(OPS_B.phone); setRoles(OPS_B.phone, ["ops_admin", "super_admin"]); });
  test.afterAll(() => { if (originalRolesB) setRoles(OPS_B.phone, JSON.parse(originalRolesB) as string[]); resetOtp(); });

  test("wizard (EN): five steps with validation, tracked-link preview and a draft; a second super admin approves on the approvals page; the campaign starts and shows budget, history and 'not connected'", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth/campaigns");
    await expect(page.getByTestId("growth-page-campaigns")).toBeVisible(); await expect(page.getByTestId("campaigns-plans-only")).toBeVisible();
    await page.getByTestId("campaign-new").click();
    await expect(page.getByTestId("campaign-wizard")).toBeVisible(); await expect(page.getByTestId("cw-next")).toBeDisabled();
    await page.getByTestId("cw-name").fill(`Playwright ${RUN}`); await page.getByTestId("cw-key").fill("Bad Key"); await expect(page.getByTestId("cw-next")).toBeDisabled();
    await page.getByTestId("cw-key").fill(KEY);
    const iso = (d: number) => new Date(Date.now() + d).toISOString().slice(0, 16);
    await page.getByTestId("cw-starts").fill(iso(-3_600_000)); await page.getByTestId("cw-ends").fill(iso(30 * 86_400_000));
    await page.screenshot({ path: path.join(SHOTS, "wizard-basics-en-light-1440.png"), fullPage: true });
    await page.getByTestId("cw-next").click();
    await page.getByTestId("cw-total").fill("10000"); await page.getByTestId("cw-daily").fill("6000"); await page.getByTestId("cw-next").click();
    await expect(page.getByTestId("cw-audience")).toContainText(/never a specialty/i);
    await page.getByTestId("cw-patient-type").selectOption("NEW"); await page.getByTestId("cw-cities").fill("Cairo"); await page.getByTestId("cw-next").click();
    await page.getByTestId("utm-content").fill("pw-banner"); await page.getByTestId("utm-path").fill("/doctors");
    await expect(page.getByTestId("utm-tag")).toHaveText(`eg-${KEY}`); await expect(page.getByTestId("utm-url")).toContainText("utm_content=pw-banner");
    await page.screenshot({ path: path.join(SHOTS, "wizard-tracking-en-light-1440.png"), fullPage: true });
    await page.getByTestId("cw-next").click(); await expect(page.getByTestId("cw-approval-note")).toContainText(/second approver/i);
    await page.getByTestId("cw-create").click();
    await expect(page.getByTestId("campaign-detail")).toBeVisible(); campaignId = (await page.getByTestId("campaign-detail").getAttribute("data-campaign-id"))!;
    await expect(page.getByTestId("campaign-status")).toHaveAttribute("data-status", "DRAFT"); await expect(page.getByTestId("campaign-tag")).toHaveText(`eg-${KEY}`);
    await expect(page.getByTestId("action-SCHEDULED")).toBeDisabled(); await expect(page.getByTestId("action-reasons")).toContainText(/second approver/i);
    await page.getByTestId("tab-approvals").click(); await page.getByTestId("ask-activate").click();
    await expect(page.getByTestId("approval-rows")).toContainText("Waiting");
    // the second super admin approves on the approvals page; the requester sees no decision buttons
    await page.goto("/growth/approvals"); const mine = page.locator(`[data-testid="approval-card"]`).filter({ hasText: `Playwright ${RUN}` });
    await expect(mine).toBeVisible(); await expect(mine.getByTestId("approval-self")).toBeVisible(); await expect(mine.getByTestId("approval-approve")).toHaveCount(0);
    const b = await second(browser, "/growth/approvals");
    try {
      const card = b.page.locator(`[data-testid="approval-card"]`).filter({ hasText: `Playwright ${RUN}` }); await expect(card).toBeVisible();
      await card.getByTestId("approval-approve").click(); await expect(b.page.getByTestId("approvals-pending")).not.toContainText(`Playwright ${RUN}`, { timeout: 15_000 }).catch(() => undefined);
    } finally { await b.ctx.close(); }
    await page.goto(`/growth/campaigns/${campaignId}`); await expect(page.getByTestId("campaign-status")).toHaveAttribute("data-status", /^(SCHEDULED|ACTIVE)$/); // the one-minute scheduler of the stack may already have started it
    expect((await api(page, "post", "/admin/growth/campaigns/scheduler/run")).status).toBe(200);
    await page.reload(); await expect(page.getByTestId("campaign-status")).toHaveAttribute("data-status", "ACTIVE");
    await expect(page.getByTestId("action-PAUSED")).toBeEnabled();
    await page.getByTestId("action-PAUSED").click(); await expect(page.getByTestId("reason-confirm")).toBeDisabled(); await page.getByTestId("reason-input").fill("Playwright pause"); await page.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("campaign-status")).toHaveAttribute("data-status", "PAUSED");
    await page.getByTestId("tab-spend").click(); await page.getByTestId("spend-amount").fill("1000"); await page.getByTestId("spend-add").click(); await expect(page.getByTestId("spend-rows")).toContainText("Waiting");
    await page.getByTestId("tab-creatives").click(); await page.getByTestId("creative-ref").fill("http://evil.example/x.png"); await page.getByTestId("creative-add").click(); await expect(page.getByTestId("creative-error")).toBeVisible();
    await page.getByTestId("creative-ref").fill(`growth/creatives/eg/${campaignId}/banner.png`); await page.getByTestId("creative-add").click(); await expect(page.getByTestId("creative-rows")).toContainText("banner.png");
    await page.getByTestId("tab-report").click(); await expect(page.getByTestId("report-external")).toHaveAttribute("data-connected", "false"); await expect(page.getByTestId("report-external")).toContainText(/no ad-platform numbers/i);
    await page.getByTestId("tab-history").click(); await expect(page.getByTestId("campaign-history")).toContainText("Draft → Waiting for approval");
    await page.screenshot({ path: path.join(SHOTS, "detail-history-en-light-1440.png"), fullPage: true });
  });

  test("Promotional Campaigns lists only promotions and says it does not change a patient price; the list filters by state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/growth/promotions");
    await expect(page.getByTestId("growth-page-promotions")).toBeVisible(); await expect(page.getByTestId("campaigns-plans-only")).toContainText(/does not change a patient price/i);
    await expect(page.getByText(`Playwright ${RUN}`)).toHaveCount(0); // an ACQUISITION campaign is not a promotion
    test.skip(!campaignId, "the first test creates the campaign");
    await page.goto("/growth/campaigns"); await page.getByTestId("campaigns-plans-only").waitFor(); await page.getByTestId("campaign-search").fill(KEY); await expect(page.getByText(`Playwright ${RUN}`)).toBeVisible();
    await page.getByTestId("campaign-status-filter").selectOption("ARCHIVED"); await expect(page.getByText(`Playwright ${RUN}`)).toHaveCount(0);
  });

  test("an ops finance user (ops_admin plus finance, no super admin) reads campaigns but cannot create or change them", async ({ page }) => {
    test.skip(!campaignId, "the first test creates the campaign");
    await page.setViewportSize({ width: 1440, height: 900 }); await page.addInitScript(prefs, ["en", "light"]);
    await signInAs(page, OPS_FINANCE, "/growth/campaigns");
    await expect(page.getByTestId("campaigns-readonly")).toBeVisible(); await expect(page.getByTestId("campaign-new")).toHaveCount(0);
    await page.goto(`/growth/campaigns/${campaignId}`); await expect(page.getByTestId("action-COMPLETED")).toBeDisabled();
    expect((await api(page, "post", "/admin/growth/campaigns", { key: `pw-ro-${RUN}`, name: "x", objective: "ACQUISITION", budgetTotalMinor: 1000, channels: ["EMAIL"] })).status).toBe(403);
    expect((await api(page, "get", `/admin/growth/campaigns/${campaignId}/report`)).status).toBe(200); // the finance role reads the report, including revenue
  });

  // one sign-in per language and theme, then the three widths in the same session (the dev IdP accepts each TOTP step once, so twelve separate sign-ins would be flaky)
  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) {
    test(`renders ${lang} ${theme} at 320, 768 and 1440 px: RTL where Arabic, no horizontal overflow, axe clean on the list, wizard, detail, approvals and promotions`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)"); test.skip(!campaignId, "the first test creates the campaign");
      await page.addInitScript(prefs, [lang, theme]);
      await page.setViewportSize({ width: 1440, height: 900 }); await signIn(page, "/growth/campaigns"); // cached real Passport session (one real OTP and TOTP login per run)
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
        for (const [route, ready, name] of [["/growth/campaigns", "campaigns-plans-only", "list"], ["/growth/campaigns/new", "campaign-wizard", "wizard"], [`/growth/campaigns/${campaignId}`, "campaign-budget", "detail"], ["/growth/approvals", "growth-page-approvals", "approvals"], ["/growth/promotions", "campaigns-plans-only", "promotions"]] as const) {
          await page.goto(route); await page.getByTestId(ready).waitFor();
          await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr"); await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
          await page.waitForTimeout(400);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} @${width} overflows`).toBeLessThanOrEqual(1);
          expect(await axeSerious(page), `${route} @${width} axe`).toEqual([]);
          if (width === 1440 && theme === "light") await page.screenshot({ path: path.join(SHOTS, `${name}-${lang}-${theme}-${width}.png`), fullPage: true });
        }
      }
    });
  }

  test("cleanup: the campaign is completed and archived so it never counts against a ceiling", async ({ page }) => {
    test.skip(!campaignId, "no campaign"); await page.addInitScript(prefs, ["en", "light"]); await signIn(page, `/growth/campaigns/${campaignId}`);
    for (const to of ["COMPLETED", "ARCHIVED"]) expect((await api(page, "post", `/admin/growth/campaigns/${campaignId}/transition`, { to })).status).toBe(200);
  });
});
