import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * GRW-P3-E in a real browser against the real local stack (a private API instance on KIOREX_API_URL, a private database, the dev Passport session injected as PW_SESSION_JSON): the Automation console
 * (list, builder, dry run) and the Recommendations inbox in Arabic RTL and English, light and dark, 320 to 1440 px, no horizontal overflow, axe serious and critical clean (including contrast),
 * 44 px touch targets, reduced motion, keyboard-only building of a journey, the builder read-only at 320 px and editable at 1440 px, the closed vocabulary (no clinical option exists),
 * the server's validation in words, the inserted gate marker, approval creating a DRAFT only. Screenshots: _docs/test-flow/growth-p3/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p3") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p3"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
// This spec WRITES fixtures (campaigns, spend rows, dev gate rows) through the API and the database it is pointed at: there is no default, so it can never touch the shared stack by accident.
const API = process.env.KIOREX_API_URL ?? "";
const DB = process.env.PW_DB ?? "";
test.skip(!API || !DB, "growth-automation.spec.ts writes fixtures: set KIOREX_API_URL (a PRIVATE Kiorex API) and PW_DB (its database); there is no default");
const RUN = Date.now().toString(36); const KEY = `pw-auto-${RUN}`;
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const OIDC_KEY = `oidc.user:${process.env.PW_OIDC_AUTHORITY ?? "http://localhost:4400"}:kiorex-ops`; // PW_OIDC_AUTHORITY: the private Passport of the stack under test
const psql = (sql: string) => execFileSync(process.env.PSQL ?? "/Users/postgres/bin/psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", DB, "-t", "-A", "-c", sql], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString();
const token = (): string => (JSON.parse(process.env.PW_SESSION_JSON ?? "{}") as { access_token?: string }).access_token ?? "";

async function session(page: Page, to: string) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, process.env.PW_SESSION_JSON!]);
  await page.goto(to); await expect(page.getByRole("main")).toBeVisible();
}
async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const smallTargets = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main button, main a, main select, main input:not([type=checkbox]):not([type=radio])")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && !e.closest("[aria-hidden=true]") && getComputedStyle(e).visibility !== "hidden"; }).map((e) => `${e.tagName}.${(e.getAttribute("data-testid") ?? e.textContent ?? "").slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`));
const VIEWPORTS = [{ w: 320, h: 800 }, { w: 640, h: 450 }, { w: 768, h: 900 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 }] as const;
const GRAPH = { schema: 1, nodes: [{ id: "start", type: "TRIGGER", event: "STAGE_DORMANT" }, { id: "n1", type: "SEND", template: "REENGAGE_DORMANT", channels: ["PUSH"] }, { id: "n2", type: "WAIT", minutes: 10080 }, { id: "n3", type: "SEND", template: "REENGAGE_DORMANT" }, { id: "end", type: "END" }], edges: [{ from: "start", to: "n1" }, { from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "end" }] };

