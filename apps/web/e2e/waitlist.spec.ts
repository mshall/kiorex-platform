import { expect, test } from "@playwright/test";
import { API, apiHeaders, bearer, signIn } from "./helpers";

/** BK-12 against the real stack: a doctor with open slots refuses the waitlist (409 SLOTS_AVAILABLE) and the UI offers to book directly.
 *  The offer → accept → hold path needs a doctor with NO slots that later frees one; the dev Kiorly seed has none, so that path is covered by unit tests. */
test("waitlist: joining a doctor with open slots shows 'book directly' with real slots", async ({ page, request }) => {
  await signIn(page);
  const items = ((await (await request.get(`${API}/api/v1/search/providers`)).json()) as { items: { id: string; nextSlots: unknown[] | null }[] }).items;
  const withSlots = items.find((i) => (i.nextSlots?.length ?? 0) > 0);
  test.skip(!withSlots, "No provider with open slots on the real stack (start Kiorly :3010 and run the provider sync)");
  const token = await bearer(page);
  const mine = (await (await request.get(`${API}/api/v1/waitlist`, { headers: apiHeaders(token) })).json()) as { id: string; providerId: string }[];
  for (const e of mine.filter((x) => x.providerId === withSlots!.id)) await request.delete(`${API}/api/v1/waitlist/${e.id}`, { headers: apiHeaders(token) });
  // force the profile's no-slot rendering in the browser only; the join call itself is real
  await page.route(/\/api\/v1\/providers\/[^/]+\/slots/, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...((await r.json()) as object), slots: [] } }); });
  await page.goto(`/doctors/${withSlots!.id}`);
  await expect(page.getByTestId("no-slots")).toBeVisible();
  await page.getByTestId("waitlist-join-btn").click();
  await expect(page.getByTestId("waitlist-slots-available")).toBeVisible();
  await expect(page.getByTestId("book-directly")).toBeVisible();
  const after = (await (await request.get(`${API}/api/v1/waitlist`, { headers: apiHeaders(token) })).json()) as { providerId: string }[];
  expect(after.some((e) => e.providerId === withSlots!.id)).toBe(false); // nothing was joined
});

test("waitlist page: empty state and Arabic RTL", async ({ page }) => {
  await signIn(page, "/waitlist");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("error-state")).toHaveCount(0);
});
