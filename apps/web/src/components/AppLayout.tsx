import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, CalendarCheck, FolderHeart, Grid2x2, Home, Languages, LogIn, LogOut, Moon, Sun, User, WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/useOnline";
import { MarketNotLiveBanner, MarketSelector } from "@/components/MarketSelector";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { PulseDivider } from "@/components/PulseLine";
import { useAuth } from "@/auth/AuthProvider";
import { useNotifications } from "@/api/engagement";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const next = i18n.language.startsWith("ar") ? "en" : "ar";
  return (
    <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(next)} aria-label={t("nav.switchLanguage")} data-testid="lang-toggle">
      <Languages aria-hidden="true" />
      <span lang={next} className="hidden sm:inline">{next === "ar" ? "العربية" : "English"}</span>
    </Button>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}>
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  cn("inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors hover:bg-accent", isActive && "text-primary underline decoration-pulse decoration-2 underline-offset-8");

/** Slim, announced banner while the browser has no connection (the pages keep showing cached data). */
function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  if (online) return null;
  return <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-sm font-medium text-warning" data-testid="offline-banner"><WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />{t("p3.offlineBanner")}</div>;
}

/** Inbox bell with the unread count; polls lightly (KXM-NT-01). */
function NotificationBell() {
  const { t } = useTranslation();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.readAt).length;
  return (
    <Button asChild variant="ghost" size="icon" className="relative" aria-label={unread ? t("notifications.bellUnread", { count: unread }) : t("notifications.title")}>
      <Link to="/notifications" data-testid="notification-bell"><Bell aria-hidden="true" />{unread > 0 && <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pulse px-1 text-[10px] font-semibold leading-none text-pulse-foreground" data-testid="notification-count">{unread > 9 ? "9+" : unread}</span>}</Link>
    </Button>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const { status, login, logout } = useAuth();
  const signedIn = status === "signedIn";
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }); }, [pathname]); // new screen starts at the top (booking flow lands on the confirmation moment)
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:z-60 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">{t("nav.skip")}</a>
      <MarketNotLiveBanner />
      <OfflineBanner />
      {/* The six-link nav plus sign out only fit from 1024 px in English (they overflowed 768 to 907 px signed in); below that the bottom tab bar carries the same destinations and Account carries sign out. */}
      <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur-md kx-hairline">
        <div className="container flex min-h-16 items-center justify-between gap-2 sm:gap-3">
          <Link to="/" aria-label={t("nav.home")} className="inline-flex shrink-0 items-center rounded-lg"><Logo className="hidden sm:inline-flex" height={64} /><Logo className="sm:hidden" height={60} /></Link>
          <nav aria-label={t("nav.main")} className="hidden items-center gap-1 lg:flex">
            <NavLink to="/" end className={navCls}>{t("nav.home")}</NavLink>
            <NavLink to="/search" className={navCls}>{t("nav.search")}</NavLink>
            {signedIn && <NavLink to="/appointments" className={navCls}>{t("nav.appointments")}</NavLink>}
            <NavLink to="/services" className={navCls}>{t("nav.services")}</NavLink>
            {signedIn && <NavLink to="/records" className={navCls}>{t("nav.records")}</NavLink>}
            {signedIn && <NavLink to="/account" className={navCls}>{t("nav.account")}</NavLink>}
          </nav>
          <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            <MarketSelector />
            {signedIn && <NotificationBell />}
            <LanguageSwitcher />
            <ThemeToggle />
            {status !== "loading" && (signedIn ? (
              <Button variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => void logout()}><LogOut className="rtl-flip" aria-hidden="true" />{t("nav.signOut")}</Button>
            ) : (
              <Button size="sm" className="px-2.5 sm:px-3" onClick={() => void login("/")} data-testid="sign-in"><LogIn className="rtl-flip" aria-hidden="true" /><span className="max-[359px]:sr-only">{t("nav.signIn")}</span></Button>
            ))}
          </div>
        </div>
      </header>

      <main id="main" key={pathname} className="kx-page container flex-1 py-8 pb-28 lg:pb-12" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="border-t bg-card">
        <div className="container space-y-4 py-8">
          <PulseDivider />
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
            <Logo height={56} />
            <p>{t("footer.tagline")}</p>
            <p>{t("footer.emergency")}</p>
            <Link to="/preferences" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" data-testid="footer-preferences">{t("consent.banner.preferences")}</Link>
          </div>
        </div>
      </footer>

      {signedIn && (
        <nav aria-label={t("nav.main")} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card lg:hidden">
          {[{ to: "/", icon: Home, label: t("nav.home"), end: true }, { to: "/appointments", icon: CalendarCheck, label: t("nav.appointments") }, { to: "/services", icon: Grid2x2, label: t("nav.services") }, { to: "/records", icon: FolderHeart, label: t("nav.records") }, { to: "/account", icon: User, label: t("nav.account") }].map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium", isActive ? "text-primary" : "text-muted-foreground")}>
              {({ isActive }) => (<><Icon className="h-5 w-5" aria-hidden="true" /><span className={cn(isActive && "border-b-2 border-pulse")}>{label}</span></>)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
