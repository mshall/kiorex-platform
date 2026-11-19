import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { apiHeaders, bearer, opsToken, signIn } from "../helpers";

const API = "http://localhost:4001";
const PSQL = process.env.PSQL ?? "/Users/postgres/bin/psql";
const sql = (q: string) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_e2e_verticals", "-tAc", q], { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" });

/** Partner → Kiorex outbox webhook, signed with the partner's secret (same scheme as Kiorly Clinic). */
async function partnerEvent(page: Page, partner: "pharmacy" | "lab", type: string, data: Record<string, unknown>) {
  const secret = partner === "pharmacy" ? "kx_dev_pharmacy_webhook_secret" : "kx_dev_lab_webhook_secret";
  const eventId = randomUUID();
  const body = JSON.stringify({ eventId, type, aggregateType: partner === "pharmacy" ? "PharmacyOrder" : "LabReport", aggregateId: String(data.orderId), target: "KIOREX", occurredAt: new Date().toISOString(), data });
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await page.request.post(`${API}/api/v1/webhooks/${partner}`, { data: body, headers: { "content-type": "application/json", "x-kiorly-event": type, "x-kiorly-event-id": eventId, "x-kiorly-timestamp": ts, "x-kiorly-signature": `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}` } });
  expect(r.status(), `${type} webhook`).toBeLessThan(300);
}
const paySandbox = async (page: Page) => {
  const href = await page.getByTestId("pay-link").getAttribute("href");
  const p = await page.context().newPage();
  await p.goto(href!); await p.locator('button[value="pay"]').click(); await p.waitForLoadState("networkidle"); await p.close();
};

test.beforeEach(async ({ page }) => {
  await signIn(page, "/");
  const t = await bearer(page);
  // profile name + marketplace consent are prerequisites for orders (same as the API tests)
  await page.request.put(`${API}/api/v1/me/profile`, { headers: apiHeaders(t), data: { nameEn: "Amira Samy" } });
  await page.request.put(`${API}/api/v1/me/consents/MARKETPLACE_PROCESSING`, { headers: apiHeaders(t), data: { granted: true } });
});

test("flags are effective on this isolated stack (fixture gate rows) and the services hub shows them as available", async ({ page }) => {
  await page.goto("/services");
  await expect(page.getByTestId("svc-pharmacy")).toBeVisible();
  await expect(page.getByTestId("svc-locked")).toHaveCount(0);
});

