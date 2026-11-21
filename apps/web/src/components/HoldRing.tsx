import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Countdown ring for the slot hold. The ring's full length is the time left when it first rendered (the API hold is 5 minutes). */
export function HoldRing({ remainingMs }: { remainingMs: number }) {
  const { t } = useTranslation();
  const [total, setTotal] = useState(() => Math.max(remainingMs, 1));
  if (remainingMs > total) setTotal(remainingMs); // derived-state update during render (React-sanctioned); the ring only ever grows its reference
  const frac = Math.min(1, Math.max(0, remainingMs / Math.max(total, remainingMs)));
  const low = remainingMs < 60_000;
  const R = 26, C = 2 * Math.PI * R;
  return (
    <div role="timer" aria-live="off" data-testid="hold-countdown" className={cn("kx-card flex items-center gap-4 p-4", low && "border-warning bg-warning-soft")}>
      <div className="relative h-16 w-16 shrink-0" dir="ltr">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden="true">
          <circle cx="32" cy="32" r={R} fill="none" strokeWidth="5" className="stroke-border" />
          <circle cx="32" cy="32" r={R} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} className={cn("transition-[stroke-dashoffset] duration-1000 ease-linear", low ? "stroke-warning" : "stroke-pulse")} />
        </svg>
        <AlarmClock className={cn("absolute inset-0 m-auto h-5 w-5", low ? "text-warning" : "text-primary")} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("checkout.holdLabel")}</p>
        <p className="kx-label-num text-3xl font-semibold leading-tight" dir="ltr" aria-label={t("checkout.holdRemaining", { time: formatCountdown(remainingMs) })}>{formatCountdown(remainingMs)}</p>
      </div>
    </div>
  );
}
