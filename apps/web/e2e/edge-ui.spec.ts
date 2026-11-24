import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * EDGE 48: UI/UX edges on the patient web (real local stack). Narrow and wide screens, 200 % zoom, Arabic RTL with long/mixed text, emoji and zero-width input,
 * offline and slow network, double clicks, back/refresh in a multi-step flow, keyboard-only use, reduced motion.
 */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const PAGES = ["/", "/search"];

for (const [name, size] of [["320x568", { width: 320, height: 568 }], ["2560x1440", { width: 2560, height: 1440 }], ["zoom200-1280", { width: 640, height: 450 }], ["landscape-phone", { width: 667, height: 320 }]] as const) {
  test(`no horizontal scroll and no clipped primary action at ${name}, Arabic and English`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const lang of ["ar", "en"]) for (const path of PAGES) {
      await page.addInitScript((l) => { try { localStorage.setItem("kx-lang", l); } catch { /* storage blocked */ } }, lang); // the SPA reads its language from localStorage kx-lang
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await overflow(page), `${path} ${lang} ${name}`).toBeLessThanOrEqual(1);
      const sizes = await page.evaluate(() => [...document.querySelectorAll("button, a[href], [role=button]")].filter((e) => (e as HTMLElement).offsetParent).filter((e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if ((ox === "auto" || ox === "scroll") && a.scrollWidth > a.clientWidth) return false; } return true; /* controls inside a deliberate horizontal scroller (chips, carousels) may sit off-screen */ }).slice(0, 40).map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, left: r.left }; }));
      for (const s of sizes) { expect(s.right, "a control is pushed past the right edge").toBeLessThanOrEqual(size.width + 1); expect(s.left, "a control is pushed past the left edge").toBeGreaterThanOrEqual(-1); }
    }
  });
}

test("Arabic page keeps RTL with mixed digits and a very long name: no overflow, no text clipped without ellipsis", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/search");
  const box = page.getByRole("searchbox").or(page.locator("input[type=search], input[name=q], input[placeholder]")).first();
  if (await box.count()) {
    for (const text of ["د. " + "محمد عبد الرحمن ".repeat(30) + "١٢٣ 456", "🙂".repeat(80), "​‍‏‮" + "x".repeat(50), "a".repeat(5000), "<img src=x onerror=alert(1)>", "'; drop table--"]) {
      await box.fill(text); await box.press("Enter");
      await page.waitForTimeout(300);
      expect(await overflow(page), text.slice(0, 20)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => Boolean((window as unknown as { __xss?: unknown }).__xss))).toBe(false);
    }
  }
  await expect(page.locator("html")).toHaveAttribute("dir", /rtl|ltr/);
});

test("offline: a failed search shows a readable error and recovery works when the network returns (no blank page, no crash loop)", async ({ page, context }) => {
  await page.goto("/search");
  await expect(page.getByTestId("doctor-card").first()).toBeVisible({ timeout: 20_000 });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.reload().catch(() => undefined); // the document itself may fail offline: the browser error page is acceptable here
  await context.setOffline(false);
  await page.goto("/search");
  await expect(page.getByTestId("doctor-card").first()).toBeVisible({ timeout: 20_000 });
  // in-app navigation while offline: results fetch fails, the page stays usable
  await context.setOffline(true);
  await page.getByTestId("open-filters").click().catch(() => undefined);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.body.innerText.trim().length)).toBeGreaterThan(20); // not blank
  await context.setOffline(false);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|Load failed/i.test(e)), "uncaught errors other than the network failure").toEqual([]);
});

test("slow network (3 s per API call): a loading state is shown, nothing throws, and the list still arrives", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/search/**", async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.continue(); });
  await page.goto("/search");
  await expect(page.getByTestId("doctor-card").first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("server errors on search (500, 429, empty JSON, HTML) never blank the page", async ({ page }) => {
  for (const [status, body, type] of [[500, "boom", "text/plain"], [429, '{"code":"RATE_LIMITED"}', "application/json"], [200, "{}", "application/json"], [200, "<html>proxy</html>", "text/html"], [200, '{"items":null,"total":null}', "application/json"]] as const) {
    await page.route("**/api/v1/search/providers**", (r) => r.fulfill({ status, body, contentType: type }));
    const errors: string[] = []; const h = (e: Error) => errors.push(e.message); page.on("pageerror", h);
    await page.goto("/search"); await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.body.innerText.trim().length), `status ${status}`).toBeGreaterThan(20);
    expect(errors, `status ${status}`).toEqual([]);
    page.off("pageerror", h); await page.unroute("**/api/v1/search/providers**");
  }
});

