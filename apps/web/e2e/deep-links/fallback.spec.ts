import { expect, test } from "@playwright/test";

const touches = async (request: import("@playwright/test").APIRequestContext) => (await (await request.get("/__touches")).json()) as Array<Record<string, unknown>>;
test.beforeEach(async ({ request }) => { await request.get("/__reset"); });

test.describe("referral fallback page: consent first, attribution preserved", () => {
  test("no touch and no referrer before consent; equal-weight choices; open-in-app and store links render", async ({ page, request }) => {
    const res = await page.goto("/r/AB12CD34?l=en");
    expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.locator("#open")).toHaveAttribute("href", "kiorex://r/AB12CD34?cc=eg");
    await expect(page.locator("#allow")).toBeVisible();
    await expect(page.locator("#decline")).toBeVisible();
    await expect(page.locator("#android")).toHaveAttribute("href", "https://play.google.com/store/apps/details?id=com.kiorex.app");
    await expect(page.locator("#claim")).toBeHidden();
    await page.waitForTimeout(300);
    expect(await touches(request)).toEqual([]);
  });

  test("Allow sends one touch with only landing kind, code and dwell; Play link gains the install referrer; claim code appears", async ({ page, request }) => {
    await page.goto("/r/AB12CD34?l=en");
    await page.locator("#allow").click();
    await expect(page.locator("#claim")).toBeVisible();
    await expect(page.locator("#claim .code")).toHaveText("AB12CD34");
    await expect(page.locator("#android")).toHaveAttribute("href", /referrer=kxref%3Dr\.AB12CD34$/);
    await expect.poll(async () => (await touches(request)).length).toBe(1);
    const [t] = await touches(request);
    expect(Object.keys(t!).sort()).toEqual(["dwellMs", "landingKind", "ref"]);
    expect(t).toMatchObject({ landingKind: "REFERRAL", ref: "AB12CD34" });
  });

  test("Not now sends nothing, adds no referrer and the links still work", async ({ page, request }) => {
    await page.goto("/r/AB12CD34?l=en");
    await page.locator("#decline").click();
    await expect(page.locator("#consent")).toBeHidden();
    await expect(page.locator("#claim")).toBeHidden();
    await expect(page.locator("#android")).toHaveAttribute("href", "https://play.google.com/store/apps/details?id=com.kiorex.app");
    await page.waitForTimeout(300);
    expect(await touches(request)).toEqual([]);
    await page.locator("#web").click();
    await expect(page.locator("#webhome")).toBeVisible(); // navigated to the configured web origin
    expect(page.url()).toContain("/web/?ref=AB12CD34");
  });

  test("provider QR code: lower case input is normalised and the touch kind is PROVIDER_LINK with a p. referrer", async ({ page, request }) => {
    await page.goto("/q/7xk2m9qp?l=ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.locator("#allow").click();
    await expect(page.locator("#android")).toHaveAttribute("href", /referrer=kxref%3Dp\.7XK2M9QP$/);
    await expect.poll(async () => (await touches(request)).length).toBe(1);
    expect((await touches(request))[0]).toMatchObject({ landingKind: "PROVIDER_LINK", ref: "7XK2M9QP" });
  });

  test("appointment links never ask for consent and never touch", async ({ page, request }) => {
    await page.goto("/a/apt_123?l=en");
    await expect(page.locator("#allow")).toHaveCount(0);
    await expect(page.locator("#open")).toHaveAttribute("href", "kiorex://appointment/apt_123?cc=eg");
    expect(await touches(request)).toEqual([]);
  });
});

test.describe("hostile input", () => {
  for (const p of ["/r/abc", "/r/%3Cscript%3Ewindow.__x=1%3C%2Fscript%3E", "/q/7XK2M9QI", "/a/..", "/a/%2e%2e", "/r/https%3A%2F%2Fevil.example"]) {
    test(`${p} is a 404 and executes nothing`, async ({ page }) => {
      const res = await page.goto(p);
      expect(res?.status()).toBe(404);
      expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
      expect(await page.content()).not.toContain("evil.example");
    });
  }
  test("URL-valued query parameters are not followed or reflected", async ({ page }) => {
    const res = await page.goto("/r/AB12CD34?to=https://evil.example&url=//evil.example&next=javascript:alert(1)&l=en");
    expect(res?.status()).toBe(200);
    expect(page.url()).toContain("localhost:4391");
    const html = await page.content();
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
  });
  test("a dynamic value cannot inject markup (CSP also blocks inline script without the nonce)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/r/AB12CD34?l=%22%3E%3Cscript%3Ewindow.__x%3D1%3C%2Fscript%3E");
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  });
});
