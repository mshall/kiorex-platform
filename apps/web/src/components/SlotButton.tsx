import { useTranslation } from "react-i18next";
import { formatDay, formatTime, relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Slot } from "@/api/types";

/** Tappable time chip. With `showDay` it is labelled "Today / Tomorrow / Sat 21 Nov" above the time (search cards, reschedule). */
export function SlotButton({ slot, onPick, selected, showDay = true, disabled, className }: { slot: Slot; onPick: (s: Slot) => void; selected?: boolean; showDay?: boolean; disabled?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const rel = showDay ? relativeDay(slot.startsAt) : null;
  return (
    <button type="button" disabled={disabled} aria-pressed={selected} onClick={() => onPick(slot)} data-testid="slot-button" className={cn("kx-slot", className)}>
      {showDay && <span className={cn("text-[11px] font-medium leading-4", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{rel ? t(`results.${rel}`) : formatDay(slot.startsAt, i18n.language)}</span>}
      <span className="kx-label-num leading-5" dir="ltr">{formatTime(slot.startsAt, i18n.language)}</span>
    </button>
  );
}
