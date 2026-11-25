import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Integrations Control Center in a real browser, on a private API and database (e2e/scripts/cfg-stack.sh), the dev Passport session injected as PW_SESSION_JSON.
 * In Arabic RTL and English, at 320 and 1440 px: the main landmark and every integration card render, no horizontal overflow, axe serious and critical violations are zero (contrast included),
 * no uncaught page error, controls inside main are at least 44 px tall, and no secret-looking value is on the page. Then a real flow: check, and a mode proposal that waits for a second person.
 */
const SHOTS = process.env.SHOTS_DIR ?? path.resolve(process.cwd(), "../../../_docs/test-flow/integrations-center");
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].find((p) => p && existsSync(p));
const OIDC_KEY = `oidc.user:${process.env.PW_OIDC_AUTHORITY ?? "http://localhost:4400"}:kiorex-ops`; // PW_OIDC_AUTHORITY: the private Passport of the stack under test
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const VIEWPORTS = [{ w: 320, h: 800 }, { w: 640, h: 450 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 }] as const;
const KEYS = ["PAYMOB", "FAWRY", "INSTAPAY", "SMS", "EMAIL", "WHATSAPP_CLOUD", "PUSH_FCM", "PUSH_APNS", "PUSH_EXPO", "GOOGLE_ADS", "GA4", "SEARCH_CONSOLE", "META_ADS", "TIKTOK", "PLAY_CONSOLE", "APP_STORE_CONNECT", "CRUX", "LLM_ASSISTANT", "LLM_RECOMMENDATIONS", "LLM_AI_GATEWAY", "TURN_VIDEO", "PASSPORT_IDP", "MAPS_GEOCODING", "OBJECT_STORAGE", "ERROR_MONITORING"];

test.use({ actionTimeout: 25_000, navigationTimeout: 45_000 });

async function open(page: Page, lang: string) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, process.env.PW_SESSION_JSON!]);
  await page.addInitScript(prefs, [lang, "light"]);
  await page.goto("/integrations"); await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("ic-card-SMS")).toBeVisible(); await page.waitForLoadState("networkidle").catch(() => undefined);
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

for (const lang of ["en", "ar"] as const) for (const vp of VIEWPORTS) {
  test(`${lang} ${vp.w}px: every integration card, no overflow, axe clean, 44px targets, no secrets`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: vp.w, height: vp.h }); await open(page, lang);
    expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
    for (const k of KEYS) await expect(page.getByTestId(`ic-card-${k}`)).toBeAttached();
    for (const g of ["payments", "messaging", "push", "marketing", "ai", "platform"]) await expect(page.getByTestId(`ic-group-${g}`)).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(await axeSerious(page)).toEqual([]);
    const small = await page.evaluate(() => [...document.querySelectorAll("main button, main summary, main select, main input, main textarea, main a")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const inline = e.tagName === "A" && !!e.closest("p, li"); return r.width > 0 && !inline && r.height < 43.5; }).map((e) => `${e.tagName} ${(e.textContent ?? "").slice(0, 30)}`));
    expect(small).toEqual([]);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/sk_(live|test)_|-----BEGIN|AKIA[0-9A-Z]{12}|eyJ[A-Za-z0-9_-]{10,}\./);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, `integrations-${lang}-${vp.w}.png`), fullPage: true });
  });
}

test("a super admin runs a check and proposes a mode change that then waits for a second person", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page, "en");
  await expect(page.getByTestId("ic-readonly")).toHaveCount(0);
  await page.getByTestId("ic-check-EMAIL").click();
  await expect(page.getByTestId("ic-lastcheck-EMAIL")).toContainText(/OK/i);
  await page.getByTestId("ic-propose-WHATSAPP_CLOUD").click();
  await page.getByLabel(/reason/i).fill("Pilot clinics go live on 1 December");
  await page.getByTestId("ic-submit-WHATSAPP_CLOUD").click();
  await expect(page.getByTestId("ic-pending")).toContainText("WHATSAPP_CLOUD");
  await page.screenshot({ path: path.join(SHOTS, "integrations-en-1440-pending.png"), fullPage: true });
});
