import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatDay, formatTime } from "@/lib/format";
import type { Slot } from "@/api/types";

export function SlotButton({ slot, onPick, selected, showDay = true, disabled }: { slot: Slot; onPick: (s: Slot) => void; selected?: boolean; showDay?: boolean; disabled?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <button
      type="button" disabled={disabled} aria-pressed={selected} onClick={() => onPick(slot)} data-testid="slot-button"
      className={cn("flex min-h-11 min-w-[5.5rem] flex-col items-center justify-center rounded-xl border bg-card px-3 py-1 text-sm font-medium transition-colors hover:border-primary hover:bg-accent disabled:opacity-50",
        selected && "border-pulse bg-pulse/15")}
    >
      {showDay && <span className="text-xs text-muted-foreground">{formatDay(slot.startsAt, i18n.language)}</span>}
      <span className="kx-label-num" dir="ltr">{formatTime(slot.startsAt, i18n.language)}</span>
    </button>
  );
}
