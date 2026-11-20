import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { apiHeaders, bearer, opsToken, payFakeDeposit, signIn } from "../helpers";

const API = "http://localhost:4001";
const PSQL = process.env.PSQL ?? "/Users/postgres/bin/psql";
const sql = (q: string) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "kiorex_e2e_home", "-tAc", q], { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }).trim();
const STREET = "12 Secret Street E2E-4417";

/** Kiorly -> Kiorex outbox event, HMAC-signed exactly like Kiorly Clinic (contracts 1.5.0 home events). */
async function kiorlyEvent(page: Page, type: string, data: Record<string, unknown>) {
  const eventId = randomUUID();
  const body = JSON.stringify({ eventId, type, aggregateType: "Appointment", aggregateId: String(data.appointmentId ?? "apt_1"), target: "KIOREX", occurredAt: new Date().toISOString(), data });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `sha256=${createHmac("sha256", "kx_dev_webhook_secret").update(`${ts}.${body}`).digest("hex")}`;
  const r = await page.request.post(`${API}/api/v1/webhooks/kiorly`, { data: body, headers: { "content-type": "application/json", "x-kiorly-event": type, "x-kiorly-event-id": eventId, "x-kiorly-timestamp": ts, "x-kiorly-signature": sig } });
  expect(r.status(), type).toBeLessThan(300);
}
const bookingRef = (bookingId: string) => ({ appointmentId: sql(`select "kiorlyAppointmentId" from "BookingIntent" where id='${bookingId}'`), clinicId: "cl_nurse", externalReference: bookingId, serviceLocation: "HOME" });
let bookingId = "";
let shareLink = "";

/** The shared dev web server on :5180 proxies to the dev API on :4000; this suite targets the isolated API on :4001 by re-pointing the browser's /api calls at the network layer (still the real API, nothing is mocked). */
const toIsolatedApi = (ctx: BrowserContext) => ctx.route("http://localhost:5180/api/**", (route) => route.continue({ url: route.request().url().replace("http://localhost:5180", API) }));

test.beforeEach(async ({ page }) => {
  await toIsolatedApi(page.context());
  await signIn(page, "/");
  const t = await bearer(page);
  await page.request.put(`${API}/api/v1/me/profile`, { headers: apiHeaders(t), data: { nameEn: "Amira Samy" } });
  await page.request.put(`${API}/api/v1/me/consents/MARKETPLACE_PROCESSING`, { headers: apiHeaders(t), data: { granted: true } });
  await page.request.put(`${API}/api/v1/me/consents/REMINDERS`, { headers: apiHeaders(t), data: { granted: true } });
  await page.request.post(`${API}/api/v1/admin/providers/sync`, { headers: apiHeaders(await opsToken(page.context().browser()!)) }).catch(() => undefined);
});

