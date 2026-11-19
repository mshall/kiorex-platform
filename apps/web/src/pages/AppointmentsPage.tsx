import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarCheck, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBookings } from "@/api/hooks";
import type { Booking } from "@/api/types";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { formatDay, formatTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePatient } from "@/hooks/usePatient";

const ACTIVE = ["HELD", "PENDING_CLINIC", "CONFIRMED", "CHECKED_IN"];

export const statusVariant = (s: Booking["status"]) =>
  s === "CONFIRMED" || s === "COMPLETED" ? "success" : s === "PENDING_CLINIC" || s === "HELD" || s === "CHECKED_IN" ? "warning" : s === "CANCELLED" || s === "NO_SHOW" || s === "EXPIRED" ? "secondary" : "info";

function Row({ b }: { b: Booking }) {
  const { t, i18n } = useTranslation();
  const { nameOf } = usePatient();
  return (
    <li>
      <Link to={b.status === "HELD" ? `/checkout/${b.id}` : `/appointments/${b.id}`} className="kx-card flex items-center justify-between gap-3 p-4 hover:border-primary" data-testid="appointment-row">
        <div className="space-y-1">
          <p className="font-semibold">{pick(b.doctor, "name", i18n.language)}</p>
          <p className="text-sm text-muted-foreground">{nameOf(b.patient.id)} · {formatDay(b.startsAt, i18n.language)} · <span dir="ltr">{formatTime(b.startsAt, i18n.language)}</span></p>
        </div>
        <div className="flex items-center gap-2"><Badge variant={statusVariant(b.status)}>{t(`status.${b.status}`)}</Badge><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></div>
      </Link>
    </li>
  );
}

export default function AppointmentsPage() {
  const { t } = useTranslation();
  const q = useBookings();
  const all = q.data ?? [];
  const upcoming = all.filter((b) => ACTIVE.includes(b.status));
  const past = all.filter((b) => !ACTIVE.includes(b.status)).reverse();
  const empty = (key: string) => (
    <EmptyState icon={<CalendarCheck className="h-10 w-10" aria-hidden="true" />} title={t(`appointments.empty.${key}`)} action={<Link to="/search" className={cn(buttonVariants())}>{t("home.findDoctor")}</Link>} />
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl">{t("appointments.title")}</h1>
      {q.isLoading ? <CardSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <Tabs defaultValue="upcoming">
          <TabsList className="h-auto"><TabsTrigger value="upcoming" className="min-h-11 px-5">{t("appointments.upcoming")}</TabsTrigger><TabsTrigger value="past" className="min-h-11 px-5">{t("appointments.past")}</TabsTrigger></TabsList>
          <TabsContent value="upcoming" className="mt-4">{upcoming.length ? <ul className="space-y-3">{upcoming.map((b) => <Row key={b.id} b={b} />)}</ul> : empty("upcoming")}</TabsContent>
          <TabsContent value="past" className="mt-4">{past.length ? <ul className="space-y-3">{past.map((b) => <Row key={b.id} b={b} />)}</ul> : empty("past")}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