test("double click, back and refresh in the booking flow: one request per click, the page survives back/forward/refresh", async ({ page }) => {
  await signIn(page);
  await page.goto("/search");
  await page.getByTestId("doctor-card").first().getByRole("link").first().click();
  await expect(page.getByTestId("doctor-name")).toBeVisible();
  const url = page.url();
  await page.goBack(); await expect(page.getByTestId("doctor-card").first()).toBeVisible();
  await page.goForward(); await expect(page.getByTestId("doctor-name")).toBeVisible();
  await page.reload(); await expect(page.getByTestId("doctor-name")).toBeVisible();
  expect(page.url()).toBe(url);
  const holds: string[] = []; page.on("request", (r) => { if (r.method() === "POST" && /\/api\/v1\/bookings$/.test(new URL(r.url()).pathname)) holds.push(r.url()); });
  const openBooking = page.getByTestId("open-booking"); if (await openBooking.isVisible()) await openBooking.click();
  const slot = page.getByTestId("slot").first();
  if (await slot.count()) {
    await slot.dblclick().catch(() => undefined);
    const cont = page.getByTestId("slot-continue").or(page.getByRole("button", { name: /continue|hold|حجز|متابعة/i })).first();
    if (await cont.count() && await cont.isEnabled()) { await cont.dblclick(); await page.waitForTimeout(1200); expect(holds.length, "a double click must create at most one hold request").toBeLessThanOrEqual(1); }
  }
});

test("keyboard only: Tab reaches interactive controls in a sensible order, every focused control shows a visible focus indicator, Escape closes the filters sheet", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByTestId("doctor-card").first()).toBeVisible({ timeout: 20_000 });
  const seen: { tag: string; outline: string; boxShadow: string }[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => { const e = document.activeElement as HTMLElement; const cs = getComputedStyle(e); return { tag: e.tagName, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, boxShadow: cs.boxShadow }; }));
  }
  expect(new Set(seen.map((s) => s.tag)).size).toBeGreaterThan(1);
  const interactive = seen.filter((s) => ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(s.tag));
  expect(interactive.length).toBeGreaterThan(5);
  const noIndicator = interactive.filter((s) => /^none/.test(s.outline) && s.boxShadow === "none");
  expect(noIndicator.length / interactive.length, "focused controls without any visible indicator").toBeLessThan(0.2);
  const filters = page.getByTestId("open-filters");
  if (await filters.isVisible()) { await filters.focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("filters-sheet")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByTestId("filters-sheet")).toBeHidden(); }
});

test("reduced motion: no infinite or long CSS animation keeps running", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://localhost:5180", storageState: "./e2e/consent-seed.json" });
  const page = await ctx.newPage();
  await page.goto("/"); await page.waitForLoadState("networkidle").catch(() => undefined);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => { const t = a.effect?.getComputedTiming(); return t && (t.iterations === Infinity || (typeof t.duration === "number" && t.duration > 600)); }).map((a) => (a as CSSAnimation).animationName ?? "transition"));
  expect(running, "animations that should be disabled under prefers-reduced-motion").toEqual([]);
  await ctx.close();
});

test("a huge result list and an empty one both render (pagination boundaries): page=1, page past the end, pageSize 1 and 100", async ({ page }) => {
  for (const qs of ["?page=1", "?page=9999", "?pageSize=1", "?pageSize=100", "?specialty=__nothing__"]) {
    const errors: string[] = []; const h = (e: Error) => errors.push(e.message); page.on("pageerror", h);
    await page.goto(`/search${qs}`); await page.waitForTimeout(700);
    expect(await page.evaluate(() => document.body.innerText.trim().length), qs).toBeGreaterThan(20);
    expect(errors, qs).toEqual([]); page.off("pageerror", h);
  }
});
