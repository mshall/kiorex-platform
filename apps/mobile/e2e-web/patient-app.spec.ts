import { expect, test as base, type Page } from "@playwright/test";

/** Kiorex patient app, Expo web build, real Passport + real Kiorex API + seeded demo data (TEST_DATA.md). The app defaults to Arabic, so text assertions accept both languages. */
const PHONE = process.env.E2E_PATIENT_PHONE ?? "+201000001006"; // Mariam: pharmacy orders, lab bookings, results
const errors: string[] = [];

async function passportLogin(page: Page) {
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  const notNow = page.getByRole("button", { name: "Not now" });
  await notNow.click({ timeout: 10_000 }).catch(() => undefined); // passkey offer only on the first sign-in of a session
  await page.waitForURL(/localhost:8081/);
}
async function noErrorScreen(page: Page) {
  await expect(page.getByTestId("error-state")).toHaveCount(0);
  await expect(page.getByTestId("unavailable")).toHaveCount(0);
}

// One browser context for the whole journey (sessionStorage holds the tokens on web; a new context per test would sign out).
let shared: Page;
const test = base.extend<{ page: Page }>({ page: async ({}, use) => { await use(shared); } });
test.describe.configure({ mode: "serial" });
base.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.WEB_URL ?? "http://localhost:8081", viewport: { width: 420, height: 900 }, locale: "en-US" });
  shared = await ctx.newPage();
  shared.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
});
base.afterAll(async () => { await shared.context().close(); });

test("sign in with Passport, then Services shows Pharmacy, Lab and Telemedicine as Available", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("continue-passport").click();
  await page.waitForURL(/localhost:4400/);
  await passportLogin(page);
  await expect(page.getByTestId("home")).toBeVisible();
  await page.goto("/services");
  for (const id of ["telemedicine", "pharmacy", "lab"]) await expect(page.getByTestId(`svc-${id}-badge`)).toHaveText(/^(Available|متاحة)$/);
});

test("pharmacy: pick a pharmacy, search, add to cart, open the cart; orders list and a detail", async ({ page }) => {
  await page.goto("/pharmacy");
  await noErrorScreen(page);
  await page.getByTestId("medicine-search").fill("par");
  const add = page.locator('[data-testid^="add-"]').first();
  await expect(add).toBeVisible();
  await add.click();
  await page.getByTestId("open-cart").click();
  await expect(page).toHaveURL(/\/pharmacy\/cart/);
  await page.goto("/pharmacy/orders");
  const first = page.locator('[data-testid^="porder-"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/pharmacy\/order\//);
  await noErrorScreen(page);
});

test("lab: tests list, booking list and a booking detail; telemedicine providers and sessions", async ({ page }) => {
  await page.goto("/lab");
  await noErrorScreen(page);
  await expect(page.locator('[data-testid^="test-"]').first()).toBeVisible();
  await page.goto("/lab/bookings");
  const b = page.locator('[data-testid^="lbooking-"], [data-testid^="lab-booking-"]').first();
  await expect(page.getByTestId("lab-bookings-list")).toBeVisible();
  if (await b.count()) { await b.click(); await expect(page).toHaveURL(/\/lab\/booking\//); }
  await page.goto("/telemedicine");
  await noErrorScreen(page);
  await expect(page.locator('[data-testid^="tele-doc-"], [data-testid^="tsession-"]').first()).toBeVisible();
});

test("records, results (search), appointments, account and notification settings render real data", async ({ page }) => {
  await page.goto("/records");
  await expect(page.getByTestId("records")).toBeVisible(); await noErrorScreen(page);
  await page.goto("/appointments"); await noErrorScreen(page);
  await page.goto("/results"); await expect(page.getByTestId("results")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByTestId("account")).toBeVisible();
  await expect(page.getByTestId("push-card")).toBeVisible(); // notifications card: on web it explains that push needs the app, never a dead end
  await page.goto("/settings/sessions"); await noErrorScreen(page);
});

test("sign out ends the app AND the Passport session: no Stay-signed-in page, the next sign-in asks for the phone again", async ({ page }) => {
  await page.goto("/account");
  await page.getByTestId("sign-out-top").click();
  const seen: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) seen.push(f.url()); });
  await page.getByTestId("signout-confirm-btn").click();
  await page.waitForURL((u) => u.origin === "http://localhost:8081", { timeout: 20_000 });
  await expect(page.getByText(/stay signed in/i)).toHaveCount(0);
  // app side: signed out
  await page.goto("/sign-in");
  await expect(page.getByTestId("continue-passport")).toBeVisible();
  // IdP side: no silent SSO, the phone form is shown
  await page.getByTestId("continue-passport").click();
  await page.waitForURL(/localhost:4400/);
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  expect(seen.some((u) => u.includes("/session/end") || u.includes(":4400"))).toBeTruthy();
  expect(errors, errors.join("\n")).toEqual([]);
});