test.describe.serial("Rev 2.3 home visits, patient web", () => {
  test("care-type categories on the home page; physiotherapy is unlocked by its dev gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("care-DOCTORS")).toBeVisible();
    await expect(page.getByTestId("care-PHYSIOTHERAPY")).not.toHaveAttribute("data-locked", "true");
    await expect(page.getByTestId("care-HOME_NURSING")).toBeVisible();
    await page.getByTestId("care-HOME_NURSING").click();
    await expect(page).toHaveURL(/careType=HOME_NURSING/);
  });

  test("specialty codes are shown as proper labels, never raw snake_case", async ({ page }) => {
    await page.goto("/search?careType=DOCTORS");
    await expect(page.getByTestId("doctor-card").first()).toBeVisible();
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/family_medicine|physio_therapy|obstetrics_gynecology/);
    await expect(page.getByTestId("doctor-card").filter({ hasText: "طب الأسرة" })).toHaveCount(1);
  });

  test("address book: add (masked), confirm, edit, delete", async ({ page }) => {
    const t = await bearer(page);
    for (const a of (await (await page.request.get(`${API}/api/v1/me/addresses`, { headers: apiHeaders(t) })).json()) as { id: string }[]) await page.request.delete(`${API}/api/v1/me/addresses/${a.id}`, { headers: apiHeaders(t) }); // re-runnable
    await page.goto("/account/addresses");
    for (const [label, district] of [["المنزل", "maadi"], ["العمل", "zamalek"]] as const) {
      await page.getByTestId("add-address").click();
      await page.getByTestId("addr-label").fill(label);
      await page.getByTestId("addr-governorate").fill("cairo");
      await page.getByTestId("addr-district").fill(district);
      await page.getByTestId("addr-street").fill(STREET);
      await page.getByTestId("addr-building").fill("7");
      await page.getByTestId("save-address").click();
      await expect(page.getByTestId("address-row").filter({ hasText: label })).toBeVisible();
    }
    const home = page.getByTestId("address-row").filter({ hasText: "المنزل" });
    await expect(home.getByTestId("address-lines")).toHaveText("••••••••");
    await expect(page.locator("main")).not.toContainText(STREET);
    await home.getByTestId("reveal-address").click();
    await expect(home.getByTestId("address-lines")).toContainText(STREET);
    await home.getByTestId("confirm-address").click();
    await expect(home.getByTestId("confirm-address")).toHaveCount(0);
    await home.getByTestId("edit-address").click();
    await page.getByTestId("addr-label").fill("بيتي");
    await page.getByTestId("save-address").click();
    await expect(page.getByTestId("address-row").filter({ hasText: "بيتي" })).toBeVisible();
    const work = page.getByTestId("address-row").filter({ hasText: "العمل" });
    await work.getByTestId("delete-address").click();
    await page.getByTestId("confirm-delete-address").click();
    await expect(page.getByTestId("address-row")).toHaveCount(1);
    await page.getByTestId("add-address").click(); // keep an uncovered-district address for the coverage check
    await page.getByTestId("addr-label").fill("زمالك");
    await page.getByTestId("addr-governorate").fill("cairo");
    await page.getByTestId("addr-district").fill("zamalek");
    await page.getByTestId("addr-street").fill("1 Nile St");
    await page.getByTestId("save-address").click();
    await expect(page.getByTestId("address-row")).toHaveCount(2);
  });

  test("home search by district; OUT_OF_COVERAGE message on an uncovered address", async ({ page }) => {
    await page.goto("/search?careType=HOME_NURSING&serviceLocation=HOME");
    await expect(page.getByTestId("district-select")).toBeVisible();
    await page.getByTestId("district-select").selectOption("maadi");
    await expect(page.getByTestId("doctor-card").filter({ hasText: "النيل للتمريض" })).toBeVisible();
    await expect(page.getByTestId("home-badge").first()).toBeVisible();
    await expect(page.getByTestId("profession-badge").first()).toBeVisible();
    await page.getByTestId("doctor-card").filter({ hasText: "النيل للتمريض" }).getByRole("link").first().click();
    await expect(page.getByTestId("agency-note")).toBeVisible();
    await page.getByTestId("loc-home").click();
    await page.getByTestId("address-option").filter({ hasText: "زمالك" }).click();
    await expect(page.getByTestId("out-of-coverage")).toBeVisible();
    await expect(page.getByTestId("continue-booking")).toBeDisabled();
    // the API enforces it too (422 OUT_OF_COVERAGE), not just the UI
    const t = await bearer(page);
    const addrs = (await (await page.request.get(`${API}/api/v1/me/addresses`, { headers: apiHeaders(t) })).json()) as { id: string; district: string }[];
    const z = addrs.find((a) => a.district === "zamalek")!;
    const r = await page.request.post(`${API}/api/v1/bookings`, { headers: apiHeaders(t), data: { providerId: "lst_nurse", typeId: "typ_home", startsAt: new Date(Date.now() + 72 * 3600_000).toISOString(), serviceLocation: "HOME", addressId: z.id } });
    expect(r.status()).toBe(422);
    expect((await r.json()).code).toBe("OUT_OF_COVERAGE");
  });

  test("book a home visit: address, fee with surcharge, deposit, confirm", async ({ page }) => {
    await page.goto("/doctors/lst_nurse?loc=home");
    await page.getByTestId("address-option").filter({ hasText: "بيتي" }).click();
    await expect(page.getByTestId("home-surcharge")).toBeVisible();
    await page.getByTestId("slot-calendar").getByTestId("slot-button").first().click();
    await page.getByTestId("continue-booking").click();
    await expect(page).toHaveURL(/\/checkout\//);
    bookingId = page.url().split("/").pop()!;
    await expect(page.getByTestId("checkout-home")).toBeVisible();
    await expect(page.getByTestId("fee-surcharge")).toBeVisible();
    await expect(page.getByTestId("fee-total")).toContainText(/٢٥٠|250/);
    await expect(page.getByTestId("visit-district")).toContainText("maadi");
    await expect(page.getByTestId("address-lines")).toHaveText("••••••••");
    await expect(page.getByTestId("deposit-panel")).toBeVisible();
    await page.getByTestId("consent-data").click();
    await page.getByTestId("confirm-booking").click();
    await expect(page).toHaveURL(/\/appointments\//);
    await expect(page.getByTestId("appt-home")).toBeVisible();
    await expect(page.getByTestId("assignment-pending")).toBeVisible(); // agency listing: nurse assigned after booking
    await expect(page.getByTestId("home-fee")).toBeVisible();
    if (await page.getByTestId("pay-deposit-link").isVisible()) await payFakeDeposit(page);
  });

  test("timeline: assigned -> en route (ETA) -> safety card, report a problem, family share (WhatsApp mock consent)", async ({ page }) => {
    await page.goto(`/appointments/${bookingId}`);
    const ref = bookingRef(bookingId);
    await kiorlyEvent(page, "HOME_VISIT_ASSIGNED", { ...ref, assignee: { clinicianId: "clin_9", displayName: "Nurse Mona Adel", photoUrl: null, badge: "Verified nurse", profession: "NURSE" }, assignedAt: new Date().toISOString() });
    await expect(page.getByTestId("assignee")).toContainText("Nurse Mona Adel", { timeout: 20_000 });
    await expect(page.getByTestId("safety-name")).toContainText("Nurse Mona Adel");
    await kiorlyEvent(page, "HOME_VISIT_EN_ROUTE", { ...ref, enRouteAt: new Date().toISOString(), etaMinutes: 12 });
    await expect(page.getByTestId("en-route")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("eta")).toContainText("12");
    await expect(page.getByTestId("emergency-call")).toHaveAttribute("href", "tel:123");

    const complaints = () => Number(sql(`select count(*) from "Complaint" where category='HOME_CONDUCT'`));
    const before = complaints();
    await page.getByTestId("report-problem").click();
    await page.getByTestId("problem-category").selectOption("CONDUCT");
    await page.getByTestId("problem-body").fill("E2E report");
    await page.getByTestId("submit-problem").click();
    await expect(page.getByTestId("submit-problem")).toHaveCount(0);
    expect(complaints()).toBe(before + 1);

    await expect(page.getByTestId("share-submit")).toBeDisabled();
    await page.getByTestId("share-name").fill("Sara");
    await page.getByTestId("share-phone").fill("+201001234567");
    await page.getByTestId("share-attest").click();
    await page.getByTestId("share-consent").click();
    await page.getByTestId("share-submit").click();
    const link = page.getByTestId("share-link");
    await expect(link).toBeVisible();
    shareLink = (await link.locator("p.break-all").innerText()).trim();
    expect(shareLink).toMatch(/\/visit-status\//);
    await expect(page.getByTestId("share-row")).toContainText("Sara");

    // the family member opens the link WITHOUT logging in: status only, no address/fee/phone
    const anon = await page.context().browser()!.newContext({ baseURL: "http://localhost:5180", locale: "ar-EG" });
    await toIsolatedApi(anon);
    const fam = await anon.newPage();
    await fam.goto(new URL(shareLink).pathname);
    await expect(fam.getByTestId("family-steps")).toBeVisible();
    await expect(fam.getByTestId("family-eta")).toContainText("12");
    const txt = await fam.locator("main").innerText();
    expect(txt).not.toContain(STREET);
    expect(txt).not.toMatch(/EGP|ج\.م|\+20100/);
    await fam.getByTestId("family-stop").click();
    await expect(fam.getByTestId("family-stopped").or(fam.getByTestId("empty-state"))).toBeVisible({ timeout: 20_000 });
    await anon.close();
  });

  test("aborted-unsafe: patient sees the notice, the deposit is held for review, a safety alert reaches ops", async ({ page }) => {
    await page.goto(`/appointments/${bookingId}`);
    const ref = bookingRef(bookingId);
    await kiorlyEvent(page, "SAFETY_ALERT_RAISED", { alertId: "al_e2e_1", clinicId: "cl_nurse", appointmentId: ref.appointmentId, externalReference: bookingId, kind: "SOS", raisedAt: new Date().toISOString(), deliverTo: ["ORG_SAFETY_CONTACT", "KIOREX_OPS"], deliverWithinSeconds: 60, district: "maadi" });
    await kiorlyEvent(page, "HOME_VISIT_ABORTED_UNSAFE", { ...ref, abortedAt: new Date().toISOString(), reasonCategory: "UNSAFE_ENVIRONMENT", noShow: false, depositAction: "HOLD_FOR_REVIEW", district: "maadi" });
    await expect(page.getByTestId("aborted-unsafe")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("deposit-review").first()).toBeVisible();
  });

  test("care plans stay awaiting-gate (GKN1 unrecorded) and kiorex.home_visits OFF shows the unavailable state", async ({ page, browser }) => {
    await page.goto("/care-plans");
    await expect(page.getByTestId("plan-provider").locator("option")).not.toHaveCount(1); // nurse listing + the physio loaded
    await page.getByTestId("plan-provider").selectOption({ index: 1 });
    await page.getByTestId("plan-address").selectOption({ index: 1 });
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("feature-unavailable")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("feature-unavailable")).toHaveAttribute("data-awaiting", "true");

    const ops = await opsToken(browser);
    const flag = (value: "ON" | "OFF") => page.request.put(`${API}/api/v1/admin/flags/kiorex.home_visits/values`, { headers: apiHeaders(ops), data: { scope: "GLOBAL", value, reason: "e2e launch-lock check", ticket: "E2E-1", ...(value === "OFF" ? { emergency: true } : {}) } }); // money-path OFF needs a 2nd approver, or the audited emergency kill
    expect((await flag("OFF")).status()).toBeLessThan(300);
    try {
      await page.goto("/doctors/lst_nurse?loc=home");
      await expect(page.getByTestId("feature-unavailable")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("continue-booking")).toBeDisabled();
      // existing booking stays readable
      await page.goto(`/appointments/${bookingId}`);
      await expect(page.getByTestId("appt-home")).toBeVisible();
    } finally {
      expect((await flag("ON")).status()).toBeLessThan(300);
    }
  });

  test("English / LTR layout renders the home screens", async ({ page }) => {
    await page.goto("/account/addresses");
    await page.getByTestId("lang-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { name: "My addresses" })).toBeVisible();
    await page.goto("/search?careType=HOME_NURSING&serviceLocation=HOME");
    await expect(page.getByTestId("care-HOME_NURSING")).toContainText("Home nursing");
    await page.getByTestId("lang-toggle").click();
  });
});
