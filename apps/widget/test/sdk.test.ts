import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const manifest = JSON.parse(readFileSync(join(__dirname, '../dist/sdk/manifest.json'), 'utf8')) as { file: string };
const code = readFileSync(join(__dirname, '../dist/sdk', manifest.file), 'utf8');
const WIDGET = 'https://book.kiorex.com';

/** Runs the REAL built SDK bundle against a jsdom window, as a script loaded from the widget host. */
function load(host?: HTMLElement) {
  document.body.innerHTML = '';
  const el = host ?? document.createElement('div');
  if (!host) { el.setAttribute('data-kx-widget', ''); el.setAttribute('data-org', 'nile-clinic'); el.setAttribute('data-locale', 'en'); el.setAttribute('data-lt', 'lt_token.1'); }
  document.body.appendChild(el);
  Object.defineProperty(document, 'currentScript', { configurable: true, value: { src: `${WIDGET}/v1/sdk.js` } });
  new Function(code)();
  const iframe = el.querySelector('iframe') as HTMLIFrameElement;
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
  const send = (data: unknown, o: { origin?: string; source?: unknown } = {}) => window.dispatchEvent(new MessageEvent('message', { data, origin: o.origin ?? WIDGET, source: (o.source ?? iframe.contentWindow) as MessageEventSource }));
  return { el, iframe, post, send };
}

describe('kiorex-widget.js (the built SDK bundle)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('creates one sandboxed iframe on the widget origin with the page origin and options in the URL, and never twice for one element', () => {
    const { el, iframe } = load();
    const u = new URL(iframe.src);
    expect(u.origin).toBe(WIDGET); expect(u.pathname).toBe('/v1/embed/nile-clinic');
    expect(u.searchParams.get('po')).toBe(location.origin); expect(u.searchParams.get('locale')).toBe('en'); expect(u.searchParams.get('lt')).toBe('lt_token.1');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts'); expect(iframe.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(iframe.title).toBeTruthy();
    (window as unknown as { KiorexWidget: { scan(): void } }).KiorexWidget.scan();
    expect(el.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('answers kx:ready with kx:init to the EXACT widget origin (never "*") and only for the right window', () => {
    const { post, send } = load();
    send({ kx: 1, type: 'kx:ready' }, { source: window }); // wrong window
    send({ kx: 1, type: 'kx:ready' }, { origin: 'https://evil.example' }); // wrong origin
    expect(post).not.toHaveBeenCalled();
    send({ kx: 1, type: 'kx:ready' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toEqual({ kx: 1, type: 'kx:init', lt: 'lt_token.1', locale: 'en' });
    expect(post.mock.calls[0]![1]).toBe(WIDGET);
    expect(post.mock.calls.every((c) => (c as unknown[])[1] !== '*')).toBe(true);
  });

  it('resizes from kx:resize only when origin and source match; clamps the height; ignores malformed messages', () => {
    const { iframe, send } = load();
    send({ kx: 1, type: 'kx:resize', height: 777 });
    expect(iframe.style.height).toBe('777px');
    send({ kx: 1, type: 'kx:resize', height: 1234 }, { origin: 'https://evil.example' });
    send({ kx: 1, type: 'kx:resize', height: 1234 }, { source: window });
    send({ kx: 1, type: 'kx:resize', height: -5 }); send({ kx: 1, type: 'kx:resize', height: 'tall' }); send('kx:resize'); send(null);
    expect(iframe.style.height).toBe('777px');
    send({ kx: 1, type: 'kx:resize', height: 90000 }); // over the protocol limit: dropped
    expect(iframe.style.height).toBe('777px');
    send({ kx: 1, type: 'kx:resize', height: 100 });
    expect(iframe.style.height).toBe('320px');
  });

  it('emits kx:booked on the element with status and an opaque reference only (no PHI), from the widget only', () => {
    const { el, send } = load();
    const got: unknown[] = []; el.addEventListener('kx:booked', (e) => got.push((e as CustomEvent).detail));
    send({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'kx_bk_1', patientName: 'Amira', phone: '+20100' }, { origin: 'https://evil.example' });
    expect(got).toHaveLength(0);
    send({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'kx_bk_1', patientName: 'Amira', phone: '+20100' });
    expect(got).toEqual([{ status: 'CONFIRMED', bookingRef: 'kx_bk_1' }]);
  });

  it('exposes the version and a mount API, and the bundle never uses a wildcard targetOrigin or eval-like constructs', () => {
    load();
    expect((window as unknown as { KiorexWidget: { version: string } }).KiorexWidget.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(code).not.toMatch(/postMessage\([^)]*['"]\*['"]\)/);
    expect(code).not.toMatch(/\beval\(|new Function|document\.write|innerHTML/);
  });
});
