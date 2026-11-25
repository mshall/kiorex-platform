import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states";
import { useAuth } from "./AuthProvider";

export const OPS_ROLES = ["ops_admin", "super_admin", "growth_admin", "finance"];
export const isOps = (roles: string[]) => roles.some((r) => OPS_ROLES.includes(r));
export const isSuperAdmin = (roles: string[]) => roles.includes("super_admin");

/** Console is for ops_admin / super_admin / growth_admin (GRW-P2-S reviewer) only (client kiorex-ops). The API enforces roles too; this is UX. */
export function RequireOps({ children }: { children: ReactNode }) {
  const { status, user, login, logout } = useAuth();
  const { t } = useTranslation();
  useEffect(() => { if (status === "signedOut") void login(window.location.pathname + window.location.search); }, [status, login]);
  if (status !== "signedIn") return <LoadingState />;
  if (!user || !isOps(user.roles)) {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-4 text-center" role="alert">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl">{t("auth.noAccessTitle")}</h1>
        <p className="text-muted-foreground">{t("auth.noAccessBody")}</p>
        <Button variant="outline" onClick={() => void logout()}>{t("nav.signOut")}</Button>
      </div>
    );
  }
  return <>{children}</>;
}
