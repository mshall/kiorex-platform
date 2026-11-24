import { acceptFrom, parseToWidget, type ToParent, type ToWidget } from '../shared/protocol';
import { originOfUrl } from './origin';

export interface Bridge { parentOrigin: string | null; init: ToWidget | null; send: (m: ToParent) => void; verified: boolean }

/**
 * Widget side of the postMessage protocol. With the SDK: the SDK puts its page origin in `po`; the widget says `kx:ready` to exactly that origin, the SDK answers `kx:init`,
 * and only a reply whose `event.origin` equals `po` AND `event.source` is `window.parent` is accepted (handshake verified). Without the SDK (plain iframe snippet) the
 * parent origin comes from `location.ancestorOrigins` or the referrer: it is only a CLAIM until the server checks it against the allow-list when the session is created.
 * Outgoing messages always use that exact origin as targetOrigin, never `*`.
 */
export async function connect(po: string | null, self: string, sandbox: boolean, timeoutMs = 1500): Promise<Bridge> {
  const framed = window.parent !== window;
  let parentOrigin: string | null = null;
  let init: ToWidget | null = null;
  let verified = false;
  const claimed = originOfUrl(po);
  if (framed && claimed) {
    const got = new Promise<ToWidget | null>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const m = parseToWidget(acceptFrom(e, claimed, window.parent));
        if (!m) return;
        window.removeEventListener('message', onMsg); resolve(m);
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, timeoutMs);
    });
    try { window.parent.postMessage({ kx: 1, type: 'kx:ready' } satisfies ToParent, claimed); } catch { /* wrong origin: nothing is delivered */ }
    init = await got;
    if (init) { parentOrigin = claimed; verified = true; }
  }
  if (!parentOrigin) {
    const anc = (location as unknown as { ancestorOrigins?: ArrayLike<string> }).ancestorOrigins;
    parentOrigin = (anc && anc.length ? originOfUrl(anc[0]) : null) ?? originOfUrl(document.referrer) ?? (sandbox ? self : null);
  }
  const send = (m: ToParent) => { if (framed && parentOrigin) try { window.parent.postMessage(m, parentOrigin); } catch { /* ignore */ } };
  return { parentOrigin, init, send, verified };
}
