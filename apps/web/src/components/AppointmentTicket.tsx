import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import { StatusChip } from "@/components/kit";
import { formatDayNum, formatMonthShort, formatTime, formatWeekdayShort, pick, relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Booking } from "@/api/types";

/** Date block + visit summary, shared by Home (next appointment) and the appointments list. */
export function DateBlock({ iso, className }: { iso: string; className?: string }) {
  const { i18n } = useTranslation();
  const l = i18n.language;
  return (
    <div className={cn("flex h-[4.5rem] w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-ocean text-white shadow-raised", className)} aria-hidden="true">
      <span className="text-[11px] font-medium uppercase leading-4 tracking-wide opacity-90">{formatWeekdayShort(iso, l)}</span>
      <span className="kx-label-num text-2xl font-semibold leading-7">{formatDayNum(iso, l)}</span>
      <span className="text-[11px] font-medium leading-4 opacity-90">{formatMonthShort(iso, l)}</span>
    </div>
  );
}

export function statusTone(s: Booking["status"]): "success" | "warning" | "danger" | "info" | "neutral" | "brand" {
  return s === "CONFIRMED" || s === "COMPLETED" ? "success" : s === "PENDING_CLINIC" || s === "HELD" ? "warning" : s === "CHECKED_IN" ? "info" : s === "CANCELLED" || s === "NO_SHOW" ? "danger" : "neutral";
}

export function AppointmentTicket({ booking: b, patientName }: { booking: Booking; patientName?: string }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const rel = relativeDay(b.startsAt);
  return (
    <Link to={`/appointments/${b.id}`} className="kx-card kx-card-interactive group flex items-center gap-4 p-4 sm:p-5" data-testid="upcoming-card">
      <DateBlock iso={b.startsAt} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-lg font-semibold">{pick(b.doctor, "name", l)}</p>
          <StatusChip tone={statusTone(b.status)}>{t(`status.${b.status}`)}</StatusChip>
        </div>
        <p className="flex items-center gap-1.5 text-sm"><Clock className="h-4 w-4 text-ocean" aria-hidden="true" />{rel && <span className="font-medium">{t(`results.${rel}`)} ·</span>}<span className="kx-label-num" dir="ltr">{formatTime(b.startsAt, l)}</span></p>
        <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{b.serviceLocation === "HOME" ? t("hv.homeVisitAt") : pick(b.clinic, "name", l)}{patientName && ` · ${patientName}`}</p>
      </div>
      <ChevronRight className="rtl-flip h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
