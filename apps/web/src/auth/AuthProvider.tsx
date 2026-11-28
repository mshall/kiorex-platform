import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { configureApi } from "@/api/client";
import { getManager, toAuthUser, type AuthUser } from "./oidc";
import { INTENT_KEY, REASON_KEY, sset, type AuthIntent } from "@/lib/onboarding";

type Status = "loading" | "signedOut" | "signedIn";
export interface AuthCtx {
  status: Status;
  user: AuthUser | null;
  login: (returnTo?: string, opts?: { intent?: AuthIntent }) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<string>;
}
export const AuthContext = createContext<AuthCtx | null>(null);
const RETURN_KEY = "kx-return-to";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  // true while the RP-initiated logout navigation to Passport /session/end is in flight (see logout())
  const signingOut = useRef(false);
  // layout effect: runs before any child's passive effect, so a request fired right after sign-in sees the new token
  useLayoutEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    configureApi({
      getToken: async () => userRef.current?.token ?? null,
      onUnauthorized: () => { sset(REASON_KEY, "expired"); void getManager().removeUser().then(() => { setUser(null); setStatus("signedOut"); }); },
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = getManager();
      const u = await m.getUser();
      if (!alive) return;
      if (u && !u.expired) { setUser(toAuthUser(u)); setStatus("signedIn"); } else { setStatus("signedOut"); }
      m.events.addUserLoaded((nu) => { setUser(toAuthUser(nu)); setStatus("signedIn"); });
      m.events.addUserUnloaded(() => { setUser(null); if (!signingOut.current) setStatus("signedOut"); });
      // The refresh token stopped working (revoked from another device, or expired): say so before the next request fails, and offer a one-click sign-in that returns here.
      m.events.addSilentRenewError(() => {
        toast.warning(i18n.t("session.renewFailed"), { id: "session-renew", duration: Infinity, action: { label: i18n.t("nav.signIn"), onClick: () => { sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search); void m.signinRedirect({ ui_locales: i18n.language.startsWith("ar") ? "ar" : "en" }); } } });
      });
    })().catch(() => alive && setStatus("signedOut"));
    return () => { alive = false; };
  }, []);

  // Passport contract (docs/PASSPORT_ENTRY_CONTRACT in the web README): `ui_locales` (ar|en) and the extra parameter `intent=register|signin`.
  // Passport may ignore `intent` (the phone code creates the account on first verification either way); Kiorex never relies on it: it decides "new or existing" from its own profile after the return.
  const login = useCallback(async (returnTo?: string, opts?: { intent?: AuthIntent }) => {
    const intent: AuthIntent = opts?.intent ?? "signin";
    sessionStorage.setItem(RETURN_KEY, returnTo ?? window.location.pathname + window.location.search);
    sset(INTENT_KEY, intent); sset(REASON_KEY, null);
    await getManager().signinRedirect({ ui_locales: i18n.language.startsWith("ar") ? "ar" : "en", extraQueryParams: { intent } });
  }, []);

  const logout = useCallback(async () => {
    // signoutRedirect() drops the local user first; flipping to "signedOut" would make RequireAuth start a new sign-in
    // redirect that cancels the /session/end navigation, so the Passport session would survive. Stay in "loading".
    signingOut.current = true;
    setStatus("loading");
    try {
      await getManager().signoutRedirect();
    } catch (e) {
      signingOut.current = false;
      setUser(null);
      setStatus("signedOut");
      throw e;
    }
  }, []);

  const completeLogin = useCallback(async () => {
    const u = await getManager().signinRedirectCallback();
    setUser(toAuthUser(u)); setStatus("signedIn");
    const back = sessionStorage.getItem(RETURN_KEY) ?? "/";
    sessionStorage.removeItem(RETURN_KEY);
    return back;
  }, []);

  const value = useMemo(() => ({ status, user, login, logout, completeLogin }), [status, user, login, logout, completeLogin]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
