import { ApiError } from './api';

/**
 * Kiorex Passport sign-in for the widget: Authorization Code + PKCE (S256) in a popup (phone number + one-time code happen on Passport, nothing is typed into the widget).
 * The popup returns to /v1/embed/auth/callback on the widget host, which posts {code,state} to its opener with an exact origin; the iframe checks origin, source and state.
 * The access token stays in memory (no storage): closing the page signs the visitor out of the widget.
 */
interface Meta { authorization_endpoint: string; token_endpoint: string }
let meta: Meta | null = null;

export async function discover(authority: string): Promise<void> {
  if (meta) return;
  const r = await fetch(`${authority}/.well-known/openid-configuration`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  const j = (await r.json()) as Meta;
  if (typeof j.authorization_endpoint !== 'string' || typeof j.token_endpoint !== 'string') throw new ApiError(0, 'IDP_UNAVAILABLE');
  meta = j;
}
export const isReady = () => meta !== null;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n: number) => b64(crypto.getRandomValues(new Uint8Array(n)));

export interface LoginParams { clientId: string; redirectUri: string; locale: string; self: string }

/** Must be called directly from a click handler (popup blockers). `discover()` has to have finished before. */
export function startLogin(p: LoginParams): { done: Promise<{ accessToken: string; expiresIn: number }>; cancel: () => void } {
  if (!meta) throw new ApiError(0, 'IDP_UNAVAILABLE');
  const m = meta;
  const verifier = rand(48); const state = rand(16); const nonce = rand(16);
  const u = new URL(m.authorization_endpoint);
  const win = window.open('', 'kx-passport', 'popup=yes,width=460,height=740');
  if (!win) throw new ApiError(0, 'POPUP_BLOCKED');
  let closed = false;
  const done = (async () => {
    const challenge = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    u.search = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri, scope: 'openid profile phone', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ui_locales: p.locale }).toString();
    win.location.href = u.toString();
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setInterval(() => { if (win.closed) { cleanup(); reject(new ApiError(0, 'CANCELLED')); } }, 500);
      const onMsg = (e: MessageEvent) => {
        if (e.origin !== p.self || e.source !== win) return;
        const d = e.data as { kx?: number; type?: string; state?: string; code?: string; error?: string };
        if (!d || d.kx !== 1 || d.type !== 'kx:oidc' || d.state !== state) return;
        cleanup();
        if (typeof d.code === 'string' && d.code.length < 2048) resolve(d.code); else reject(new ApiError(0, 'CANCELLED'));
      };
      const cleanup = () => { clearInterval(timer); window.removeEventListener('message', onMsg); closed = true; try { win.close(); } catch { /* ignore */ } };
      window.addEventListener('message', onMsg);
    });
    const r = await fetch(m.token_endpoint, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: verifier }).toString(),
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!r.ok || typeof j.access_token !== 'string') throw new ApiError(r.status, 'SIGN_IN_FAILED');
    return { accessToken: j.access_token, expiresIn: Number(j.expires_in) || 900 };
  })();
  return { done, cancel: () => { if (!closed) try { win.close(); } catch { /* ignore */ } } };
}
