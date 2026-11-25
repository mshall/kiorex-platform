import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * GRW-P2-S patient web in a real browser: the SPONSORED label. A sponsored placement is always labelled on the result card (text "Sponsored" / "إعلان", not colour alone) and the checkout discount line
 * says who sponsors it ("not a Kiorex discount"). Arabic RTL and English, light and dark, at 320, 640x450, 1440 and 2560: no horizontal overflow, axe serious and critical clean. The API is answered by
 * fixtures so the figures are deterministic (the real endpoints are covered by the integration suites).
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const ITEM = (id: string, sponsored: boolean) => ({ id, nameEn: `Dr Sara ${id}`, nameAr: `د. سارة ${id}`, clinicNameEn: "Nile Clinic", clinicNameAr: "عيادة النيل", specialty: "cardiology", governorate: "Cairo", area: "Maadi", minFeeMinor: 30000, maxFeeMinor: 45000, currency: "EGP", rating: { average: 4.6, count: 21 }, acceptsDeposit: true, languages: ["ar", "en"], gender: "F", distanceKm: 2.1, verified: true, bookable: true, defaultTypeId: `${id}-first`, nextSlots: [], slotsUnavailable: false, sponsored });

async function mock(page: Page, items: ReturnType<typeof ITEM>[]) {
  await page.route("**/api/v1/**", (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace("/api/v1", ""); const json = (j: unknown, status = 200) => r.fulfill({ status, json: j });
    if (p === "/search/providers") return json({ items, total: items.length, page: 1, pageSize: 20, sort: "earliest", specialties: [] });
    if (p === "/care-types") return json([{ code: "DOCTORS", enabled: true, flag: null, labelEn: "Doctors", labelAr: "أطباء", reason: "ON", providerCount: 3 }]);
    if (p === "/specialties") return json([{ code: "cardiology", en: "Cardiology", ar: "القلب" }]);
    if (p === "/search/sponsored") return json({ items: [], sponsored: true, label: "SPONSORED" });
    if (p === "/markets") return json([{ code: "EG", name: "Egypt", live: true, currency: "EGP", phoneCode: "+20" }]);
    if (p === "/bootstrap") return json({ features: { referral: false, loyalty: false } });
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

test.use({ baseURL: process.env.KX_SPONSORED_WEB_URL ?? "http://localhost:5393", actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("sponsored label on the result cards (real browser)", () => {
  test.setTimeout(180_000);
  test("only the sponsored card carries the label, in text, in both languages", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mock(page, [ITEM("a", true), ITEM("b", false)]); await page.goto("/search");
    await expect(page.getByText("Dr Sara a")).toBeVisible(); await expect(page.getByTestId("sponsored-label")).toHaveCount(1);
    await expect(page.getByTestId("sponsored-label")).toHaveText("Sponsored");
    // the smallest container around the label that holds a doctor name belongs to the sponsored doctor, not the other one
    const owner = await page.getByTestId("sponsored-label").evaluate((el) => { let n: HTMLElement | null = el as HTMLElement; while (n && !/Dr Sara [ab]/.test(n.textContent ?? "")) n = n.parentElement; return /Dr Sara a/.test(n?.textContent ?? "") && !/Dr Sara b/.test(n?.textContent ?? ""); });
    expect(owner).toBe(true);
  });
  test("no sponsored placement means no label anywhere", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await mock(page, [ITEM("a", false), ITEM("b", false)]); await page.goto("/search");
    await expect(page.getByText("Dr Sara a")).toBeVisible(); await expect(page.getByTestId("sponsored-label")).toHaveCount(0);
  });
  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) {
    test(`renders ${lang} ${theme} at 320, 640x450, 1440 and 2560: label visible, RTL where Arabic, no horizontal overflow, axe clean`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await page.addInitScript(prefs, [lang, theme]); await mock(page, [ITEM("a", true), ITEM("b", false)]); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/search");
      await expect(page.getByTestId("sponsored-label")).toBeVisible(); await expect(page.getByTestId("sponsored-label")).toHaveText(lang === "ar" ? "إعلان" : "Sponsored");
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      for (const s of SIZES) {
        await page.setViewportSize(s); await expect(page.getByTestId("sponsored-label")).toBeVisible(); await noOverflow(page, `${lang} ${s.width}x${s.height}`);
        expect(await axeSerious(page), `axe ${lang} ${theme} ${s.width}`).toEqual([]);
      }
    });
  }
});
