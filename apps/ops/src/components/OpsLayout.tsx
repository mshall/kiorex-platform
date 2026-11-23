import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, Banknote, HandCoins, House, Siren, Building2, Flag, Languages, DatabaseZap, LogOut, MessagesSquare, Moon, PackageCheck, Receipt, Route, ScrollText, Settings2, ShieldCheck, Sun, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/providers", icon: Building2, key: "providers" }, { to: "/bookings", icon: Route, key: "bookings" }, { to: "/outbox", icon: Activity, key: "outbox" },
  { to: "/finance", icon: Banknote, key: "finance" }, { to: "/moderation", icon: ShieldCheck, key: "moderation" }, { to: "/liquidity", icon: Waves, key: "liquidity" }, { to: "/messaging", icon: MessagesSquare, key: "messaging" }, { to: "/orders", icon: PackageCheck, key: "orders" }, { to: "/fees", icon: Receipt, key: "fees" }, { to: "/operations", icon: Settings2, key: "operations" }, { to: "/safety", icon: Siren, key: "safety" }, { to: "/held-deposits", icon: HandCoins, key: "held" }, { to: "/home-gate", icon: House, key: "homeGate" }, { to: "/flags", icon: Flag, key: "flags" }, { to: "/onboarding", icon: DatabaseZap, key: "onboarding" },
] as const;

export function OpsLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const next = i18n.language.startsWith("ar") ? "en" : "ar";
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e bg-card p-4 md:flex" aria-label={t("nav.main")}>
        <Logo className="mb-1" markClassName="h-9" />
        <p className="mb-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("nav.console")}</p>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, icon: Icon, key }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-accent", isActive && "bg-accent text-accent-foreground ring-1 ring-pulse/40")}>
              <Icon className="h-4 w-4" aria-hidden="true" />{t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><ScrollText className="inline h-3 w-3" aria-hidden="true" /> {user?.name ?? user?.sub}<br />{user?.roles.join(", ")}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b bg-card/90 px-4 backdrop-blur-sm">
          <nav className="flex gap-1 overflow-x-auto md:hidden" aria-label={t("nav.main")}>
            {NAV.map(({ to, key }) => <NavLink key={to} to={to} className={({ isActive }) => cn("min-h-11 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm", isActive && "bg-accent text-primary")}>{t(`nav.${key}`)}</NavLink>)}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(next)} data-testid="lang-toggle"><Languages aria-hidden="true" /><span lang={next}>{next === "ar" ? "العربية" : "English"}</span></Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={t("nav.theme")}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
            <Button variant="outline" size="sm" onClick={() => void logout()}><LogOut className="rtl-flip" aria-hidden="true" />{t("nav.signOut")}</Button>
          </div>
        </header>
        <main key={pathname} className="kx-page flex-1 p-4 md:p-8" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
