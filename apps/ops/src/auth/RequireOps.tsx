import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states";
import { useAuth } from "./AuthProvider";
import { isKiorly } from "@/lib/edition";
import { isKiorlyOnly, isMixed } from "@/lib/roleAccess";

export const OPS_ROLES = ["ops_admin", "super_admin", "growth_admin", "finance", "kiorly_ops", "kiorly_admin"];
export const isOps = (roles: string[]) => roles.some((r) => OPS_ROLES.includes(r));
export const isSuperAdmin = (roles: string[]) => roles.includes("super_admin");

/** Console is for ops_admin / super_admin / growth_admin (GRW-P2-S reviewer) only (client kiorex-ops). The API enforces roles too; this is UX. */
export function RequireOps({ children }: { children: ReactNode }) {
  const { status, user, login, logout } = useAuth();
  const { t } = useTranslation();
  useEffect(() => { if (status === "signedOut") void login(window.location.pathname + window.location.search); }, [status, login]);
  if (status !== "signedIn") return <LoadingState />;
  // Kiorly-only roles belong to the Kiorly admin: the Kiorex console refuses them, and a sign-in that mixes Kiorex and Kiorly roles is refused in both (separate accounts, ADR-062)
  const wrongHome = !!user && isKiorlyOnly(user.roles) && !isKiorly;
  if (!user || !isOps(user.roles) || wrongHome || isMixed(user.roles)) {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-4 text-center" role="alert">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-xl">{wrongHome ? t("auth.kiorlyOnlyTitle") : t("auth.noAccessTitle")}</h1>
        <p className="text-muted-foreground" data-testid="no-access-reason">{wrongHome ? t("auth.kiorlyOnlyBody") : t("auth.noAccessBody")}</p>
        <Button variant="outline" onClick={() => void logout()}>{t("nav.signOut")}</Button>
      </div>
    );
  }
  return <>{children}</>;
}
