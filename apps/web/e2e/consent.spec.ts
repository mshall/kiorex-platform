import { expect, test, type Page, type Request } from "@playwright/test";
import { signIn } from "./helpers";

/** GRW-P1-I against the real Kiorex API: the privacy banner and the preference centre. These tests start with NO stored choice (the other suites start with a stored reject). */
test.use({ storageState: { cookies: [], origins: [] } });

const touches = (page: Page) => { const seen: Request[] = []; page.on("request", (r) => { if (r.url().includes("/api/v1/growth/v1/touch")) seen.push(r); }); return seen; };
const kxv = async (page: Page) => (await page.context().cookies()).filter((c) => c.name === "kxv");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("kx-consent") ?? "null") as null | { analytics: boolean; marketing: boolean; textVersion: string; consentId: string | null });

test("first visit: banner shows, nothing is sent or stored before a choice; Accept and Reject carry equal weight; no kxv cookie", async ({ page }) => {
  const seen = touches(page);
  await page.goto("/");
  const banner = page.getByTestId("consent-banner");
  await expect(banner).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl"); // Arabic first
  await expect(page.locator("html")).not.toHaveClass(/dark/); // light by default
  const [a, r] = [await page.getByTestId("consent-accept").boundingBox(), await page.getByTestId("consent-reject").boundingBox()];
  expect(Math.abs(a!.width - r!.width)).toBeLessThanOrEqual(1); expect(Math.abs(a!.height - r!.height)).toBeLessThanOrEqual(1);
  expect(await page.getByTestId("consent-accept").getAttribute("class")).toBe(await page.getByTestId("consent-reject").getAttribute("class")); // identical styling: neither answer is steered
  await page.waitForTimeout(2500); // longer than the touch delay
  expect(seen).toHaveLength(0); expect(await kxv(page)).toHaveLength(0); expect(await stored(page)).toBeNull();
  await page.screenshot({ path: "e2e/screenshots/consent-banner-ar.png" });
});

test("Reject: stored with the wording version, audited on the server, no touch, no kxv cookie, banner stays away after reload", async ({ page }) => {
  const seen = touches(page);
  const audit = page.waitForRequest((r) => r.url().endsWith("/api/v1/growth/v1/consent") && r.method() === "POST");
  await page.goto("/");
  await page.getByTestId("consent-reject").click();
  const body = (await audit).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ analytics: false, marketing: false, source: "web", evidence: "reject" });
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.consentId).toMatch(/^kxc_/);
  expect(await stored(page)).toMatchObject({ analytics: false, marketing: false, textVersion: body.textVersion });
  await page.reload(); await page.waitForTimeout(2200);
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  expect(seen).toHaveLength(0); expect(await kxv(page)).toHaveLength(0);
});

test("Accept: audited, then one landing touch carries X-KX-Consent: analytics; the kxv cookie appears exactly when the server says visitorKeySet", async ({ page }) => {
  await page.goto("/?utm_source=newsletter&utm_medium=email&email=jane@example.com");
  const touch = page.waitForRequest((r) => r.url().includes("/api/v1/growth/v1/touch"), { timeout: 8000 });
  const res = page.waitForResponse((r) => r.url().includes("/api/v1/growth/v1/touch"), { timeout: 8000 });
  await page.getByTestId("consent-accept").click();
  const req = await touch;
  expect(req.headers()["x-kx-consent"]).toBe("analytics");
  const sent = req.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ landingKind: "HOME", utm: { source: "newsletter", medium: "email" } });
  expect(JSON.stringify(sent)).not.toMatch(/jane|@example|email=/); // unknown params never leave the browser
  expect(sent.dwellMs).toBeGreaterThanOrEqual(1000);
  const body = (await (await res).json()) as { accepted: boolean; visitorKeySet: boolean };
  expect(body.accepted).toBe(true);
  expect((await kxv(page)).length).toBe(body.visitorKeySet ? 1 : 0); // the key is set only after consent AND with the counsel gate (growth.analytics_visitor) satisfied
  expect(await stored(page)).toMatchObject({ analytics: true, marketing: false });
  if (body.visitorKeySet) { const [c] = await kxv(page); expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax" }); }
});

