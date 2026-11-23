import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { config } from "@/lib/config";

/** Where Passport sends the browser after RP-initiated logout (registered as a post-logout URI of client kiorex-mobile). */
export const postLogoutUri = () =>
  Platform.OS === "web" ? `${window.location.origin}/` : AuthSession.makeRedirectUri({ scheme: "kiorex", path: "auth/logout" });

/**
 * RP-initiated logout URL (OIDC RP-Initiated Logout 1.0). With a verified `id_token_hint` Passport confirms the logout itself, so the
 * user never meets a "Stay signed in" button after pressing Sign out in the app. Without a hint only `client_id` is sent (Passport then asks).
 */
export function buildEndSessionUrl(endpoint: string, p: { idToken?: string; clientId: string; postLogoutRedirectUri: string; state?: string }): string {
  const q = new URLSearchParams();
  if (p.idToken) q.set("id_token_hint", p.idToken);
  q.set("client_id", p.clientId);
  q.set("post_logout_redirect_uri", p.postLogoutRedirectUri);
  if (p.state) q.set("state", p.state);
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${q}`;
}

/**
 * Ends the Passport (IdP) session so the app and the IdP agree after Sign out: the next "Continue with Kiorex Passport" asks for the phone
 * and code again instead of silently re-using the browser's SSO cookie. Best effort: the local session is already cleared by the caller,
 * so any failure here (offline, user dismissed the sheet, Expo Go redirect scheme) must never block or undo the sign-out.
 * Web navigates the whole page (it returns to `/`); native opens the system auth session and resolves when Passport redirects back.
 */
export async function endPassportSession(idToken: string | undefined, endpoint?: string): Promise<void> {
  if (config.mock) return;
  try {
    const ep = endpoint ?? (await AuthSession.fetchDiscoveryAsync(config.oidcIssuer)).endSessionEndpoint;
    if (!ep) return;
    const redirect = postLogoutUri();
    const url = buildEndSessionUrl(ep, { idToken, clientId: config.oidcClientId, postLogoutRedirectUri: redirect, state: Math.random().toString(36).slice(2) });
    if (Platform.OS === "web") { window.location.assign(url); return; }
    await WebBrowser.openAuthSessionAsync(url, redirect);
  } catch (e) {
    console.log("[auth] end-session failed (local sign-out already done):", (e as Error).message);
  }
}
