import { expect, test, type Page, type Route } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-GC-4 XSS sweep: every live Growth page of the ops console (the routes of components/growth/sections.ts, plus the experiments views) is loaded in English and Arabic while EVERY text value of
 * every Growth API answer is poisoned with markup, script and event-handler payloads (enums and ids excepted so routing keeps working). A page passes when no payload executed
 * (window.__xss stays undefined), no injected element exists in the DOM, no dialog opened and no uncaught page error came from the payloads. React escapes text by default; this proves nothing
 * on these pages opts out of it (dangerouslySetInnerHTML is also banned by the SAST grep in CI).
 * Sign-in: the cached real Passport session, or PW_SESSION_JSON (a ready OIDC user JSON for the run) for a lane running its own Vite on another port.
 */
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";
const PAYLOADS = ['"><img src=x onerror="window.__xss=1">', "<script>window.__xss=2</script>", "<svg onload=window.__xss=3>", "javascript:window.__xss=4", "'-window.__xss=5-'", "مرحبا<img src=x onerror=window.__xss=6>"];
const ROUTES = ["/growth", "/growth/campaigns", "/growth/campaigns/new", "/growth/approvals", "/growth/channels", "/growth/providers", "/growth/patients", "/growth/referrals", "/growth/rewards", "/growth/promotions", "/growth/seo", "/growth/landing-pages", "/growth/widgets", "/growth/whatsapp", "/growth/assistant", "/growth/lifecycle", "/growth/templates", "/growth/experiments", "/growth/experiments?new=1", "/growth/attribution", "/growth/attribution-models", "/growth/fraud", "/growth/analytics", "/growth/finance", "/growth/markets", "/growth/integrations", "/growth/audit", "/growth/config"];
const keepRaw = (s: string) => /^[A-Z0-9_:.-]+$/.test(s) || /^c[a-z0-9]{20,}$/.test(s) || /^(rwl|kx|gtp|src)_/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /^[a-z0-9-]{1,3}$/.test(s) || s.length > 400 || /^(https?:|\/)/.test(s);
let n = 0;
const poison = (v: unknown): unknown => Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === "string" && !/(^|_)(id|key|status|kind|type|role|code|market|currency|locale|sub)$/i.test(k) && !keepRaw(x) ? `${x} ${PAYLOADS[n++ % PAYLOADS.length]}` : poison(x)])) : v;
const session = async (page: Page, to: string) => {
  const injected = process.env.PW_SESSION_JSON;
  if (injected) { await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, injected]); await page.goto(to); return; }
  await signIn(page, to);
};

test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 });
test.describe("growth XSS sweep (real stack, poisoned responses)", () => {
  test.setTimeout(300_000);
  for (const lang of ["en", "ar"]) {
    test(`every live growth page in ${lang}: no injected payload executes or lands in the DOM`, async ({ page }) => {
      const dialogs: string[] = []; const errors: string[] = [];
      page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); }); page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((l) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", "light"); } catch { /* storage unavailable */ } }, lang);
      await page.route(/\/api\/v1\/(admin|ops)\/(growth|widget)[^?]*(\?.*)?$/, async (route: Route) => {
        if (route.request().method() !== "GET") return route.continue();
        const res = await route.fetch(); const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return route.fulfill({ response: res });
        try { await route.fulfill({ response: res, json: poison(await res.json()) }); } catch { await route.fulfill({ response: res }); }
      });
      await session(page, "/growth");
      let showsPayload = 0; // proof the poison reached the DOM as TEXT on pages that have data
      for (const r of ROUTES) {
        await page.goto(r); await page.getByRole("main").waitFor(); await page.waitForTimeout(900);
        const hit = await page.evaluate(() => ({ xss: (window as unknown as { __xss?: number }).__xss, img: document.querySelectorAll('img[src="x"]').length, svg: document.querySelectorAll("svg[onload]").length, inl: [...document.querySelectorAll("[onerror],[onload],[onclick]")].length, inj: [...document.querySelectorAll("main script")].length }));
        expect(hit, `${lang} ${r}`).toEqual({ xss: undefined, img: 0, svg: 0, inl: 0, inj: 0 });
        if (/__xss/.test(await page.locator("main").innerText())) showsPayload++;
      }
      expect(showsPayload, "the poisoned text must be visible as text on several pages, otherwise the sweep proves nothing").toBeGreaterThanOrEqual(3);
      expect(dialogs, "no alert or prompt opened").toEqual([]);
      expect(errors.filter((e) => /__xss|alert|payload/i.test(e)), "no error caused by a payload").toEqual([]);
    });
  }
});
