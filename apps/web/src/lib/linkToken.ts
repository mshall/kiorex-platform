/**
 * In-session provider link token `lt` (GRW-P1-C). A provider's link, QR or widget lands on Kiorex with `?lt=<signed token>`; the visitor may browse for a while before
 * booking, so the token is kept for THIS TAB only (sessionStorage, never a cookie, never localStorage) and sent on the booking request, where the server verifies it.
 * It is opaque, signed, short-lived and carries no person. A malformed value is never stored.
 */
const KEY = "kx-lt";
const SHAPE = /^[A-Za-z0-9_.-]{20,600}$/;
const store = (): Storage | undefined => { try { return typeof window !== "undefined" ? window.sessionStorage : undefined; } catch { return undefined; } };

export function captureLinkToken(search: string, s: Pick<Storage, "setItem"> | undefined = store()) {
  const lt = new URLSearchParams(search).get("lt");
  if (lt && SHAPE.test(lt)) { try { s?.setItem(KEY, lt); } catch { /* private mode: the token then lives for this page only */ } }
}
export function getLinkToken(s: Pick<Storage, "getItem"> | undefined = store()): string | undefined {
  try { const v = s?.getItem(KEY); return v && SHAPE.test(v) ? v : undefined; } catch { return undefined; }
}
