/**
 * Popup return page script (/v1/embed/auth/callback): hands the authorisation code back to the widget iframe that opened the popup, then closes. The target origin is this
 * page's own origin (the iframe and the popup share the widget origin), never `*`. No token is ever in this URL: only the one-time code and the state.
 */
const q = new URLSearchParams(location.search);
const state = q.get('state') ?? '';
const code = q.get('code') ?? '';
if (window.opener && state) {
  window.opener.postMessage({ kx: 1, type: 'kx:oidc', state, code: q.get('error') ? '' : code }, location.origin);
}
window.close();
const el = document.getElementById('msg');
if (el) el.hidden = false;
