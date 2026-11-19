import { Link, NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarCheck, Home, Languages, LogIn, LogOut, Moon, Sun, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { PulseDivider } from "@/components/PulseLine";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const next = i18n.language.startsWith("ar") ? "en" : "ar";
  return (
    <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(next)} aria-label={t("nav.switchLanguage")} data-testid="lang-toggle">
      <Languages aria-hidden="true" />
      <span lang={next}>{next === "ar" ? "العربية" : "English"}</span>
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

export function AppLayout() {
  const { t } = useTranslation();
  const { status, login, logout } = useAuth();
  const signedIn = status === "signedIn";
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">{t("nav.skip")}</a>
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
        <div className="container flex min-h-16 items-center justify-between gap-3">
          <Link to="/" aria-label={t("nav.home")} className="rounded-lg"><Logo /></Link>
          <nav aria-label={t("nav.main")} className="hidden items-center gap-1 md:flex">
            <NavLink to="/" end className={navCls}>{t("nav.home")}</NavLink>
            <NavLink to="/search" className={navCls}>{t("nav.search")}</NavLink>
            {signedIn && <NavLink to="/appointments" className={navCls}>{t("nav.appointments")}</NavLink>}
            {signedIn && <NavLink to="/account" className={navCls}>{t("nav.account")}</NavLink>}
          </nav>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
            {status !== "loading" && (signedIn ? (
              <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => void logout()}><LogOut className="rtl-flip" aria-hidden="true" />{t("nav.signOut")}</Button>
            ) : (
              <Button size="sm" onClick={() => void login("/")} data-testid="sign-in"><LogIn className="rtl-flip" aria-hidden="true" />{t("nav.signIn")}</Button>
            ))}
          </div>
        </div>
      </header>

      <main id="main" className="container flex-1 py-6 pb-28 md:pb-10" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="border-t bg-card">
        <div className="container space-y-4 py-8">
          <PulseDivider />
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
            <Logo markClassName="h-6" />
            <p>{t("footer.tagline")}</p>
            <p>{t("footer.emergency")}</p>
          </div>
        </div>
      </footer>

      {signedIn && (
        <nav aria-label={t("nav.main")} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-card md:hidden">
          {[{ to: "/", icon: Home, label: t("nav.home"), end: true }, { to: "/appointments", icon: CalendarCheck, label: t("nav.appointments") }, { to: "/account", icon: User, label: t("nav.account") }].map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium", isActive ? "text-primary" : "text-muted-foreground")}>
              {({ isActive }) => (<><Icon className="h-5 w-5" aria-hidden="true" /><span className={cn(isActive && "border-b-2 border-pulse")}>{label}</span></>)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
