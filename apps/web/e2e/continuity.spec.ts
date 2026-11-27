import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-P4-A patient web: the continuity cards on the home page. Real browser, real Passport session, the real web app; the continuity answers are served by page.route (the package is launch-locked, so the
 * real API answers `enabled: false` until a human records the gate). 320 to 1440 px, AR and EN, light and dark, keyboard, axe serious and critical clean. Screenshots: _docs/test-flow/growth-p4/.
 * `KX_CONTINUITY_URL` points the run at a private web instance (default: the stack's web on :5180).
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p4") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p4"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots; mkdirSync(SHOTS, { recursive: true });
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(700); // entrance animations blend colours while they run, which axe would read as low contrast
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document.querySelector("[data-testid='continuity-cards']"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const CARDS = { enabled: true, consent: false, cards: [
  { id: "ep_rxabcdefghij", kind: "RX_TO_PHARMACY", toProduct: "PHARMACY", expiresAt: "2027-03-01T00:00:00Z", recordId: "kx_rec_1", path: "/pharmacy" },
  { id: "ep_lababcdefghi", kind: "LAB_ORDER_TO_LAB", toProduct: "LAB", expiresAt: "2027-03-01T00:00:00Z", path: "/lab" },
  { id: "ep_homeabcdefgh", kind: "CARE_PLAN_TO_HOME_VISIT", toProduct: "NURSE", expiresAt: "2027-03-01T00:00:00Z", path: "/care-plans" },
] };
async function mock(page: Page, o: { off?: boolean; seen?: { put?: unknown; dismissed?: string[] } } = {}) {
  const seen = o.seen ?? {};
  await page.route("**/api/v1/growth/v1/continuity/cards", (r) => r.fulfill({ json: o.off ? { enabled: false, consent: false, cards: [] } : CARDS }));
  await page.route("**/api/v1/growth/v1/continuity/consent", async (r) => { seen.put = r.request().postDataJSON(); await r.fulfill({ json: { granted: true, textVersion: null, draftWording: true } }); });
  await page.route("**/api/v1/growth/v1/continuity/cards/*/dismiss", async (r) => { (seen.dismissed ??= []).push(r.request().url().split("/").slice(-2)[0]!); await r.fulfill({ json: { dismissed: true } }); });
}
const noOverflow = async (page: Page, where: string) => {
  const w = await page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > iw + 1).slice(0, 3).map((e) => `${e.tagName}.${e.className}`.slice(0, 80)); return { d: document.documentElement.scrollWidth - iw, wide }; });
  expect(w.d, `${where} overflows horizontally by ${w.d}px: ${w.wide.join(" | ")}`).toBeLessThanOrEqual(1);
};

test.use({ baseURL: process.env.KX_CONTINUITY_URL ?? "http://localhost:5180", actionTimeout: 20_000, navigationTimeout: 40_000 });
test.describe("continuity cards (web, real sign-in)", () => {
  test.setTimeout(180_000);
  test("package OFF or locked: the home page has no continuity section at all", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mock(page, { off: true }); await signIn(page, "/");
    await expect(page.getByTestId("home-title").or(page.locator("#home-title"))).toBeVisible(); await expect(page.getByTestId("continuity-cards")).toHaveCount(0);
  });

  for (const [lang, theme, width] of [["en", "light", 1440], ["ar", "dark", 320], ["ar", "light", 390], ["en", "dark", 1024]] as const) {
    test(`three cards: ${lang} ${theme} ${width}px, no overflow, keyboard reachable, 44 px targets, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 }); await page.addInitScript(prefs, [lang, theme]); await mock(page); await signIn(page, "/");
      const box = page.getByTestId("continuity-cards"); await expect(box).toBeVisible(); await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.getByTestId("continuity-card-rx")).toContainText(lang === "ar" ? "أرسل وصفتك الطبية إلى صيدلية" : "Send your prescription to a pharmacy");
      await noOverflow(page, `continuity ${lang} ${width}`);
      for (const k of ["rx", "lab", "home"]) { const b = await page.getByTestId(`continuity-dismiss-${k}`).boundingBox(); expect(b!.width).toBeGreaterThanOrEqual(44); expect(b!.height).toBeGreaterThanOrEqual(44); const o = await page.getByTestId(`continuity-open-${k}`).boundingBox(); expect(o!.height).toBeGreaterThanOrEqual(44); }
      await page.getByTestId("continuity-open-rx").focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: lang === "ar" ? "ليس الآن" : "Not now" }).first()).toBeFocused();
      expect(await axeSerious(page), "axe on the continuity cards").toEqual([]); await box.scrollIntoViewIfNeeded(); await box.screenshot({ path: path.join(SHOTS, `continuity-${lang}-${theme}-${width}.png`) });
    });
  }

  test("opening the pharmacy card goes to the pharmacy flow with the prescription chosen; the consent is saved only when the switch was turned on; dismiss hides the card", async ({ page }) => {
    const seen: { put?: unknown; dismissed?: string[] } = {}; await page.addInitScript(prefs, ["en", "light"]); await mock(page, { seen }); await signIn(page, "/");
    await page.getByTestId("continuity-card-rx").getByRole("switch").click();
    await page.getByTestId("continuity-open-rx").click(); await expect(page).toHaveURL(/\/pharmacy\?rx=kx_rec_1$/);
    expect(seen.put).toEqual({ granted: true, source: "web" });
    await page.goto("/"); await page.getByTestId("continuity-dismiss-lab").click(); await expect.poll(() => seen.dismissed).toEqual(["ep_lababcdefghi"]);
  });
});
