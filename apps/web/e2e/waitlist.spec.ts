import { expect, test } from "@playwright/test";
import { API, apiHeaders, bearer, opsToken, signIn } from "./helpers";

/** BK-12 against the real stack: join from the no-slot state, ops scan creates a real offer, patient accepts → 5-minute hold → confirm. */
test("waitlist: join from no-slot state → offer in inbox → accept → hold → confirmed appointment", async ({ page, browser, request }) => {
  await signIn(page);
  const token = await bearer(page);
  const search = await request.get(`${API}/api/v1/search/providers`);
  const items = ((await search.json()) as { items: { id: string; nextSlots: unknown[] | null }[] }).items;
  test.skip(items.length === 0, "No providers synced into the real stack (start Kiorly :3010 and run the provider sync)");
  const providerId = items.find((i) => (i.nextSlots?.length ?? 0) > 0)?.id ?? items[0].id;

  // clean slate: leave any previous waitlist entries for this doctor
  const mine = (await (await request.get(`${API}/api/v1/waitlist`, { headers: apiHeaders(token) })).json()) as { id: string; providerId: string; status: string }[];
  for (const e of mine.filter((x) => x.providerId === providerId && ["WAITING", "OFFERED"].includes(x.status))) await request.delete(`${API}/api/v1/waitlist/${e.id}`, { headers: apiHeaders(token) });

  // The doctor really has slots; hide them in the browser only so the profile renders the no-slot state (the offer later comes from the REAL slots).
  await page.route(/\/api\/v1\/providers\/[^/]+\/slots/, async (route) => {
    const r = await route.fetch();
    const body = (await r.json()) as { slots: unknown[] };
    await route.fulfill({ response: r, json: { ...body, slots: [] } });
  });
  await page.goto(`/doctors/${providerId}`);
  await expect(page.getByTestId("no-slots")).toBeVisible();
  await page.getByTestId("waitlist-join-btn").click();
  await expect(page.getByTestId("waitlist-joined")).toBeVisible();

  // ops runs the autofill scan (real endpoint, real ops token)
  const ops = await opsToken(browser);
  const scan = await request.post(`${API}/api/v1/admin/waitlist/scan`, { headers: apiHeaders(ops) });
  expect(scan.ok()).toBeTruthy();
  expect(((await scan.json()) as { offersCreated: number }).offersCreated).toBeGreaterThanOrEqual(1);

  // offers inbox
  await page.unroute(/\/api\/v1\/providers\/[^/]+\/slots/);
  await page.goto("/waitlist");
  await expect(page.getByTestId("offers-inbox")).toBeVisible();
  await expect(page.getByTestId("waitlist-offer").first()).toBeVisible();
  await page.getByTestId("offer-accept").first().click();

  // accept → the normal 5-minute hold → checkout → confirm
  await expect(page).toHaveURL(/\/checkout\//);
  await expect(page.getByTestId("hold-countdown")).toContainText(/0[0-5]:\d\d/);
  await page.getByTestId("consent-data").click();
  await page.getByTestId("confirm-booking").click();
  await expect(page).toHaveURL(/\/appointments\//);
  await expect(page.getByTestId("appt-status")).toBeVisible();

  // clean up: cancel the booking so the doctor's slot is released
  const id = page.url().split("/").pop()!;
  await request.post(`${API}/api/v1/bookings/${id}/cancel`, { headers: apiHeaders(token), data: { reason: "e2e cleanup" } });
});

test("waitlist page: empty state and Arabic RTL", async ({ page }) => {
  await signIn(page, "/waitlist");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});
