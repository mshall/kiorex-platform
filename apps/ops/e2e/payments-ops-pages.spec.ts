import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * PAY-READY: the ops payments pages and the corporate pages in a real browser against a PRIVATE API and database (e2e/scripts/pay-stack.sh), the dev Passport session injected as PW_SESSION_JSON.
 * For each page, in Arabic RTL and English, at 320, 768, 1440 and 2560 px: the main landmark renders, no horizontal overflow, axe serious and critical violations are zero (contrast included),
 * no uncaught page error. The connection page must never show a secret VALUE (only references), and the corporate pages stay readable at 2560 px.
 */
const SHOTS = path.resolve(process.cwd(), "../../../_docs/test-flow/pay-ready");
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const OIDC_KEY = `oidc.user:${process.env.PW_OIDC_AUTHORITY ?? "http://localhost:4400"}:kiorex-ops`; // PW_OIDC_AUTHORITY: the private Passport of the stack under test
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const PAGES = [{ key: "payments-connection", path: "/payments-connection" }, { key: "reconciliation", path: "/reconciliation" }, { key: "corporate", path: "/growth/corporate" }] as const;
const VIEWPORTS = [{ w: 320, h: 800 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }, { w: 2560, h: 1300 }] as const;
test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });

async function open(page: Page, to: string, lang: string) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, process.env.PW_SESSION_JSON!]);
  await page.addInitScript(prefs, [lang, "light"]);
  await page.goto(to); await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
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
test.beforeAll(() => { expect(process.env.PW_SESSION_JSON, "PW_SESSION_JSON (real Passport session) is required").toBeTruthy(); expect(AXE, "axe-core must be installed").toBeTruthy(); mkdirSync(SHOTS, { recursive: true }); });

for (const pg of PAGES) for (const lang of ["ar", "en"]) for (const vp of VIEWPORTS) {
  test(`${pg.key} ${lang} ${vp.w}px renders, no overflow, axe serious/critical clean`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await open(page, pg.path, lang);
    expect(await page.evaluate(() => document.documentElement.getAttribute("dir"))).toBe(lang === "ar" ? "rtl" : "ltr");
    const wide = await page.evaluate(() => { const w = document.documentElement.clientWidth; return document.documentElement.scrollWidth <= w + 1 ? [] : [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} right=${Math.round(e.getBoundingClientRect().right)}`); });
    expect(wide, `no horizontal overflow (elements wider than the viewport)`).toEqual([]);
    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, `${pg.key}-${lang}-${vp.w}.png`), fullPage: false });
  });
}

test("the connection page shows references, never a secret value, and the live probe is off in mock mode", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page, "/payments-connection", "en");
  await expect(page.getByTestId("pc-mode")).toBeVisible();
  const text = await page.getByRole("main").innerText();
  expect(text).toContain("/kiorex/"); expect(text).not.toMatch(/sk_(test|live)_|whsec_|egy_sk/);
  await expect(page.getByTestId("live-probe")).toBeDisabled();
});
