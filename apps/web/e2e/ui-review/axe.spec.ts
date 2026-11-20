import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";
import { LABS, ORDERS, SESSIONS, mockPharmacy, mockServiceStates, mockVisitStatus } from "../fixtures";

/** axe-core a11y gate on key screens, AR+EN x light+dark. axe-core is not a dependency of this repo: set AXE_CORE_PATH to axe.min.js
 *  (defaults to the copy in the sibling kiorex-account checkout) and the suite skips when it is missing. */
const CANDIDATES = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean) as string[];
const AXE = CANDIDATES.find((p) => existsSync(p));
const PAGES: string[] = ["/", "/search", "/appointments", "/records", "/services", "/account", "/pharmacy", "/lab", "/waitlist", "/pharmacy/orders", "/lab/bookings", "/telemedicine", "/care-plans", "/account/addresses", "/this-page-does-not-exist"];
const LANGS = ["ar", "en"], THEMES = ["light", "dark"];

async function scan(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")) }));
  });
}

test.describe("axe", () => {
  test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
  test.setTimeout(300_000);
  for (const lang of LANGS) for (const theme of THEMES) {
    test(`no serious violations ${lang} ${theme}`, async ({ page }) => {
      await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);
      await signIn(page, PAGES[0]);
      const bad: string[] = [];
      await page.goto("/search"); await page.getByTestId("doctor-card").first().waitFor();
      const doctorHref = await page.getByTestId("doctor-card").first().getByRole("link").first().getAttribute("href");
      for (const u of [...PAGES, ...(doctorHref ? [doctorHref] : [])]) { // + the first doctor profile (editorial header, slot picker, review summary)
        await page.goto(u); await page.waitForTimeout(900);
        const v = await scan(page);
        for (const x of v.filter((y: { impact: string }) => y.impact === "serious" || y.impact === "critical")) bad.push(`${u} ${x.id} (${x.impact}) ${x.nodes.join(" | ")}`);
      }
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
});

const serious = (v: { impact: string }[]) => v.filter((y) => y.impact === "serious" || y.impact === "critical");
async function check(page: Page, label: string, bad: string[]) {
  await page.waitForTimeout(700);
  for (const x of serious(await scan(page)) as unknown as { id: string; impact: string; nodes: string[] }[]) bad.push(`${label} ${x.id} (${x.impact}) ${x.nodes.join(" | ")}`);
}
const prefs = (page: Page, lang: string, theme: string) => page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);

/** Service flows with DEV fixtures (every order / lab / video state, a filled cart, a live home-visit link): the seed does not reliably hold them. */
test.describe("axe service flows", () => {
  test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
  test.setTimeout(300_000);
  for (const lang of LANGS) for (const theme of THEMES) {
    test(`order, lab, video and home-visit states ${lang} ${theme}`, async ({ page }) => {
      await prefs(page, lang, theme);
      await mockServiceStates(page); await mockPharmacy(page); await mockVisitStatus(page);
      await signIn(page, "/");
      const bad: string[] = [];
      const urls = ["/pharmacy", ...ORDERS.map((o) => `/pharmacy/orders/${o.id}`), ...LABS.map((l) => `/lab/bookings/${l.id}`), "/telemedicine", ...SESSIONS.map((x) => `/telemedicine/${x.id}`), `/telemedicine/${SESSIONS[1].id}/room`, "/visit-status/DEMO"];
      for (const u of urls) {
        await page.goto(u);
        if (u === "/pharmacy") { await page.getByTestId("pharmacy-option").first().click(); await page.getByTestId("medicine-search").fill("par"); await page.getByTestId("medicine-search-submit").click(); await page.getByTestId("medicine").first().waitFor(); }
        await check(page, u, bad);
      }
      expect(bad, bad.join("\n")).toEqual([]);
    });

    test(`mobile sheets (cart, lab summary, doctor booking) ${lang} ${theme}`, async ({ page }) => {
      await prefs(page, lang, theme);
      await mockPharmacy(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, "/");
      const bad: string[] = [];
      await page.goto("/pharmacy"); await page.getByTestId("open-cart").click(); await page.getByTestId("cart-sheet").waitFor(); await check(page, "pharmacy cart sheet", bad);
      await page.goto("/lab"); await page.getByTestId("lab-test").first().waitFor();
      await page.getByTestId("lab-test").first().locator("button[role=checkbox]").click(); await page.getByTestId("open-lab-summary").click(); await page.getByTestId("lab-sheet").waitFor(); await check(page, "lab sheet", bad);
      await page.goto("/search"); await page.getByTestId("doctor-card").first().waitFor();
      await page.getByTestId("doctor-card").first().getByRole("link").first().click(); await page.getByTestId("open-booking").click(); await page.getByTestId("booking-sheet").waitFor(); await check(page, "doctor booking sheet", bad);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }

  for (const [lang, theme] of [["ar", "light"], ["en", "dark"]] as const) {
    test(`checkout and confirmation ${lang} ${theme}`, async ({ page }) => {
      await prefs(page, lang, theme);
      await signIn(page, "/");
      const bad: string[] = [];
      await page.goto("/search"); await page.getByTestId("doctor-card").first().waitFor();
      await page.getByTestId("doctor-card").first().getByRole("link").first().click(); await page.getByTestId("doctor-name").waitFor();
      const slot = page.getByTestId("slot-calendar").getByTestId("slot-button").first();
      test.skip(!(await slot.count()), "no bookable slot on this stack");
      await slot.click(); await page.getByTestId("continue-booking").click(); await page.waitForURL(/\/checkout\//);
      await page.getByTestId("hold-countdown").waitFor(); await check(page, "checkout", bad);
      await page.getByTestId("consent-data").click(); await page.getByTestId("confirm-booking").click(); await page.waitForURL(/\/appointments\//);
      await page.getByTestId("booking-confirmed").waitFor({ timeout: 15000 }).catch(() => {}); await check(page, "confirmation", bad);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }

  test("offline state", async ({ page, context }) => {
    await signIn(page, "/services");
    await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const bad: string[] = [];
    await page.getByTestId("offline-banner").waitFor(); await check(page, "offline banner", bad);
    await context.setOffline(false);
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
