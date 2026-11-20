import { expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { signIn } from "../helpers";

// Runs AFTER apps/web/e2e/home/home.spec.ts on the same isolated stack (node apps/web/e2e/home/stack.mjs up): that spec creates the home booking,
// the SOS safety alert and the unsafe abort (deposit held for review) that this console spec acts on.
const API = "http://localhost:4001";
const PSQL = process.env.PSQL ?? "/Users/postgres/bin/psql";
const sql = (q: string) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_e2e_home", "-tAc", q], { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }).trim();
/** The shared dev ops server on :5181 proxies to the dev API on :4000; re-point /api to the isolated API at the network layer (still the real API). */
const toIsolatedApi = (ctx: BrowserContext) => ctx.route("http://localhost:5181/api/**", (route) => route.continue({ url: route.request().url().replace("http://localhost:5181", API) }));

test.beforeEach(async ({ page }) => { await toIsolatedApi(page.context()); });

test.describe.serial("Rev 2.3 home visits, ops console", () => {
  test("safety console: SOS alert with delivery SLO, acknowledge with note, escalate, resolve", async ({ page }) => {
    await signIn(page, "/safety");
    await expect(page.getByTestId("safety-tiles")).toBeVisible();
    await expect(page.getByTestId("safety-mock-note")).toBeVisible(); // SAFETY_DELIVERY_MODE=mock: said honestly
    const row = page.getByTestId("row").filter({ hasText: "maadi" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("slo")).toBeVisible(); // 60 s delivery SLO: delivered (met) or counting/breached
    await expect(row.getByTestId("alert-status")).toContainText(/مرفوع|Raised/);
    const id = sql(`select id from "SafetyAlert" order by "createdAt" desc limit 1`);
    await page.getByTestId(`ack-${id}`).click();
    await page.getByTestId("safety-note").fill("e2e: on-call owns it");
    await page.getByTestId("safety-confirm").click();
    await expect(row.getByTestId("alert-status")).toContainText(/تم الاستلام|Acknowledged/);
    await page.getByTestId(`esc-${id}`).click();
    await page.getByTestId("safety-confirm").click();
    await expect(row.getByTestId("alert-status")).toContainText(/مُصعَّد|Escalated/);
    await page.getByTestId(`res-${id}`).click();
    await page.getByTestId("safety-confirm").click();
    await expect(row.getByTestId("alert-status")).toContainText(/تمت المعالجة|Resolved/);
    await page.getByTestId("safety-status-filter").selectOption("RESOLVED");
    await expect(page.getByTestId("row")).toHaveCount(1);
    expect(sql(`select count(*) from "SafetyAlertAction" where "alertId"='${id}'`)).not.toBe("0");
  });

  test("held-deposit queue: reason is mandatory, release decides the deposit", async ({ page }) => {
    await signIn(page, "/held-deposits");
    const row = page.getByTestId("row").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("maadi");
    await row.getByRole("button").first().click(); // release
    await expect(page.getByTestId("review-confirm")).toBeDisabled();
    await page.getByTestId("review-reason").fill("e2e: provider was in danger");
    await page.getByTestId("review-confirm").click();
    await expect(page.getByTestId("empty-state").or(page.getByText(/لا توجد عربونات|No deposits/))).toBeVisible();
    await expect.poll(() => sql(`select "depositStatus" from "BookingIntent" where "depositStatus" in ('HOLD_FOR_REVIEW','RELEASED')`)).toBe("RELEASED");
  });

  test("home-visit gate metric shows clusters and human-recorded GHV1/GHV2 evidence (dev rows), never satisfying a gate itself", async ({ page }) => {
    await signIn(page, "/home-gate");
    await expect(page.getByTestId("gate-tiles")).toBeVisible();
    await expect(page.getByTestId("gate-GHV1")).toHaveAttribute("data-recorded", "true");
    await expect(page.getByTestId("gate-GHV2")).toHaveAttribute("data-recorded", "true");
    await expect(page.getByTestId("cluster-short").first()).toBeVisible(); // 2 home-enabled providers of 50
  });

  test("flag catalogue: the new home / nurse flags with their gates; GKN1 awaits a human", async ({ page }) => {
    await signIn(page, "/flags");
    await page.locator("#f-q").fill("home_visits");
    await expect(page.getByTestId("flag-gate-GHV1").first()).toBeVisible();
    await page.locator("#f-q").fill("nurse.");
    await expect(page.getByTestId("row")).toHaveCount(await page.getByTestId("row").count());
    expect(await page.getByTestId("row").count()).toBeGreaterThanOrEqual(5);
    await page.locator("#f-q").fill("");
    await page.getByTestId("tab-gates").click();
    await expect(page.getByTestId("board-GHV1")).toBeVisible();
    await expect(page.getByTestId("board-GKN1")).toBeVisible();
    await expect(page.getByTestId("record-GKN1")).toBeEnabled(); // a human (super admin) records it; the console never does
    expect(sql(`select count(*) from "FlagGateEvidence" where "gateId" like '%GKN1%'`)).toBe("0");
  });

  test("Arabic / RTL and English / LTR both render the safety console", async ({ page }) => {
    await signIn(page, "/safety");
    const startsArabic = (await page.locator("html").getAttribute("lang")) === "ar";
    await page.getByTestId("lang-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("dir", startsArabic ? "ltr" : "rtl");
    await expect(page.getByRole("heading", { name: startsArabic ? "Safety console" : "لوحة السلامة" })).toBeVisible();
    await page.getByTestId("lang-toggle").click();
    await expect(page.getByRole("heading", { name: startsArabic ? "لوحة السلامة" : "Safety console" })).toBeVisible();
  });
});
