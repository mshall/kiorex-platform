import { test } from "@playwright/test";
import { signIn, bearer, apiHeaders } from "../helpers";

/** Not an assertion suite: refreshes the README screenshots (dark + mobile) of the home screens. Run after home.spec.ts: npx playwright test -c playwright.home.config.ts shots */
const API = "http://localhost:4001";
test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem("kx-theme", "dark"); } catch { /* ignore */ } }); }); // light is the default: dark is an explicit stored choice
test("screenshots", async ({ page }) => {
  await page.context().route("http://localhost:5180/api/**", (r) => r.continue({ url: r.request().url().replace("http://localhost:5180", API) }));
  await signIn(page, "/");
  const t = await bearer(page);
  const b = (await (await page.request.get(`${API}/api/v1/bookings`, { headers: apiHeaders(t) })).json()) as { id: string; serviceLocation: string }[];
  const home = b.find((x) => x.serviceLocation === "HOME");
  const shots: [string, string][] = [["/account/addresses", "addresses"], ["/doctors/lst_nurse?loc=home", "home-profile"], ["/search?careType=HOME_NURSING&serviceLocation=HOME&district=maadi", "home-search"], ...(home ? [[`/appointments/${home.id}`, "home-appointment"] as [string, string]] : [])];
  for (const [u, n] of shots) { await page.goto(u); await page.waitForTimeout(1200); await page.screenshot({ path: `e2e/screenshots/home-${n}.png`, fullPage: true }); }
});
