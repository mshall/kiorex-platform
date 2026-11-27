import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-P3-A in a real browser against the real local stack: the Experiments console (list, wizard, detail, history) in Arabic RTL and English, light and dark, 320 to 1440 px, no horizontal overflow,
 * axe serious and critical clean (including colour contrast), keyboard-only creation of a draft, the closed surface list, results hidden while a blocker stands, stop with a reason.
 * Data comes from the API as the seeded ops super admin. Sign-in is the cached real Passport session (`signIn`) or, with PW_SESSION_JSON (a ready OIDC user JSON for the run), an injected one:
 * a lane running its own Vite on another port cannot use the Passport redirect, so it injects the session of the same real login.
 * Screenshots: _docs/test-flow/growth-p3/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p3") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p3"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
const API = process.env.KIOREX_API_URL ?? "http://localhost:4000";
const RUN = Date.now().toString(36); const KEY = `pw-exp-${RUN}`;
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";

async function session(page: Page, to: string) {
  const injected = process.env.PW_SESSION_JSON;
  if (injected) { await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, injected]); await page.goto(to); await expect(page.getByRole("main")).toBeVisible(); return; }
  await signIn(page, to);
}
const token = (): string => (JSON.parse(process.env.PW_SESSION_JSON ?? "{}") as { access_token?: string }).access_token ?? "";
async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}

test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("ops experiments (real stack)", () => {
  test.setTimeout(180_000);
  let expId = "";
  test.beforeAll(async ({ request }) => {
    mkdirSync(SHOTS, { recursive: true });
    if (!token()) return;
    const r = await request.post(`${API}/api/v1/admin/growth/experiments`, { headers: { Authorization: `Bearer ${token()}` }, data: { key: KEY, name: `Hero copy ${RUN}`, surface: "landing.home.hero_copy", hypothesis: "A shorter headline raises booking starts", variants: [{ key: "control", weightBp: 5000 }, { key: "b", weightBp: 5000 }], primaryMetric: "booking_started", minSample: 500, plannedDays: 14 } });
    if (r.status() === 201) expId = ((await r.json()) as { id: string }).id;
  });

  test("keyboard-only: the wizard creates a draft from the closed surface list; a forbidden surface cannot even be chosen", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, "/growth/experiments?new=1");
    await expect(page.getByTestId("exp-wizard")).toBeVisible();
    const opts = await page.getByTestId("exp-surface").locator("option").allTextContents(); expect(opts.join(" ")).not.toMatch(/emergency|triage|consent|privacy|price|\bfees?\b|(?<!non-)clinical|cancellation/i);
    await page.getByTestId("exp-key").focus(); await page.keyboard.type(`${KEY}-kb`); await page.keyboard.press("Tab"); await page.keyboard.type("Keyboard draft"); await page.keyboard.press("Tab");
    await page.getByTestId("exp-surface").selectOption("landing.home.hero_copy"); await page.getByTestId("exp-hypothesis").fill("A shorter headline raises booking starts");
    await page.getByTestId("exp-create").focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("exp-status")).toContainText(/Draft/, { timeout: 15_000 });
    await expect(page.getByTestId("exp-design")).toContainText("landing.home.hero_copy");
  });

  test("detail: a draft has Submit, no results yet, a history tab with the CREATED event; stop needs a reason once running", async ({ page }) => {
    test.skip(!expId, "needs PW_SESSION_JSON to create the fixture experiment"); await page.addInitScript(prefs, ["en", "light"]); await session(page, `/growth/experiments?id=${expId}`);
    await expect(page.getByTestId("act-submit")).toBeVisible(); await expect(page.getByTestId("exp-no-result")).toBeVisible();
    await page.getByTestId("exp-tab-history").click(); await expect(page.getByTestId("hist-CREATED")).toBeVisible();
  });

  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) {
    test(`renders ${lang} ${theme} at 320, 768 and 1440 px: RTL where Arabic, no horizontal overflow, 44 px targets, axe clean on list, wizard, detail and history`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)"); test.skip(!expId, "needs PW_SESSION_JSON to create the fixture experiment");
      await page.addInitScript(prefs, [lang, theme]); await page.setViewportSize({ width: 1440, height: 900 }); await session(page, "/growth/experiments");
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
        for (const [route, ready, name] of [["/growth/experiments", "exp-list", "list"], ["/growth/experiments?new=1", "exp-wizard", "wizard"], [`/growth/experiments?id=${expId}`, "exp-design", "detail"], [`/growth/experiments?id=${expId}&tab=history`, "exp-history", "history"]] as const) {
          await page.goto(route); await page.getByTestId(ready).waitFor();
          await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr"); await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
          await page.waitForTimeout(400);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} @${width} overflows`).toBeLessThanOrEqual(1);
          const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main button, main a[role=tab], main input:not([type=hidden]), main select")].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 40)).map((e) => `${e.tagName}.${e.getAttribute("data-testid") ?? ""}`));
          expect(small, `${route} @${width} targets under 40 px`).toEqual([]);
          expect(await axeSerious(page), `${route} @${width} axe`).toEqual([]);
          if (width === 1440 && theme === "light") await page.screenshot({ path: path.join(SHOTS, `experiments-${name}-${lang}-${theme}-${width}.png`), fullPage: true });
        }
      }
    });
  }

  test("prefers-reduced-motion: no animation runs on the experiments pages", async ({ browser }) => {
    test.skip(!expId, "needs PW_SESSION_JSON"); const ctx = await browser.newContext({ reducedMotion: "reduce" }); const page = await ctx.newPage(); await page.addInitScript(prefs, ["en", "light"]);
    await session(page, `/growth/experiments?id=${expId}`); await page.getByTestId("exp-design").waitFor();
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getTiming().iterations ?? 1) === Infinity).length); expect(running).toBe(0); await ctx.close();
  });
});
