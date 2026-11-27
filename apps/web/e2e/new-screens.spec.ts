import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signIn } from "./helpers";
import { mockAwaitingGate } from "./fixtures";

const shots = "e2e/screenshots";
mkdirSync(shots, { recursive: true });
const noOverflow = async (page: Page, where: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${where} overflows horizontally`).toBeLessThanOrEqual(1);

const PAGES = ["/services", "/waitlist", "/records", "/records?tab=sharing", "/records?tab=prescriptions", "/records?tab=followups", "/pharmacy", "/pharmacy/orders", "/lab", "/lab/bookings", "/telemedicine"];

/** Launch-locked verticals (pharmacy, lab, telemedicine) are AWAITING_GATE on the real stack until a human records gate evidence. */
test("launch-locked verticals show 'awaiting approval' (Arabic), never a crash, and existing history stays reachable", async ({ page }) => {
  await mockAwaitingGate(page); // DEV fixture: independent of whether gate evidence is currently recorded in the seed
  await signIn(page, "/pharmacy");
  const locked = page.getByTestId("feature-unavailable").first();
  await expect(locked).toBeVisible();
  await expect(locked).toHaveAttribute("data-awaiting", "true");
  await expect(locked).toContainText("بانتظار الاعتماد");
  await expect(page.getByTestId("my-orders-link")).toBeVisible();
  await page.goto("/lab");
  await expect(page.getByTestId("feature-unavailable").first()).toContainText("بانتظار الاعتماد");
  await page.goto("/telemedicine");
  await expect(page.getByTestId("feature-unavailable").first()).toContainText("بانتظار الاعتماد");
  await page.goto("/pharmacy/orders");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});

test("services hub, market selector, WhatsApp entry point and booking channel badges", async ({ page }) => {
  await mockAwaitingGate(page);
  await signIn(page, "/services");
  await expect(page.getByTestId("svc-pharmacy")).toBeVisible();
  await expect(page.getByTestId("svc-locked").first()).toBeVisible();
  await expect(page.getByTestId("whatsapp-card")).toBeVisible();
  // one market live (Egypt): the country selector is hidden by founder decision (23 Nov 2026); the API stays multi-market
  await expect(page.getByTestId("market-select")).toHaveCount(0);
  await expect(page.getByTestId("market-not-live")).toHaveCount(0);
  await page.goto("/appointments");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});

test("client analytics posts only whitelisted events to /analytics/events", async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route("**/api/v1/analytics/events", async (route) => { bodies.push(route.request().postDataJSON()); await route.continue(); });
  await signIn(page, "/search?specialty=dermatology");
  await page.getByTestId("result-count").waitFor();
  await page.goto("/records"); // vault_opened
  await page.waitForTimeout(2500); // batch flush
  await page.goto("/services"); // pagehide flush of anything pending
  const events = (bodies as { events: { name: string; props?: Record<string, string> }[] }[]).flatMap((b) => b.events);
  expect(events.length).toBeGreaterThan(0);
  const allowed = new Set(["search_started", "results_viewed", "slot_viewed", "booking_started", "booking_failed", "review_submitted", "waitlist_joined", "vault_opened", "whatsapp_link_clicked"]);
  for (const e of events) { expect(allowed.has(e.name)).toBe(true); for (const k of Object.keys(e.props ?? {})) expect(["specialtyCode", "providerId", "market", "code"]).toContain(k); }
  expect(events.some((e) => e.name === "vault_opened")).toBe(true);
});

for (const mode of ["light", "dark"] as const) {
  test(`new screens: Arabic RTL, ${mode} mode, no overflow, no error state, screenshots`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: mode });
    await signIn(page, "/services");
    await page.evaluate((m) => { try { localStorage.setItem("kx-theme", m); } catch { /* ignore */ } document.documentElement.classList.toggle("dark", m === "dark"); }, mode);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByTestId("error-state"), `${path} shows an error state`).toHaveCount(0);
      if (await page.getByRole("tabpanel").count()) expect(await page.evaluate(() => getComputedStyle(document.querySelector("[role=tabpanel]")!).direction), `${path}: tab content must stay RTL`).toBe("rtl");
      await noOverflow(page, path);
      await page.screenshot({ path: `${shots}/${info.project.name}-${mode}${path.replace(/[/?=&]/g, "_")}.png`, fullPage: true });
    }
  });
}
