import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The widget booking flow against the REAL dev stack (see playwright.real.config.ts): real Kiorex API embed + SDK on :4000, real Kiorly Clinic holds and bookings,
 * and the real Kiorex Passport popup (client `kiorex-widget`, PKCE) with its dev quick-pick chips. The host page is the only synthetic part: Playwright answers
 * `https://widget-host.example.test/` (an origin the clinic really registered) with a page that loads the SDK from the API host.
 */
const fx = JSON.parse(readFileSync(process.env.WIDGET_REAL_FIXTURE ?? '', 'utf8')) as { slug: string; origin: string };
const API = 'http://localhost:4000';
const PASSPORT = 'http://localhost:4400';
const T = { en: { next: 'Continue', signIn: 'Continue with phone number', confirm: 'Confirm booking', done: 'Your booking is in' }, ar: { next: 'متابعة', signIn: 'المتابعة برقم الهاتف', confirm: 'تأكيد الحجز', done: 'تم استلام حجزك' } } as const;
const widget = (page: Page): FrameLocator => page.frameLocator('iframe[data-kx]');

/** The KX-DEV clinic lists two doctors, so one must be chosen before Continue is enabled (the hermetic suite has a single doctor). */
async function chooseDoctor(w: FrameLocator) {
  await w.locator('button.choice').filter({ hasText: /Mona Fahmy|منى فهمي/ }).click({ timeout: 30_000 });
  await w.locator('h3 + ul button.choice').first().click(); // first visit type of that doctor (Continue stays disabled until one is chosen)
}

/** Every test books a DIFFERENT time: a slot taken by the previous test is gone (and the widget slot list is cached for a minute), so "the first time" would collide on the second booking. */
let nextSlot = 0;
async function chooseTime(w: FrameLocator) {
  const times = w.locator('.times button');
  await expect(times.first()).toBeVisible({ timeout: 30_000 });
  const n = await times.count();
  await times.nth(Math.min(nextSlot++, n - 1)).click();
}

async function openHost(page: Page, locale: 'en' | 'ar', path = '/host.html') {
  await page.route(`${fx.origin}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta charset=utf-8><title>Provider site</title></head><body><h1>Clinic website</h1><div data-kx-widget data-org="${fx.slug}" data-locale="${locale}"></div><pre id=events></pre><script>document.addEventListener('kx:booked',function(e){document.getElementById('events').textContent+=JSON.stringify(e.detail)+'\\n'});document.addEventListener('kx:error',function(e){document.getElementById('events').textContent+='error:'+e.detail.code+'\\n'});</script><script src="${API}/v1/sdk.js" async></script></body></html>` }));
  await page.goto(`${fx.origin}${path}`);
}

for (const lang of ['en', 'ar'] as const) {
  test(`real Passport popup (${lang}): slot, phone sign-in in the popup, hold timer, consent, confirm; the host page gets a PHI-free booked event`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await openHost(page, lang);
    const w = widget(page);
    await chooseDoctor(w);
    await expect(w.getByRole('button', { name: T[lang].next, exact: true })).toBeEnabled({ timeout: 30_000 });
    await w.getByRole('button', { name: T[lang].next, exact: true }).click();
    await chooseTime(w);

    const popupP = page.waitForEvent('popup');
    const authReq = page.context().waitForEvent('request', { predicate: (r) => r.url().startsWith(`${PASSPORT}/auth?`), timeout: 20_000 });
    await w.getByRole('button', { name: T[lang].signIn }).click();
    const popup = await popupP;
    await popup.waitForURL(new RegExp(`^${PASSPORT.replace(/[.:/]/g, '\\$&')}/`), { timeout: 20_000 }); // the popup opens as about:blank and is then pointed at Passport
    // the first request names the widget client, PKCE S256 and the callback of the widget host
    const q = new URL((await authReq).url()).searchParams;
    expect(q.get('client_id')).toBe('kiorex-widget');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe(`${API}/v1/embed/auth/callback`);
    expect(q.get('response_type')).toBe('code');
    await popup.waitForSelector('[data-dev-test-users]', { timeout: 20_000 });
    await popup.locator('[data-dev-phone="+201000001001"]').click(); // chip: phone and the dev code are entered for you
    await expect(w.locator('[role=timer]')).toBeVisible({ timeout: 40_000 });
    expect(popup.isClosed()).toBe(true); // Passport returned to the widget host callback, which handed the code to the iframe and closed itself

    await w.getByLabel(/I agree that Kiorex shares|أوافق/).check();
    await w.getByRole('button', { name: T[lang].confirm }).click();
    await expect(w.getByRole('heading', { name: T[lang].done })).toBeVisible({ timeout: 30_000 });
    const events = await page.locator('#events').textContent();
    expect(events).toMatch(/"status":"(CONFIRMED|PENDING_CLINIC)","bookingRef":"kx_bk_/);
    expect(events).not.toMatch(/Hoda|\+20100|phone|name/i);
    expect(errors, 'no uncaught error on the host page').toEqual([]);
  });
}

test('closing the Passport popup without signing in leaves the widget usable and holds nothing', async ({ page }) => {
  await openHost(page, 'en');
  const w = widget(page);
  await chooseDoctor(w);
  await expect(w.getByRole('button', { name: T.en.next, exact: true })).toBeEnabled({ timeout: 30_000 });
  await w.getByRole('button', { name: T.en.next, exact: true }).click();
  await expect(w.locator('.times button').first()).toBeVisible({ timeout: 30_000 });
  await w.locator('.times button').first().click();
  const popupP = page.waitForEvent('popup');
  await w.getByRole('button', { name: T.en.signIn }).click();
  const popup = await popupP;
  await popup.waitForLoadState('domcontentloaded');
  await popup.close();
  await expect(w.getByRole('button', { name: T.en.signIn })).toBeVisible({ timeout: 15_000 });
  await expect(w.locator('[role=timer]')).toHaveCount(0);
});

test('a page on an origin the clinic did not register cannot frame the widget (frame-ancestors) and gets no session', async ({ page }) => {
  const res = await fetch(`${API}/v1/embed/${fx.slug}`, { headers: { 'sec-fetch-dest': 'iframe' } });
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain(`frame-ancestors ${fx.origin}`);
  expect(csp).not.toContain('*');
  const session = await fetch(`${API}/api/v1/widget/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: API }, body: JSON.stringify({ org: fx.slug, parentOrigin: 'https://evil.example.test' }) });
  expect(session.status).toBe(403);
  void page;
});
