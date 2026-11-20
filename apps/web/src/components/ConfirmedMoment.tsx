import { useTranslation } from "react-i18next";
import { CalendarPlus, ClipboardList, Navigation, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { directionsUrl } from "@/components/ClinicMap";
import { buildIcs, downloadIcs } from "@/lib/ics";
import { formatDayLong, formatTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Booking } from "@/api/types";

/** The confirmation moment: ring + check + pulse draw themselves once (static under reduced motion), then the next useful actions. */
export function ConfirmedMoment({ booking: b }: { booking: Booking }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isHome = b.serviceLocation === "HOME";
  const bring = [t("appointment.bring1"), t("appointment.bring2"), t("appointment.bring3"), t("appointment.bring4")];
  const act = cn(buttonVariants({ variant: "outline" }), "h-auto min-h-16 flex-col gap-1 px-2 py-3 text-xs sm:text-sm");
  return (
    <section role="status" className="kx-hero relative overflow-hidden rounded-3xl border border-success/30 px-6 py-10 text-center shadow-float" data-testid="booking-confirmed">
      <svg viewBox="0 0 160 160" className="mx-auto h-32 w-32" aria-hidden="true" focusable="false">
        <circle cx="80" cy="80" r="62" className="fill-success-soft" />
        <circle cx="80" cy="80" r="62" fill="none" strokeWidth="5" strokeLinecap="round" pathLength={1} className="kx-draw stroke-success" transform="rotate(-90 80 80)" />
        <path d="M54 82 L72 99 L107 61" fill="none" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="kx-draw stroke-success" style={{ ["--kx-delay" as string]: "650ms" }} />
        <path d="M6 126 H52 L60 116 L68 140 L78 108 L86 134 L92 126 H154" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="kx-draw stroke-pulse" style={{ ["--kx-delay" as string]: "1100ms" }} />
      </svg>
      <h2 className="kx-pop mt-3 text-3xl" style={{ ["--kx-delay" as string]: "900ms" }}>{t("appointment.confirmedTitle")}</h2>
      <p className="mt-1 font-medium">{pick(b.doctor, "name", lang)} · {formatDayLong(b.startsAt, lang)} · <span dir="ltr" className="kx-label-num">{formatTime(b.startsAt, lang)}</span></p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("appointment.confirmedBody")}</p>
      <div className="mx-auto mt-6 grid max-w-xl grid-cols-3 gap-2 sm:gap-3">
        <button type="button" className={act} onClick={() => downloadIcs(`kiorex-${b.id}.ics`, buildIcs({ id: b.id, title: pick(b.doctor, "name", "en"), location: pick(b.clinic, "address", "en"), startsAt: b.startsAt, endsAt: b.endsAt }))} data-testid="confirmed-calendar"><CalendarPlus className="h-5 w-5 text-ocean" aria-hidden="true" />{t("appointment.addToCalendar")}</button>
        {!isHome && <a href={directionsUrl(b.clinic)} target="_blank" rel="noreferrer" className={act}><Navigation className="rtl-flip h-5 w-5 text-ocean" aria-hidden="true" />{t("appointment.directions")}</a>}
        {!isHome && <a href={`tel:${b.clinic.phone.replace(/\s/g, "")}`} className={act}><Phone className="h-5 w-5 text-ocean" aria-hidden="true" />{t("appointment.call")}</a>}
      </div>
      <div className="mx-auto mt-6 max-w-xl rounded-2xl border bg-card p-4 text-start">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-ocean" aria-hidden="true" />{t("appointment.bringTitle")}</h3>
        <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">{bring.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pulse" aria-hidden="true" />{x}</li>)}</ul>
      </div>
    </section>
  );
}
