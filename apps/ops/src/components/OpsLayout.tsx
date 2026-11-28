import { usePageTitle } from "@/hooks/usePageTitle";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Globe2, Tags, Activity, BarChart3, Banknote, Crosshair, HandCoins, House, Siren, Building2, Flag, Languages, DatabaseZap, Handshake, UserPlus, Inbox, LogOut, MessagesSquare, Moon, Plug, PackageCheck, Receipt, Route, ScrollText, Settings2, Scale, ShieldCheck, Sun, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { useLeadsUnread } from "@/api/partnerLeads";
import { useSiteLeadSummary } from "@/api/siteLeads";
import { GrowthNav } from "@/components/growth/GrowthNav";
import { KiorlyLogo, KiorlyMark } from "@/components/KiorlyLogo";
import { KIORLY_ROUTES, isKiorly } from "@/lib/edition";
import { canOpen } from "@/lib/roleAccess";
import NoAccessPage from "@/pages/NoAccessPage";

/** Unread count on the Partner leads entry (new leads this person has not opened yet). */
function LeadsBadge({ className }: { className?: string }) {
  const { t } = useTranslation(); const n = useLeadsUnread().data?.count ?? 0;
  if (n < 1) return null;
  return <span className={cn("kx-label-num ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground", className)} data-testid="nav-leads-badge" role="status" aria-label={t("leads.alerts.unread", { count: n })}>{n > 99 ? "99+" : n}</span>;
}

/** New (not yet contacted) join requests from the Kiorly site. */
function SiteLeadsBadge() {
  const { t } = useTranslation(); const n = useSiteLeadSummary().data?.byStatus.NEW ?? 0;
  if (n < 1) return null;
  return <span className="kx-label-num ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground" data-testid="site-leads-badge" aria-label={t("siteLeads.newBadge", { count: n })}>{n > 99 ? "99+" : n}</span>;
}

const NAV = [
  { to: "/providers", icon: Building2, key: "providers" }, { to: "/bookings", icon: Route, key: "bookings" }, { to: "/outbox", icon: Activity, key: "outbox" },
  { to: "/finance", icon: Banknote, key: "finance" }, { to: "/moderation", icon: ShieldCheck, key: "moderation" }, { to: "/liquidity", icon: Waves, key: "liquidity" }, { to: "/messaging", icon: MessagesSquare, key: "messaging" }, { to: "/integrations", icon: Plug, key: "integrationsCenter" }, { to: "/orders", icon: PackageCheck, key: "orders" }, { to: "/fees", icon: Receipt, key: "fees" }, { to: "/policy", icon: Scale, key: "policy" }, { to: "/operations", icon: Settings2, key: "operations" }, { to: "/safety", icon: Siren, key: "safety" }, { to: "/held-deposits", icon: HandCoins, key: "held" }, { to: "/payments-connection", icon: Plug, key: "payConn" }, { to: "/reconciliation", icon: Scale, key: "recon" }, { to: "/pay-ops", icon: Scale, key: "payOps" }, { to: "/commissions", icon: Banknote, key: "commissions" }, { to: "/commission-policy", icon: Scale, key: "commissionPolicy" }, { to: "/home-gate", icon: House, key: "homeGate" }, { to: "/flags", icon: Flag, key: "flags" }, { to: "/onboarding", icon: DatabaseZap, key: "onboarding" }, { to: "/partner-onboarding", icon: Handshake, key: "partnerOnboarding" }, { to: "/partner-leads", icon: UserPlus, key: "partnerLeads" }, { to: "/leads", icon: Inbox, key: "siteLeads" }, { to: "/kiorly-markets", icon: Globe2, key: "kiorlyMarkets" }, { to: "/kiorly-plans", icon: Tags, key: "kiorlyPlans" }, { to: "/growth-analytics", icon: BarChart3, key: "growthAnalytics" }, { to: "/acquisition", icon: Crosshair, key: "acquisition" },
] as const;

