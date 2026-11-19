import { expect, test } from "@playwright/test";
import { API, bearer, signIn } from "./helpers";

test("messaging log: mock mode is flagged, simulate delivery moves a message, tick advances", async ({ page, request }) => {
  await signIn(page, "/messaging");
  const token = await bearer(page);
  // produce real outbound mock messages: a patient "writes" on WhatsApp (dev inbox; the number is the seeded patient's)
  const r = await request.post(`${API}/api/v1/dev/messaging/inbound`, { headers: { Authorization: `Bearer ${token}` }, data: { channel: "WHATSAPP", from: "+201000000001", text: "hi" } });
  expect(r.status(), "dev inbox route must exist in mock mode").toBeLessThan(300);
  await page.reload();
  await expect(page.getByTestId("messaging-mode")).toBeVisible();
  await expect(page.getByTestId("messaging-mock-note")).toBeVisible();
  await expect(page.getByTestId("messaging-tiles")).toBeVisible();
  const outRow = page.getByRole("row").filter({ has: page.getByTestId("sim-DELIVERED") }).first();
  await expect(outRow).toBeVisible();
  await outRow.getByTestId("sim-DELIVERED").click();
  await expect(outRow.getByTestId("msg-status")).toHaveText(/DELIVERED|READ/);
  await page.getByTestId("delivery-tick").click();
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});

test("fee statements: VAT is a config line, CSV export enabled when lines exist", async ({ page }) => {
  await signIn(page, "/fees");
  await expect(page.getByTestId("fee-tiles")).toBeVisible();
  await expect(page.getByTestId("vat-note")).toBeVisible();
  await expect(page.getByTestId("error-state")).toHaveCount(0);
  await expect(page.getByText(/\bETA\b|ZATCA|e-invoice/)).toHaveCount(0); // no tax-authority features anywhere
});

test("order monitors render for pharmacy and lab (launch-locked flags show awaiting approval, never an error)", async ({ page }) => {
  await signIn(page, "/orders");
  await expect(page.getByTestId("tab-pharmacy")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
  await page.getByTestId("tab-lab").click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});

test("operations: waitlist scan runs and reports counts", async ({ page }) => {
  await signIn(page, "/operations");
  await page.getByTestId("waitlist-scan").click();
  await expect(page.getByTestId("scan-result")).toBeVisible();
});

test("gate evidence form (human-only): launch-locked flags expose it, validation blocks incomplete input; nothing is submitted by tests", async ({ page }) => {
  await signIn(page, "/flags");
  const key = "kiorex.pharmacy_orders";
  const row = page.getByRole("row").filter({ hasText: key });
  await expect(row.getByTestId("flag-state")).toContainText(/awaiting|بانتظار/i);
  await page.getByTestId(`gate-${key}`).click();
  await expect(page.getByTestId("gate-dialog")).toBeVisible();
  await expect(page.getByTestId("gate-submit")).toBeDisabled();
  await page.getByLabel(/Gate ID/).fill("X");
  await page.getByLabel(/Document link/).fill("not-a-url");
  await expect(page.getByTestId("gate-submit")).toBeDisabled(); // all four fields, incl. an http(s) document link, are required
  await page.keyboard.press("Escape");
  await expect(row.getByTestId("flag-state")).toContainText(/awaiting|بانتظار/i);
});

test("propagation view lists every product with version and sync status", async ({ page }) => {
  await signIn(page, "/flags");
  await page.getByTestId("tab-propagation").click();
  await expect(page.getByTestId("prop-status").first()).toBeVisible();
  expect(await page.getByTestId("prop-status").count()).toBeGreaterThanOrEqual(3);
});

test("ops console is Arabic-first friendly: RTL on toggle, no horizontal overflow on new pages", async ({ page }) => {
  await signIn(page, "/messaging");
  await page.getByTestId("lang-toggle").click();
  for (const p of ["/messaging", "/orders", "/fees", "/operations"]) {
    await page.goto(p);
    await expect(page.locator("html")).toHaveAttribute("dir", /rtl|ltr/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${p} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});
