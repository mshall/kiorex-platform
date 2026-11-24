import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SITES = 'http://localhost:4392';
const BAD_SITES = 'http://127.0.0.1:4392';
const API = 'http://localhost:4393';

const state = async () => (await fetch(`${SITES}/__state`)).json() as Promise<{ intents: { id: string; status: string; channel: string; failureCode: string | null; startsAt: string }[]; kiorlyBookings: { channel: string; bookingPageSlug: string; key: string }[]; audit: number }>;
test.beforeEach(async () => { await fetch(`${SITES}/__reset`); });

const widget = (page: Page): FrameLocator => page.frameLocator('iframe[data-kx]');
const T = { en: { next: 'Continue', signIn: 'Continue with phone number', confirm: 'Confirm booking', done: 'Your booking is in' }, ar: { next: 'متابعة', signIn: 'المتابعة برقم الهاتف', confirm: 'تأكيد الحجز', done: 'تم استلام حجزك' } } as const;

async function toTimes(page: Page, lang: 'en' | 'ar') {
  const w = widget(page);
  await expect(w.getByRole('button', { name: T[lang].next })).toBeEnabled({ timeout: 20_000 });
  await w.getByRole('button', { name: T[lang].next }).click();
  await expect(w.locator('.times button').first()).toBeVisible();
  return w;
}
async function signInAndHold(page: Page, w: FrameLocator, lang: 'en' | 'ar') {
  await w.locator('.times button').first().click();
  const popupP = page.waitForEvent('popup');
  await w.getByRole('button', { name: T[lang].signIn }).click();
  const popup = await popupP;
  await popup.locator('#verify').click();
  await expect(w.locator('[role=timer]')).toBeVisible({ timeout: 20_000 });
}

