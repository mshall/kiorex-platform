import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { config } from "@/lib/config";
import { secureStore } from "@/lib/storage";
import { configureApi } from "@/api/client";
import { decodeClaims } from "./jwt";
import { endPassportSession } from "./endSession";
import { refreshPushRegistration } from "@/lib/push";
import i18n from "@/i18n";

// Completes the popup / in-app browser session on web and native when returning to kiorex://auth/callback.
WebBrowser.maybeCompleteAuthSession();

const KEY = "kx-passport-tokens";
interface Stored { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number }
export interface AuthUser { sub: string; name?: string; phone?: string; roles: string[] }
type Status = "loading" | "signedOut" | "signedIn";
interface Ctx { status: Status; user: AuthUser | null; login: (loginHint?: string) => Promise<boolean>; completeWebLogin: (p: { code?: string; state?: string }) => Promise<boolean>; logout: () => Promise<void>; error: string | null; busy: boolean }
const AuthCtx = createContext<Ctx | null>(null);

export const redirectUri = () => AuthSession.makeRedirectUri({ scheme: "kiorex", path: "auth/callback" });
let discoveryCache: AuthSession.DiscoveryDocument | null = null;
const discover = async () => (discoveryCache ??= await AuthSession.fetchDiscoveryAsync(config.oidcIssuer));

const toUser = (t: Stored): AuthUser => {
  const c = decodeClaims(t.accessToken) ?? decodeClaims(t.idToken);
  return { sub: c?.sub ?? "unknown", name: c?.name, phone: c?.phone_number, roles: c?.kx_roles ?? [] };
};
const WEB_PKCE = "kx-web-pkce"; // sessionStorage: { state, verifier } for the redirect flow
const MOCK_TOKEN: Stored = { accessToken: "mock.e30.mock", expiresAt: Date.now() + 365 * 86_400_000 };

/** Kiorex Passport sign-in: OIDC authorization-code + PKCE (expo-auth-session), tokens in expo-secure-store. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokens = useRef<Stored | null>(null);

  const setSession = useCallback(async (t: Stored | null) => {
    tokens.current = t;
    if (t) { await secureStore.set(KEY, JSON.stringify(t)); setUser(config.mock ? { sub: "mock", name: "Amira", roles: ["patient"] } : toUser(t)); setStatus("signedIn"); }
    else { await secureStore.remove(KEY); setUser(null); setStatus("signedOut"); qc.clear(); }
  }, [qc]);

  const fromResponse = (r: AuthSession.TokenResponse, prev?: Stored): Stored => ({
    accessToken: r.accessToken, refreshToken: r.refreshToken ?? prev?.refreshToken, idToken: r.idToken ?? prev?.idToken,
    expiresAt: Date.now() + (r.expiresIn ?? 900) * 1000,
  });

  const getToken = useCallback(async (): Promise<string | null> => {
    const t = tokens.current;
    if (!t) return null;
    if (config.mock || t.expiresAt - Date.now() > 30_000) return t.accessToken;
    if (!t.refreshToken) { await setSession(null); return null; }
    try {
      const d = await discover();
      const r = await AuthSession.refreshAsync({ clientId: config.oidcClientId, refreshToken: t.refreshToken }, d);
      const next = fromResponse(r, t);
      await setSession(next);
      return next.accessToken;
    } catch { await setSession(null); return null; }
  }, [setSession]);

  useEffect(() => {
    configureApi({ getToken, onUnauthorized: () => { if (!config.mock) void setSession(null); } });
    void (async () => {
      const raw = await secureStore.get(KEY);
      if (raw) { try { await setSession(JSON.parse(raw) as Stored); return; } catch { /* fallthrough */ } }
      setStatus("signedOut");
    })();
  }, [getToken, setSession]);

  useEffect(() => { if (status === "signedIn") void refreshPushRegistration(i18n.language?.startsWith("en") ? "en" : "ar"); }, [status]);

  const login = useCallback(async (loginHint?: string) => {
    setError(null); setBusy(true);
    try {
      if (config.mock) { await setSession(MOCK_TOKEN); return true; }
      const d = await discover();
      const request = new AuthSession.AuthRequest({ clientId: config.oidcClientId, redirectUri: redirectUri(), scopes: config.oidcScopes, usePKCE: true, responseType: AuthSession.ResponseType.Code, ...(loginHint ? { extraParams: { login_hint: loginHint } } : {}) });
      if (Platform.OS === "web") {
        // Full-page redirect (no popup: popup blockers and embedded browsers break the opener hand-off). The code is exchanged on /auth/callback.
        const url = await request.makeAuthUrlAsync(d);
        sessionStorage.setItem(WEB_PKCE, JSON.stringify({ state: request.state, verifier: request.codeVerifier }));
        window.location.assign(url);
        return false;
      }
      const res = await request.promptAsync(d);
      if (res.type !== "success") return false;
      const tr = await AuthSession.exchangeCodeAsync({ clientId: config.oidcClientId, code: res.params.code, redirectUri: redirectUri(), extraParams: { code_verifier: request.codeVerifier ?? "" } }, d);
      await setSession(fromResponse(tr));
      return true;
    } catch (e) {
      console.log("[auth] sign-in failed:", (e as Error).message);
      setError("signIn.failed");
      return false;
    } finally { setBusy(false); }
  }, [setSession]);

  /** Web redirect flow, step 2: called by /auth/callback with the `code` + `state` query params. */
  const completeWebLogin = useCallback(async (p: { code?: string; state?: string }) => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(WEB_PKCE) ?? "null") as { state: string; verifier: string } | null;
      sessionStorage.removeItem(WEB_PKCE);
      if (!p.code || !saved || saved.state !== p.state) throw new Error("state mismatch");
      const d = await discover();
      const tr = await AuthSession.exchangeCodeAsync({ clientId: config.oidcClientId, code: p.code, redirectUri: redirectUri(), extraParams: { code_verifier: saved.verifier } }, d);
      await setSession(fromResponse(tr));
      return true;
    } catch (e) { console.log("[auth] web callback failed:", (e as Error).message); setError("signIn.failed"); return false; }
  }, [setSession]);

  /** Clears the app session first (so the app is signed out whatever happens next), then ends the Passport session (id_token_hint: no confirm page). */
  const logout = useCallback(async () => {
    const idToken = tokens.current?.idToken;
    await setSession(null);
    await endPassportSession(idToken);
  }, [setSession]);
  const value = useMemo(() => ({ status, user, login, completeWebLogin, logout, error, busy }), [status, user, login, completeWebLogin, logout, error, busy]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