test("Customise: switches start unticked, marketing alone does not enable measurement, and the choice is stored", async ({ page }) => {
  const seen = touches(page);
  await page.goto("/");
  await page.getByTestId("consent-customise").click();
  await expect(page.getByTestId("consent-dialog")).toBeVisible();
  await expect(page.getByTestId("consent-analytics")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("consent-marketing")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("consent-marketing").click();
  await page.getByTestId("consent-save").click();
  await expect.poll(async () => (await stored(page))?.marketing).toBe(true);
  expect(await stored(page)).toMatchObject({ analytics: false, marketing: true });
  await page.waitForTimeout(2200);
  expect(seen).toHaveLength(0); // marketing without analytics sends no touch
});

test("a change of the wording version asks again", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kx-consent", JSON.stringify({ v: 1, textVersion: "OLD_VERSION", analytics: true, marketing: false, consentId: "kxc_old", at: "2025-01-01T00:00:00Z" })));
  await page.goto("/");
  await expect(page.getByTestId("consent-banner")).toBeVisible();
});

test("the draft-wording marker is visible outside production", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("consent-draft")).toBeVisible();
});

test("cookie preferences link in the footer reopens the choice; the preference centre shows the cookie state signed out", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kx-consent", JSON.stringify({ v: 1, textVersion: "TODO_NEEDS_HUMAN_v0", analytics: false, marketing: false, consentId: null, at: "2026-11-24T00:00:00Z" })));
  await page.goto("/");
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await page.getByTestId("footer-preferences").click();
  await expect(page).toHaveURL(/\/preferences$/);
  await expect(page.getByTestId("preference-centre")).toBeVisible();
  await expect(page.getByTestId("pc-cookie-state")).toBeVisible();
  await page.getByTestId("pc-open-cookies").click();
  await expect(page.getByTestId("consent-dialog")).toBeVisible();
});

test("preference centre (signed in): service messages required, nothing pre-ticked, per-channel marketing consent, unsubscribe from all, RTL", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kx-consent", JSON.stringify({ v: 1, textVersion: "TODO_NEEDS_HUMAN_v0", analytics: false, marketing: false, consentId: null, at: "2026-11-24T00:00:00Z" })));
  await signIn(page, "/preferences");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const pc = page.getByTestId("preference-centre");
  await expect(pc).toBeVisible();
  await expect(pc.getByText(/تعمل دائمًا|يعمل دائمًا/).first()).toBeVisible();
  // start from a known state (the dev patient may have chosen before): everything off
  if (await page.getByTestId("pc-unsubscribe").isEnabled()) await page.getByTestId("pc-unsubscribe").click();
  for (const ch of ["WHATSAPP", "SMS", "EMAIL", "PUSH"]) await expect(page.getByTestId(`pc-marketing-${ch}`)).toHaveAttribute("aria-checked", "false");
  const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/me/preferences") && r.request().method() === "PUT");
  await page.getByTestId("pc-marketing-WHATSAPP").click();
  expect((await put).status()).toBe(200);
  await expect(page.getByTestId("pc-marketing-WHATSAPP")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pc-unsubscribe")).toBeEnabled();
  await page.waitForTimeout(500); // let the switch transitions settle before the review screenshot
  await page.locator("header").first().evaluate((h) => { (h as HTMLElement).style.position = "static"; }); // the sticky header would float over the full-page capture
  await page.screenshot({ path: "e2e/screenshots/preference-centre-ar.png", fullPage: true });
  await page.getByTestId("pc-unsubscribe").click();
  await expect(page.getByTestId("pc-marketing-WHATSAPP")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("pc-unsubscribe")).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