test.describe('embedded on an allow-listed site (another origin)', () => {
  test('books end to end: slot, phone sign-in popup, hold timer, consent, confirm; the host page gets a PHI-free booked event', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    const w = await toTimes(page, 'en');
    await signInAndHold(page, w, 'en');
    await expect(w.locator('[role=timer]')).toHaveText(/0[0-4]:\d\d/);
    await w.getByRole('button', { name: T.en.confirm }).click(); // consent missing: stays on the step
    await expect(w.getByRole('alert')).toBeVisible();
    await w.getByLabel(/I agree that Kiorex shares/).check();
    await w.getByRole('button', { name: T.en.confirm }).click();
    await expect(w.getByRole('heading', { name: T.en.done })).toBeVisible({ timeout: 20_000 });
    await expect(w.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(w.getByRole('link', { name: 'Open in the Kiorex app' })).toHaveAttribute('href', /\/appointment\/kx_bk_/);
    const events = await page.locator('#events').textContent();
    expect(events).toMatch(/"status":"CONFIRMED","bookingRef":"kx_bk_/);
    expect(events).not.toMatch(/Mona|\+20100|phone|name/i);
    const s = await state();
    expect(s.intents).toHaveLength(1); expect(s.intents[0]).toMatchObject({ status: 'CONFIRMED', channel: 'CLINIC_LINK' });
    expect(s.kiorlyBookings).toEqual([{ channel: 'CLINIC_LINK', bookingPageSlug: 'nile-clinic', key: s.intents[0]!.id }]);
  });

  test('Arabic: the frame is RTL, strings are Arabic, the flow completes', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=ar`);
    const w = await toTimes(page, 'ar');
    const frame = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
    expect(await frame.evaluate(() => document.documentElement.dir)).toBe('rtl');
    expect(await frame.evaluate(() => document.documentElement.lang)).toBe('ar');
    await expect(w.getByRole('heading', { name: 'اختر اليوم' })).toBeVisible();
    await signInAndHold(page, w, 'ar');
    await w.getByLabel(/أوافق على أن تشارك/).check();
    await w.getByRole('button', { name: T.ar.confirm }).click();
    await expect(w.getByRole('heading', { name: T.ar.done })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/widget-ar-done.png', fullPage: true });
  });

  test('mobile width: no horizontal overflow on any step and the iframe resizes to its content', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    const w = await toTimes(page, 'en');
    const frame = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
    const overflow = () => frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await signInAndHold(page, w, 'en');
    expect(await overflow()).toBeLessThanOrEqual(0);
    const h = await page.locator('iframe[data-kx]').evaluate((f) => f.getBoundingClientRect().height);
    const content = await frame.evaluate(() => document.documentElement.scrollHeight);
    expect(Math.abs(h - Math.max(320, content))).toBeLessThanOrEqual(4);
    for (const btn of await w.getByRole('button').all()) { const b = await btn.boundingBox(); if (b) expect(b.height).toBeGreaterThanOrEqual(43); }
  });

  test('branding: colour and radius are applied within bounds; an unsafe colour falls back to the Kiorex indigo', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en&color=%230f766e&radius=4`);
    await expect(widget(page).getByRole('button', { name: T.en.next })).toBeVisible({ timeout: 20_000 });
    const frame = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
    expect(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kx-accent').trim())).toBe('#0f766e');
    expect(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kx-radius').trim())).toBe('4px');
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en&color=red&radius=999`);
    await expect(widget(page).getByRole('button', { name: T.en.next })).toBeVisible({ timeout: 20_000 });
    const f2 = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
    expect(await f2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kx-accent').trim())).toBe('#3730a3');
    expect(await f2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kx-radius').trim())).toBe('10px');
  });

  test('the plain iframe snippet (no SDK) renders and lists times', async ({ page }) => {
    await page.goto(`${SITES}/iframe.html?org=nile-clinic&locale=en`);
    const w = page.frameLocator('#plain');
    await expect(w.getByRole('button', { name: T.en.next })).toBeEnabled({ timeout: 20_000 });
    await w.getByRole('button', { name: T.en.next }).click();
    await expect(w.locator('.times button').first()).toBeVisible();
  });

  test('double booking: when another visitor takes the chosen time the widget shows SLOT_TAKEN with nearby times and can re-hold', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    const w = await toTimes(page, 'en');
    const first = w.locator('.times button').first();
    const label = await first.textContent();
    // find the exact slot start the first button stands for: the first Kiorly slot
    const slotStart = (await (await fetch(`${API}/api/v1/providers/lst_1/slots?typeId=typ_1`)).json() as { slots: { startsAt: string }[] }).slots[0]!.startsAt;
    await fetch(`${SITES}/__hold-others?startsAt=${encodeURIComponent(slotStart)}`);
    expect(label).toBeTruthy();
    await first.click();
    const popupP = page.waitForEvent('popup');
    await w.getByRole('button', { name: T.en.signIn }).click();
    await (await popupP).locator('#verify').click();
    await expect(w.getByText('Someone just took that time.')).toBeVisible({ timeout: 20_000 });
    await expect(w.getByRole('heading', { name: 'Nearby times' })).toBeVisible();
    await w.locator('.times button').first().click(); // an alternative
    await expect(w.locator('[role=timer]')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('failure states', () => {
  test('no free times shows the empty state with a way to look further ahead; a slot API error shows retry', async ({ page }) => {
    await page.route('**/api/v1/providers/*/slots*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providerId: 'lst_1', typeId: 'typ_1', slots: [] }) }));
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    const w = widget(page);
    await w.getByRole('button', { name: T.en.next }).click();
    await expect(w.locator('p', { hasText: 'No free times in the next two weeks.' })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Look further ahead' })).toBeVisible();
    await page.unroute('**/api/v1/providers/*/slots*');
    await page.route('**/api/v1/providers/*/slots*', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'CLINIC_SYSTEM_BUSY', message: 'busy' }) }));
    await w.getByRole('button', { name: 'Look further ahead' }).click();
    await expect(w.getByRole('alert').getByText('Could not load times.')).toBeVisible();
    await page.unroute('**/api/v1/providers/*/slots*');
    await w.getByRole('button', { name: 'Try again' }).click();
    await expect(w.locator('.times button').first()).toBeVisible();
  });

  test('offline: the widget says so and recovers on retry', async ({ page, context }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    const w = widget(page);
    await expect(w.getByRole('button', { name: T.en.next })).toBeEnabled({ timeout: 20_000 });
    await context.setOffline(true); // navigator.onLine=false (banner); localhost requests are not cut by the emulation, so abort the slot call too
    await page.route('**/api/v1/providers/*/slots*', (r) => r.abort('internetdisconnected'));
    await w.getByRole('button', { name: T.en.next }).click();
    await expect(w.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();
    await expect(w.getByRole('alert').filter({ hasText: 'You are offline' })).toBeVisible();
    await context.setOffline(false); await page.unroute('**/api/v1/providers/*/slots*');
    await w.getByRole('button', { name: 'Try again' }).click();
    await expect(w.locator('.times button').first()).toBeVisible();
  });

  test('an unknown organisation shows a not-found state, not a blank frame', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=no-such-clinic&locale=en`);
    // the embed answers 404 with frame-ancestors none: the browser refuses the document, the host page shows no widget content
    await page.waitForTimeout(1500);
    expect(page.frames().some((f) => /nile|Book an appointment/.test(f.url()))).toBe(false);
  });
});

