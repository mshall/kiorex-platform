import { MapPin, Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Clinic } from "@/api/types";
import { pick } from "@/lib/format";

export const directionsUrl = (c: Clinic) =>
  c.lat != null && c.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pick(c, "address", "en"))}`;

/** Clinic map placeholder (KXMPR02): address + directions link; an interactive map arrives with KXMDS05 (P2). */
export function ClinicMap({ clinic }: { clinic: Clinic }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border" data-testid="clinic-map">
      <div className="relative flex h-40 items-center justify-center bg-accent" role="img" aria-label={t("doctor.mapPlaceholder")}>
        <svg className="absolute inset-0 h-full w-full text-border" aria-hidden="true"><defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
        <MapPin className="relative h-9 w-9 text-pulse" aria-hidden="true" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="font-medium">{pick(clinic, "name", i18n.language)}</p><p className="text-sm text-muted-foreground">{pick(clinic, "address", i18n.language)}</p></div>
        <a href={directionsUrl(clinic)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}><Navigation className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("appointment.directions")}</a>
      </div>
    </div>
  );
}
