import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarCheck, ChevronRight, Sparkles, FlaskConical, FolderHeart, Grid2x2, Pill, Video, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useBookings, useMe } from "@/api/hooks";
import { usePreferences } from "@/api/consent";
import { useAuth } from "@/auth/AuthProvider";
import { INTEREST_LINK, getInterests, isDeviceDone, sget, sset } from "@/lib/onboarding";
import { useState } from "react";
import { HeroSearch } from "@/components/HeroSearch";
import { SpecialtyChips } from "@/components/SearchBar";
import { CareTypeTabs } from "@/components/CareTypeTabs";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { AppointmentTicket } from "@/components/AppointmentTicket";
import { DoctorAvatar } from "@/components/DoctorAvatar";
import { EmptyState, ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { pick } from "@/lib/format";
import { getRecent } from "@/lib/recent";
import { cn } from "@/lib/utils";
import { useFeature } from "@/hooks/useFeature";
import { usePatient } from "@/hooks/usePatient";
import { ContinuityCards } from "@/components/continuity/ContinuityCards"; // GRW-P4-A

const UPCOMING = ["HELD", "PENDING_CLINIC", "CONFIRMED", "CHECKED_IN"];
const QUICK: { to: string; icon: LucideIcon; k: string }[] = [
  { to: "/records", icon: FolderHeart, k: "nav.records" }, { to: "/pharmacy", icon: Pill, k: "pharmacy.title" }, { to: "/lab", icon: FlaskConical, k: "lab.title" }, { to: "/telemedicine", icon: Video, k: "tele.title" }, { to: "/services", icon: Grid2x2, k: "nav.services" },
];

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const me = useMe();
  const bookings = useBookings();
  const family = useFeature("kiorex.family_accounts");
  const { nameOf } = usePatient();
  const upcoming = (bookings.data ?? []).filter((b) => UPCOMING.includes(b.status) && new Date(b.endsAt) > new Date())[0];
  const recent = getRecent();
  const { user } = useAuth();
  const prefs = usePreferences();
  const interests = getInterests();
  const [dismissed, setDismissed] = useState(() => sget("kx-setup-dismissed") === "1");
  const setupOpen = !dismissed && !!prefs.data && !prefs.data.reminders.updatedAt && !prefs.data.analytics.updatedAt && !isDeviceDone(user?.sub ?? "anon");
  const first = me.data ? (i18n.language.startsWith("ar") ? me.data.nameAr : me.data.nameEn) ?? me.data.nameEn ?? me.data.nameAr : null;

  return (
    <div className="space-y-10">
      <section className="kx-hero min-w-0 space-y-5 rounded-3xl border p-5 shadow-float md:p-8" aria-labelledby="home-title">
        <div className="space-y-1">
          <p className="kx-eyebrow">{t("home.eyebrow")}</p>
          <h1 id="home-title" className="text-3xl md:text-4xl">{first ? t("home.greeting", { name: first }) : t("home.greetingAnon")}</h1>
        </div>
        <HeroSearch />
        <div className="space-y-3">
          <CareTypeTabs onPick={(c) => nav(c ? `/search?careType=${c}${c === "HOME_NURSING" ? "&serviceLocation=HOME" : ""}` : "/search")} />
          <SpecialtyChips onPick={(code) => nav(code ? `/search?specialty=${code}` : "/search")} />
        </div>
      </section>

      {setupOpen && (
        <section className="kx-card flex flex-wrap items-center justify-between gap-4 border-primary/30 p-5" aria-labelledby="setup-title" data-testid="finish-setup">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
            <div><h2 id="setup-title" className="text-lg">{t("home.finishSetup")}</h2><p className="text-sm text-muted-foreground">{t("home.finishSetupBody")}</p></div></div>
          <div className="flex items-center gap-2"><button type="button" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => { sset("kx-setup-dismissed", "1"); setDismissed(true); }}>{t("welcome.skip")}</button><Link to="/welcome?review=1" className={cn(buttonVariants())}>{t("home.finishSetupGo")}</Link></div>
        </section>
      )}

      {interests.length > 0 && (
        <section aria-labelledby="foryou-title" className="space-y-3" data-testid="for-you">
          <div className="flex items-center justify-between gap-3"><h2 id="foryou-title" className="kx-section-title">{t("home.forYou")}</h2><Link to="/welcome?review=1" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">{t("home.forYouEdit")}</Link></div>
          <ul className="flex flex-wrap gap-2">{interests.map((i) => <li key={i}><Link to={INTEREST_LINK[i]} className="kx-chip">{t(`welcome.interests.items.${i}`)}</Link></li>)}</ul>
        </section>
      )}

      <ContinuityCards />

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="upcoming-title" className="space-y-3">
          <h2 id="upcoming-title" className="kx-section-title">{t("home.upcoming")}</h2>
          {family.enabled && <FamilySwitcher />}
          {bookings.isLoading ? <Skeleton className="h-28 w-full rounded-xl" /> : bookings.error ? <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} /> : upcoming ? (
            <AppointmentTicket booking={upcoming} patientName={nameOf(upcoming.patient.id)} />
          ) : (
            <EmptyState icon={<CalendarCheck className="h-10 w-10" aria-hidden="true" />} title={t("home.noUpcoming")} hint={t("home.noUpcomingHint")} action={<Link to="/search" className={cn(buttonVariants())}>{t("home.findDoctor")}</Link>} />
          )}
        </section>

        <section aria-labelledby="quick-title" className="space-y-3">
          <h2 id="quick-title" className="kx-section-title">{t("home.quick")}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            {QUICK.map(({ to, icon: Icon, k }) => (
              <li key={to}><Link to={to} className="kx-card kx-card-interactive flex min-h-14 items-center gap-3 p-3.5 text-sm font-semibold"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>{t(k)}</Link></li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="recent-title" className="space-y-3">
        <h2 id="recent-title" className="kx-section-title">{t("home.recent")}</h2>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">{t("home.recentEmpty")}</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((d) => (
              <li key={d.id}><Link to={`/doctors/${d.id}`} className="kx-card kx-card-interactive flex min-h-16 items-center gap-3 p-3.5"><DoctorAvatar name={pick(d, "name", i18n.language)} size="sm" /><span className="flex-1 font-medium">{pick(d, "name", i18n.language)}</span><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
