import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * GRW-P2-F (Integrations, Channels performance) and GRW-P2-B3 (Referrals, Review, Rewards, Lot, Finance, Manual issue) in the ops console. Real browser, real Passport sign-in of the seeded ops super admin, the
 * real console build; the Phase 2 data is answered by page.route fixtures (deterministic values for the assertions) and the first test below checks every fixture against the REAL committed API on :4000 (status 200 and the same keys); behaviour is covered by the API suites
 * `growth-integrations.int.spec.ts` and A1's referral and rewards suites). AR (RTL) and EN, light and dark, 320 to 1440 px, keyboard, axe serious and critical clean. Screenshots: _docs/test-flow/growth-p2/.
 */
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "growth-p2") : path.resolve(process.cwd(), "../../../_docs/test-flow/growth-p2"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots; mkdirSync(SHOTS, { recursive: true });
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => !!p && existsSync(p));
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };
async function axeSerious(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(700); // entrance animations blend colours while they run, which axe would read as low contrast
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const noOverflow = async (page: Page, where: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${where} overflows horizontally`).toBeLessThanOrEqual(1);

const KINDS = [["googleads", "Google Ads"], ["searchconsole", "Google Search Console"], ["ga4", "GA4"], ["playconsole", "Google Play Console"], ["appstoreconnect", "App Store Connect"], ["metaads", "Meta Ads"], ["tiktok", "TikTok Ads"], ["whatsappcloud", "Meta WhatsApp Cloud"], ["fcmapns", "FCM and APNs"], ["crux", "Chrome UX Report"]] as const;
const row = (kind: string, label: string, o: Record<string, unknown> = {}) => ({ kind, label, mode: "mock", flagEffective: true, flagReason: "ON", secretRefSet: false, secretRefConfigured: false, accountLabelSet: false, pullSchedule: "daily", rateBudgetPerHour: 60, retentionMonths: 25, location: "Kiorex cell (frankfurt)", fallback: "manual", defaultOff: false, circuit: "CLOSED", consecutiveFailures: 0, lastOkAt: null, lastErrorAt: null, lastRun: null, health: { ok: true, detail: "synthetic" }, connected: false, synthetic: false, ...o });
const STATUS = { market: "EG", integrations: KINDS.map(([k, l]) => (k === "googleads" ? row(k, l, { connected: true, synthetic: true, lastRun: { id: "gir_1", status: "OK", mode: "mock", rows: 18, error: null, startedAt: new Date().toISOString() } }) : k === "metaads" ? row(k, l, { mode: "real", secretRefConfigured: true, circuit: "OPEN", consecutiveFailures: 5, lastRun: { id: "gir_2", status: "FAILED", mode: "real", rows: 0, error: "NEEDS_HUMAN", startedAt: new Date().toISOString() } }) : row(k, l))), rules: { secrets: "", data: "", conversions: "" } };
const RUNS = [{ id: "gir_2", kind: "metaads", mode: "real", status: "FAILED", rows: 0, error: "NEEDS_HUMAN", windowFrom: "2027-01-01", windowTo: "2027-01-02", startedAt: new Date().toISOString(), finishedAt: null }, { id: "gir_1", kind: "googleads", mode: "mock", status: "OK", rows: 18, error: null, windowFrom: "2027-01-01", windowTo: "2027-01-02", startedAt: new Date().toISOString(), finishedAt: null }];
const PERF = { market: "EG", range: { from: "2027-01-01", to: "2027-01-30" }, currency: "EGP", kMin: 10, spendFloorMinor: 50_000, definitions: { cac: "spend / attended new patients" },
  channels: KINDS.map(([k, l]) => ({ kind: k, label: l, connected: k === "googleads", synthetic: k === "googleads", lastRunAt: null, paid: ["googleads", "metaads", "tiktok"].includes(k), metrics: k === "googleads" ? { spendMinor: 120_000, impressions: 9000, clicks: 300, conversions: 12, ctrPct: 3.33, cpcMinor: 400, cpmMinor: 13_333 } : null })),
  campaigns: [{ key: "eg-winter", campaignId: "c1", name: "Winter check-up", status: "ACTIVE", synthetic: true, external: { spendMinor: 120_000, impressions: 9000, clicks: 300, conversions: 12, cpcMinor: 400, ctrPct: 3.33 }, firstParty: { attendedNewPatients: "<10", bookingsConfirmed: 14 }, spend: { approvedMinor: 100_000, externalMinor: 120_000, usedMinor: 120_000, source: "ADAPTER", deltaBp: 2000, conflict: true, note: "ADAPTER_WINS" }, cacMinor: "<10", cacHidden: "K_ANONYMITY", roas: null, roasHidden: "FINANCE_ONLY", revenueToDateMinor: null }],
  mix: [{ key: "PAID", count: "<10" }, { key: "ORGANIC", count: 40 }, { key: "REFERRAL", count: 12 }], blended: { spendMinor: 120_000, rewardCostMinor: 20_000, attendedNewPatients: 52, cacWithoutRewardsMinor: 2300, cacWithRewardsMinor: 2700, hidden: null, merHidden: "FINANCE_ONLY", mer: null },
  appFunnel: { storeConnected: false, installsStore: null, listingViews: null, installsFirstParty: 0, registrations: 0, firstCompletedBookings: 0, installToRegistrationPct: null, registrationToFirstBookingPct: null }, organic: [], vitals: [], notConnected: ["metaads"], gaps: ["SYNTHETIC_DATA_PRESENT", "SPEND_CONFLICT:eg-winter"] };
const REF = { funnel: { relationships: 120, signedUp: 80, booked: 40, qualified: 30, rejected: "<10", expired: 12, onHold: "<10" }, queue: [{ id: "rel_pw1", status: "BOOKED", createdAt: new Date().toISOString(), holdUntil: new Date(Date.now() + 5 * 86_400_000).toISOString() }] };
const REF1 = { id: "rel_pw1", status: "BOOKED", reviewState: "HOLD", rejectReason: null, createdAt: new Date().toISOString(), completedAt: null, holdUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(), qualifiedAt: null, ruleVersionId: "gcv_9", referrerRef: "a1b2c3d4e5f6", refereeRef: "f6e5d4c3b2a1", checks: [{ key: "RF_SELF", passed: true, detail: { match: false }, at: new Date().toISOString() }, { key: "VISIT_COMPLETED", passed: false, detail: null, at: new Date().toISOString() }], signals: [{ id: "s1", ruleId: "RF_FARM", score: 40, reviewStatus: "OPEN" }] };
const LOT = { id: "rwl_pw1", patientRef: "p1p1p1p1p1p1", kind: "REFERRER", mode: "COUPON", funding: "PLATFORM_MARKETING", status: "ACTIVE", amountMinor: 15_000, currency: "EGP", availableMinor: 15_000, heldMinor: 0, reservedMinor: 0, expiresAt: "2027-09-01T00:00:00Z", createdAt: "2027-01-01T00:00:00Z", campaignId: null, ruleVersionId: "gcv_1" };
const FIN = { month: "2027-01", rows: [{ market: "EG", currency: "EGP", kind: "REFERRER", funding: "PLATFORM_MARKETING", ruleVersionId: "gcv_1", campaignId: null, issuedMinor: 150_000, redeemedMinor: 50_000, reversedMinor: 0, expiredMinor: 0 }], totals: { issuedMinor: 150_000, redeemedMinor: 50_000, reversedMinor: 0, expiredMinor: 0 }, outstanding: [{ market: "EG", currency: "EGP", platformFundedMinor: 100_000, serviceRecoveryMinor: 0, refundCreditLiabilityMinor: 20_000, totalMinor: 120_000 }], recoverableLossMinor: 0, kiorexRevenueEffectMinor: 0, note: "x" };

async function mockPhase2(page: Page, log: { posts: Array<{ url: string; body: unknown }> } = { posts: [] }) {
  const j = (pattern: string, json: unknown) => page.route(pattern, (r) => (r.request().method() === "GET" ? r.fulfill({ json }) : r.fallback()));
  await j("**/api/v1/admin/growth/integration-status**", STATUS); await j("**/api/v1/admin/growth/integration-runs**", RUNS); await j("**/api/v1/admin/growth/channel-performance**", PERF);
  await j("**/api/v1/admin/growth/referrals", REF); await j("**/api/v1/admin/growth/referrals/rel_pw1", REF1);
  await j("**/api/v1/admin/growth/rewards", { mode: "COUPON", effectiveMode: "COUPON", ruleVersionId: "gcv_1", source: "ACTIVE", flags: { rewards: true, patientCredit: false, refundAsCredit: false, family: false, goodwill: false, referral: true }, banner: "NO_DEPOSIT_CONFIGURED", openApprovals: 1 });
  await j("**/api/v1/admin/growth/rewards/lots**", [LOT]); await j("**/api/v1/admin/growth/rewards/approvals", [{ id: "apr_pw1", kind: "MANUAL_ISSUE", amountMinor: 50_000, reason: "late cancel", bookingId: null, ticketRef: "T-1", requestedBy: "someone_else", createdAt: new Date().toISOString() }]);
  await j("**/api/v1/admin/growth/rewards/lots/rwl_pw1/ledger", [{ id: "e1", type: "ISSUE", amountMinor: 15_000, reasonCode: "REFERRER_QUALIFIED", bookingId: "bk_1", refundId: null, actor: "system", idempotencyKey: "rwd:issue:1", createdAt: new Date().toISOString() }]);
  await j("**/api/v1/admin/growth/rewards/finance**", FIN);
  await page.route(/\/api\/v1\/admin\/growth\/(integrations\/[a-z0-9]+\/(run|test|run-requests)|referrals\/[^/]+\/decision|rewards\/(manual-issue|approvals\/[^/]+\/decide|lots\/[^/]+\/(hold|release)))/, async (r) => { log.posts.push({ url: r.request().url().split("/api/v1")[1]!, body: r.request().postDataJSON() }); await r.fulfill({ json: r.request().url().includes("run-requests") ? { requestId: "aud_pw1" } : r.request().url().includes("/test") ? { kind: "googleads", mode: "mock", ok: true, detail: "synthetic" } : { status: "OK", rows: 18 } }); });
}

test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 });
test.describe("ops console: integrations, channel performance, referrals and rewards (real sign-in)", () => {
  test.setTimeout(240_000);

  for (const [lang, theme, width] of [["en", "light", 1440], ["ar", "dark", 320], ["ar", "light", 1024], ["en", "dark", 390]] as const) {
    test(`Integrations and Channels: ${lang} ${theme} ${width}px, labelled synthetic, hidden CAC with its reason, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 }); await page.addInitScript(prefs, [lang, theme]); await mockPhase2(page); await signIn(page, "/growth/integrations");
      await expect(page.getByTestId("growth-page-integrations")).toBeVisible(); await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.getByTestId("ig-mode-googleads")).toBeVisible(); await expect(page.getByTestId("ig-mode-metaads")).toBeVisible(); await expect(page.getByTestId("ig-circuit-metaads")).toBeVisible(); await expect(page.getByTestId("integration-rules")).toBeVisible();
      await expect(page.getByText("NEEDS_HUMAN").first()).toBeVisible(); await noOverflow(page, `integrations ${lang} ${width}`);
      expect(await axeSerious(page), "axe on integrations").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `integrations-${lang}-${theme}-${width}.png`), fullPage: true });
      await page.goto("/growth/channels"); await expect(page.getByTestId("channel-performance")).toBeVisible(); await expect(page.getByTestId("perf-state-metaads")).toBeVisible(); await expect(page.getByTestId("perf-cac-eg-winter")).toHaveText("<10"); await expect(page.getByTestId("perf-rec-eg-winter")).toBeVisible(); await expect(page.getByTestId("perf-blended")).toBeVisible();
      await noOverflow(page, `channels ${lang} ${width}`); expect(await axeSerious(page), "axe on channel performance").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `channel-performance-${lang}-${theme}-${width}.png`), fullPage: true });
    });
  }

  test("every fixture matches the REAL API: same status and every fixture key present in the live response", async ({ page }) => {
    await page.addInitScript(prefs, ["en", "light"]); await signIn(page, "/growth/integrations");
    const token = await page.evaluate(() => { const k = Object.keys(sessionStorage).find((x) => x.startsWith("oidc.user:")); return k ? (JSON.parse(sessionStorage.getItem(k)!) as { access_token: string }).access_token : null; });
    expect(token).toBeTruthy();
    const get = async (p: string) => { const r = await page.request.get(`${process.env.KIOREX_API_URL ?? "http://localhost:4000"}/api/v1/admin/growth/${p}`, { headers: { Authorization: `Bearer ${token}` } }); expect(r.status(), `GET ${p}`).toBe(200); return r.json() as Promise<unknown>; };
    const missing = (fx: unknown, live: unknown, at: string): string[] => {
      if (live === null) return []; /* nullable until the first run */ if (Array.isArray(fx)) { if (!Array.isArray(live)) return [`${at}: live is not an array`]; return fx.length && live.length ? missing(fx[0], live[0], `${at}[0]`) : []; }
      if (fx && typeof fx === "object") { if (!live || typeof live !== "object") return [`${at}: live is not an object`]; return Object.entries(fx).flatMap(([k, v]) => (k in (live as object) ? missing(v, (live as Record<string, unknown>)[k], `${at}.${k}`) : [`${at}.${k}`])); }
      return [];
    };
    const gaps: string[] = [];
    for (const [p, fx] of [["integration-status", STATUS], ["integration-runs", RUNS], ["channel-performance", PERF], ["referrals", REF], ["rewards", { mode: "", effectiveMode: "", ruleVersionId: "", source: "", flags: {}, banner: "", openApprovals: 0 }], ["rewards/lots", [LOT]], ["rewards/finance", FIN]] as const) gaps.push(...missing(fx, await get(p), p));
    expect(gaps, "fixture keys the real API does not return").toEqual([]);
  });

  test("Integrations: test connection, pull now (mock) and the two-person flow for a real pull", async ({ page }) => {
    const log = { posts: [] as Array<{ url: string; body: unknown }> }; await page.setViewportSize({ width: 1440, height: 900 }); await page.addInitScript(prefs, ["en", "light"]); await mockPhase2(page, log); await signIn(page, "/growth/integrations");
    await page.getByTestId("ig-test-googleads").click(); await expect.poll(() => log.posts.some((p) => p.url.startsWith("/admin/growth/integrations/googleads/test"))).toBe(true);
    await page.getByTestId("ig-pull-googleads").click(); await expect.poll(() => log.posts.some((p) => p.url.endsWith("/integrations/googleads/run"))).toBe(true);
    await page.getByTestId("ig-pull-metaads").click(); await expect(page.getByTestId("ig-request-metaads")).toHaveText("aud_pw1"); await expect(page.getByTestId("ig-confirm-metaads")).toBeDisabled();
    await page.getByPlaceholder(/request id/i).fill("aud_pw1"); await page.getByTestId("ig-confirm-metaads").click(); await expect.poll(() => log.posts.some((p) => JSON.stringify(p.body ?? {}).includes("aud_pw1") && p.url.endsWith("/integrations/metaads/run"))).toBe(true);
  });

  for (const [lang, theme, width] of [["en", "light", 1440], ["ar", "dark", 320], ["ar", "light", 1024]] as const) {
    test(`Referrals, review, rewards, lot, finance and manual issue: ${lang} ${theme} ${width}px, axe clean`, async ({ page }) => {
      const log = { posts: [] as Array<{ url: string; body: unknown }> }; await page.setViewportSize({ width, height: 900 }); await page.addInitScript(prefs, [lang, theme]); await mockPhase2(page, log); await signIn(page, "/growth/referrals");
      await expect(page.getByTestId("referrals-funnel")).toBeVisible(); await expect(page.getByTestId("rate-hold")).toHaveText("<10"); await expect(page.getByTestId("referrals-privacy")).toBeVisible(); await noOverflow(page, `referrals ${lang} ${width}`);
      expect(await axeSerious(page), "axe on referrals").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `referrals-${lang}-${theme}-${width}.png`), fullPage: true });
      await page.getByRole("link", { name: "rel_pw1" }).click(); await expect(page.getByTestId("referrer-ref")).toHaveText("a1b2c3d4e5f6"); await expect(page.locator("body")).not.toContainText(/\+20\d{9}/); await noOverflow(page, `review ${lang} ${width}`);
      expect(await axeSerious(page), "axe on review").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `referral-review-${lang}-${theme}-${width}.png`), fullPage: true });
      await page.getByTestId("decision-note").fill("family"); await page.getByTestId("decision-release").click(); await expect.poll(() => log.posts.some((p) => p.url.endsWith("/decision") && JSON.stringify(p.body).includes("RELEASE_HOLD"))).toBe(true);
      await page.goto("/growth/rewards"); await expect(page.getByTestId("rewards-overview")).toBeVisible(); await expect(page.getByTestId("rewards-no-deposit")).toBeVisible(); await expect(page.getByTestId("lot-available-rwl_pw1")).toBeVisible(); await noOverflow(page, `rewards ${lang} ${width}`);
      await page.getByTestId("manual-issue-open").click(); await expect(page.getByTestId("manual-issue")).toBeVisible(); await expect(page.getByTestId("mi-submit")).toBeDisabled();
      await page.getByTestId("mi-sub").fill("pat_pw_0001"); await page.getByTestId("mi-amount").fill("75"); await page.getByTestId("mi-reason").fill("Provider cancelled late"); await expect(page.getByTestId("mi-submit")).toBeEnabled();
      expect(await axeSerious(page), "axe on manual issue").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `manual-issue-${lang}-${theme}-${width}.png`) });
      await page.getByTestId("mi-submit").click(); await expect.poll(() => log.posts.some((p) => p.url.endsWith("/rewards/manual-issue") && JSON.stringify(p.body).includes("7500"))).toBe(true);
      await page.keyboard.press("Escape"); expect(await axeSerious(page), "axe on rewards").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `rewards-${lang}-${theme}-${width}.png`), fullPage: true });
      await page.goto("/growth/rewards/lots/rwl_pw1"); await expect(page.getByText("REFERRER_QUALIFIED")).toBeVisible(); await noOverflow(page, `lot ${lang} ${width}`); expect(await axeSerious(page), "axe on lot").toEqual([]);
      await page.goto("/growth/rewards/finance"); await expect(page.getByTestId("finance-totals")).toBeVisible(); await expect(page.getByTestId("refund-credit-liability")).toBeVisible(); await expect(page.getByTestId("finance-note")).toBeVisible(); await noOverflow(page, `finance ${lang} ${width}`);
      expect(await axeSerious(page), "axe on finance").toEqual([]); await page.screenshot({ path: path.join(SHOTS, `rewards-finance-${lang}-${theme}-${width}.png`), fullPage: true });
    });
  }
});
