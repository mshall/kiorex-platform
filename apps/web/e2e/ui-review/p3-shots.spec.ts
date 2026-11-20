import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";
import { mockPharmacy, mockServiceStates, mockVisitStatus } from "../fixtures";

/** Not an assertion suite: Q11 P3 screenshots of the service flows (pharmacy, lab, telemedicine, home visits, account, states).
 *  TAG=p3-before|p3-after LANGS=ar,en THEMES=light,dark VIEWS=desktop,mobile ONLY=pharmacy,lab,... Signs in as Hoda (TEST_DATA.md). Output: _docs/ui-review/kiorex-web */
const OUT = path.resolve(process.cwd(), "../../../_docs/ui-review/kiorex-web");
const TAG = process.env.TAG ?? "p3-after";
const LANGS = (process.env.LANGS ?? "ar,en").split(",");
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const VIEWS = (process.env.VIEWS ?? "desktop,mobile").split(",");
const ONLY = process.env.ONLY?.split(",");
const SIZE = { desktop: { width: 1280, height: 860 }, mobile: { width: 390, height: 844 } } as const;
const HODA = "+201000001001";
mkdirSync(OUT, { recursive: true });
test.setTimeout(420_000);

const want = (n: string) => !ONLY || ONLY.includes(n);
async function shot(page: Page, name: string, lang: string, theme: string, view: string, full = true) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${view}-${lang}-${theme}.png`), fullPage: full });
}
/** Visits each detail link of a list page and shots one per distinct status (so rejected/refunded/ready... are all covered). */
async function details(page: Page, list: string, linkSel: string, statusId: string, name: string, lang: string, theme: string, view: string, max = 6) {
  await page.goto(list); await page.waitForTimeout(1200);
  const hrefs = await page.locator(linkSel).evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter(Boolean) as string[]);
  const seen = new Set<string>();
  for (const h of hrefs) {
    if (seen.size >= max) break;
    await page.goto(h); await page.waitForTimeout(900);
    const st = ((await page.getByTestId(statusId).first().textContent({ timeout: 4000 }).catch(() => "")) ?? "").trim() || `x${seen.size}`;
    const key = st.replace(/\W+/g, "").slice(0, 14) || `x${seen.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await shot(page, `${name}-${seen.size}`, lang, theme, view);
  }
}

for (const lang of LANGS) for (const theme of THEMES) for (const view of VIEWS as (keyof typeof SIZE)[]) {
  test(`p3 ${view} ${lang} ${theme}`, async ({ page }) => {
    await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* ignore */ } }, [lang, theme]);
    await page.setViewportSize(SIZE[view]);
    if (process.env.FIX !== "0") { await mockServiceStates(page); await mockPharmacy(page); } // dev fixtures: every order / lab / video state (the seed rarely holds them all)
    if (want("notfound")) { await page.goto("/nope/nothing"); await shot(page, "notfound", lang, theme, view); }
    await signIn(page, "/", HODA);
    for (const [n, u] of [["pharmacy", "/pharmacy"], ["labp", "/lab"], ["tele", "/telemedicine"], ["waitlist", "/waitlist"], ["careplans", "/care-plans"], ["addresses", "/account/addresses"], ["account", "/account"], ["services", "/services"]] as const) {
      if (!want(n)) continue;
      await page.goto(u); await shot(page, n, lang, theme, view);
    }
    if (want("pharmacy-flow")) {
      await page.goto("/pharmacy");
      await page.getByTestId("pharmacy-option").first().click().catch(() => {});
      await page.getByTestId("medicine-search").fill("par").catch(() => {});
      await page.getByTestId("medicine-search-submit").click().catch(() => {});
      await page.getByTestId("add-to-cart").first().click({ timeout: 6000 }).catch(() => {});
      await page.getByTestId("method-delivery").click({ timeout: 4000 }).catch(() => {});
      await shot(page, "pharmacy-cart", lang, theme, view);
      if (view === "mobile") { await page.getByTestId("open-cart").click({ timeout: 4000 }).catch(() => {}); await shot(page, "pharmacy-sheet", lang, theme, view, false); }
    }
    if (want("labflow")) {
      await page.goto("/lab"); await page.getByTestId("lab-test").first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.getByTestId("lab-test").first().locator("button[role=checkbox]").click().catch(() => {});
      await page.getByTestId("lab-slot").first().click({ timeout: 8000 }).catch(() => {});
      await shot(page, "lab-flow", lang, theme, view);
      if (view === "mobile") { await page.getByTestId("open-lab-summary").click({ timeout: 4000 }).catch(() => {}); await shot(page, "lab-sheet", lang, theme, view, false); }
    }
    if (want("teleroom")) { await page.goto("/telemedicine/t-live/room"); await page.getByTestId("tele-room").waitFor({ timeout: 8000 }).catch(() => {}); await shot(page, "teleroom", lang, theme, view, false); }
    if (want("offline")) {
      await page.goto("/services"); await page.waitForTimeout(800);
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.getByRole("link", { name: /Account|حسابي/ }).first().click({ timeout: 4000 }).catch(() => {});
      await shot(page, "offline", lang, theme, view, false);
      await page.context().setOffline(false);
    }
    if (want("orders")) { await page.goto("/pharmacy/orders"); await shot(page, "orders", lang, theme, view); await details(page, "/pharmacy/orders", '[data-testid="order-row"]', "order-status", "order", lang, theme, view); }
    if (want("labbookings")) { await page.goto("/lab/bookings"); await shot(page, "labbookings", lang, theme, view); await details(page, "/lab/bookings", 'a[href^="/lab/bookings/"]', "lab-status", "labbooking", lang, theme, view, 4); }
    if (want("telesessions")) { await details(page, "/telemedicine", 'a[href^="/telemedicine/"]', "tele-status", "telesession", lang, theme, view, 4); }
    if (want("hv")) {
      await mockVisitStatus(page);
      await page.goto("/visit-status/DEMO"); await shot(page, "visitstatus", lang, theme, view);
    }
    if (want("error")) {
      await page.route("**/api/v1/me/addresses**", (r) => r.fulfill({ status: 500, json: { code: "X", message: "x" } }));
      await page.goto("/account/addresses"); await shot(page, "error", lang, theme, view);
    }
  });
}