/** The Kiorly admin offers only the provider-product views (lib/edition.ts); the Kiorex super admin offers everything. */
const EDITION_NAV = isKiorly ? NAV.filter((n) => (KIORLY_ROUTES as readonly string[]).includes(n.to)) : NAV;

export function OpsLayout() {
  const { t, i18n } = useTranslation();
  usePageTitle(isKiorly ? t("edition.kiorlyTitle") : "Kiorex Ops");
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const next = i18n.language.startsWith("ar") ? "en" : "ar";
  // navigation shows only what this person's roles may open (lib/roleAccess.ts); the Home entry is always first
  const roles = user?.roles ?? [];
  const VISIBLE_NAV: ReadonlyArray<{ readonly to: string; readonly icon: typeof LayoutDashboard; readonly key: string }> = [{ to: "/home", icon: LayoutDashboard, key: "home" }, ...EDITION_NAV.filter((n) => canOpen(roles, n.to))];
  const allowed = pathname === "/no-access" || canOpen(roles, pathname);
  const showGrowth = !isKiorly && canOpen(roles, "/growth");
  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>{t("common.skipToContent")}</a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e bg-card p-4 md:flex" aria-label={t("nav.main")}>
        {isKiorly ? <KiorlyLogo className="mb-2" height={44} arabic={i18n.language.startsWith("ar")} /> : <Logo className="mb-2" height={56} />}
        <p className="mb-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{isKiorly ? t("edition.console") : t("nav.console")}</p>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto" data-testid="sidebar-nav">
          {VISIBLE_NAV.map(({ to, icon: Icon, key }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-accent", isActive && "bg-accent text-accent-foreground ring-1 ring-pulse/40")}>
              <Icon className="h-4 w-4" aria-hidden="true" />{t(`nav.${key}`)}{key === "partnerLeads" ? <LeadsBadge /> : key === "siteLeads" ? <SiteLeadsBadge /> : null}
            </NavLink>
          ))}
          {showGrowth ? <GrowthNav /> : null}
        </nav>
        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><ScrollText className="inline h-3 w-3" aria-hidden="true" /> {user?.name ?? user?.sub}<br />{user?.roles.join(", ")}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-x-2 border-b bg-card/90 px-4 backdrop-blur-sm">
          <span className="shrink-0 md:hidden" dir="ltr" data-testid="mobile-logo">{isKiorly ? <KiorlyMark height={28} /> : <LogoMark height={28} title="KIOREX" />}</span>
          <nav className="order-last flex w-full min-w-0 gap-1 overflow-x-auto md:hidden" aria-label={t("nav.main")}>
            {VISIBLE_NAV.map(({ to, key }) => <NavLink key={to} to={to} className={({ isActive }) => cn("min-h-11 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm", isActive && "bg-accent font-semibold text-accent-foreground")}><span className="inline-flex items-center gap-1.5">{t(`nav.${key}`)}{key === "partnerLeads" ? <LeadsBadge className="ms-1" /> : null}</span></NavLink>)}
            {showGrowth ? <NavLink to="/growth" className={({ isActive }) => cn("min-h-11 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm", (isActive || pathname.startsWith("/growth")) && "bg-accent font-semibold text-accent-foreground")} data-testid="mobile-growth-link">{t("growth.nav.group")}</NavLink> : null}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(next)} data-testid="lang-toggle"><Languages aria-hidden="true" /><span lang={next}>{next === "ar" ? "العربية" : "English"}</span></Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={t("nav.theme")}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
            <Button variant="outline" size="sm" onClick={() => void logout()}><LogOut className="rtl-flip" aria-hidden="true" />{t("nav.signOut")}</Button>
          </div>
        </header>
        <main key={pathname} id="main-content" className="kx-page flex-1 p-4 md:p-8" tabIndex={-1}>{allowed ? <Outlet /> : <NoAccessPage />}</main>
      </div>
    </div>
  );
}
