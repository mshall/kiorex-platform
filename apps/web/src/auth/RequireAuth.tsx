import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { LoadingState } from "@/components/states";
import { REASON_KEY, sget, sset } from "@/lib/onboarding";

/** A private page for a signed-out visitor goes to the Kiorex entry page (Sign in or Join us), never straight to Passport; the entry page brings them back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (status !== "signedOut") return;
    const reason = sget(REASON_KEY) === "expired" ? "expired" : "required";
    sset(REASON_KEY, null);
    nav(`/signin?reason=${reason}&returnTo=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
  }, [status, nav, loc.pathname, loc.search]);
  if (status !== "signedIn") return <LoadingState />;
  return <>{children}</>;
}
