import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { configureApi } from "@/api/client";
import { getManager, toAuthUser, type AuthUser } from "./oidc";

type Status = "loading" | "signedOut" | "signedIn";
export interface AuthCtx {
  status: Status;
  user: AuthUser | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<string>;
}
export const AuthContext = createContext<AuthCtx | null>(null);
const RETURN_KEY = "kx-return-to";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    configureApi({
      getToken: async () => userRef.current?.token ?? null,
      onUnauthorized: () => { void getManager().removeUser().then(() => { setUser(null); setStatus("signedOut"); }); },
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
      m.events.addUserUnloaded(() => { setUser(null); setStatus("signedOut"); });
    })().catch(() => alive && setStatus("signedOut"));
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (returnTo?: string) => {
    sessionStorage.setItem(RETURN_KEY, returnTo ?? window.location.pathname + window.location.search);
    await getManager().signinRedirect();
  }, []);

  const logout = useCallback(async () => {
    await getManager().signoutRedirect();
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
