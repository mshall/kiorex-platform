import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDay, formatTime } from "@/lib/format";
import type { Booking, BookingStatus } from "@/api/types";

/** What can still happen next, so the patient sees where the visit is heading (only reached states carry timestamps). */
const NEXT: Partial<Record<BookingStatus, BookingStatus[]>> = { PENDING_CLINIC: ["CONFIRMED", "CHECKED_IN", "COMPLETED"], CONFIRMED: ["CHECKED_IN", "COMPLETED"], CHECKED_IN: ["COMPLETED"] };

/** Status timeline per the KX-03 §05 state machine: connected rail, reached steps filled, the current one pulsing, upcoming ones outlined. */
export function StatusTimeline({ booking }: { booking: Booking }) {
  const { t, i18n } = useTranslation();
  const events = booking.timeline.filter((e) => e.status !== "INTENT");
  const last = events[events.length - 1];
  const upcoming = last ? (NEXT[last.status] ?? []) : [];
  return (
    <ol className="relative" aria-label={t("appointment.timeline")} data-testid="status-timeline">
      {events.map((e, i) => {
        const current = e === last && upcoming.length >= 0 && !["COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"].includes(e.status);
        const end = i === events.length - 1 && upcoming.length === 0;
        return (
          <li key={`${e.status}-${i}`} className="relative flex gap-4 pb-6 last:pb-0" aria-current={current ? "step" : undefined}>
            {!end && <span className={cn("absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5", current ? "bg-border" : "bg-primary/60")} aria-hidden="true" />}
            <span className={cn("relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", current ? "bg-pulse/20 ring-2 ring-pulse" : "bg-primary text-primary-foreground")}>
              {current ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-pulse motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div>
              <p className="font-semibold leading-7">{t(`status.${e.status}`)}</p>
              <p className="text-xs text-muted-foreground"><time dateTime={e.at}>{formatDay(e.at, i18n.language)} · <span dir="ltr">{formatTime(e.at, i18n.language)}</span></time></p>
              {e.note && <p className="mt-1 text-sm text-muted-foreground">{e.note}</p>}
            </div>
          </li>
        );
      })}
      {upcoming.map((s, i) => (
        <li key={s} className="relative flex gap-4 pb-6 last:pb-0 opacity-70" data-upcoming="true">
          {i < upcoming.length - 1 && <span className="absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 border-s-2 border-dashed border-border" aria-hidden="true" />}
          <span className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border bg-card" aria-hidden="true" />
          <div><p className="font-medium leading-7 text-muted-foreground">{t(`status.${s}`)}</p><p className="text-xs text-muted-foreground">{t("appointment.upcomingStep")}</p></div>
        </li>
      ))}
    </ol>
  );
}
