import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

/** Shown inside the console when the role may not open the address (typed by hand or from an old bookmark). The API refuses the same calls with 403 FORBIDDEN_ROLE. */
export default function NoAccessPage() {
  const { t } = useTranslation(); const { pathname } = useLocation();
  return (
    <div className="mx-auto mt-16 max-w-md space-y-4 text-center" role="alert" data-testid="no-access-page">
      <ShieldAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
      <h1 className="text-xl">{t("roleHome.noAccess.title")}</h1>
      <p className="text-muted-foreground">{t("roleHome.noAccess.body")}</p>
      <p className="text-xs text-muted-foreground" dir="ltr">{pathname}</p>
      <Link to="/home" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent" data-testid="no-access-home">{t("roleHome.noAccess.home")}</Link>
    </div>
  );
}
