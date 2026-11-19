import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarCheck, ChevronRight, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useBookings, useMe } from "@/api/hooks";
import { SearchBar, SpecialtyChips } from "@/components/SearchBar";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { formatDayLong, formatTime, pick } from "@/lib/format";
import { getRecent } from "@/lib/recent";
import { cn } from "@/lib/utils";
import { PulseDivider } from "@/components/PulseLine";
import { useFeature } from "@/hooks/useFeature";
import { usePatient } from "@/hooks/usePatient";

const UPCOMING = ["HELD", "PENDING_CLINIC", "CONFIRMED", "CHECKED_IN"];

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const me = useMe();
  const bookings = useBookings();
  const family = useFeature("kiorex.family_accounts");
  const { nameOf } = usePatient();
  const upcoming = (bookings.data ?? []).filter((b) => UPCOMING.includes(b.status) && new Date(b.endsAt) > new Date())[0];
  const recent = getRecent();
  const first = me.data ? (i18n.language.startsWith("ar") ? me.data.nameAr : me.data.nameEn) ?? me.data.nameEn ?? me.data.nameAr : null;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl">{first ? t("home.greeting", { name: first }) : t("home.greetingAnon")}</h1>
        <SearchBar />
        <SpecialtyChips onPick={(code) => nav(code ? `/search?specialty=${code}` : "/search")} />
      </section>

      {family.enabled && <FamilySwitcher />}
      <PulseDivider />

      <section aria-labelledby="upcoming-title" className="space-y-3">
        <h2 id="upcoming-title" className="text-xl">{t("home.upcoming")}</h2>
        {bookings.isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : bookings.error ? <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} /> : upcoming ? (
          <Link to={`/appointments/${upcoming.id}`} className="kx-card block p-5 transition-colors hover:border-primary" data-testid="upcoming-card">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-lg font-semibold">{pick(upcoming.doctor, "name", i18n.language)}</p>
                <p className="text-sm text-muted-foreground">{pick(upcoming.clinic, "name", i18n.language)} · {nameOf(upcoming.patient.id)}</p>
                <p className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4 text-ocean" aria-hidden="true" />{formatDayLong(upcoming.startsAt, i18n.language)} · <span dir="ltr">{formatTime(upcoming.startsAt, i18n.language)}</span></p>
              </div>
              <div className="flex items-center gap-2"><Badge variant={upcoming.status === "CONFIRMED" ? "success" : "warning"}>{t(`status.${upcoming.status}`)}</Badge><ChevronRight className="h-5 w-5 rtl-flip text-muted-foreground" aria-hidden="true" /></div>
            </div>
          </Link>
        ) : (
          <EmptyState icon={<CalendarCheck className="h-10 w-10" aria-hidden="true" />} title={t("home.noUpcoming")} hint={t("home.noUpcomingHint")} action={<Link to="/search" className={cn(buttonVariants())}>{t("home.findDoctor")}</Link>} />
        )}
      </section>

      <section aria-labelledby="recent-title" className="space-y-3">
        <h2 id="recent-title" className="text-xl">{t("home.recent")}</h2>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">{t("home.recentEmpty")}</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((d) => (
              <li key={d.id}><Link to={`/doctors/${d.id}`} className="kx-card flex min-h-14 items-center justify-between p-4 hover:border-primary"><span className="font-medium">{pick(d, "name", i18n.language)}</span><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
