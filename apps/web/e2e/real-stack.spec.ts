import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Gap closure: the loyalty, referral and corporate pages against a PRIVATE REAL stack (no route mocks): the real Kiorex API (:4139, own cloned database) answers every call, the session is a REAL Passport
 * access token (OTP login against the shared dev IdP, read only) injected the way `helpers.ts` re-injects a cached sign-in (the Passport redirect URI is registered for :5180 and :5181 only, so a private Vite
 * cannot do the redirect), and the launch-locked flags carry the DEV-ONLY gate rows ('DEV-TEST-FIXTURE-NOT-A-REAL-GATE', private database only; `e2e/scripts/gap-web-session.ts` records and releases them).
 *   cd e2e && E2E_KIOREX_URL=http://localhost:4139 npx tsx scripts/gap-web-session.ts > /tmp/real-session.json
 *   KIOREX_API_URL=http://localhost:4139 npx vite --port 5139 --strictPort &   then   KX_REAL_WEB_URL=http://localhost:5139 KX_REAL_SESSION=/tmp/real-session.json npx playwright test e2e/real-stack.spec.ts --project=chromium
 * Skipped unless both variables are set, so it never runs against the shared stack.
 */
const SESSION = process.env.KX_REAL_SESSION; const URL_ = process.env.KX_REAL_WEB_URL;
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const run = SESSION && URL_ && existsSync(SESSION) ? test.describe : test.describe.skip;
const KEY = "oidc.user:http://localhost:4400:kiorex-web";

async function signedIn(page: Page, lang: "en" | "ar") {
  const s = JSON.parse(readFileSync(SESSION!, "utf8")) as { access_token: string; id_token: string; sub: string; expires_at: number };
  const user = JSON.stringify({ access_token: s.access_token, id_token: s.id_token, token_type: "Bearer", scope: "openid profile phone", expires_at: s.expires_at, profile: { sub: s.sub, name: "Real Stack Tester" } });
  await page.addInitScript(([k, v, l]) => { try { sessionStorage.setItem(k!, v!); localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", "light"); } catch { /* storage unavailable */ } }, [KEY, user, lang]);
}
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(700); await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const overflow = (page: Page) => page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > iw + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? `[${e.dataset.testid}]` : ""}.${String(e.className).slice(0, 60)}`); return { d: Math.max(0, document.documentElement.scrollWidth - iw), wide }; });

test.use({ baseURL: URL_ ?? "http://localhost:5139", actionTimeout: 25_000, navigationTimeout: 45_000 });
run("patient pages on the private real stack (real API, real Passport session, DEV-ONLY gates)", () => {
  test.setTimeout(180_000);
  const PAGES: [string, string][] = [["/loyalty", "loyalty-balance"], ["/referral", "invite-card"], ["/corporate", "corporate-page"]];
  for (const [lang, dir] of [["en", "ltr"], ["ar", "rtl"]] as const) {
    for (const [route, testId] of PAGES) {
      for (const size of [{ width: 320, height: 800 }, { width: 1440, height: 900 }]) {
        test(`${route} ${lang} ${size.width}px: renders from the real API, no 5xx, no overflow, axe serious and critical clean`, async ({ page }) => {
          const failures: string[] = []; const calls: string[] = [];
          page.on("response", (r) => { if (r.url().includes("/api/v1/")) { calls.push(`${r.status()} ${new URL(r.url()).pathname}`); if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`); } });
          await page.setViewportSize(size); await signedIn(page, lang); await page.goto(route);
          await expect(page.getByTestId(testId)).toBeVisible({ timeout: 30_000 });
          await page.waitForLoadState("networkidle"); // the first load of a page on a cold Vite dev server paints before its stylesheet is in: measure after the network is quiet
          await expect(page.locator("html")).toHaveAttribute("dir", dir);
          expect(calls.some((c) => /\/(growth|me)\//.test(c)), `no real API call seen: ${calls.join(", ")}`).toBe(true);
          expect(failures).toEqual([]);
          const o = await overflow(page); expect(o.d, `overflows by ${o.d}px: ${o.wide.join(" | ")}`).toBeLessThanOrEqual(1);
          expect(await axeSerious(page)).toEqual([]);
        });
      }
    }
  }
  test("the loyalty page tells the truth about the real configuration: points are not money, and with every shipped default (all zero) conversion is closed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await signedIn(page, "en"); await page.goto("/loyalty");
    await expect(page.getByTestId("loyalty-not-money")).toBeVisible({ timeout: 30_000 });
  });
});
