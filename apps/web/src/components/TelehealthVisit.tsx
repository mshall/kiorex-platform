import { useTranslation } from "react-i18next";
import { Video } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBanner } from "@/components/kit";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Telehealth } from "@/api/types";

/**
 * Clinic-owned video visit. The Clinic hosts the peer-to-peer call at its public page (`joinUrl` = .../v/<token>); Kiorex only shows the state,
 * the join window and the button. The page asks for camera and microphone itself, so we open it in a new tab (same-origin popups are never needed).
 */
export function telehealthPhase(t: Telehealth, now = Date.now()): "inPerson" | "cancelled" | "ended" | "missed" | "beforeWindow" | "open" | "live" | "windowPassed" | "noLink" {
  if (t.state === "IN_PERSON") return "inPerson";
  if (t.state === "CANCELLED") return "cancelled";
  if (t.state === "ENDED") return "ended";
  if (t.state === "MISSED") return "missed";
  if (!t.joinUrl) return "noLink";
  if (now > new Date(t.closesAt).getTime()) return "windowPassed";
  if (t.state === "LIVE") return "live";
  return now < new Date(t.opensAt).getTime() ? "beforeWindow" : "open";
}

export function TelehealthVisit({ telehealth: tv, className }: { telehealth: Telehealth; className?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const opens = useCountdown(tv.state === "SCHEDULED" ? tv.opensAt : null);
  const phase = telehealthPhase(tv);
  const before = phase === "beforeWindow" && !opens.expired;
  const joinable = phase === "open" || phase === "live" || (phase === "beforeWindow" && opens.expired);
  const text = { inPerson: t("tele.visit.inPerson"), cancelled: t("tele.visit.cancelled"), ended: t("tele.visit.ended"), missed: t("tele.visit.missed"), windowPassed: t("tele.visit.windowPassed"), noLink: t("tele.visit.noLink") } as Record<string, string>;
  const tone = phase === "inPerson" ? "info" : phase === "live" ? "success" : phase === "missed" || phase === "windowPassed" ? "warning" : "neutral";
  return (
    <section className={cn("kx-card space-y-3 p-5", className)} aria-labelledby="tv-h" data-testid="telehealth-visit" data-phase={phase}>
      <h2 id="tv-h" className="flex items-center gap-2 text-lg"><Video className="h-5 w-5 text-primary" aria-hidden="true" />{t("tele.visit.title")}</h2>
      {tv.movedFrom && <p className="text-sm text-muted-foreground" data-testid="tele-moved">{t("tele.visit.moved", { time: formatDateTime(tv.movedFrom, lang) })}</p>}
      {text[phase] && <StatusBanner tone={tone} data-testid="tele-phase-note">{text[phase]}</StatusBanner>}
      {before && (
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-accent/60 py-5 text-center" aria-live="polite" data-testid="tele-countdown">
          <p className="text-sm text-muted-foreground">{t("tele.visit.opensIn")}</p>
          <p className="kx-label-num text-4xl font-semibold" dir="ltr">{formatCountdown(opens.remainingMs ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{t("tele.visit.opensAt", { time: formatDateTime(tv.opensAt, lang) })}</p>
        </div>
      )}
      {(phase === "open" || phase === "live") && <p className="text-sm" role="status">{phase === "live" ? t("tele.visit.live") : t("tele.visit.opensNow")}</p>}
      {(phase === "beforeWindow" || phase === "open" || phase === "live") && (
        joinable
          ? <a href={tv.joinUrl ?? "#"} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")} data-testid="tele-join-visit"><Video aria-hidden="true" />{t("tele.visit.join")}</a>
          : <span className={cn(buttonVariants({ size: "lg" }), "pointer-events-none w-full opacity-50 sm:w-auto")} aria-disabled="true" data-testid="tele-join-visit-disabled"><Video aria-hidden="true" />{t("tele.visit.join")}</span>
      )}
      {(phase === "beforeWindow" || phase === "open" || phase === "live") && (
        <>
          <p className="text-xs text-muted-foreground">{t("tele.visit.closes", { time: formatDateTime(tv.closesAt, lang) })}</p>
          <p className="text-xs text-muted-foreground">{t("tele.visit.hint")}</p>
        </>
      )}
    </section>
  );
}