test.describe.serial("pharmacy order journey", () => {
  test("search → cart → pickup → order → Kiorex Pay sandbox → ready → dispensed", async ({ page }) => {
    await page.goto("/pharmacy");
    await expect(page.getByTestId("mock-notice").first()).toBeVisible(); // partner is a test double: said honestly
    await page.getByTestId("pharmacy-option").first().click();
    await page.getByTestId("medicine-search").fill("para");
    await page.getByTestId("medicine-search-submit").click();
    await page.getByTestId("add-to-cart").first().click();
    await expect(page.getByTestId("cart-line").first()).toBeVisible();
    await page.getByTestId("cart").getByRole("radio", { name: /^(استلام|Pickup)/ }).click();
    await expect(page.getByTestId("place-order")).toBeEnabled();
    await page.getByTestId("place-order").click();
    await expect(page).toHaveURL(/\/pharmacy\/orders\//);
    await expect(page.getByTestId("order-status")).toContainText(/بانتظار الدفع|Awaiting payment/);
    await expect(page.getByTestId("mock-notice")).toHaveAttribute("data-kind", "payment");
    const orderId = page.url().split("/").pop()!;
    await paySandbox(page);
    await expect(page.getByTestId("order-status")).toContainText(/تم الدفع|أُرسل إلى الصيدلية|Paid|Sent to pharmacy/, { timeout: 30_000 });
    await partnerEvent(page, "pharmacy", "OrderReady", { orderId, pharmacistSignoff: { userId: "ph-user-1" }, readyAt: new Date().toISOString() });
    await expect(page.getByTestId("order-status")).toContainText(/جاهز|Ready/, { timeout: 15_000 });
    await partnerEvent(page, "pharmacy", "DispenseCompleted", { orderId, pharmacistSignoff: { userId: "ph-user-1" }, dispensedAt: new Date().toISOString() });
    await expect(page.getByTestId("order-status")).toContainText(/تم الاستلام|Collected/, { timeout: 15_000 });
    // the ops monitor shows the platform fee for it
    const ops = await opsToken(page.context().browser()!);
    const list = (await (await page.request.get(`${API}/api/v1/admin/pharmacy/orders`, { headers: apiHeaders(ops) })).json()) as { id: string; platformFeeMinor: number }[];
    expect(list.find((o) => o.id === orderId)?.platformFeeMinor).toBeGreaterThan(0);
  });

  test("rejected by the pharmacy → rejected state with automatic refund note; then cancel flow on a second order", async ({ page }) => {
    const make = async () => {
      await page.goto("/pharmacy");
      await page.getByTestId("pharmacy-option").first().click();
      await page.getByTestId("medicine-search").fill("para");
      await page.getByTestId("medicine-search-submit").click();
      await page.getByTestId("add-to-cart").first().click();
      await expect(page.getByTestId("cart-line").first()).toBeVisible();
      await page.getByTestId("cart").getByRole("radio", { name: /^(استلام|Pickup)/ }).click();
      await page.getByTestId("place-order").click();
      await expect(page).toHaveURL(/\/pharmacy\/orders\//);
      return page.url().split("/").pop()!;
    };
    const rejected = await make();
    await paySandbox(page);
    await expect(page.getByTestId("order-status")).toContainText(/تم الدفع|أُرسل|Paid|Sent/, { timeout: 30_000 });
    await partnerEvent(page, "pharmacy", "OrderRejected", { orderId: rejected, reasonCode: "OUT_OF_STOCK" });
    await expect(page.getByTestId("order-rejected")).toContainText("OUT_OF_STOCK", { timeout: 15_000 });
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);

    await make(); // unpaid order → cancel
    await page.getByTestId("cancel-order").click();
    await page.getByTestId("confirm-cancel-order").click();
    await expect(page.getByTestId("order-status")).toContainText(/ملغى|Cancelled/);
  });
});

test("lab: search → home collection slot → book → pay → result delivered into the vault", async ({ page }) => {
  const t = await bearer(page);
  await page.request.put(`${API}/api/v1/me/record-sharing/LAB_RESULTS`, { headers: apiHeaders(t), data: { granted: true } });
  await page.goto("/lab");
  await page.getByTestId("lab-search").fill("blood");
  await page.getByTestId("lab-search").press("Enter");
  await page.getByTestId("lab-test").first().getByRole("checkbox").click();
  await page.getByTestId("collect-home").click();
  await page.getByTestId("lab-slot").first().click();
  await page.getByLabel(/العنوان|Address/).fill("1 Nile St");
  await page.getByTestId("lab-book").click();
  await expect(page).toHaveURL(/\/lab\/bookings\//);
  const id = page.url().split("/").pop()!;
  await paySandbox(page);
  await expect(page.getByTestId("lab-status")).toContainText(/تم الدفع|أُرسل|Paid|Sent/, { timeout: 30_000 });
  await partnerEvent(page, "lab", "LabResultReleased", { reportId: `rep_${Date.now()}`, orderId: id, labId: "lab_1", patientRef: "x", reportVersion: 1, signedAt: new Date().toISOString(), secureLink: "https://lab.invalid/report/abc", channels: ["KIOREX_VAULT"] });
  await expect(page.getByTestId("lab-result-ready")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("lab-result-link").click();
  await expect(page).toHaveURL(/\/records\//);
  await expect(page.getByTestId("record-content")).toBeVisible();
});

test("telemedicine: create session for a confirmed booking → join mock room → end", async ({ page, browser }) => {
  const t = await bearer(page);
  const ops = await opsToken(browser);
  await page.request.post(`${API}/api/v1/admin/providers/sync?full=true`, { headers: apiHeaders(ops) });
  const list = (await (await page.request.get(`${API}/api/v1/search/providers`)).json()) as { items: { id: string; defaultTypeId: string; nextSlots: { startsAt: string; endsAt: string }[] }[] };
  const candidates = list.items.flatMap((i) => (i.nextSlots ?? []).map((sl) => ({ providerId: i.id, typeId: i.defaultTypeId, slot: sl })));
  test.skip(candidates.length === 0, "No provider with slots (Kiorly :3010 down or not synced)");
  let booking: { id: string } | undefined;
  for (const c of candidates) { // earlier runs may have left a slot held/taken: try the next one
    const hold = await page.request.post(`${API}/api/v1/bookings`, { headers: apiHeaders(t), data: { providerId: c.providerId, typeId: c.typeId, startsAt: c.slot.startsAt, endsAt: c.slot.endsAt } });
    if (hold.ok()) { booking = (await hold.json()) as { id: string }; break; }
  }
  expect(booking, "could not hold any slot").toBeTruthy();
  booking = booking!;
  const conf = await page.request.post(`${API}/api/v1/bookings/${booking!.id}/confirm`, { headers: apiHeaders(t), data: { marketplaceConsent: true, remindersConsent: true } });
  expect(conf.ok()).toBeTruthy();
  await expect.poll(async () => ((await (await page.request.get(`${API}/api/v1/bookings/${booking!.id}`, { headers: apiHeaders(t) })).json()) as { status: string }).status, { timeout: 30_000 }).toBe("CONFIRMED");

  await page.goto("/telemedicine");
  await page.getByTestId("tele-eligible").waitFor();
  await page.getByTestId("tele-create").first().click();
  await expect(page.getByTestId("tele-session-row").first()).toBeVisible();
  const sessions = (await (await page.request.get(`${API}/api/v1/telemedicine/sessions`, { headers: apiHeaders(t) })).json()) as { id: string; bookingId: string }[];
  const sid = sessions.find((x) => x.bookingId === booking!.id)!.id;
  await page.goto(`/telemedicine/${sid}`);
  await expect(page.getByTestId("tele-countdown")).toBeVisible(); // the room is not open yet (opens 15 min before)
  await expect(page.getByTestId("tele-join-disabled")).toBeVisible();

  // test fixture on the throwaway DB: move the visit to "now" so the join window is open
  sql(`UPDATE "TeleSession" SET "scheduledStartsAt" = (now() AT TIME ZONE 'UTC') WHERE "bookingId" = '${booking!.id}'`);
  await page.reload();
  await page.getByTestId("tele-join").click();
  await expect(page.getByTestId("tele-room")).toBeVisible();
  await expect(page.getByTestId("mock-notice")).toHaveAttribute("data-kind", "video");
  await page.getByTestId("tele-mic").click();
  await expect(page.getByTestId("tele-mic")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("tele-end").click();
  await expect(page.getByTestId("tele-status")).toContainText(/انتهت|Ended/);
  await page.request.post(`${API}/api/v1/bookings/${booking!.id}/cancel`, { headers: apiHeaders(t), data: { reason: "e2e cleanup" } });
});
