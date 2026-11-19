import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { LoadingState } from "@/components/states";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, login } = useAuth();
  const loc = useLocation();
  useEffect(() => { if (status === "signedOut") void login(loc.pathname + loc.search); }, [status, login, loc.pathname, loc.search]);
  if (status !== "signedIn") return <LoadingState />;
  return <>{children}</>;
}
