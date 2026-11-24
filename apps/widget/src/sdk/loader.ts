import { acceptFrom, parseToParent, type ToWidget } from '../shared/protocol';

/**
 * kiorex-widget.js (GRW-P1-G). Usage: <script src="https://book.kiorex.com/v1/sdk.js" async></script> and <div data-kx-widget data-org="clinic-slug"></div>.
 * Creates ONE iframe per element pointing at the widget host (the origin this script was loaded from). Messages are accepted only from that iframe window AND the widget
 * origin; messages are sent with an exact targetOrigin. No cookies, no storage, no network calls of its own.
 */
declare const __KX_VERSION__: string;

type Opts = { org: string; doctor?: string; specialty?: string; locale?: string; color?: string; radius?: string; logo?: string; lt?: string; ref?: string; sandbox?: boolean; height?: number; onBooked?: (d: { status: string; bookingRef: string }) => void };
const w = window as unknown as { KiorexWidget?: unknown };
const script = document.currentScript as HTMLScriptElement | null;
let base: string | null = null;
try { base = script && script.src ? new URL(script.src).origin : null; } catch { base = null; }

const TITLE: Record<string, string> = { ar: 'احجز موعدك', en: 'Book an appointment' };
const attr = (el: Element, k: string) => el.getAttribute('data-' + k) || undefined;

function mount(el: HTMLElement, o: Opts) {
  if (!base || !o.org || el.querySelector('iframe[data-kx]')) return null;
  const q: string[] = ['po=' + encodeURIComponent(location.origin), 'v=' + __KX_VERSION__];
  (['doctor', 'specialty', 'locale', 'color', 'radius', 'logo', 'lt', 'ref'] as const).forEach((k) => { const v = o[k]; if (v) q.push(k + '=' + encodeURIComponent(v)); });
  if (o.sandbox) q.push('sandbox=1');
  const f = document.createElement('iframe');
  f.setAttribute('data-kx', '');
  f.src = base + '/v1/embed/' + encodeURIComponent(o.org) + '?' + q.join('&');
  f.title = TITLE[o.locale === 'en' ? 'en' : 'ar'];
  f.loading = 'lazy';
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  const s = f.style; s.width = '100%'; s.border = '0'; s.display = 'block'; s.colorScheme = 'normal'; s.height = (o.height || 560) + 'px';
  const send = (m: ToWidget) => { if (f.contentWindow && base) f.contentWindow.postMessage(m, base); };
  const onMsg = (e: MessageEvent) => {
    const m = parseToParent(acceptFrom(e, base, f.contentWindow));
    if (!m) return;
    if (m.type === 'kx:ready') { const init: ToWidget = { kx: 1, type: 'kx:init' }; if (o.lt) init.lt = o.lt; if (o.ref) init.ref = o.ref; if (o.locale === 'ar' || o.locale === 'en') init.locale = o.locale; send(init); }
    else if (m.type === 'kx:resize') s.height = Math.max(320, Math.min(m.height, 4000)) + 'px';
    else if (m.type === 'kx:booked') { const d = { status: m.status, bookingRef: m.bookingRef }; el.dispatchEvent(new CustomEvent('kx:booked', { detail: d, bubbles: true })); if (o.onBooked) try { o.onBooked(d); } catch { /* host callback errors never break the widget */ } }
    else if (m.type === 'kx:error') el.dispatchEvent(new CustomEvent('kx:error', { detail: { code: m.code }, bubbles: true }));
  };
  window.addEventListener('message', onMsg);
  el.appendChild(f);
  return { iframe: f, destroy() { window.removeEventListener('message', onMsg); f.remove(); } };
}

function scan() {
  document.querySelectorAll<HTMLElement>('[data-kx-widget]').forEach((el) => {
    mount(el, { org: attr(el, 'org') || '', doctor: attr(el, 'doctor'), specialty: attr(el, 'specialty'), locale: attr(el, 'locale'), color: attr(el, 'color'), radius: attr(el, 'radius'), logo: attr(el, 'logo'), lt: attr(el, 'lt'), ref: attr(el, 'ref'), sandbox: el.hasAttribute('data-sandbox'), height: Number(attr(el, 'height')) || undefined });
  });
}

w.KiorexWidget = { version: __KX_VERSION__, mount, scan };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
