import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Globe2, Sparkles } from "lucide-react";
import { cairoOffsetLabel, formatDayLong, formatDayNum, formatMonthShort, formatTime, formatWeekdayShort, relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Slot } from "@/api/types";
import { SlotButton } from "./SlotButton";

const hourCairo = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Cairo" }).format(new Date(iso))) % 24;
type Period = "morning" | "afternoon" | "evening";
const periodOf = (iso: string): Period => { const h = hourCairo(iso); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

/** Week strip + time chips grouped by part of day, a "next available" shortcut and an explicit timezone line. */
export function SlotPicker({ days, day, onDay, selected, onSelect }: { days: [string, Slot[]][]; day: string | null; onDay: (k: string) => void; selected: Slot | null; onSelect: (s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const next = days[0]?.[1][0];
  const dayList = useMemo(() => days.find(([k]) => k === day)?.[1] ?? [], [days, day]);
  const groups = useMemo(() => {
    const g: Record<Period, Slot[]> = { morning: [], afternoon: [], evening: [] };
    for (const s of dayList) g[periodOf(s.startsAt)].push(s);
    return (Object.keys(g) as Period[]).filter((p) => g[p].length).map((p) => [p, g[p]] as const);
  }, [dayList]);
  const nextRel = next ? relativeDay(next.startsAt) : null;
  return (
    <div className="space-y-4" data-testid="slot-calendar">
      {next && (
        <button type="button" onClick={() => { onDay(days[0][0]); onSelect(next); }} data-testid="next-available"
          className="group flex w-full items-center justify-between gap-3 rounded-xl border border-primary/25 bg-accent px-4 py-3 text-start transition-colors hover:border-primary">
          <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
            <span><span className="block text-xs font-medium text-muted-foreground">{t("doctor.nextAvailable")}</span>
              <span className="block text-sm font-semibold">{nextRel ? t(`results.${nextRel}`) : formatDayLong(next.startsAt, lang)} · <span className="kx-label-num" dir="ltr">{formatTime(next.startsAt, lang)}</span></span></span></span>
          <ChevronRight className="rtl-flip h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
        </button>
      )}
      <div className="-mx-1 snap-x overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("doctor.days")}>
        <div className="flex gap-2">
          {days.map(([k, list]) => {
            const on = day === k;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => onDay(k)} className={cn("flex min-h-[4.5rem] w-16 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition-[background-color,border-color,box-shadow,transform] duration-150", on ? "border-primary bg-primary text-primary-foreground shadow-raised" : "bg-card hover:border-primary hover:bg-accent")}>
                <span className={cn("text-[11px] font-medium uppercase leading-4", on ? "text-primary-foreground/85" : "text-muted-foreground")}>{formatWeekdayShort(list[0].startsAt, lang)}</span>
                <span className="kx-label-num text-xl font-semibold leading-6">{formatDayNum(list[0].startsAt, lang)}</span>
                <span className={cn("text-[11px] leading-4", on ? "text-primary-foreground/85" : "text-muted-foreground")}>{formatMonthShort(list[0].startsAt, lang)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-sm font-medium" aria-live="polite">{dayList[0] ? formatDayLong(dayList[0].startsAt, lang) : ""}<span className="ms-2 font-normal text-muted-foreground">· {t("doctor.slotsCount", { count: dayList.length })}</span></p>
      <div className="space-y-3" role="group" aria-label={t("doctor.times")}>
        {groups.map(([p, list]) => (
          <div key={p} className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{t(`doctor.period.${p}`)}</p>
            <div className="flex flex-wrap gap-2">{list.map((s) => <SlotButton key={s.slotId} slot={s} showDay={false} selected={selected?.slotId === s.slotId} onPick={onSelect} />)}</div>
          </div>
        ))}
      </div>
      {dayList[0] && <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="tz-note"><Globe2 className="h-3.5 w-3.5" aria-hidden="true" />{t("doctor.timezone", { offset: cairoOffsetLabel(dayList[0].startsAt, lang) })}</p>}
    </div>
  );
}