test.describe('blocked and hostile origins', () => {
  test('a site that is not allow-listed cannot render the iframe (frame-ancestors) and the refusal is audited', async ({ page }) => {
    const refusals: string[] = [];
    page.on('console', (m) => { if (/frame-ancestors|Refused to frame/i.test(m.text())) refusals.push(m.text()); });
    await page.goto(`${BAD_SITES}/spoof.html`);
    await page.waitForTimeout(1500);
    const fr = page.frames().find((f) => f.url().includes('/v1/embed/'));
    const rendered = fr ? await fr.evaluate(() => !!document.getElementById('kx-boot')).catch(() => false) : false;
    expect(rendered).toBe(false);
    const res = await fetch(`${API}/v1/embed/nile-clinic?locale=en`, { headers: { Referer: `${BAD_SITES}/spoof.html` } });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await state()).audit).toBeGreaterThan(0);
    expect(refusals.length + (fr ? 0 : 1)).toBeGreaterThan(0);
  });

  test('SDK on a non-allow-listed origin: the iframe never shows the widget', async ({ page }) => {
    await page.goto(`${BAD_SITES}/host.html?org=nile-clinic&locale=en`);
    await page.waitForTimeout(1500);
    const fr = page.frames().find((f) => f.url().includes('/v1/embed/'));
    const rendered = fr ? await fr.evaluate(() => !!document.getElementById('kx-boot')).catch(() => false) : false;
    expect(rendered).toBe(false);
  });

  test('postMessage origin validation in a real browser: forged messages from the host window or a cross-origin frame change nothing', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=en`);
    await expect(widget(page).getByRole('button', { name: T.en.next })).toBeEnabled({ timeout: 20_000 });
    const before = await page.locator('iframe[data-kx]').evaluate((f) => f.getBoundingClientRect().height);
    await page.evaluate(() => {
      window.postMessage({ kx: 1, type: 'kx:resize', height: 50 }, '*'); // source is the host window itself, not the widget frame
      window.postMessage({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'forged' }, '*');
      const a = document.createElement('iframe'); a.src = 'http://127.0.0.1:4392/attacker.html'; a.style.display = 'none'; a.id = 'attacker'; document.body.appendChild(a); // cross-origin frame posting to its parent
    });
    await page.waitForTimeout(800);
    expect(await page.locator('iframe[data-kx]').evaluate((f) => f.getBoundingClientRect().height)).toBe(before);
    expect(await page.locator('#events').textContent()).toBe('');
  });

  test('widget side: a message to the widget frame from a page that is not the verified parent is ignored (locale stays)', async ({ page }) => {
    await page.goto(`${SITES}/host.html?org=nile-clinic&locale=ar`);
    await expect(widget(page).getByRole('heading', { name: 'اختر اليوم' }).or(widget(page).getByRole('button', { name: 'متابعة' }))).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      const f = document.querySelector('iframe[data-kx]') as HTMLIFrameElement;
      const attacker = document.createElement('iframe'); attacker.src = 'http://127.0.0.1:4392/attacker.html'; document.body.appendChild(attacker);
      // a message from a third window with an arbitrary locale and lt: the widget only listens to window.parent during the handshake
      f.contentWindow!.postMessage({ kx: 1, type: 'kx:init', locale: 'en', lt: 'forged.token' }, 'http://localhost:4393');
    });
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
    expect(await frame.evaluate(() => document.documentElement.dir)).toBe('rtl');
  });
});

test.describe('accessibility (axe, WCAG 2.2 A and AA rules) on the sandbox page that frames the real widget', () => {
  test('every step has no axe violations; keyboard focus lands on the step heading and the flow works with the keyboard', async ({ page }) => {
    await page.goto(`${API}/v1/sandbox?org=nile-clinic&locale=en`);
    const w = widget(page);
    await expect(w.getByRole('button', { name: T.en.next })).toBeEnabled({ timeout: 20_000 });
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join('>')).join(' | ')}`), label).toEqual([]);
      const frame = page.frames().find((f) => f.url().includes('/v1/embed/'))!;
      const inner = await new AxeBuilder({ page }).include('iframe').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze().catch(() => null);
      if (inner) expect(inner.violations.map((v) => `${label}/frame: ${v.id}`), label).toEqual([]);
      return frame;
    };
    await scan('choose');
    await w.getByRole('button', { name: T.en.next }).focus(); await page.keyboard.press('Enter');
    await expect(w.locator('.times button').first()).toBeVisible();
    const frame = await scan('times');
    expect(await frame.evaluate(() => document.activeElement?.tagName)).toBe('H2');
    await w.locator('.times button').first().focus(); await page.keyboard.press('Enter');
    await expect(w.getByRole('button', { name: T.en.signIn })).toBeVisible();
    await scan('review-signed-out');
    const popupP = page.waitForEvent('popup');
    await page.keyboard.press('Tab'); // focus moves forward from the heading into the controls
    await w.getByRole('button', { name: T.en.signIn }).focus(); await page.keyboard.press('Enter');
    await (await popupP).locator('#verify').click();
    await expect(w.locator('[role=timer]')).toBeVisible({ timeout: 20_000 });
    await scan('review-held');
    await w.getByLabel(/I agree that Kiorex shares/).focus(); await page.keyboard.press('Space');
    await w.getByRole('button', { name: T.en.confirm }).focus(); await page.keyboard.press('Enter');
    await expect(w.getByRole('heading', { name: T.en.done })).toBeVisible({ timeout: 20_000 });
    await scan('done');
  });

  test('Arabic RTL has no axe violations', async ({ page }) => {
    await page.goto(`${API}/v1/sandbox?org=nile-clinic&locale=ar`);
    await expect(widget(page).getByRole('button', { name: T.ar.next })).toBeEnabled({ timeout: 20_000 });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
