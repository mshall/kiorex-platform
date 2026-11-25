import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * GRW-P4-D in a real browser: the three loyalty pages (Overview, Tiers and rules, Partnerships) in Arabic RTL and English, light and dark, at 320, 640x450, 1440 and 2560 px: no horizontal overflow, axe serious and
 * critical clean, keyboard-reachable tabs and actions, masked cells read <10, a new partner code is shown once. The API is answered by fixtures (page.route) behind a synthetic session so the figures are deterministic; the real
 * endpoints, the budget cap and the ledger are exercised by test/growth-loyalty.int.spec.ts. `KX_LOYALTY_URL` points the run at another instance.
 */
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p!));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
const OIDC_KEY = "oidc.user:http://localhost:4400:kiorex-ops";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER = JSON.stringify({ access_token: `${b64({ alg: "none" })}.${b64({ sub: "adm_a", kx_roles: ["ops_admin", "super_admin"] })}.x`, token_type: "Bearer", scope: "openid profile", expires_at: Math.floor(Date.now() / 1000) + 3600, profile: { sub: "adm_a", name: "Ops A", kx_roles: ["ops_admin", "super_admin"] } });
const CAPS = { roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: false, writeConfig: true, approveConfig: true, reviewFraud: false, manage: true, manageCampaigns: true, reviewPromotions: false, manageCorporate: true, manageLoyalty: true } };
const RULES = { enabled: true, pointsPerCompletedBooking: 10, windowMonths: 12, expiryMonths: 12, annualCapPoints: 1000, tiers: { SILVER: { minCompletedBookings: 3, bonusPoints: 5 }, GOLD: { minCompletedBookings: 6, bonusPoints: 10 }, PLATINUM: { minCompletedBookings: 0, bonusPoints: 0 } }, conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 2 } };
const SUMMARY = { k: 10, accounts: 120, tiers: { NONE: 100, SILVER: 12, GOLD: null, PLATINUM: 0 }, points: { outstanding: 4300, holders: 90 }, last30Days: { earned: { people: 40, points: 900 }, expired: { people: null, points: null }, reversed: { people: 0, points: 0 }, converted: { people: 12, points: 360 } }, partnerships: { ACTIVE: { programs: 1, budgetMinor: 900000 }, DRAFT: { programs: 1, budgetMinor: 0 } }, suppressed: ["tiers.GOLD"] };
const PROGRAMS = [{ id: "ptp_1", key: "bank-x", partnerRef: "bank-x", kind: "CODE_DISCOUNT", nameAr: "بنك إكس", nameEn: "Bank X", status: "ACTIVE", fundingMode: "PLATFORM_MARKETING", budgetMinor: 900000, perRedemptionMinor: 30000, currency: "EGP", startsAt: "2027-02-01T00:00:00Z", endsAt: "2027-03-01T00:00:00Z", campaignId: "cmp_1", legalTextRef: "TODO_NEEDS_HUMAN: counsel legal text reference", legalTextIsPlaceholder: true, createdBy: "a", activatedBy: "b", usedMinor: 300000, redemptions: 10, campaign: { id: "cmp_1", key: "partner-1", name: "Bank partner offer", status: "ACTIVE", budgetTotalMinor: 1000000 } },
  { id: "ptp_2", key: "card-y", partnerRef: "card-y", kind: "CARD_OFFER", nameAr: "بطاقة واي", nameEn: "Card Y", status: "DRAFT", fundingMode: "PLATFORM_MARKETING", budgetMinor: 0, perRedemptionMinor: 0, currency: "EGP", startsAt: null, endsAt: null, campaignId: null, legalTextRef: "TODO_NEEDS_HUMAN: counsel legal text reference", legalTextIsPlaceholder: true, createdBy: "a", activatedBy: null, usedMinor: 0, redemptions: 0, campaign: null }];

