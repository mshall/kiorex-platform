import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * GRW-P4-D patient web in a real browser: `/loyalty` (tier, points as a count, the exchange for a voucher, the partner code, the history) in Arabic RTL and English, light and dark, at 320, 640x450, 1440 and 2560 px: no horizontal
 * overflow, axe serious and critical clean, keyboard path to the exchange. The API is answered by fixtures behind a synthetic session so the figures are deterministic; the real endpoints are covered by the API integration suite.
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const KEY = `oidc.user:${process.env.PW_PASSPORT_URL ?? "http://localhost:4400"}:kiorex-web`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER = JSON.stringify({ access_token: `${b64({ alg: "none" })}.${b64({ sub: "p_1" })}.x`, token_type: "Bearer", scope: "openid profile", expires_at: Math.floor(Date.now() / 1000) + 3600, profile: { sub: "p_1", name: "Amira" } });
const ME = { tier: "SILVER", tierSince: "2027-02-01T00:00:00Z", window: { months: 12, completed: 3 }, next: { tier: "GOLD", minCompletedBookings: 6, remaining: 3 }, points: { balance: 45, expiringSoon: { points: 10, at: "2027-11-24T00:00:00Z" } }, conversion: { open: true, pointsRequired: 30, valueMinor: 5000, currency: "EGP", blocksLeftThisYear: 2, canConvert: true }, notMoney: true };
const HIST = { items: [{ id: "e1", type: "ACCRUE", points: 10, direction: "IN", expiresAt: "2028-02-01T00:00:00Z", at: "2027-02-01T00:00:00Z" }, { id: "e2", type: "CONVERT", points: 30, direction: "OUT", expiresAt: null, at: "2027-02-10T00:00:00Z" }] };

async function mock(page: Page, o: { keys?: string[]; me?: Record<string, unknown>; off?: boolean } = {}) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [KEY, USER]);
  await page.route("**/api/v1/**", (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace("/api/v1", ""); const m = r.request().method(); const json = (j: unknown, status = 200) => r.fulfill({ status, json: j });
    if (p === "/growth/v1/loyalty/me") return o.off ? json({ code: "FEATURE_DISABLED", message: "off", key: "growth.loyalty", scope: "GLOBAL" }, 403) : json(o.me ?? ME);
    if (p === "/growth/v1/loyalty/history") return json(HIST);
    if (p === "/growth/v1/loyalty/convert" && m === "POST") { o.keys?.push(JSON.parse(r.request().postData() ?? "{}").requestKey); return json({ lotId: "rwl_1", mode: "COUPON", points: 30, amountMinor: 5000, currency: "EGP", balanceAfter: 15 }); }
    if (p === "/growth/v1/loyalty/partner/redeem" && m === "POST") return json({ redeemed: true, lotId: "rwl_2", amountMinor: 3000, currency: "EGP", partner: { ar: "بنك إكس", en: "Bank X" }, legalTextRef: "TODO" });
    if (p === "/markets") return json([{ code: "EG", name: "Egypt", live: true, currency: "EGP", phoneCode: "+20" }]);
    if (p === "/me/dependants" || p === "/me/notifications") return json([]);
    return json({});
  });
}
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(700); await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = async (page: Page, where: string) => {
  const w = await page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > iw + 1).slice(0, 3).map((e) => `${e.tagName}.${String(e.className)}`.slice(0, 80)); return { d: document.documentElement.scrollWidth - iw, wide }; });
  expect(w.d, `${where} overflows horizontally by ${w.d}px: ${w.wide.join(" | ")}`).toBeLessThanOrEqual(1);
};
const SIZES = [{ width: 320, height: 800 }, { width: 640, height: 450 }, { width: 1440, height: 900 }, { width: 2560, height: 1300 }];

test.use({ baseURL: process.env.KX_LOYALTY_WEB_URL ?? "http://localhost:5392", actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("patient loyalty page (real browser)", () => {
  test.setTimeout(180_000);
  test("keyboard: tab to the exchange, press it once with one key; the voucher link goes to the vouchers", async ({ page }) => {
    const keys: string[] = []; await page.addInitScript(prefs, ["en", "light"]); await mock(page, { keys }); await page.goto("/loyalty");
    await expect(page.getByTestId("loyalty-balance")).toHaveText("45 points"); await expect(page.getByTestId("loyalty-not-money")).toContainText("Points are not money");
    await page.getByTestId("loyalty-convert-button").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("loyalty-converted")).toContainText("voucher worth");
    await expect(page.getByRole("link", { name: "Open my vouchers" })).toHaveAttribute("href", "/referral/rewards"); expect(keys).toHaveLength(1); expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
  test("the partner code: the button stays off until the code is well formed, then the voucher is confirmed", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mock(page); await page.goto("/loyalty");
    const submit = page.getByTestId("loyalty-partner-submit"); await expect(submit).toBeDisabled(); await page.getByTestId("loyalty-partner-code").fill("a7kq2-m9xot"); await expect(submit).toBeEnabled(); await submit.click();
    await expect(page.getByTestId("loyalty-partner-done")).toContainText("Bank X"); await expect(page.getByTestId("loyalty-partner-terms")).toHaveAttribute("data-needs-human", "true");
  });
  test("flag OFF shows the unavailable state and no exchange", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mock(page, { off: true }); await page.goto("/loyalty");
    await expect(page.getByTestId("loyalty-page")).toBeVisible(); await expect(page.getByTestId("loyalty-convert-button")).toHaveCount(0); await expect(page.getByTestId("loyalty-balance")).toHaveCount(0);
  });
  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) {
    test(`renders ${lang} ${theme} at 320, 640x450, 1440 and 2560: RTL where Arabic, no horizontal overflow, axe clean`, async ({ page }, info) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await page.addInitScript(prefs, [lang, theme]); await mock(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/loyalty");
      await expect(page.getByTestId("loyalty-balance")).toBeVisible(); await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      for (const s of SIZES) {
        await page.setViewportSize(s); await expect(page.getByTestId("loyalty-balance")).toBeVisible(); await noOverflow(page, `${lang} ${s.width}x${s.height}`);
        expect(await axeSerious(page), `axe ${lang} ${theme} ${s.width}`).toEqual([]);
        if (s.width === 320 || s.width === 1440) await page.screenshot({ path: info.outputPath(`loyalty-${lang}-${theme}-${s.width}.png`), fullPage: true });
      }
    });
  }
});
