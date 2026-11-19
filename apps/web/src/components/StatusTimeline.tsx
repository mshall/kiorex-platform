import { useTranslation } from "react-i18next";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDay, formatTime } from "@/lib/format";
import type { Booking } from "@/api/types";

/** Status timeline per the KX-03 §05 state machine; only reached states have timestamps. */
export function StatusTimeline({ booking }: { booking: Booking }) {
  const { t, i18n } = useTranslation();
  const events = booking.timeline.filter((e) => e.status !== "INTENT");
  const last = events[events.length - 1];
  return (
    <ol className="space-y-4" aria-label={t("appointment.timeline")} data-testid="status-timeline">
      {events.map((e, i) => {
        const current = e === last;
        return (
          <li key={`${e.status}-${i}`} className="flex gap-3" aria-current={current ? "step" : undefined}>
            <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", current ? "border-pulse bg-pulse/20" : "border-primary bg-primary text-primary-foreground")}>
              {current ? <Circle className="h-2.5 w-2.5 fill-pulse text-pulse" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <div>
              <p className="font-medium">{t(`status.${e.status}`)}</p>
              <p className="text-xs text-muted-foreground"><time dateTime={e.at}>{formatDay(e.at, i18n.language)} · {formatTime(e.at, i18n.language)}</time></p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