async function mock(page: Page) {
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k!)) sessionStorage.setItem(k!, v!); }, [OIDC_KEY, USER]);
  await page.route("**/api/v1/**", (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace("/api/v1", ""); const m = r.request().method();
    const json = (j: unknown, status = 200) => r.fulfill({ status, json: j });
    if (p === "/ops/growth/access") return json(CAPS);
    if (p === "/admin/growth/loyalty/summary") return json(SUMMARY);
    if (p === "/admin/growth/loyalty/rules") return json({ rules: RULES, versionId: "v1", source: "ACTIVE", defaultsOnly: false, allZero: false, flagOn: true });
    if (p === "/admin/growth/loyalty/tiers/preview") return json({ completed: Number(u.searchParams.get("completed")), tier: "GOLD" });
    if (p === "/admin/growth/loyalty/partnerships" && m === "GET") return json({ items: PROGRAMS });
    if (/\/admin\/growth\/loyalty\/partnerships\/ptp_1\/codes$/.test(p) && m === "GET") return json({ items: [{ id: "ptc_1", label: "Card mailer", maxRedemptions: 100, redeemedCount: 10, expiresAt: null, status: "ACTIVE", createdAt: "2027-02-01T00:00:00Z" }] });
    if (/\/admin\/growth\/loyalty\/partnerships\/ptp_1\/codes$/.test(p) && m === "POST") return json({ id: "ptc_2", code: "ABCDE-FGHJK", label: "New", maxRedemptions: 50, expiresAt: null, shownOnce: true }, 201);
    if (p === "/admin/growth/campaigns") return json([{ id: "cmp_1", key: "partner-1", name: "Bank partner offer", status: "ACTIVE", channels: ["PARTNER"], budgetTotalMinor: 1_000_000, objective: "ACQUISITION", market: "EG", utmCampaign: "eg-partner-1", budgetDailyMinor: 1, currency: "EGP", startsAt: null, endsAt: null }]);
    return json({});
  });
}
async function open(page: Page, lang: string, theme: string, tab: "overview" | "tiers" | "partnerships") {
  await page.addInitScript(prefs, [lang, theme]); await mock(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/growth/loyalty");
  await expect(page.getByRole("main")).toBeVisible(); await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await page.getByTestId(`loy-tab-${tab}`).click();
}
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(500); await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = async (page: Page, where: string) => {
  const w = await page.evaluate(() => { const iw = window.innerWidth; const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => { const sc = e.closest("[role='region'][tabindex='0']"); return !sc && e.getBoundingClientRect().right > iw + 1; }).slice(0, 3).map((e) => `${e.tagName}.${e.className}`.slice(0, 80)); return { d: document.documentElement.scrollWidth - iw, wide }; });
  expect(w.d, `${where} overflows horizontally by ${w.d}px: ${w.wide.join(" | ")}`).toBeLessThanOrEqual(1);
};
const SIZES = [{ width: 320, height: 800 }, { width: 640, height: 450 }, { width: 1440, height: 900 }, { width: 2560, height: 1300 }];
const READY = { overview: "loy-cards", tiers: "loy-rules", partnerships: "ptn-rules-note" } as const;

test.use({ baseURL: process.env.KX_LOYALTY_URL ?? "http://localhost:5391", actionTimeout: 25_000, navigationTimeout: 45_000 });
test.describe("ops loyalty pages (real browser)", () => {
  test.setTimeout(240_000);

  test("keyboard: the tabs switch the panel; masked cells read <10; the partner code appears once and is gone after dismissal", async ({ page }) => {
    await open(page, "en", "light", "overview");
    await expect(page.getByTestId("loy-not-money")).toContainText("Points are not money"); await expect(page.getByTestId("loy-cards")).toContainText("<10");
    await page.getByRole("tab", { name: "Overview" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("tab", { name: "Tiers and rules" })).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("loy-min-SILVER")).toHaveText("3"); await expect(page.getByTestId("loy-people-GOLD")).toHaveText("<10"); await page.getByTestId("loy-calc-input").fill("6"); await expect(page.getByTestId("loy-calc-result")).toContainText("Gold");
    await page.getByTestId("loy-tab-partnerships").click(); await page.getByTestId("ptn-open-bank-x").click(); await expect(page.getByTestId("ptn-legal")).toHaveAttribute("data-needs-human", "true");
    await page.getByTestId("ptn-code-label").fill("New"); await page.getByTestId("ptn-code-create").click(); await expect(page.getByTestId("ptn-code-value")).toHaveText("ABCDE-FGHJK"); await page.getByTestId("ptn-code-dismiss").click(); await expect(page.getByTestId("ptn-code-value")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("ABCDE-FGHJK");
  });

  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) for (const tab of ["overview", "tiers", "partnerships"] as const) {
    test(`${tab} renders ${lang} ${theme} at 320, 640x450, 1440 and 2560: RTL where Arabic, no horizontal overflow, axe clean`, async ({ page }, info) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await open(page, lang, theme, tab); await expect(page.getByTestId(READY[tab])).toBeVisible();
      for (const s of SIZES) {
        await page.setViewportSize(s); await expect(page.getByTestId(READY[tab])).toBeVisible(); await noOverflow(page, `${tab} ${lang} ${s.width}x${s.height}`);
        expect(await axeSerious(page), `axe on ${tab} ${lang} ${theme} ${s.width}`).toEqual([]);
        if (s.width === 320 || s.width === 1440) await page.screenshot({ path: info.outputPath(`loyalty-${tab}-${lang}-${theme}-${s.width}.png`), fullPage: true });
      }
    });
  }
});