test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("ops automation and recommendations (real stack)", () => {
  test.setTimeout(240_000);
  let journeyId = ""; let recId = "";
  test.beforeAll(async ({ request }) => {
    mkdirSync(SHOTS, { recursive: true });
    test.skip(!process.env.PW_SESSION_JSON, "needs PW_SESSION_JSON");
    const h = { Authorization: `Bearer ${token()}` };
    const r = await request.post(`${API}/api/v1/admin/growth/automation/journeys`, { headers: h, data: { key: KEY, name: `Win-back ${RUN}`, graph: GRAPH } });
    if (r.status() === 201) journeyId = ((await r.json()) as { id: string }).id;
    // recommendations: DEV test fixture gate evidence (never a real gate) and two seeded campaigns inside the window
    psql(`insert into "FlagGateEvidence" ("flagKey","gateId",approver,"approvedOn","documentUrl","recordedBy") values ('growth.ai_recommendations','DEV-TEST-FIXTURE-NOT-A-REAL-GATE','test fixture',now(),'https://dev.invalid/fixture','TEST_FIXTURE') on conflict do nothing`);
    await request.put(`${API}/api/v1/admin/flags/growth.ai_recommendations/values`, { headers: h, data: { scope: "GLOBAL", value: "ON", reason: "pw", ticket: "PW-1" } });
    const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    for (const [k, ch, spend, att] of [["ref", "REFERRAL", 100000, 50], ["search", "PAID_SEARCH", 800000, 40]] as const) {
      const id = `pwauto${RUN}${k}`;
      psql(`insert into "GrowthCampaign" (id, market, key, "utmCampaign", name, objective, status, "budgetTotalMinor", "budgetDailyMinor", channels, "policyVersionId", "ownerSub", "activatedAt", "updatedAt") values ('${id}','EG','pw-${k}-${RUN}','eg-pw-${k}-${RUN}','pw','ACQUISITION','ACTIVE',5000000,500000,'{${ch}}','pw','pw',now() - interval '20 days', now()) on conflict do nothing`);
      psql(`insert into "GrowthSpendEntry" (id, market, day, campaign, "campaignId", channel, "amountMinor", status, "createdBy", source) values ('pws${RUN}${k}','EG','${day}','eg-pw-${k}-${RUN}','${id}','${ch}',${spend},'APPROVED','pw','MANUAL') on conflict do nothing`);
      psql(`insert into "GrowthMetricDaily" (id, market, day, metric, "sourceKind", campaign, "campaignId", value, "updatedAt") values ('pwm${RUN}${k}','EG','${day}','AttendedNewPatient','CAMPAIGN','eg-pw-${k}-${RUN}','${id}',${att}, now()) on conflict do nothing`);
    }
    const run = await request.post(`${API}/api/v1/admin/growth/recommendations/run`, { headers: h, data: {} });
    if (run.status() === 200) { const list = await (await request.get(`${API}/api/v1/admin/growth/recommendations?kind=REALLOCATE_BUDGET&status=PROPOSED`, { headers: h })).json() as Array<{ id: string }>; recId = list[0]?.id ?? ""; }
  });
  test.afterAll(async () => { try { psql(`delete from "GrowthMetricDaily" where id like 'pwm${RUN}%'; delete from "GrowthSpendEntry" where id like 'pws${RUN}%'; delete from "GrowthCampaign" where id like 'pwauto${RUN}%' or key like 'rec-%'; delete from "FlagGateEvidence" where "flagKey" = 'growth.ai_recommendations' and "gateId" = 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE';`); } catch { /* best effort */ } });

  test("builder: read-only at 320 px (flow and checks, no form), editable at 1440 px, the closed vocabulary, the inserted gate marker, keyboard-only draft", async ({ page }) => {
    test.skip(!journeyId, "needs the fixture journey");
    await page.addInitScript(prefs, ["en", "light"]);
    await page.setViewportSize({ width: 320, height: 800 }); await session(page, `/growth/automation?id=${journeyId}`);
    await expect(page.getByTestId("auto-narrow")).toBeVisible(); await expect(page.getByTestId("auto-form")).toBeHidden(); await expect(page.getByTestId("flow")).toBeVisible(); await expect(page.getByTestId("flow-gate").first()).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 }); await expect(page.getByTestId("auto-form")).toBeVisible(); await expect(page.getByTestId("auto-narrow")).toBeHidden();
    const opts = await page.getByTestId("auto-send-template-0").locator("option").allTextContents(); expect(opts.join(" ")).not.toMatch(/reward|new device|security|deposit|confirmed|specialt|doctor|diagnos/i);
    await expect(page.getByTestId("auto-gate-note-0")).toContainText(/cannot be removed/i);
    await page.screenshot({ path: path.join(SHOTS, "automation-builder-en-1440.png"), fullPage: true });
    // keyboard only: a new journey with a wait below the minimum shows the server's words, then is fixed and saved
    await page.goto("/growth/automation?new=1"); await expect(page.getByTestId("auto-form")).toBeVisible();
    await page.getByTestId("auto-key").focus(); await page.keyboard.type(`${KEY}-kb`); await page.keyboard.press("Tab"); await page.keyboard.type("Keyboard journey");
    await page.getByTestId("auto-add-wait").focus(); await page.keyboard.press("Enter");
    await page.getByTestId("auto-wait-unit-1").selectOption("minutes"); await page.getByTestId("auto-wait-value-1").fill("5");
    await page.getByTestId("auto-add-send").focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("auto-error-WAIT_RANGE")).toContainText("between 15 minutes and 90 days", { timeout: 10_000 }); await expect(page.getByTestId("auto-save")).toBeDisabled();
    await page.getByTestId("auto-wait-value-1").fill("2"); await page.getByTestId("auto-wait-unit-1").selectOption("days");
    await expect(page.getByTestId("auto-check-state")).toContainText("passes every check", { timeout: 10_000 });
    await page.getByTestId("auto-save").focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Keyboard journey" })).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId("flow")).toContainText("2 days");
  });

  for (const [lang, theme] of [["en", "light"], ["ar", "dark"]] as const) for (const vp of VIEWPORTS) {
    test(`list and dry run: ${lang} ${theme} ${vp.w}px, axe, targets, no overflow`, async ({ page }) => {
      await page.addInitScript(prefs, [lang, theme]); await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: vp.w, height: vp.h });
      await session(page, "/growth/automation"); await expect(page.getByTestId("auto-journeys")).toBeVisible(); await expect(page.getByTestId("auto-banner-licence")).toBeVisible();
      if (lang === "ar") expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
      expect(await noOverflow(page)).toBe(true); expect(await axeSerious(page)).toEqual([]); expect(await smallTargets(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `automation-list-${lang}-${theme}-${vp.w}.png`), fullPage: true });
      test.skip(!journeyId, "needs the fixture journey");
      await page.goto(`/growth/automation?id=${journeyId}&view=dryrun`); await expect(page.getByTestId("dry-run")).toBeVisible(); await page.getByTestId("dry-run").click();
      await expect(page.getByTestId("dry-step-1")).toBeVisible(); await expect(page.getByTestId("dry-steps")).toBeVisible(); await expect(page.getByTestId("dry-flag-off")).toBeVisible();
      expect(await noOverflow(page)).toBe(true); expect(await axeSerious(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `automation-dryrun-${lang}-${theme}-${vp.w}.png`), fullPage: true });
    });
    test(`recommendations: ${lang} ${theme} ${vp.w}px, axe, targets, no overflow`, async ({ page }) => {
      test.skip(!recId, "needs a proposed recommendation");
      await page.addInitScript(prefs, [lang, theme]); await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: vp.w, height: vp.h });
      await session(page, "/growth/recommendations"); await expect(page.getByTestId("rec-list")).toBeVisible(); await expect(page.getByTestId("rec-banner")).toBeVisible();
      await expect(page.getByTestId(`rec-ai-${recId}`)).toBeVisible();
      expect(await noOverflow(page)).toBe(true); expect(await axeSerious(page)).toEqual([]); expect(await smallTargets(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `recommendations-list-${lang}-${theme}-${vp.w}.png`), fullPage: true });
      await page.goto(`/growth/recommendations?id=${recId}`); await expect(page.getByTestId("rec-rationale")).toBeVisible(); await expect(page.getByTestId("rec-numbers")).toBeVisible();
      expect(await noOverflow(page)).toBe(true); expect(await axeSerious(page)).toEqual([]); expect(await smallTargets(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `recommendations-detail-${lang}-${theme}-${vp.w}.png`), fullPage: true });
    });
  }

  test("recommendation: approve with the keyboard creates a DRAFT only and says so; the campaign is not active", async ({ page }) => {
    test.skip(!recId, "needs a proposed recommendation");
    await page.addInitScript(prefs, ["en", "light"]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, `/growth/recommendations?id=${recId}`);
    await expect(page.getByText(/creates a draft only\. Nothing is activated, sent or spent/)).toBeVisible();
    await page.getByTestId("rec-approve").focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("rec-result")).toContainText(/A draft was created: campaign:.*It still needs its own approval/, { timeout: 15_000 });
    const ref = ((await page.getByTestId("rec-result").textContent()) ?? "").match(/campaign:([a-z0-9]+)/)![1]!;
    expect(psql(`select status from "GrowthCampaign" where id = '${ref}'`).trim()).toBe("DRAFT");
    await page.screenshot({ path: path.join(SHOTS, "recommendations-approved-en-1440.png"), fullPage: true });
  });
});
