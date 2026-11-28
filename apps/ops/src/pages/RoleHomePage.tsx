import { lazy } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { dashboardRole, heldRoles, type ConsoleRole } from "@/lib/roleAccess";
import { cn } from "@/lib/utils";

const SuperAdminDashboard = lazy(() => import("./dashboards/SuperAdminDashboard"));
const OpsAdminDashboard = lazy(() => import("./dashboards/OpsAdminDashboard"));
const FinanceDashboard = lazy(() => import("./dashboards/FinanceDashboard"));
const GrowthDashboard = lazy(() => import("./dashboards/GrowthDashboard"));
const KiorlyDashboard = lazy(() => import("./dashboards/KiorlyDashboard"));

/** Home of the console: every role lands on its OWN dashboard (ADR-062). A person who holds several roles sees the first and can switch with ?role=. */
export default function RoleHomePage() {
  const { t } = useTranslation(); const { user } = useAuth(); const [sp] = useSearchParams();
  const roles = user?.roles ?? []; const role = dashboardRole(roles, sp.get("role"));
  if (!role) return <Navigate to="/no-access" replace />;
  const held = heldRoles(roles);
  return (
    <div data-testid="role-home" data-role={role}>
      <PageHeader title={t(`roleHome.titles.${role}`)} hint={t(`roleHome.hints.${role}`)} />
      {held.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("roleHome.switch")} data-testid="role-switch">
          {held.map((r) => <Link key={r} to={`/home?role=${r}`} aria-current={r === role ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-lg border px-3 text-sm", r === role ? "bg-accent font-semibold" : "hover:bg-accent")}>{t(`roleHome.roles.${r}`)}</Link>)}
        </nav>
      )}
      <Dashboard role={role} />
    </div>
  );
}
function Dashboard({ role }: { role: ConsoleRole }) {
  switch (role) {
    case "super_admin": return <SuperAdminDashboard />;
    case "ops_admin": return <OpsAdminDashboard />;
    case "finance": return <FinanceDashboard />;
    case "growth_admin": return <GrowthDashboard />;
    case "kiorly_admin": return <KiorlyDashboard admin />;
    case "kiorly_ops": return <KiorlyDashboard admin={false} />;
  }
}
