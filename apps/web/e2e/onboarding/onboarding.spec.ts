import { expect, test, type Page } from "@playwright/test";
import { axe } from "./axe";
import { mockStack, newState, type MockState } from "./mock";

const prep = async (page: Page, s: MockState, lang: "en" | "ar" = "en") => {
  await page.addInitScript((l) => { try { if (!sessionStorage.getItem("kx-t-init")) { sessionStorage.setItem("kx-t-init", "1"); localStorage.setItem("kx-lang", l); } localStorage.setItem("kx-consent", "{}"); } catch { /* */ } }, lang);
  await mockStack(page, s);
};
const register = async (page: Page) => { await page.goto("/join"); await page.getByTestId("entry-continue").click(); };

test("register end to end: Join us -> Passport (intent=register, return-to) -> onboarding -> personalised home", async ({ page }) => {
  const s = newState(); await prep(page, s);
  await register(page);
  await expect(page.getByTestId("welcome")).toBeVisible();
  expect(s.authorizeQuery?.get("intent")).toBe("register");
  expect(s.authorizeQuery?.get("ui_locales")).toBe("en");
  expect(s.authorizeQuery?.get("code_challenge_method")).toBe("S256");
  await expect(page.getByTestId("welcome-step")).toContainText("Step 1 of 6");
  await page.getByTestId("welcome-next").click(); // welcome
  await page.getByTestId("welcome-name").fill("  Mona   Test ");
  await page.getByTestId("welcome-next").click();
  expect(s.profilePuts[0]).toEqual({ nameEn: "Mona Test" });
  await expect(page.getByTestId("welcome-lang-en")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("welcome-market-soon")).toBeVisible(); // gated market: honest, never faked
  await page.getByTestId("welcome-lang-ar").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("welcome-lang-en").click();
  await page.getByTestId("welcome-next").click();
  expect(s.profilePuts[1]).toMatchObject({ preferredLocale: "en" });
  await page.getByTestId("welcome-interest-labs").click();
  await page.getByTestId("welcome-interest-doctors").click();
  await page.getByTestId("welcome-next").click();
  await page.getByTestId("welcome-analytics").click();
  await page.getByTestId("welcome-next").click();
  expect(s.prefsPuts[0]).toMatchObject({ analytics: true });
  await page.getByTestId("welcome-reminders").click();
  await page.getByTestId("welcome-next").click();
  expect(s.prefsPuts[1]).toMatchObject({ reminders: true }); // no marketing channel was ticked, none is sent
  await expect(page.getByTestId("welcome-done")).toBeVisible();
  await page.getByTestId("welcome-go").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("for-you")).toContainText("Lab tests");
  await expect(page.getByTestId("finish-setup")).toHaveCount(0);
  expect(JSON.stringify(s.prefsPuts)).not.toMatch(/marketing/);
});

test("an existing member skips onboarding and lands where they were going", async ({ page }) => {
  const s = newState({ profile: { ...newState().profile, createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(), nameEn: "Hoda" } }); await prep(page, s);
  await page.goto("/signin?returnTo=%2Fservices"); await page.getByTestId("entry-continue").click();
  await expect(page).toHaveURL(/\/services$/);
  expect(s.authorizeQuery?.get("intent")).toBe("signin");
  expect(s.profilePuts).toEqual([]); expect(s.prefsPuts).toEqual([]);
});

test("cancelled Passport sign-in returns to the entry page with a calm message and nothing saved", async ({ page }) => {
  const s = newState({ cancel: true }); await prep(page, s);
  await register(page);
  await expect(page).toHaveURL(/\/signin\?reason=cancelled/);
  await expect(page.getByTestId("entry-note-cancelled")).toBeVisible();
  await expect(page.getByTestId("sign-in")).toBeVisible(); // still signed out
  s.cancel = false; await page.getByTestId("entry-continue").click(); // and it can be retried
  await expect(page.getByTestId("welcome")).toBeVisible();
});

test("a private page for a signed-out visitor goes to the entry page, never straight to Passport; expired sessions say so", async ({ page }) => {
  const s = newState(); await prep(page, s);
  await page.goto("/appointments");
  await expect(page).toHaveURL(/\/signin\?reason=required&returnTo=%2Fappointments/);
  await expect(page.getByTestId("entry-note-required")).toBeVisible();
  expect(s.authorizeCount).toBe(0);
  await page.evaluate(() => sessionStorage.setItem("kx-auth-reason", "expired"));
  await page.goto("/records");
  await expect(page.getByTestId("entry-note-expired")).toBeVisible();
});

test("a failed save keeps the answer, shows the error and succeeds on retry", async ({ page }) => {
  const s = newState(); await prep(page, s); await register(page);
  await page.getByTestId("welcome-next").click();
  await page.getByTestId("welcome-name").fill("Mona");
  s.failNextProfilePut = true;
  await page.getByTestId("welcome-next").click();
  await expect(page.getByTestId("welcome-error")).toBeVisible();
  await expect(page.getByTestId("welcome-name")).toHaveValue("Mona");
  await page.getByTestId("welcome-next").click();
  await expect(page.getByTestId("welcome-lang-en")).toBeVisible();
});

test("resumable: closing the tab on step 3 resumes at step 3", async ({ page }) => {
  const s = newState(); await prep(page, s); await register(page);
  await page.getByTestId("welcome-next").click(); await page.getByTestId("welcome-skip").click();
  await expect(page.getByTestId("welcome-step")).toContainText("Step 3 of 6");
  await page.goto("/welcome");
  await expect(page.getByTestId("welcome-step")).toContainText("Step 3 of 6");
});

test("Skip setup records explicit refusals (no consent is assumed) and is not shown again", async ({ page }) => {
  const s = newState(); await prep(page, s); await register(page);
  await page.getByTestId("welcome-skip-all").click();
  expect(s.prefsPuts).toMatchObject([{ analytics: false, reminders: false }]);
  await expect(page.getByTestId("welcome-done")).toContainText("Setup skipped");
  await page.getByTestId("welcome-go").click();
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
});

test("the return target is same-origin only", async ({ page }) => {
  const s = newState({ profile: { ...newState().profile, createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } }); await prep(page, s);
  await page.goto("/signin?returnTo=https%3A%2F%2Fevil.example%2Fx"); await page.getByTestId("entry-continue").click();
  await expect(page).toHaveURL(/localhost:5193\/$/);
});

for (const lang of ["en", "ar"] as const) {
  test(`axe clean and no overflow: entry and onboarding steps (${lang})`, async ({ page }) => {
    const s = newState(); await prep(page, s, lang);
    await page.goto("/join");
    await expect(page.getByTestId("entry-continue")).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByTestId("entry-continue").click();
    for (let i = 0; i < 6; i++) {
      await expect(page.getByTestId("welcome-step")).toContainText(String(i + 1));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(await axe(page)).toEqual([]);
      await page.getByTestId("welcome-next").click();
    }
    await expect(page.getByTestId("welcome-done")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
}
